import type { Pool } from 'pg';
import { startDbos } from '../../../src/distributed/dbos/runtime.js';
import type { Steps } from '../../../src/distributed/dbos/steps.js';
import type { Workflows } from '../../../src/distributed/dbos/workflows.js';
import { readConfig } from '../../../src/distributed/shared/config.js';

/**
 * The real mechanism, running inside a spec.
 *
 * This is what `worker.ts` runs: the same registration, in the same
 * order, against the same databases. A spec that registered its own
 * subset would be proving something about a mechanism nobody deploys.
 *
 * Needs the stack up and migrated — including DBOS's own system
 * database, which `pnpm distributed:migrate` creates.
 */

/** Everything a spec needs to start work and then see what happened. */
export type DbosHarness = {
  /** The workflows a spec may start. */
  readonly workflows: Workflows;
  /**
   * One delivery per handler, outside any workflow.
   *
   * A step called outside a workflow is an ordinary function call, which
   * is how an obligation about one delivery is asserted without a run
   * around it. It is the same function a workflow calls — the durability
   * is what differs, not the work.
   */
  readonly steps: Steps;
  /** Both stores: the handlers' own data and the execution records. */
  readonly pool: Pool;
  /** Stops DBOS, finishes what is in flight, and lets go. */
  readonly stop: () => Promise<void>;
};

/**
 * Starts the mechanism and hands back the ways in.
 *
 * @param serviceName - What this spec calls itself in a trace.
 */
export const startDbosHarness = async (
  serviceName: string,
): Promise<DbosHarness> => {
  const runtime = await startDbos(readConfig(serviceName));

  return {
    workflows: runtime.workflows,
    steps: runtime.steps,
    pool: runtime.pool,
    stop: runtime.stop,
  };
};
