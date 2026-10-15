import { describe, expect, it } from 'vitest';
import { ArvoDomain } from '../../../../src/ArvoDomain/index.js';
import type { ArvoEvent } from '../../../../src/ArvoEvent/index.js';
import { createArvoEventFactory } from '../../../../src/factories/ArvoEventFactory/index.js';
import { cloneArvoEvent } from '../../../../src/factories/cloneArvoEvent.js';
import {
  declareVersions,
  type OrderContext,
  orderV1,
  paymentV1,
  reviewV1,
  walkV1,
} from './fixture.js';
import { checkInvariants } from './invariants.js';
import { type ArvoChaos, createArvoLattice } from './lattice.js';

/**
 * The same shapes again, under conditions nobody chose.
 *
 * The named scenarios are cases a person thought of. This one takes the
 * same shapes and lets a seeded source of chance decide how badly the
 * lattice behaves — how often an event is repeated, whether anything
 * arrives in order, which commits lose their race, which crash before
 * publishing — and then asks the same questions of whatever came out.
 *
 * A failing seed is printed with the failure, and pinning it as its own
 * test is how it stops being chance.
 */

const anOrder = (subject: string) =>
  createArvoEventFactory(orderV1).createInput({
    source: 'com.web.checkout',
    subject,
    to: orderV1.type,
    data: { items: ['book'] },
  });

const aWalk = (remaining: number, subject: string) =>
  createArvoEventFactory(walkV1).createInput({
    source: 'com.web.start',
    subject,
    to: walkV1.type,
    data: { node: 'root', remaining },
  });

/** What a person decides, injected from outside the lattice. */
const decided = (asked: ArvoEvent) =>
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
    },
  );

/** How badly this lattice behaves, decided by the seed alone. */
const chaosFrom = (seed: number): Partial<ArvoChaos> => {
  const draw = (at: number) => ((seed * 9301 + at * 49297) % 233280) / 233280;
  return {
    duplicate: Math.floor(draw(1) * 3),
    shuffle: draw(2) > 0.3,
    crashBeforePublish: draw(3) > 0.7 ? draw(4) * 0.5 : 0,
    loseRace: draw(5) > 0.7 ? draw(6) * 0.5 : 0,
  };
};

/** One run of a shape, under whatever that seed decided. */
const ran = async (
  seed: number,
  shape: (lattice: ReturnType<typeof createArvoLattice>) => void,
) => {
  const chaos = chaosFrom(seed);
  const lattice = createArvoLattice({
    versions: declareVersions({ [walkV1.type]: { maxDepth: 10_000 } }),
    chaos,
    seed,
  });
  shape(lattice);
  await lattice.settle();
  while (lattice.holding > 0) await lattice.recover().settle();
  return { lattice, chaos };
};

/** Every property, with the seed named where one of them does not hold. */
const holds = async (
  seed: number,
  shape: (lattice: ReturnType<typeof createArvoLattice>) => void,
) => {
  const { lattice, chaos } = await ran(seed, shape);
  try {
    await checkInvariants(lattice);
  } catch (broken) {
    throw new Error(
      `seed ${seed} broke an invariant under ${JSON.stringify(chaos)}: ${
        (broken as Error).message
      }`,
      { cause: broken },
    );
  }
  return lattice;
};

const SEEDS = Array.from({ length: 40 }, (_, at) => at + 1);

describe('a fan-out, however the lattice behaves', () => {
  const fanningOut = (lattice: ReturnType<typeof createArvoLattice>) => {
    lattice.behave(orderV1.type, async (ctx: OrderContext) => {
      if (ctx.entry === 'followup') {
        await ctx.setState({ data: { stage: 'answering', answers: 2 } });
        return ctx.build({
          type: 'evt_order_fulfilled',
          data: { order_id: 'o-1' },
        });
      }
      await ctx.setState({ data: { stage: 'asking', answers: 0 } });
      return [
        await ctx.build({
          type: 'com_inventory_reserve',
          data: { items: ['book'] },
        }),
        await ctx.build({ type: 'com_payment_charge', data: { amount: 1 } }),
      ];
    });
    lattice.publish(anOrder('order-1')).publish(anOrder('order-2'));
  };

  it.each(SEEDS)('holds under seed %i', async (seed) => {
    const lattice = await holds(seed, fanningOut);

    // and whatever was done to it, both callers were answered once
    const answered = lattice.transcript.published.filter(
      (event) => event.to === 'com.web.checkout',
    );
    expect(answered.map((event) => event.subject).sort()).toEqual([
      'order-1',
      'order-2',
    ]);
  });
});

