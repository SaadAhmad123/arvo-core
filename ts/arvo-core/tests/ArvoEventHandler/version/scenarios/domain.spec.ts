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
const needingReview = (lattice = latticeWith()) => {
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
const decided = (asked: ArvoEvent, overrides: Record<string, unknown> = {}) =>
  cloneArvoEvent(
    createArvoEventFactory(reviewV1).createOutput({
      type: 'evt_review_decided',
      source: reviewV1.type,
      subject: asked.subject,
      to: asked.source,
      data: { approved: true },
    }),
    {
      executionid: asked.executionid,
      parentid: asked.id,
      initid: asked.id,
      depth: asked.depth,
      ...overrides,
    },
  );

const answered = (lattice: ReturnType<typeof latticeWith>) =>
  lattice.transcript.published.filter(
    (event) => event.to === 'com.web.checkout',
  );

const resting = (lattice: ReturnType<typeof latticeWith>) =>
  [...lattice.store.values()].find((row) => row.source === orderV1.type)
    ?.lifecycle;

describe('an order that cannot finish without a person', () => {
  it('lifts the review off the lattice, and delivers it to nobody', async () => {
    const lattice = needingReview();
    await lattice.publish(anOrder()).settle();

    expect(lattice.parked.get(REVIEW)).toHaveLength(1);
    expect(
      lattice.transcript.delivered.some(
        (given) => given.event.type === reviewV1.type,
      ),
    ).toBe(false);
  });

  it('sends it on the path the contract it is built from declares', async () => {
    const lattice = needingReview();
    await lattice.publish(anOrder()).settle();
    expect(lattice.parked.get(REVIEW)?.[0]?.domain).toBe(REVIEW);
  });

  it('leaves its siblings on the lattice, where they belong', async () => {
    const lattice = needingReview();
    await lattice.publish(anOrder()).settle();

    const siblings = lattice.transcript.published.filter((event) =>
      ['com_inventory_reserve', 'com_payment_charge'].includes(event.type),
    );
    expect(siblings.map((event) => event.domain)).toEqual([null, null]);
  });

  it('waits, however long it takes, with the services already answered', async () => {
    const lattice = needingReview();
    await lattice.publish(anOrder()).settle();

    expect(resting(lattice)).toBe('waiting');
    expect(answered(lattice)).toHaveLength(0);
    expect(lattice.transcript.faults).toEqual([]);
  });

  it('goes on once a person answers, entering the executor exactly once more', async () => {
    const lattice = needingReview();
    await lattice.publish(anOrder()).settle();
    lattice.fulfil(REVIEW, (asked) => decided(asked));
    await lattice.settle();

    expect(resting(lattice)).toBe('success');
    expect(answered(lattice)).toHaveLength(1);
    expect(answered(lattice)[0]?.data.order_id).toBe('3');
  });

  it('holds everything that must hold, across the suspension', async () => {
    const lattice = needingReview();
    await lattice.publish(anOrder()).settle();
    lattice.fulfil(REVIEW, (asked) => decided(asked));
    await lattice.settle();
    await checkInvariants(lattice);
  });
});

describe('everything the outside world does wrong', () => {
  /** An order waiting on a person, with the request they are holding. */
  const parked = async (lattice = needingReview()) => {
    await lattice.publish(anOrder()).settle();
    const asked = lattice.parked.get(REVIEW)?.[0] as ArvoEvent;
    return { lattice, asked };
  };

  it('never answers: the execution waits, and nothing is reported', async () => {
    const { lattice } = await parked();
    expect(resting(lattice)).toBe('waiting');
    expect(lattice.transcript.faults).toEqual([]);
    await checkInvariants(lattice);
  });

  it('answers twice: the second is discarded, not reported', async () => {
    const { lattice, asked } = await parked();
    const answer = decided(asked);
    lattice.inject(answer).inject(answer);
    await lattice.settle();

    expect(answered(lattice)).toHaveLength(1);
    expect(lattice.transcript.discarded).toHaveLength(1);
    expect(lattice.transcript.faults).toEqual([]);
  });

  it('answers a request nobody made: refused, naming what it claimed', async () => {
    const { lattice, asked } = await parked();
    lattice.inject(decided(asked, { initid: 'never-asked' }));
    await lattice.settle();

    const refused = lattice.transcript.faults[0]?.fault;
    expect(refused?.faultKind).toBe('response_unawaited');
    expect(refused?.message).toContain('never-asked');
  });

  it('answers a request nobody made, where the lattice holds rather than gives up', async () => {
    const holding = needingReview(
      createArvoLattice({
        versions: declareVersions(),
        seed: 23,
        abandons: false,
      }),
    );
    await holding.publish(anOrder()).settle();
    const asked = holding.parked.get(REVIEW)?.[0] as ArvoEvent;

    holding.inject(decided(asked, { initid: 'never-asked' }));
    await holding.settle();

    // the stray is refused and the execution is left as it was, still
    // waiting on the review nobody has answered
    expect(resting(holding)).toBe('waiting');
    expect(holding.parked.get(REVIEW)).toHaveLength(1);
    expect(holding.transcript.abandoned).toEqual([]);
  });

  it('answers a request nobody made, where the lattice gives up on what it will not retry', async () => {
    const { lattice, asked } = await parked();
    lattice.inject(decided(asked, { initid: 'never-asked' }));
    await lattice.settle();

    // the fault carries what giving up takes, and this lattice takes it:
    // a stray event ends an execution that was waiting on a person
    expect(resting(lattice)).toBe('failure');
    expect(lattice.transcript.abandoned).toHaveLength(1);
    expect(answered(lattice)).toHaveLength(1);
  });

  it('answers in the wrong workflow: refused for what disagrees', async () => {
    const { lattice, asked } = await parked();
    lattice.inject(decided(asked, { subject: 'another-workflow' }));
    await lattice.settle();

    const refused = lattice.transcript.faults[0]?.fault;
    expect(refused?.faultKind).toBe('addressing_mismatch');
    expect(
      refused?.violations.some((broken) => broken.includes('subject')),
    ).toBe(true);
  });

  it('answers an execution that already ended: refused, and carries nothing', async () => {
    const { lattice, asked } = await parked();
    lattice.inject(decided(asked));
    await lattice.settle();
    expect(resting(lattice)).toBe('success');

    lattice.inject(decided(asked, { id: 'a-second-opinion' }));
    await lattice.settle();

    const late = lattice.transcript.faults.at(-1)?.fault;
    expect(late?.faultKind).toBe('lifecycle_terminal');
    expect(late?.abandonmentEvent).toBeNull();
    expect(late?.abandonmentState).toBeNull();
  });

  it('answers after the execution outlived its time: refused for time', async () => {
    const lattice = needingReview(
      createArvoLattice({
        versions: declareVersions({ [orderV1.type]: { executionTimeout: 50 } }),
        seed: 5,
      }),
    );
    await lattice.publish(anOrder()).settle();
    const asked = lattice.parked.get(REVIEW)?.[0] as ArvoEvent;

    await new Promise((settle) => setTimeout(settle, 70));
    lattice.inject(decided(asked));
    await lattice.settle();

    const late = lattice.transcript.faults.at(-1)?.fault;
    expect(late?.faultKind).toBe('execution_timeout');
    expect(late?.retry).toBeNull();
    expect(late?.message).toContain('executionTimeout');
  });

  it('answers with the service own failure: an answer like any other', async () => {
    const { lattice, asked } = await parked();
    lattice.inject(
      cloneArvoEvent(
        createArvoEventFactory(reviewV1).createError({
          source: reviewV1.type,
          subject: asked.subject,
          to: asked.source,
          error: new Error('nobody could decide'),
        }),
        {
          executionid: asked.executionid,
          parentid: asked.id,
          initid: asked.id,
          depth: asked.depth,
        },
      ),
    );
    await lattice.settle();

    expect(resting(lattice)).toBe('success');
    expect(answered(lattice)).toHaveLength(1);
  });

  it('answers with a path still set: it parks again, and the order stalls', async () => {
    const { lattice, asked } = await parked();
    lattice.inject(decided(asked, { domain: 'somewhere_else' }));
    await lattice.settle();

    expect(lattice.parked.get('somewhere_else')).toHaveLength(1);
    expect(resting(lattice)).toBe('waiting');
    expect(answered(lattice)).toHaveLength(0);
  });

  it('answers an execution that never asked: refused, nothing else touched', async () => {
    const { lattice, asked } = await parked();
    lattice.inject(
      decided(asked, { executionid: 'f'.repeat(64), initid: 'never-asked' }),
    );
    await lattice.settle();

    expect(resting(lattice)).toBe('waiting');
    expect(lattice.store.size).toBe(3);
  });

  it('injects an order of its own: it opens, like any other', async () => {
    const { lattice } = await parked();
    lattice.inject(anOrder('order-2'));
    await lattice.settle();

    expect(lattice.parked.get(REVIEW)).toHaveLength(2);
    expect(lattice.store.size).toBe(6);
  });
});

describe('a hundred orders where a third of the people forget', () => {
  const many = async (count: number) => {
    const lattice = needingReview(latticeWith({}, 41));
    for (let at = 0; at < count; at += 1) {
      lattice.publish(anOrder(`order-${at}`));
    }
    await lattice.settle();
    return lattice;
  };

  it('answers exactly those whose reviewer answered, and no others', async () => {
    const lattice = await many(60);
    const waiting = lattice.parked.get(REVIEW) as ArvoEvent[];
    expect(waiting).toHaveLength(60);

    const forgotten = lattice.forget(REVIEW, 1 / 3);
    for (const asked of lattice.take(REVIEW)) {
      lattice.inject(decided(asked));
    }
    await lattice.settle();

    expect(answered(lattice)).toHaveLength(60 - forgotten.length);
    expect(forgotten.length).toBeGreaterThan(0);
  });

  it('leaves the forgotten waiting, and reports nothing about them', async () => {
    const lattice = await many(30);
    const forgotten = lattice.forget(REVIEW, 1 / 2);
    for (const asked of lattice.take(REVIEW)) {
      lattice.inject(decided(asked));
    }
    await lattice.settle();

    const stalled = [...lattice.store.values()].filter(
      (row) => row.source === orderV1.type && row.lifecycle === 'waiting',
    );
    expect(stalled).toHaveLength(forgotten.length);
    expect(lattice.transcript.faults).toEqual([]);
  });

  it('holds everything that must hold, with half the branches stalled', async () => {
    const lattice = await many(20);
    lattice.forget(REVIEW, 1 / 2);
    for (const asked of lattice.take(REVIEW)) {
      lattice.inject(decided(asked));
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
    const given = lattice.transcript.abandoned[0]?.fault;
    const told = JSON.parse(given?.abandonmentEvent as string);
    expect(told.domain).toBe('orders');
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

    const told = JSON.parse(
      lattice.transcript.abandoned[0]?.fault.abandonmentEvent as string,
    );
    expect(told.domain).toBeNull();
    expect(lattice.parked.get('orders') ?? []).toHaveLength(0);
  });
});
