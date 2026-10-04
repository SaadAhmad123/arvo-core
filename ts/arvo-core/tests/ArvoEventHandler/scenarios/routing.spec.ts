import { describe, expect, it } from 'vitest';
import { createArvoEventFactory } from '../../../src/factories/ArvoEventFactory/index.js';
import type { JSONObject } from '../../../src/types.js';
import {
  declareHandler,
  declareHandlerAfterDrain,
  fulfilContract,
  fulfilV1,
  fulfilV2,
  fulfilV11,
  inventoryV1,
  paymentV1,
} from './fixture.js';
import { ScenarioStore } from './store.js';

/**
 * Three versions of one contract, open at once.
 *
 * The case the version's own suite could not reach: it was handed the
 * version to run. Here the handler decides, and a wrong decision is
 * silent — a record resumed under a neighbouring version reads its state
 * through a schema that was never its own, and may well succeed.
 *
 * The three versions are chosen so that cannot pass unnoticed. They take
 * different payloads, answer with different types, remember different
 * things, and one remembers nothing at all.
 */

const opening = (subject: string) => ({
  source: 'com.web.checkout',
  subject,
  to: fulfilContract.type,
});

const atFirst = (subject: string) =>
  createArvoEventFactory(fulfilV1).createInput({
    ...opening(subject),
    data: { items: ['book'] },
  });

const atSecond = (subject: string) =>
  createArvoEventFactory(fulfilV11).createInput({
    ...opening(subject),
    data: { items: ['book'], rush: true },
  });

const atThird = (subject: string) =>
  createArvoEventFactory(fulfilV2).createInput({
    ...opening(subject),
    data: { items: ['book'] },
  });

/** Opens an execution and commits what it produced. */
const open = async (
  event: ReturnType<typeof atFirst>,
  store: ScenarioStore,
  handler = declareHandler(),
) => {
  const ran = await handler.execute({
    event,
    state: store.resolver,
    attempt: 0,
  });
  if (ran.kind !== 'produced') throw new Error('nothing was opened');
  store.commit(ran.state);
  return ran;
};

/** What a service answers one of those executions with. */
const answer = (
  opened: { state: JSONObject; events: readonly { id: string }[] },
  subject: string,
  from: typeof inventoryV1 | typeof paymentV1,
  at = 0,
) =>
  from.type === inventoryV1.type
    ? createArvoEventFactory(inventoryV1).createOutput({
        type: 'evt_inventory_reserved',
        source: inventoryV1.type,
        subject,
        to: fulfilContract.type,
        executionid: String(opened.state.executionId),
        initid: opened.events[at]?.id,
        parentid: opened.events[at]?.id,
        data: { held: 1 },
      })
    : createArvoEventFactory(paymentV1).createOutput({
        type: 'evt_payment_charged',
        source: paymentV1.type,
        subject,
        to: fulfilContract.type,
        executionid: String(opened.state.executionId),
        initid: opened.events[at]?.id,
        parentid: opened.events[at]?.id,
        data: { receipt: 'r-1' },
      });