describe('a chain, however the lattice behaves', () => {
  const chaining = (lattice: ReturnType<typeof createArvoLattice>) => {
    lattice.publish(aWalk(12, 'walk-1'));
  };

  it.each(SEEDS)('holds under seed %i', async (seed) => {
    const lattice = await holds(seed, chaining);

    expect(lattice.store.size).toBe(13);
    expect(
      lattice.transcript.published.filter(
        (event) => event.to === 'com.web.start',
      ),
    ).toHaveLength(1);
  });
});

describe('a workflow waiting on a person, however the lattice behaves', () => {
  const reviewing = (lattice: ReturnType<typeof createArvoLattice>) => {
    lattice.behave(orderV1.type, async (ctx: OrderContext) => {
      if (ctx.entry === 'followup') {
        await ctx.setState({ data: { stage: 'answering', answers: 1 } });
        return ctx.build({
          type: 'evt_order_fulfilled',
          data: { order_id: 'o-1' },
        });
      }
      await ctx.setState({ data: { stage: 'asking', answers: 0 } });
      return ctx.build({
        type: 'com_manual_review',
        data: { order_id: 'o-1' },
        domain: ArvoDomain.FROM_EVENT_CONTRACT,
      });
    });
    lattice.publish(anOrder('order-1'));
  };

  it.each(SEEDS.slice(0, 20))(
    'holds across the suspension under seed %i',
    async (seed) => {
      const { lattice, chaos } = await ran(seed, reviewing);

      // nothing on the lattice can answer this, whatever it does to the
      // events it does carry
      expect(lattice.parked.get('human_review')).toHaveLength(1);

      lattice.fulfil('human_review', (asked) => decided(asked));
      await lattice.settle();
      while (lattice.holding > 0) await lattice.recover().settle();

      try {
        await checkInvariants(lattice);
      } catch (broken) {
        throw new Error(
          `seed ${seed} broke an invariant under ${JSON.stringify(chaos)}: ${
            (broken as Error).message
          }`,
          { cause: broken },
        );
      }

      expect(
        lattice.transcript.published.filter(
          (event) => event.to === 'com.web.checkout',
        ),
      ).toHaveLength(1);
    },
  );
});

describe('a worker that fails, however the lattice behaves', () => {
  const failing = (lattice: ReturnType<typeof createArvoLattice>) => {
    lattice.behave(orderV1.type, async (ctx: OrderContext) => {
      if (ctx.entry === 'followup') {
        await ctx.setState({ data: { stage: 'answering', answers: 1 } });
        return ctx.build({
          type: 'evt_order_fulfilled',
          data: { order_id: 'o-1' },
        });
      }
      await ctx.setState({ data: { stage: 'asking', answers: 0 } });
      return ctx.build({ type: 'com_payment_charge', data: { amount: 1 } });
    });
    lattice.behave('com_payment_charge', () => {
      throw new Error('the gateway is down');
    });
    lattice.publish(anOrder('order-1'));
  };

  it.each(SEEDS.slice(0, 20))(
    'tells the order once, and ends it, under seed %i',
    async (seed) => {
      const lattice = await holds(seed, failing);

      const told = lattice.transcript.published.filter(
        (event) => event.type === paymentV1.error.type,
      );
      expect(told.length).toBeGreaterThanOrEqual(1);
      expect(
        lattice.transcript.published.filter(
          (event) => event.to === 'com.web.checkout',
        ),
      ).toHaveLength(1);
    },
  );
});
