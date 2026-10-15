import type { Client } from '@temporalio/client';
import { NativeConnection, type Worker } from '@temporalio/worker';
import { Pool } from 'pg';
import { readConfig } from '../../../src/distributed/shared/config.js';
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
 * Needs the cluster up and the handlers' store migrated. The mechanism
 * keeps nothing in that store — the handlers read their own data from it.
 */

/** Everything a spec needs to start work and then see what happened. */
export type TemporalHarness = {
  readonly client: Client;
  readonly telemetry: Telemetry;
  /** The handlers' own data, for a spec that wants to look at it. */
  readonly pool: Pool;
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

  const connection = await NativeConnection.connect({
    address: config.temporalAddress,
  });
  const reach = await reachTemporal(config);
  const pool = new Pool({
    connectionString: config.recordsUrl,
    max: config.recordsPoolSize,
    connectionTimeoutMillis: 5_000,
  });

  const workers: readonly Worker[] = await createWorkers({
    config,
    telemetry,
    connection,
    client: reach.client,
    pool,
  });
  const runningWorkers = workers.map((worker) => worker.run());

  return {
    client: reach.client,
    telemetry,
    pool,
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
