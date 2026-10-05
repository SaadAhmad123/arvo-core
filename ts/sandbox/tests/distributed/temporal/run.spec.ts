import { ArvoEventSerializer, createArvoEventFactory } from 'arvo-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { manualReviewV1 } from '../../../src/distributed/handler/com_manual_review/contract.js';
import {
  orderFulfilContract,
  orderFulfilV1,
} from '../../../src/distributed/handler/com_order_fulfil/contract.js';
import {
  answerFromOutside,
  startRun,
} from '../../../src/distributed/temporal/client.js';
import type {
  EmittedEvent,
  RunOutcome,
} from '../../../src/distributed/temporal/protocol.js';
import { startTemporalHarness, type TemporalHarness } from './harness.js';

/**
 * One whole run under Temporal, twice: once to where it waits on a
 * person, and once more to where it answers.
 *
 * Narrow on purpose. Everything the scenario does happens here — the
 * fan-out, the recursive walk, a request that leaves the lattice, work
 * that fails and then does not, work that is given up on, and a sink
 * emitted alongside the completion — two of each rather than hundreds.
 *
 * Needs the cluster up. Nothing here touches a database.
 */

const WIRE = new ArvoEventSerializer({ type: 'arvoevent' });

/** What this run answers to. Not a handler's type, as a sender must ensure. */
const CALLER = 'com.test.temporal';

/** Wide enough to be a fan-out, small enough to read in a log. */
const WIDTH = 2;

/** Deep enough to recurse and unwind, inside the walk's declared bound. */
const DEPTH = 2;

describe('one run under Temporal', () => {
  let harness: TemporalHarness;
  let waiting: RunOutcome;
  let answered: RunOutcome;
  let lifted: EmittedEvent;
  let subject: string;

  beforeAll(async () => {
    harness = await startTemporalHarness('arvo-temporal-run-spec');

    subject = `temporal-run-${Date.now()}`;
    const opening = createArvoEventFactory(orderFulfilV1).createInput({
      source: CALLER,
      subject,
      to: orderFulfilContract.type,
      data: {
        orderRef: `order-${Date.now()}`,
        category: 'orders',
        width: WIDTH,
        depth: DEPTH,
      },
    });

    waiting = await startRun(harness.client, opening);

    const review = waiting.events.find(
      (event) => event.eventType === 'com_manual_review',
    );
    if (review === undefined) throw new Error('nothing left the lattice');
    lifted = review;

    // Something outside decides. It answers with the same source the
    // order was sent with, because that is where this run answers.
    const request = await WIRE.deserialize(review.payload);
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

    answered = await answerFromOutside(harness.client, {
      lifted: request,
      answer: decision,
    });
  }, 300_000);

  afterAll(async () => {
    await harness?.stop();
  }, 60_000);

  it('stops at what only something outside can answer', () => {
    expect(waiting.kind).toBe('waiting_on_outside');
    expect(waiting.events.map((event) => event.eventType)).toEqual([
      'com_manual_review',
    ]);
    expect(lifted.domain).toBe('human_review');
  });

  it('delivered the fan-out, the walk and the rest before stopping', () => {
    // one for the order, one per item, at least one for the walk, one
    // for the payment that eventually succeeded, one for the fraud
    // check, and one more for the order each time something answered
    expect(waiting.deliveries).toBeGreaterThan(WIDTH * 2);
  });

  it('answers its caller once the person has decided', () => {
    expect(answered.kind).toBe('answered');
    expect(answered.events.map((event) => event.eventType).sort()).toEqual([
      'evt_order_fulfilled',
    ]);
  });

  it('addressed its answer to whoever started the run', () => {
    expect(answered.events[0]?.addressedTo).toBe(CALLER);
    // and nothing in the lattice implements that, which is what made it
    // an answer rather than more work
    expect(answered.events[0]?.handled).toBe(false);
  });

  it('came to rest, and its record says so', async () => {
    const orders = await handlerStates('com_order_fulfil');
    const thisRun = orders.filter((state) => state.subject === subject);

    expect(thisRun.length).toBe(1);
    expect(thisRun[0]?.lifecycle).toBe('success');
    // one revision for the opening delivery and one for each answer
    expect(thisRun[0]?.casVersion).toBeGreaterThan(WIDTH);
  });

  it('addressed its answer by the execution waiting for it', async () => {
    const answer = answered.events[0];
    if (answer === undefined) throw new Error('nothing was answered');
    const event = await WIRE.deserialize(answer.payload);

    // A completion carries the asking execution, not its own. For an
    // order opened from outside, what asked is the run itself, which
    // `subject` names.
    expect(event.executionid).toBe(subject);
    expect(event.to).toBe(CALLER);
  });

  it('took the payment that failed first, counting attempts from zero', async () => {
    const charged = await handlerStates('com_payment_charge');
    const first = charged[0];
    if (first === undefined) throw new Error('nothing was charged');

    expect(first.lifecycle).toBe('success');
    // asked to fail twice, so it succeeded on the attempt after those
    expect((first.data as { attempts: number }).attempts).toBe(2);
  });

  it('gave up on the work that never succeeds', async () => {
    const judged = await handlerStates('com_fraud_check');
    expect(judged[0]?.lifecycle).toBe('failure');
  });

  it('wrote the audit that answers nobody', async () => {
    const audited = await handlerStates('com_audit_write');
    expect(audited[0]?.lifecycle).toBe('success');
  });

  it('walked the tree, one execution per node', async () => {
    const walked = await handlerStates('com_category_walk');
    expect(walked.length).toBeGreaterThan(1);
  });

  /** Every record held by an execution of one contract. */
  const handlerStates = async (
    contractType: string,
  ): Promise<readonly Record<string, unknown>[]> => {
    const found: Record<string, unknown>[] = [];

    for await (const workflow of harness.client.workflow.list({
      query: `WorkflowType = 'executionRevisions'`,
    })) {
      const state = await harness.client.workflow
        .getHandle(workflow.workflowId)
        .query<Record<string, unknown> | null, []>('arvo.state');
      if (state !== null && state.source === contractType) found.push(state);
    }

    return found;
  };
});
