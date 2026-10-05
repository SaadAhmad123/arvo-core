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
 * These are the workers `worker.ts` runs: same construction, same
 * interceptors, same queues, same bounded slots.
 *
 * Needs the stack up and migrated.
 */

/** Everything a spec needs to start work and then see what happened. */
export type TemporalHarness = {
  readonly client: Client;
  readonly store: RecordStore;
  /** For the queries a spec makes that the store has no business having. */
  readonly pool: Pool;
  readonly telemetry: Telemetry;
  /** Stops the workers, finishes what is in flight, and lets go. */
  readonly stop: () => Promise<void>;
};

/**
 * Starts the mechanism and hands back the ways in.
 *
 * @param serviceName - What this spec calls itself in a trace.
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
  const runningWorkers = workers.map((worker) => worker.run());

  return {
    client: reach.client,
    store: storeFor(pool),
    pool,
    telemetry,
    stop: async () => {
      for (const worker of workers) worker.shutdown();
      await Promise.all(runningWorkers);
      await reach.close();
      await connection.close();
      await pool.end();
      await telemetry.shutdown();
    },
  };
};

/** Empties the store, so one spec's rows are not another's evidence. */
export const emptyTheStore = async (pool: Pool): Promise<void> => {
  // truncated rather than deleted, because a record may not be deleted
  await pool.query('TRUNCATE outbox, execution_record, needs_a_person');
};

/**
 * Waits for something to become true, or gives up saying what it wanted.
 *
 * @param description - What was wanted, read out in the failure.
 * @param attemptOnce - One attempt, answering null while the answer is absent.
 * @param within - How long to keep attempting.
 */
export const until = async <TFound>(
  description: string,
  attemptOnce: () => Promise<TFound | null>,
  within = 60_000,
): Promise<TFound> => {
  const giveUpAfter = Date.now() + within;
  let lastFailure: unknown = null;

  while (Date.now() < giveUpAfter) {
    try {
      const answer = await attemptOnce();
      if (answer !== null) return answer;
    } catch (failure) {
      lastFailure = failure;
    }
    await new Promise((settle) => setTimeout(settle, 250));
  }

  throw new Error(
    `${description} never happened within ${within}ms${lastFailure === null ? '' : `: ${String(lastFailure)}`}`,
  );
};

/** The latest record of the one execution of this contract, once there is one. */
export const recordOf = async (
  pool: Pool,
  contractType: string,
): Promise<{ executionId: string; lifecycle: string; document: JSONRecord }> =>
  until(`a record for ${contractType}`, async () => {
    const latest = await pool.query<{
      executionId: string;
      lifecycle: string;
      document: JSONRecord;
    }>(
      `SELECT execution_id AS "executionId", lifecycle, document
       FROM execution_record
       WHERE source = $1
       ORDER BY cas_version DESC
       LIMIT 1`,
      [contractType],
    );
    return latest.rows[0] ?? null;
  });

/** What a stored record looks like to a spec reading one field off it. */
type JSONRecord = Record<string, unknown> & {
  data?: Record<string, unknown>;
};
