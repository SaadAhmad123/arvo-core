import { createServer, type Server } from 'node:http';
import { NativeConnection, type Worker } from '@temporalio/worker';
import { Pool } from 'pg';
import { readConfig } from '../shared/config.js';
import { startTelemetry, type Telemetry } from '../shared/telemetry.js';
import { LEAF_QUEUE, ORCHESTRATION_QUEUE } from './queues.js';
import { createWorkers } from './workers.js';

/**
 * A worker process, written the way one would be written to deploy.
 *
 * It refuses to start rather than starting half-configured, says
 * separately whether it is alive and whether it can take work, bounds
 * how much it will take at once, and on a signal stops accepting work,
 * finishes what is in flight, flushes what it recorded and closes what
 * it opened. None of that is incidental: each one is something a
 * deployment finds out about the hard way.
 *
 * The workers themselves are built elsewhere, so that a conformance
 * suite runs these workers rather than something assembled to be
 * convenient.
 *
 * Run directly: `pnpm run distributed:temporal:worker`.
 */

/** What a worker answers on, so a deployment can tell two states apart. */
type Health = {
  /** The process is running and has not been asked to stop. */
  alive: boolean;
  /** It is connected and listening, so work given to it will be done. */
  ready: boolean;
};

/** The endpoint answering whether this process is alive and whether it can work. */
const healthServer = (port: number, health: Health): Server => {
  const server = createServer((asked, answer) => {
    // Alive and ready are different questions. A worker shutting down is
    // alive and must not be given work; one still connecting is neither.
    const answering =
      asked.url === '/ready'
        ? { ok: health.ready, body: health }
        : { ok: health.alive, body: health };

    answer.writeHead(answering.ok ? 200 : 503, {
      'content-type': 'application/json',
    });
    answer.end(JSON.stringify(answering.body));
  });

  server.listen(port);
  return server;
};

/** Everything this process opened, let go of in the order it was opened. */
type Opened = {
  readonly workers: readonly Worker[];
  readonly connection: NativeConnection;
  readonly pool: Pool;
  readonly telemetry: Telemetry;
  readonly server: Server;
};

/** Lets go of everything, once no work is left in flight. */
const letGo = async (opened: Opened, health: Health): Promise<void> => {
  health.alive = false;
  opened.server.close();
  await opened.connection.close();
  await opened.pool.end();
  // Last, because the last thing a worker records is usually the
  // interesting part and an unexported span may as well not exist.
  await opened.telemetry.shutdown();
};

/** Starts this process and runs until it is asked to stop. */
const main = async (): Promise<void> => {
  const config = readConfig('arvo-temporal-worker');
  const telemetry = startTelemetry(config);

  const pool = new Pool({
    connectionString: config.recordsUrl,
    max: config.recordsPoolSize,
    // Surfaced as a failure the handler can see rather than as a hang: a
    // worker that waits for ever on a pool nobody is giving back to
    // looks identical to a worker that is simply slow.
    connectionTimeoutMillis: 5_000,
  });

  const connection = await NativeConnection.connect({
    address: config.temporalAddress,
  });

  const workers = await createWorkers({ config, telemetry, connection, pool });

  const health: Health = { alive: true, ready: false };
  const opened: Opened = {
    workers,
    connection,
    pool,
    telemetry,
    server: healthServer(config.healthPort, health),
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      // Stops taking work and finishes what it is holding. Closing the
      // pool first would make it fail what it is holding instead.
      health.ready = false;
      for (const worker of workers) worker.shutdown();
    });
  }

  health.ready = true;
  console.log(
    `  listening on ${ORCHESTRATION_QUEUE} and ${LEAF_QUEUE}, health on ${config.healthPort}`,
  );

  await Promise.all(workers.map((worker) => worker.run()));
  await letGo(opened, health);
};

main().catch((raised: unknown) => {
  console.error(`\n  the worker stopped: ${String(raised)}`);
  // Non-zero only on genuine failure: a worker asked to stop and
  // stopping is not a failure, and a scheduler that cannot tell the
  // difference restarts the wrong things.
  process.exitCode = 1;
});
