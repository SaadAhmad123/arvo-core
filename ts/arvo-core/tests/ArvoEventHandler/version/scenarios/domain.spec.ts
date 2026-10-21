import { describe, expect, it } from 'vitest';
import { ArvoDomain } from '../../../../src/ArvoDomain/index.js';
import type { ArvoEvent } from '../../../../src/ArvoEvent/index.js';
import { createArvoEventFactory } from '../../../../src/factories/ArvoEventFactory/index.js';
import { cloneArvoEvent } from '../../../../src/factories/cloneArvoEvent.js';
import {
  declareVersions,
  type OrderContext,
  orderV1,
  reviewV1,
} from './fixture.js';
import { checkInvariants } from './invariants.js';
import { type ArvoChaos, createArvoLattice } from './lattice.js';

/**
 * An order that cannot finish without a person.
 *
 * A domained event is work that leaves the lattice. No handler is given
 * one; something outside picks it up and, whenever it likes or never,
 * injects an answer. The execution waiting on it does not care who
 * answers — it waits on the request's own id — which is resumability
 * across a suspension demonstrated rather than asserted.
 *
 * Everything an outside party can do wrong, it does here.
 */

const REVIEW = 'human_review';

const latticeWith = (chaos: Partial<ArvoChaos> = {}, seed = 23) =>
  createArvoLattice({ versions: declareVersions(), chaos, seed });

const anOrder = (subject = 'order-1') =>
  createArvoEventFactory(orderV1).createInput({
    source: 'com.web.checkout',
    subject,
    to: orderV1.type,
    data: { items: ['book'] },
  });

/**
 * An order that asks two services and one person, and answers once all
 * three are in.
 */
const reviewLattice = (lattice = latticeWith()) => {
  lattice.behave(orderV1.type, async (ctx: OrderContext) => {
    if (ctx.entry === 'followup') {
      const answers = [...ctx.state.inFlightEventMap.values()].filter(
        (answer) => answer !== null,
      ).length;
      await ctx.setState({ data: { stage: 'answering', answers } });
      return ctx.build({
        type: 'evt_order_fulfilled',
        data: { order_id: String(answers) },
      });
    }

    await ctx.setState({ data: { stage: 'asking', answers: 0 } });
    return [
      await ctx.build({
        type: 'com_inventory_reserve',
        data: { items: ['book'] },
      }),
      await ctx.build({ type: 'com_payment_charge', data: { amount: 10 } }),
      await ctx.build({
        type: 'com_manual_review',
        data: { order_id: 'o-1' },
        domain: ArvoDomain.FROM_EVENT_CONTRACT,
      }),
    ];
  });
  return lattice;
};

/** What a person decides, put back into the lattice as an answer. */
const reviewDecision = (
  reviewRequest: ArvoEvent,
  overrides: Record<string, unknown> = {},
) =>
  cloneArvoEvent(
    createArvoEventFactory(reviewV1).createOutput({
      type: 'evt_review_decided',
      source: reviewV1.type,
      subject: reviewRequest.subject,
      to: reviewRequest.source,
      data: { approved: true },
    }),
    {
      executionid: reviewRequest.executionid,
      parentid: reviewRequest.id,
      initid: reviewRequest.id,
      depth: reviewRequest.depth,
      ...overrides,
    },
  );

const callerAnswers = (lattice: ReturnType<typeof latticeWith>) =>
  lattice.transcript.published.filter(
    (event) => event.to === 'com.web.checkout',
  );

const orderLifecycle = (lattice: ReturnType<typeof latticeWith>) =>
  [...lattice.store.values()].find((row) => row.source === orderV1.type)
    ?.lifecycle;

