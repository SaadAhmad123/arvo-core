import { createServer, type Server } from 'node:http';
import { NativeConnection } from '@temporalio/worker';
import { Pool } from 'pg';
import { readConfig } from '../shared/config.js';
import { startTelemetry, type Telemetry } from '../shared/telemetry.js';
import { reachTemporal } from './client.js';
import { QUEUES } from './queues.js';
import { createWorkers } from './workers.js';

/**
 * A worker process.
 *
 * Refuses to start rather than starting half-configured. Says separately
 * whether it is alive and whether it can take work. Bounds how much it
 * takes at once. On a signal, stops accepting work, finishes what is in
 * flight, flushes what it recorded and closes what it opened.
 *
 * Run with `pnpm run distributed:temporal:worker`.
 */

/** What a worker answers, so a deployment can tell two states apart. */
type Health = {
  /** Running, and not asked to stop. */
  alive: boolean;
  /** Connected and listening, so work given to it will be done. */
  ready: boolean;
};

/** The endpoint saying whether this process is alive and whether it can work. */
const healthServer = (port: number, health: Health): Server => {
  const server = createServer((asked, answer) => {
    // different questions: one shutting down is alive and must get no work
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

/** Starts this process and runs until it is asked to stop. */
const main = async (): Promise<void> => {
  const config = readConfig('arvo-temporal-worker');
  const telemetry: Telemetry = startTelemetry(config);

  const connection = await NativeConnection.connect({
    address: config.temporalAddress,
  });
  const reach = await reachTemporal(config);

  // The handlers' own data, and nothing of this mechanism's.
  const pool = new Pool({
    connectionString: config.recordsUrl,
    max: config.recordsPoolSize,
    // a failure a handler can see, rather than a hang indistinguishable
    // from being slow
    connectionTimeoutMillis: 5_000,
  });

  const workers = await createWorkers({
    config,
    telemetry,
    connection,
    client: reach.client,
    pool,
  });

  const health: Health = { alive: true, ready: false };
  const server = healthServer(config.healthPort, health);

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      health.ready = false;
      for (const worker of workers) worker.shutdown();
    });
  }

  health.ready = true;
  console.log(
    `  listening on ${QUEUES.join(' and ')}, health on ${config.healthPort}`,
  );

  await Promise.all(workers.map((worker) => worker.run()));

  health.alive = false;
  server.close();
  await reach.close();
  await connection.close();
  await pool.end();
  // last: an unexported span may as well not have been recorded
  await telemetry.shutdown();
};

main().catch((raised: unknown) => {
  console.error(`\n  the worker stopped: ${String(raised)}`);
  // non-zero only on genuine failure: being asked to stop is not one
  process.exitCode = 1;
});
