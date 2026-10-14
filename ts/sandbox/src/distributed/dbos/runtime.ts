import { DBOS } from '@dbos-inc/dbos-sdk';
import { Pool } from 'pg';
import type { DistributedConfig } from '../shared/config.js';
import { storeFor } from '../shared/record-store.js';
import { createParkStep, createSteps } from './steps.js';
import { createWorkflows, type Workflows } from './workflows.js';

/**
 * This mechanism, brought up and taken down.
 *
 * One place, because registration has an order DBOS enforces: every
 * workflow and step must be registered before `launch`, and a run
 * recovered after a crash is replayed against whatever is registered
 * then. A worker that registered one step late would be a worker that
 * cannot finish a run it already started.
 *
 * So a spec and the worker process bring this up the same way. The
 * alternative — a spec registering its own subset — is a spec proving
 * something about a mechanism nobody deploys.
 */

/**
 * What DBOS files this application's workflows under.
 *
 * Part of its system database's contents rather than a label, so
 * changing it orphans every run in flight.
 */
const DBOS_APPLICATION = 'arvo';

/** What one run of this mechanism needs, and how to let go of it. */
export type DbosRuntime = {
  /** The workflows a caller may start. */
  readonly workflows: Workflows;
  /** The handlers' own data, for a caller that wants to look at it. */
  readonly pool: Pool;
  /** Stops DBOS, finishes what is in flight, and lets go. */
  readonly stop: () => Promise<void>;
};

/**
 * Registers everything, launches DBOS, and hands back the ways in.
 *
 * @param config - Where the databases are and how much this worker takes
 * on at once.
 */
export const startDbos = async (
  config: DistributedConfig,
): Promise<DbosRuntime> => {
  // The handlers' own data and the execution records: the same server as
  // DBOS's own state, a different database. A mechanism's state and an
  // application's records are different things.
  const pool = new Pool({
    connectionString: config.recordsUrl,
    max: config.recordsPoolSize,
    // a failure a handler can see, rather than a hang indistinguishable
    // from being slow
    connectionTimeoutMillis: 5_000,
  });

  DBOS.setConfig({
    // Fixed, not the telemetry service name. DBOS scopes workflows,
    // queues and recovery by application name, so a worker and anything
    // else that brings this up must agree on it — two names would mean
    // a run started under one is never recovered by the other, while
    // both still look correct in a trace.
    name: DBOS_APPLICATION,
    systemDatabaseUrl: config.dbosSystemUrl,
    // Bounded, so a wide fan-out makes a run slower rather than taking
    // every connection DBOS needs to record what it is doing.
    systemDatabasePoolSize: config.recordsPoolSize,
    enableOTLP: true,
    logLevel: 'warn',
  });

  const scope = { store: storeFor(pool), pool };
  const workflows = createWorkflows({
    steps: createSteps(scope),
    park: createParkStep(scope),
  });

  await DBOS.launch();

  return {
    workflows,
    pool,
    stop: async () => {
      await DBOS.shutdown();
      await pool.end();
    },
  };
};