describe('an order that cannot finish without a person', () => {
  it('lifts the review off the lattice, and delivers it to nobody', async () => {
    const lattice = reviewLattice();
    await lattice.publish(anOrder()).settle();

    expect(lattice.parked.get(REVIEW)).toHaveLength(1);
    expect(
      lattice.transcript.delivered.some(
        (delivery) => delivery.event.type === reviewV1.type,
      ),
    ).toBe(false);
  });

  it('sends it on the path the contract it is built from declares', async () => {
    const lattice = reviewLattice();
    await lattice.publish(anOrder()).settle();
    expect(lattice.parked.get(REVIEW)?.[0]?.domain).toBe(REVIEW);
  });

  it('leaves its siblings on the lattice, where they belong', async () => {
    const lattice = reviewLattice();
    await lattice.publish(anOrder()).settle();

    const siblings = lattice.transcript.published.filter((event) =>
      ['com_inventory_reserve', 'com_payment_charge'].includes(event.type),
    );
    expect(siblings.map((event) => event.domain)).toEqual([null, null]);
  });

  it('waits, however long it takes, with the services already answered', async () => {
    const lattice = reviewLattice();
    await lattice.publish(anOrder()).settle();

    expect(orderLifecycle(lattice)).toBe('waiting');
    expect(callerAnswers(lattice)).toHaveLength(0);
    expect(lattice.transcript.faults).toEqual([]);
  });

  it('goes on once a person answers, entering the executor exactly once more', async () => {
    const lattice = reviewLattice();
    await lattice.publish(anOrder()).settle();
    lattice.fulfil(REVIEW, (reviewRequest) => reviewDecision(reviewRequest));
    await lattice.settle();

    expect(orderLifecycle(lattice)).toBe('success');
    expect(callerAnswers(lattice)).toHaveLength(1);
    expect(callerAnswers(lattice)[0]?.data.order_id).toBe('3');
  });

  it('holds everything that must hold, across the suspension', async () => {
    const lattice = reviewLattice();
    await lattice.publish(anOrder()).settle();
    lattice.fulfil(REVIEW, (reviewRequest) => reviewDecision(reviewRequest));
    await lattice.settle();
    await checkInvariants(lattice);
  });
});

