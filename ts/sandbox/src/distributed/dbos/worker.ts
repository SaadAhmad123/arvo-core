import { readConfig } from '../shared/config.js';
import { type Health, healthServer } from '../shared/health.js';
import { startTelemetry, type Telemetry } from '../shared/telemetry.js';
import { startDbos } from './runtime.js';

/**
 * A worker process for this mechanism.
 *
 * It registers everything, launches DBOS, answers whether it is alive
 * and whether it can take work, and stops when it is asked to rather
 * than when it is killed.
 *
 * DBOS has no task-queue poller to stop: a worker takes work by being
 * the process a workflow is running in, and recovers work left by a
 * worker that died by finding it in the system database at launch. So
 * shutting down is a matter of letting go of what is in flight, which
 * `DBOS.shutdown` does.
 *
 * Run directly: `pnpm run distributed:dbos:worker`.
 */

const main = async (): Promise<void> => {
  const config = readConfig('arvo-dbos-worker');
  const telemetry: Telemetry = startTelemetry(config);

  const health: Health = { alive: true, ready: false };
  const server = healthServer(config.healthPort, health);

  const runtime = await startDbos(config);

  /** Resolves when this process has been asked to stop. */
  const askedToStop = new Promise<void>((resolve) => {
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.once(signal, () => {
        // stop being given work before giving any of it back
        health.ready = false;
        resolve();
      });
    }
  });

  health.ready = true;
  console.log(
    `  dbos is up, health on ${config.healthPort}, records in ${config.recordsUrl}`,
  );

  await askedToStop;

  health.alive = false;
  server.close();
  await runtime.stop();
  // last: an unexported span may as well not have been recorded
  await telemetry.shutdown();
};

main().catch((raised: unknown) => {
  console.error(`\n  the worker stopped: ${String(raised)}`);
  // non-zero only on genuine failure: being asked to stop is not one
  process.exitCode = 1;
});