describe('three versions of one contract, open at once', () => {
  it('runs each under the version its own event named', async () => {
    const store = new ScenarioStore();
    const handler = declareHandler();

    const first = await open(atFirst('order-first'), store, handler);
    const second = await open(atSecond('order-second'), store, handler);
    const third = await open(atThird('order-third'), store, handler);

    expect(first.state.version).toBe('1.0.0');
    expect(second.state.version).toBe('1.1.0');
    expect(third.state.version).toBe('2.0.0');
  });

  it('gives each the state only its own version declares', async () => {
    const store = new ScenarioStore();
    const handler = declareHandler();

    const first = await open(atFirst('order-first'), store, handler);
    const second = await open(atSecond('order-second'), store, handler);
    const third = await open(atThird('order-third'), store, handler);

    expect(first.state.data).toEqual({ stage: 'asking', answers: 0 });
    expect(second.state.data).toEqual({
      stage: 'asking',
      answers: 0,
      rush: true,
    });
    // this one declared none, so it remembers none
    expect(third.state.data).toBeNull();
  });

  it('lets each answer with what only it answers with', async () => {
    const store = new ScenarioStore();
    const third = await open(atThird('order-third'), store);
    expect(third.events[0]?.type).toBe('evt_order_shipped');
  });

  it('asks the services each version asks, and no others', async () => {
    const store = new ScenarioStore();
    const handler = declareHandler();

    const first = await open(atFirst('order-first'), store, handler);
    const second = await open(atSecond('order-second'), store, handler);

    expect(first.events.map((one) => one.type).sort()).toEqual([
      'com_inventory_reserve',
      'com_payment_charge',
    ]);
    expect(second.events.map((one) => one.type)).toEqual([
      'com_payment_charge',
    ]);
  });

  it('resumes each under its own version, interleaved', async () => {
    const store = new ScenarioStore();
    const handler = declareHandler();

    const first = await open(atFirst('order-first'), store, handler);
    const second = await open(atSecond('order-second'), store, handler);

    // the second completes first, which is what interleaving means
    const secondDone = await handler.execute({
      event: answer(second, 'order-second', paymentV1),
      state: store.resolver,
      attempt: 0,
    });
    if (secondDone.kind !== 'produced') throw new Error('not answered');
    store.commit(secondDone.state);

    // and the first needs both of its answers
    const firstPart = await handler.execute({
      event: answer(first, 'order-first', inventoryV1, 0),
      state: store.resolver,
      attempt: 0,
    });
    if (firstPart.kind !== 'produced') throw new Error('not recorded');
    store.commit(firstPart.state);

    const firstDone = await handler.execute({
      event: answer(first, 'order-first', paymentV1, 1),
      state: store.resolver,
      attempt: 0,
    });
    if (firstDone.kind !== 'produced') throw new Error('not answered');

    expect(secondDone.state.version).toBe('1.1.0');
    expect(firstDone.state.version).toBe('1.0.0');
    expect(secondDone.state.data).toMatchObject({ rush: true });
    expect(firstDone.state.data).toEqual({ stage: 'answering', answers: 2 });
  });

  it('keeps each execution under its own identity', async () => {
    const store = new ScenarioStore();
    const handler = declareHandler();
    await open(atFirst('order-first'), store, handler);
    await open(atSecond('order-second'), store, handler);
    await open(atThird('order-third'), store, handler);

    expect(store.rows.size).toBe(3);
    expect(new Set([...store.rows.keys()]).size).toBe(3);
  });
});

describe('a rolling upgrade, seen from outside', () => {
  it('strands the executions of a version that was removed', async () => {
    const store = new ScenarioStore();
    const before = declareHandler();
    const opened = await open(atFirst('order-first'), store, before);

    // the version is drained and removed, and this execution was still open
    const after = declareHandlerAfterDrain();
    const refused = await after.tryExecute({
      event: answer(opened, 'order-first', inventoryV1),
      state: store.resolver,
      attempt: 0,
    });

    expect(!refused.ok && refused.error.faultKind).toBe('version_not_declared');
  });

  it('tells each stranded caller, so nobody waits for an answer that is not coming', async () => {
    const store = new ScenarioStore();
    const opened = await open(atFirst('order-first'), store);
    const after = declareHandlerAfterDrain();

    const refused = await after.tryExecute({
      event: answer(opened, 'order-first', inventoryV1),
      state: store.resolver,
      attempt: 0,
    });
    if (refused.ok) throw new Error('nothing was refused');

    const told = JSON.parse(String(refused.error.abandonmentEvent)) as {
      type: string;
      to: string;
      data: { errorName: string };
    };
    expect(told.to).toBe('com.web.checkout');
    expect(told.type).toBe(fulfilV1.error.type);
  });

  it('keeps taking new work at the versions that remain', async () => {
    const store = new ScenarioStore();
    const after = declareHandlerAfterDrain();

    const taken = await after.execute({
      event: atSecond('order-second'),
      state: store.resolver,
      attempt: 0,
    });
    expect(taken.kind).toBe('produced');
    expect(taken.kind === 'produced' && taken.state.version).toBe('1.1.0');
  });

  it('refuses new work at the version that went', async () => {
    const after = declareHandlerAfterDrain();
    const refused = await after.tryExecute({
      event: atFirst('order-first'),
      state: new ScenarioStore().resolver,
      attempt: 0,
    });
    expect(!refused.ok && refused.error.faultKind).toBe('event_unclassifiable');
  });
});