describe('everything the outside world does wrong', () => {
  /** An order waiting on a person, with the request they are holding. */
  const awaitingReview = async (lattice = reviewLattice()) => {
    await lattice.publish(anOrder()).settle();
    const reviewRequest = lattice.parked.get(REVIEW)?.[0] as ArvoEvent;
    return { lattice, reviewRequest };
  };

  it('never answers: the execution waits, and nothing is reported', async () => {
    const { lattice } = await awaitingReview();
    expect(orderLifecycle(lattice)).toBe('waiting');
    expect(lattice.transcript.faults).toEqual([]);
    await checkInvariants(lattice);
  });

  it('answers twice: the second is discarded, not reported', async () => {
    const { lattice, reviewRequest } = await awaitingReview();
    const answer = reviewDecision(reviewRequest);
    lattice.inject(answer).inject(answer);
    await lattice.settle();

    expect(callerAnswers(lattice)).toHaveLength(1);
    expect(lattice.transcript.discarded).toHaveLength(1);
    expect(lattice.transcript.faults).toEqual([]);
  });

  it('answers a request nobody made: refused, naming what it claimed', async () => {
    const { lattice, reviewRequest } = await awaitingReview();
    lattice.inject(reviewDecision(reviewRequest, { initid: 'never-asked' }));
    await lattice.settle();

    const fault = lattice.transcript.faults[0]?.fault;
    expect(fault?.faultKind).toBe('response_unawaited');
    expect(fault?.message).toContain('never-asked');
  });

  it('answers a request nobody made, where the lattice holds rather than gives up', async () => {
    const holdingLattice = reviewLattice(
      createArvoLattice({
        versions: declareVersions(),
        seed: 23,
        abandons: false,
      }),
    );
    await holdingLattice.publish(anOrder()).settle();
    const reviewRequest = holdingLattice.parked.get(REVIEW)?.[0] as ArvoEvent;

    holdingLattice.inject(
      reviewDecision(reviewRequest, { initid: 'never-asked' }),
    );
    await holdingLattice.settle();

    // the stray is refused and the execution is left as it was, still
    // waiting on the review nobody has answered
    expect(orderLifecycle(holdingLattice)).toBe('waiting');
    expect(holdingLattice.parked.get(REVIEW)).toHaveLength(1);
    expect(holdingLattice.transcript.abandoned).toEqual([]);
  });

  it('answers a request nobody made, where the lattice gives up on what it will not retry', async () => {
    const { lattice, reviewRequest } = await awaitingReview();
    lattice.inject(reviewDecision(reviewRequest, { initid: 'never-asked' }));
    await lattice.settle();

    // the fault carries what giving up takes, and this lattice takes it:
    // a stray event ends an execution that was waiting on a person
    expect(orderLifecycle(lattice)).toBe('failure');
    expect(lattice.transcript.abandoned).toHaveLength(1);
    expect(callerAnswers(lattice)).toHaveLength(1);
  });

  it('answers in the wrong workflow: refused for what disagrees', async () => {
    const { lattice, reviewRequest } = await awaitingReview();
    lattice.inject(
      reviewDecision(reviewRequest, { subject: 'another-workflow' }),
    );
    await lattice.settle();

    const fault = lattice.transcript.faults[0]?.fault;
    expect(fault?.faultKind).toBe('addressing_mismatch');
    expect(
      fault?.violations.some((violation) => violation.includes('subject')),
    ).toBe(true);
  });

  it('answers an execution that already ended: refused, and carries nothing', async () => {
    const { lattice, reviewRequest } = await awaitingReview();
    lattice.inject(reviewDecision(reviewRequest));
    await lattice.settle();
    expect(orderLifecycle(lattice)).toBe('success');

    lattice.inject(reviewDecision(reviewRequest, { id: 'a-second-opinion' }));
    await lattice.settle();

    const lateFault = lattice.transcript.faults.at(-1)?.fault;
    expect(lateFault?.faultKind).toBe('lifecycle_terminal');
    expect(lateFault?.abandonmentEvent).toBeNull();
    expect(lateFault?.abandonmentState).toBeNull();
  });

  it('answers after the execution outlived its time: refused for time', async () => {
    const lattice = reviewLattice(
      createArvoLattice({
        versions: declareVersions({ [orderV1.type]: { executionTimeout: 50 } }),
        seed: 5,
      }),
    );
    await lattice.publish(anOrder()).settle();
    const reviewRequest = lattice.parked.get(REVIEW)?.[0] as ArvoEvent;

    await new Promise((resolve) => setTimeout(resolve, 70));
    lattice.inject(reviewDecision(reviewRequest));
    await lattice.settle();

    const lateFault = lattice.transcript.faults.at(-1)?.fault;
    expect(lateFault?.faultKind).toBe('execution_timeout');
    expect(lateFault?.retry).toBeNull();
    expect(lateFault?.message).toContain('executionTimeout');
  });

  it('answers with the service own failure: an answer like any other', async () => {
    const { lattice, reviewRequest } = await awaitingReview();
    lattice.inject(
      cloneArvoEvent(
        createArvoEventFactory(reviewV1).createError({
          source: reviewV1.type,
          subject: reviewRequest.subject,
          to: reviewRequest.source,
          error: new Error('nobody could decide'),
        }),
        {
          executionid: reviewRequest.executionid,
          parentid: reviewRequest.id,
          initid: reviewRequest.id,
          depth: reviewRequest.depth,
        },
      ),
    );
    await lattice.settle();

    expect(orderLifecycle(lattice)).toBe('success');
    expect(callerAnswers(lattice)).toHaveLength(1);
  });

  it('answers with a path still set: it parks again, and the order stalls', async () => {
    const { lattice, reviewRequest } = await awaitingReview();
    lattice.inject(reviewDecision(reviewRequest, { domain: 'somewhere_else' }));
    await lattice.settle();

    expect(lattice.parked.get('somewhere_else')).toHaveLength(1);
    expect(orderLifecycle(lattice)).toBe('waiting');
    expect(callerAnswers(lattice)).toHaveLength(0);
  });

  it('answers an execution that never asked: refused, nothing else touched', async () => {
    const { lattice, reviewRequest } = await awaitingReview();
    lattice.inject(
      reviewDecision(reviewRequest, {
        executionid: 'f'.repeat(64),
        initid: 'never-asked',
      }),
    );
    await lattice.settle();

    expect(orderLifecycle(lattice)).toBe('waiting');
    expect(lattice.store.size).toBe(3);
  });

  it('injects an order of its own: it opens, like any other', async () => {
    const { lattice } = await awaitingReview();
    lattice.inject(anOrder('order-2'));
    await lattice.settle();

    expect(lattice.parked.get(REVIEW)).toHaveLength(2);
    expect(lattice.store.size).toBe(6);
  });
});

