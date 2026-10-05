import type { Client } from '@temporalio/client';
import { NativeConnection, type Worker } from '@temporalio/worker';
import { Pool } from 'pg';
import { readConfig } from '../../../src/distributed/shared/config.js';
import {
  type RecordStore,
  storeFor,
} from '../../../src/distributed/shared/store.js';
import {
  startTelemetry,
  type Telemetry,
} from '../../../src/distributed/shared/telemetry.js';
import { reachTemporal } from '../../../src/distributed/temporal/client.js';
import { createWorkers } from '../../../src/distributed/temporal/workers.js';

/**
 * The real mechanism, running inside a spec.
 *
 * The workers here are the ones `worker.ts` runs: same construction,
 * same interceptors, same queues, same bounded slots. A suite that
 * started a worker of its own would be testing a worker nobody deploys.
 *
 * It needs the stack up and migrated.
 */

/** Everything a spec needs to start work and then look at what happened. */
export type TemporalHarness = {
  /** How a spec starts a run, or answers something from outside. */
  readonly client: Client;
  /** How a spec looks at what was committed. */
  readonly store: RecordStore;
  /** For the queries a spec makes that the store has no business having. */
  readonly pool: Pool;
  /** What the workers record against, for flushing before reading it back. */
  readonly telemetry: Telemetry;
  /** Stops the workers, finishes what is in flight, and lets go. */
  readonly stop: () => Promise<void>;
};

/**
 * Starts the mechanism and hands back the ways in.
 *
 * @param serviceName - What this spec's process calls itself in a trace,
 * so one spec's spans can be told from another's.
 */
export const startTemporalHarness = async (
  serviceName: string,
): Promise<TemporalHarness> => {
  const config = readConfig(serviceName);
  const telemetry = startTelemetry(config);

  const pool = new Pool({
    connectionString: config.recordsUrl,
    max: config.recordsPoolSize,
    connectionTimeoutMillis: 5_000,
  });

  const connection = await NativeConnection.connect({
    address: config.temporalAddress,
  });
  const reach = await reachTemporal(config);

  const workers: readonly Worker[] = await createWorkers({
    config,
    telemetry,
    connection,
    pool,
  });
  // Not awaited: they run until asked to stop, which is what stop does.
  const running = workers.map((worker) => worker.run());

  return {
    client: reach.client,
    store: storeFor(pool),
    pool,
    telemetry,
    stop: async () => {
      for (const worker of workers) worker.shutdown();
      await Promise.all(running);
      await reach.close();
      await connection.close();
      await pool.end();
      await telemetry.shutdown();
    },
  };
};

/**
 * Empties the store, so one spec's rows are not another's evidence.
 *
 * Truncated rather than deleted, because a record may not be deleted.
 */
export const emptyTheStore = async (pool: Pool): Promise<void> => {
  await pool.query('TRUNCATE outbox, execution_record, needs_a_person');
};

/**
 * Waits for something to become true, or gives up saying what it wanted.
 *
 * Every wait in these specs is on a real cluster doing real work, so
 * there is no moment at which a result is guaranteed to have arrived —
 * only a point past which something is wrong.
 */
export const until = async <TFound>(
  what: string,
  look: () => Promise<TFound | null>,
  within = 60_000,
): Promise<TFound> => {
  const giveUpAt = Date.now() + within;
  let last: unknown = null;

  while (Date.now() < giveUpAt) {
    try {
      const found = await look();
      if (found !== null) return found;
    } catch (raised) {
      last = raised;
    }
    await new Promise((settle) => setTimeout(settle, 250));
  }

  throw new Error(
    `${what} never happened within ${within}ms${last === null ? '' : `: ${String(last)}`}`,
  );
};
