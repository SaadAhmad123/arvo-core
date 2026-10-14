import { createServer, type Server } from 'node:http';

/**
 * Whether a worker is alive and whether it can take work.
 *
 * Two questions, deliberately. A worker asked to stop is still alive —
 * it is finishing what it has — and must be given nothing further. A
 * deployment that cannot tell those apart either kills a worker
 * mid-delivery or keeps sending it work while it drains.
 */

/** What a worker answers, so a deployment can tell two states apart. */
export type Health = {
  /** Running, and not asked to stop. */
  alive: boolean;
  /** Connected and listening, so work given to it will be done. */
  ready: boolean;
};

/**
 * The endpoint saying whether this process is alive and whether it can
 * work.
 *
 * `/ready` answers the second question and anything else the first, each
 * with a status a probe reads without parsing a body.
 *
 * @param port - Where to answer.
 * @param health - The object this process mutates as it starts and
 * stops; read per request, so it is always current.
 */
export const healthServer = (port: number, health: Health): Server => {
  const server = createServer((asked, answer) => {
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