describe('a hundred orders where a third of the people forget', () => {
  const ordersAwaitingReview = async (count: number) => {
    const lattice = reviewLattice(latticeWith({}, 41));
    for (let orderIndex = 0; orderIndex < count; orderIndex += 1) {
      lattice.publish(anOrder(`order-${orderIndex}`));
    }
    await lattice.settle();
    return lattice;
  };

  it('answers exactly those whose reviewer answered, and no others', async () => {
    const lattice = await ordersAwaitingReview(60);
    const parkedReviews = lattice.parked.get(REVIEW) as ArvoEvent[];
    expect(parkedReviews).toHaveLength(60);

    const forgottenReviews = lattice.forget(REVIEW, 1 / 3);
    for (const reviewRequest of lattice.take(REVIEW)) {
      lattice.inject(reviewDecision(reviewRequest));
    }
    await lattice.settle();

    expect(callerAnswers(lattice)).toHaveLength(60 - forgottenReviews.length);
    expect(forgottenReviews.length).toBeGreaterThan(0);
  });

  it('leaves the forgotten waiting, and reports nothing about them', async () => {
    const lattice = await ordersAwaitingReview(30);
    const forgottenReviews = lattice.forget(REVIEW, 1 / 2);
    for (const reviewRequest of lattice.take(REVIEW)) {
      lattice.inject(reviewDecision(reviewRequest));
    }
    await lattice.settle();

    const stalledOrders = [...lattice.store.values()].filter(
      (row) => row.source === orderV1.type && row.lifecycle === 'waiting',
    );
    expect(stalledOrders).toHaveLength(forgottenReviews.length);
    expect(lattice.transcript.faults).toEqual([]);
  });

  it('holds everything that must hold, with half the branches stalled', async () => {
    const lattice = await ordersAwaitingReview(20);
    lattice.forget(REVIEW, 1 / 2);
    for (const reviewRequest of lattice.take(REVIEW)) {
      lattice.inject(reviewDecision(reviewRequest));
    }
    await lattice.settle();
    await checkInvariants(lattice);
  });
});

describe('where a version sends its own failures', () => {
  it('is the path its own contract declares, where it asked for that', async () => {
    const lattice = createArvoLattice({
      versions: declareVersions({
        [orderV1.type]: { handlerErrorDomain: ArvoDomain.FROM_SELF_CONTRACT },
      }),
      seed: 2,
    });
    lattice.behave(orderV1.type, async (ctx: OrderContext) => {
      await ctx.setState({ data: { stage: 'failing', answers: 0 } });
      ctx.cancel('the customer withdrew the order');
    });
    await lattice.publish(anOrder()).settle();

    // cancelling without answering is a fault, and its contingency is the
    // event a mechanism publishes on giving up
    const abandonmentFault = lattice.transcript.abandoned[0]?.fault;
    const abandonmentEvent = JSON.parse(
      abandonmentFault?.abandonmentEvent as string,
    );
    expect(abandonmentEvent.domain).toBe('orders');
    expect(lattice.parked.get('orders')).toHaveLength(1);
  });

  it('is the lattice itself, where the version asked for that', async () => {
    const lattice = createArvoLattice({
      versions: declareVersions({
        [orderV1.type]: { handlerErrorDomain: ArvoDomain.LOCAL },
      }),
      seed: 2,
    });
    lattice.behave(orderV1.type, async (ctx: OrderContext) => {
      await ctx.setState({ data: { stage: 'failing', answers: 0 } });
      ctx.cancel('the customer withdrew the order');
    });
    await lattice.publish(anOrder()).settle();

    const abandonmentEvent = JSON.parse(
      lattice.transcript.abandoned[0]?.fault.abandonmentEvent as string,
    );
    expect(abandonmentEvent.domain).toBeNull();
    expect(lattice.parked.get('orders') ?? []).toHaveLength(0);
  });
});
