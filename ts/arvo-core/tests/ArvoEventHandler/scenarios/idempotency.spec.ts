import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ArvoIdempotencyKeys } from '../../../src/ArvoEventHandler/context/idempotency.js';
import { createArvoEventFactory } from '../../../src/factories/ArvoEventFactory/index.js';
import { setupArvoEventHandler } from '../../../src/factories/setupArvoEventHandler.js';
import { fulfilContract, fulfilV1, inventoryV1 } from './fixture.js';
import { ScenarioStore } from './store.js';

/**
 * The keys an executor is given, through a handler rather than beside it.
 *
 * `context/idempotency.spec.ts` proves the composition against literals.
 * This proves the thing those keys exist for: what each one is constant
 * across, and what it separates — asserted over real deliveries, because
 * what a scope covers is a fact about executions rather than about a
 * hash.
 */

/** A handler whose executor records the keys it was given. */
const handlerRecordingKeys = (seen: ArvoIdempotencyKeys[]) =>
  setupArvoEventHandler({
    contracts: { self: fulfilContract, services: { inventory: inventoryV1 } },
  })
    .handler('1.0.0', {
      state: z.object({ stage: z.string() }),
      execute: async (ctx) => {
        seen.push(ctx.idempotency);
        await ctx.setState({ data: { stage: 'asking' } });
        return ctx.build({
          type: 'com_inventory_reserve',
          data: { items: ['book'] },
        });
      },
    })
    .handler('1.1.0', {
      state: z.object({ stage: z.string(), rush: z.boolean() }),
      execute: async () => {},
    })
    .handler('2.0.0', async (ctx) => {
      seen.push(ctx.idempotency);
      return ctx.build({
        type: 'evt_order_shipped',
        data: { tracking: 't-1' },
      });
    })
    .build();

const anOrder = (subject: string) =>
  createArvoEventFactory(fulfilV1).createInput({
    source: 'com.web.checkout',
    subject,
    to: fulfilContract.type,
    data: { items: ['book'] },
  });

const answering = (
  opened: {
    state: { executionId?: unknown };
    events: readonly { id: string }[];
  },
  subject: string,
) =>
  createArvoEventFactory(inventoryV1).createOutput({
    type: 'evt_inventory_reserved',
    source: inventoryV1.type,
    subject,
    to: fulfilContract.type,
    executionid: String(opened.state.executionId),
    initid: opened.events[0]?.id,
    parentid: opened.events[0]?.id,
    data: { held: 1 },
  });

/**
 * One execution opened, and the keys its executor saw.
 *
 * Takes the event rather than building one, because two orders for one
 * workflow are two executions: an execution is derived from the event
 * that opened it, so reusing the event is the only way to express the
 * same delivery happening twice.
 */
const openOne = async (event: ReturnType<typeof anOrder>, attempt = 0) => {
  const seen: ArvoIdempotencyKeys[] = [];
  const store = new ScenarioStore();
  const handler = handlerRecordingKeys(seen);

  const opened = await handler.execute({
    event,
    state: store.resolver,
    attempt,
  });
  if (opened.kind !== 'produced') throw new Error('nothing was opened');

  return { opened, store, handler, seen, keys: seen[0] as ArvoIdempotencyKeys };
};

describe('the workflow key', () => {
  it('is one key across every execution of the workflow it belongs to', async () => {
    const seen: ArvoIdempotencyKeys[] = [];
    const handler = handlerRecordingKeys(seen);
    const store = new ScenarioStore();

    // Two executions of one workflow: two events sharing a subject open
    // two executions, an execution being derived from the event rather
    // than from the workflow it belongs to.
    for (const _ of [0, 1]) {
      await handler.execute({
        event: anOrder('one-run'),
        state: store.resolver,
        attempt: 0,
      });
    }

    const [first, second] = seen as [ArvoIdempotencyKeys, ArvoIdempotencyKeys];
    expect(second.workflow).toBe(first.workflow);
    // and they are two executions, not one seen twice
    expect(second.execution).not.toBe(first.execution);
  });

  it('is a different key for a different workflow', async () => {
    const here = await openOne(anOrder('one-run'));
    const elsewhere = await openOne(anOrder('another-run'));

    expect(elsewhere.keys.workflow).not.toBe(here.keys.workflow);
  });
});

describe('the execution key', () => {
  it('is the same key on a later delivery to the same execution', async () => {
    const { opened, store, handler, seen } = await openOne(anOrder('one-run'));
    store.commit(opened.state);

    await handler.execute({
      event: answering(opened, 'one-run'),
      state: store.resolver,
      attempt: 0,
    });

    const [opening, answered] = seen as [
      ArvoIdempotencyKeys,
      ArvoIdempotencyKeys,
    ];
    expect(answered.execution).toBe(opening.execution);
    // which is the whole point of it: the delivery key did move
    expect(answered.delivery).not.toBe(opening.delivery);
    expect(answered.workflow).toBe(opening.workflow);
  });

  it('is a different key for another execution of the same workflow', async () => {
    const first = await openOne(anOrder('one-run'));
    const second = await openOne(anOrder('one-run'));

    expect(second.keys.execution).not.toBe(first.keys.execution);
  });
});

describe('the delivery key', () => {
  it('is the same key on a retry of the delivery that produced it', async () => {
    // A retry is the same event again with nothing committed, so every
    // part the keys are composed from is what it was. No key is keyed
    // on the attempt, which is why the attempt here is not 1.
    const order = anOrder('one-run');
    const first = await openOne(order);
    const retried = await openOne(order, 4);

    expect(retried.keys).toEqual(first.keys);
  });

  it('is a different key for each event one execution receives', async () => {
    const { opened, store, handler, seen } = await openOne(anOrder('one-run'));
    store.commit(opened.state);

    await handler.execute({
      event: answering(opened, 'one-run'),
      state: store.resolver,
      attempt: 0,
    });

    expect(seen[1]?.delivery).not.toBe(seen[0]?.delivery);
  });
});

describe('what the keys are not', () => {
  it('are nowhere in what the execution remembers', async () => {
    const { opened, keys } = await openOne(anOrder('one-run'));
    const committed = JSON.stringify(opened.state);

    for (const key of Object.values(keys)) {
      expect(committed).not.toContain(key);
    }
    // nor anything of the composition, under any member name
    expect(committed).not.toContain('arvo-');
  });

  it('are the same keys again where the same events are carried out again', async () => {
    // Nothing is stored, so what a second run of the same events
    // reaches is what the first reached — which is what lets an effect
    // keyed on one of these not happen twice.
    const order = anOrder('one-run');
    const once = await openOne(order);
    const again = await openOne(order);

    expect(again.keys).toEqual(once.keys);
  });
});
