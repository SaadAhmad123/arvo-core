import { ArvoEventSerializer, createArvoEventFactory } from 'arvo-core';
import { manualReviewV1 } from '../handler/com_manual_review/contract.js';
import {
  orderFulfilContract,
  orderFulfilV1,
} from '../handler/com_order_fulfil/contract.js';
import { readConfig } from '../shared/config.js';
import { startTelemetry } from '../shared/telemetry.js';
import { answerFromOutside, reachTemporal, startRun } from './client.js';

/**
 * One run, started from outside, against workers somebody else is
 * running.
 *
 * For watching rather than asserting. It starts an order, waits for the
 * review that leaves the lattice, answers it as a person would, and
 * prints where to go and look.
 *
 * Needs the stack up and a worker running.
 */

/** The format an event crosses the boundary in. */
const WIRE = new ArvoEventSerializer({ type: 'arvoevent' });

/** What this run answers to. Not a handler's type, as a sender must ensure. */
const CALLER = 'com.watcher.checkout';

/** Narrow, so a run of this is quick and still does everything. */
const WIDTH = 3;

/** Deep enough to recurse and unwind. */
const DEPTH = 2;

const main = async (): Promise<void> => {
  const config = readConfig('arvo-run-once');
  const telemetry = startTelemetry(config);
  const { client, close } = await reachTemporal(config);

  // Everything this run causes hangs off one span, so there is a single
  // thing to search for afterwards.
  const watching = telemetry.tracer.startSpan('order.place');
  const traceId = watching.spanContext().traceId;

  try {
    const orderRef = `ORD-${Date.now()}`;
    const opening = createArvoEventFactory(orderFulfilV1).createInput({
      source: CALLER,
      subject: orderRef,
      to: orderFulfilContract.type,
      data: { orderRef, category: 'orders', width: WIDTH, depth: DEPTH },
    });

    console.log(`\n  order     ${orderRef}`);
    console.log(`  run       run-${opening.id}`);
    console.log(`  trace     ${traceId}\n`);

    const waiting = await startRun(client, opening, watching);
    console.log(`  the loop made ${waiting.deliveries} deliveries and`);
    console.log(`  came back ${waiting.kind}`);

    const review = waiting.events.find(
      (event) => event.eventType === 'com_manual_review',
    );
    if (review === undefined) {
      console.log(
        '\n  nothing left the lattice, so there is nothing to answer',
      );
      return;
    }

    const request = await WIRE.deserialize(review.payload);
    console.log(
      `  holding   ${review.eventType} in the ${review.domain} domain`,
    );
    console.log('\n  answering it as a person would...\n');

    const decision = createArvoEventFactory(manualReviewV1).createOutput({
      type: 'evt_review_decided',
      data: { approved: true, by: 'the review desk' },
      source: CALLER,
      subject: request.subject,
      to: request.source,
      executionid: request.executionid,
      initid: request.id,
      parentid: request.id,
      depth: request.depth,
    });

    const answered = await answerFromOutside(client, {
      lifted: request,
      answer: decision,
      span: watching,
    });

    console.log(`  the loop made ${answered.deliveries} more deliveries and`);
    console.log(`  came back ${answered.kind} with:`);
    for (const event of answered.events) {
      console.log(`    ${event.eventType} → ${event.addressedTo}`);
    }

    console.log('\n  where to look');
    console.log(
      `    workflows   http://localhost:8080/namespaces/${config.temporalNamespace}/workflows`,
    );
    console.log(
      `    the trace   http://localhost:3000/explore?schemaVersion=1&panes=%7B%22t%22%3A%7B%22datasource%22%3A%22tempo%22%2C%22queries%22%3A%5B%7B%22query%22%3A%22${traceId}%22%2C%22queryType%22%3A%22traceql%22%7D%5D%7D%7D&orgId=1`,
    );
    console.log(
      `    the logs    http://localhost:3000/explore?schemaVersion=1&panes=%7B%22l%22%3A%7B%22datasource%22%3A%22loki%22%2C%22queries%22%3A%5B%7B%22expr%22%3A%22%7Bservice_name%3D%5C%22arvo-run-once%5C%22%7D%22%7D%5D%7D%7D&orgId=1`,
    );
    console.log(`    dashboard   http://localhost:3000/d/arvo-executions\n`);
  } finally {
    watching.end();
    await close();
    // flush, or the spans this just made never leave
    await telemetry.shutdown();
  }
};

main().catch((raised: unknown) => {
  console.error(`\n  the run did not finish: ${String(raised)}`);
  process.exitCode = 1;
});
