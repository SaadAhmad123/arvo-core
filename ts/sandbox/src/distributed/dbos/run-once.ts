import { ArvoEventSerializer, createArvoEventFactory } from 'arvo-core';
import { manualReviewV1 } from '../handler/com_manual_review/contract.js';
import {
  orderFulfilContract,
  orderFulfilV1,
} from '../handler/com_order_fulfil/contract.js';
import { readConfig } from '../shared/config.js';
import { decisionFor } from '../shared/from-outside.js';
import { startTelemetry } from '../shared/telemetry.js';
import { answerFromOutside, runIdFor, startRun } from './client.js';
import { startDbos } from './runtime.js';

/**
 * One run under DBOS, start to finish, in this process.
 *
 * For watching rather than asserting. Unlike the Temporal equivalent it
 * needs no worker running beside it: a DBOS workflow runs in whatever
 * process started it, so this process is the worker.
 *
 * Needs the stack up and migrated.
 *
 * Run directly: `pnpm run distributed:dbos:run`.
 */

/** The format an event crosses the boundary in. */
const WIRE = new ArvoEventSerializer({ type: 'arvoevent' });

/** What this run answers to. Not a handler's type, as a sender must ensure. */
const CALLER = 'com.watcher.dbos';

/** Narrow and shallow, so a run of this is quick and still does everything. */
const WIDTH = 3;
const DEPTH = 2;

const main = async (): Promise<void> => {
  const config = readConfig('arvo-dbos-run-once');
  const telemetry = startTelemetry(config);
  const runtime = await startDbos(config);

  // Everything this run causes hangs off one span, so there is a single
  // thing to search for afterwards.
  const watching = telemetry.tracer.startSpan('order.place');
  const traceId = watching.spanContext().traceId;

  try {
    const orderRef = `ORD-DBOS-${Date.now()}`;
    const opening = createArvoEventFactory(orderFulfilV1).createInput({
      source: CALLER,
      subject: orderRef,
      to: orderFulfilContract.type,
      data: { orderRef, category: 'orders', width: WIDTH, depth: DEPTH },
    });

    console.log(`\n  order     ${orderRef}`);
    console.log(`  run       ${runIdFor(opening)}`);
    console.log(`  trace     ${traceId}\n`);

    // The run answers the caller only once the review is decided, so
    // this starts it and answers from outside while it waits.
    const running = startRun(runtime.workflows, opening, watching);

    const waiting = await waitForTheReview(runtime, orderRef);
    if (waiting !== null) {
      await answerFromOutside(
        runIdFor(opening),
        decisionFor(waiting, { approved: true, by: 'a.watcher' }),
      );
    }

    const outcome = await running;
    console.log(`  the run made ${outcome.deliveries} deliveries and`);
    console.log(
      `  came to ${outcome.kind} with ${outcome.events.length} event(s)\n`,
    );
  } finally {
    watching.end();
    await runtime.stop();
    await telemetry.shutdown();
  }
};

/**
 * The review request this run left for a person, once it is there.
 *
 * Polled from the table rather than awaited, because the point of a
 * domained event is that nothing running is told about it: a person
 * finds it by looking, and so does this.
 */
const waitForTheReview = async (
  runtime: Awaited<ReturnType<typeof startDbos>>,
  subject: string,
) => {
  for (let looked = 0; looked < 120; looked += 1) {
    const found = await runtime.pool.query<{ payload: string }>(
      `SELECT payload FROM needs_a_person
        WHERE subject = $1 AND event_type = $2
        LIMIT 1`,
      [subject, manualReviewV1.type],
    );
    const payload = found.rows[0]?.payload;
    if (payload !== undefined) return WIRE.deserialize(payload);
    await new Promise((wake) => setTimeout(wake, 500));
  }
  return null;
};

main().catch((raised: unknown) => {
  console.error(raised);
  process.exitCode = 1;
});
