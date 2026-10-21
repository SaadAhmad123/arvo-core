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
const keyRecordingHandler = (recordedKeys: ArvoIdempotencyKeys[]) =>
  setupArvoEventHandler({
    contracts: { self: fulfilContract, services: { inventory: inventoryV1 } },
  })
    .handler('1.0.0', {
      state: z.object({ stage: z.string() }),
      execute: async (ctx) => {
        recordedKeys.push(ctx.idempotency);
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
      recordedKeys.push(ctx.idempotency);
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

const inventoryAnswer = (
  openingOutcome: {
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
    executionid: String(openingOutcome.state.executionId),
    initid: openingOutcome.events[0]?.id,
    parentid: openingOutcome.events[0]?.id,
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
const openExecution = async (
  event: ReturnType<typeof anOrder>,
  attempt = 0,
) => {
  const recordedKeys: ArvoIdempotencyKeys[] = [];
  const store = new ScenarioStore();
  const handler = keyRecordingHandler(recordedKeys);

  const openingOutcome = await handler.execute({
    event,
    state: store.resolver,
    attempt,
  });
  if (openingOutcome.kind !== 'produced') throw new Error('nothing was opened');

  return {
    openingOutcome,
    store,
    handler,
    recordedKeys,
    keys: recordedKeys[0] as ArvoIdempotencyKeys,
  };
};

describe('the workflow key', () => {
  it('is one key across every execution of the workflow it belongs to', async () => {
    const recordedKeys: ArvoIdempotencyKeys[] = [];
    const handler = keyRecordingHandler(recordedKeys);
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

    const [firstExecutionKeys, secondExecutionKeys] = recordedKeys as [
      ArvoIdempotencyKeys,
      ArvoIdempotencyKeys,
    ];
    expect(secondExecutionKeys.workflow).toBe(firstExecutionKeys.workflow);
    // and they are two executions, not one seen twice
    expect(secondExecutionKeys.execution).not.toBe(
      firstExecutionKeys.execution,
    );
  });

  it('is a different key for a different workflow', async () => {
    const firstWorkflow = await openExecution(anOrder('one-run'));
    const secondWorkflow = await openExecution(anOrder('another-run'));

    expect(secondWorkflow.keys.workflow).not.toBe(firstWorkflow.keys.workflow);
  });
});

describe('the execution key', () => {
  it('is the same key on a later delivery to the same execution', async () => {
    const { openingOutcome, store, handler, recordedKeys } =
      await openExecution(anOrder('one-run'));
    store.commit(openingOutcome.state);

    await handler.execute({
      event: inventoryAnswer(openingOutcome, 'one-run'),
      state: store.resolver,
      attempt: 0,
    });

    const [openingKeys, answerKeys] = recordedKeys as [
      ArvoIdempotencyKeys,
      ArvoIdempotencyKeys,
    ];
    expect(answerKeys.execution).toBe(openingKeys.execution);
    // which is the whole point of it: the delivery key did move
    expect(answerKeys.delivery).not.toBe(openingKeys.delivery);
    expect(answerKeys.workflow).toBe(openingKeys.workflow);
  });

  it('is a different key for another execution of the same workflow', async () => {
    const firstExecution = await openExecution(anOrder('one-run'));
    const secondExecution = await openExecution(anOrder('one-run'));

    expect(secondExecution.keys.execution).not.toBe(
      firstExecution.keys.execution,
    );
  });
});

describe('the delivery key', () => {
  it('is the same key on a retry of the delivery that produced it', async () => {
    // A retry is the same event again with nothing committed, so every
    // part the keys are composed from is what it was. No key is keyed
    // on the attempt, which is why the attempt here is not 1.
    const order = anOrder('one-run');
    const original = await openExecution(order);
    const retry = await openExecution(order, 4);

    expect(retry.keys).toEqual(original.keys);
  });

  it('is a different key for each event one execution receives', async () => {
    const { openingOutcome, store, handler, recordedKeys } =
      await openExecution(anOrder('one-run'));
    store.commit(openingOutcome.state);

    await handler.execute({
      event: inventoryAnswer(openingOutcome, 'one-run'),
      state: store.resolver,
      attempt: 0,
    });

    expect(recordedKeys[1]?.delivery).not.toBe(recordedKeys[0]?.delivery);
  });
});

describe('what the keys are not', () => {
  it('are nowhere in what the execution remembers', async () => {
    const { openingOutcome, keys } = await openExecution(anOrder('one-run'));
    const recordJson = JSON.stringify(openingOutcome.state);

    for (const key of Object.values(keys)) {
      expect(recordJson).not.toContain(key);
    }
    // nor anything of the composition, under any member name
    expect(recordJson).not.toContain('arvo-');
  });

  it('are the same keys again where the same events are carried out again', async () => {
    // Nothing is stored, so what a second run of the same events
    // reaches is what the first reached — which is what lets an effect
    // keyed on one of these not happen twice.
    const order = anOrder('one-run');
    const firstRun = await openExecution(order);
    const secondRun = await openExecution(order);

    expect(secondRun.keys).toEqual(firstRun.keys);
  });
});
