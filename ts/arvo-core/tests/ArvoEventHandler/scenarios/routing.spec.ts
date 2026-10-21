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

const openingFields = (subject: string) => ({
  source: 'com.web.checkout',
  subject,
  to: fulfilContract.type,
});

const v1Opening = (subject: string) =>
  createArvoEventFactory(fulfilV1).createInput({
    ...openingFields(subject),
    data: { items: ['book'] },
  });

const v11Opening = (subject: string) =>
  createArvoEventFactory(fulfilV11).createInput({
    ...openingFields(subject),
    data: { items: ['book'], rush: true },
  });

const v2Opening = (subject: string) =>
  createArvoEventFactory(fulfilV2).createInput({
    ...openingFields(subject),
    data: { items: ['book'] },
  });

/** Opens an execution and commits what it produced. */
const open = async (
  event: ReturnType<typeof v1Opening>,
  store: ScenarioStore,
  handler = declareHandler(),
) => {
  const outcome = await handler.execute({
    event,
    state: store.resolver,
    attempt: 0,
  });
  if (outcome.kind !== 'produced') throw new Error('nothing was opened');
  store.commit(outcome.state);
  return outcome;
};

/** What a service answers one of those executions with. */
const serviceAnswer = (
  openingOutcome: { state: JSONObject; events: readonly { id: string }[] },
  subject: string,
  service: typeof inventoryV1 | typeof paymentV1,
  requestIndex = 0,
) =>
  service.type === inventoryV1.type
    ? createArvoEventFactory(inventoryV1).createOutput({
        type: 'evt_inventory_reserved',
        source: inventoryV1.type,
        subject,
        to: fulfilContract.type,
        executionid: String(openingOutcome.state.executionId),
        initid: openingOutcome.events[requestIndex]?.id,
        parentid: openingOutcome.events[requestIndex]?.id,
        data: { held: 1 },
      })
    : createArvoEventFactory(paymentV1).createOutput({
        type: 'evt_payment_charged',
        source: paymentV1.type,
        subject,
        to: fulfilContract.type,
        executionid: String(openingOutcome.state.executionId),
        initid: openingOutcome.events[requestIndex]?.id,
        parentid: openingOutcome.events[requestIndex]?.id,
        data: { receipt: 'r-1' },
      });

describe('three versions of one contract, open at once', () => {
  it('runs each under the version its own event named', async () => {
    const store = new ScenarioStore();
    const handler = declareHandler();

    const v1Outcome = await open(v1Opening('order-first'), store, handler);
    const v11Outcome = await open(v11Opening('order-second'), store, handler);
    const v2Outcome = await open(v2Opening('order-third'), store, handler);

    expect(v1Outcome.state.version).toBe('1.0.0');
    expect(v11Outcome.state.version).toBe('1.1.0');
    expect(v2Outcome.state.version).toBe('2.0.0');
  });

  it('gives each the state only its own version declares', async () => {
    const store = new ScenarioStore();
    const handler = declareHandler();

    const v1Outcome = await open(v1Opening('order-first'), store, handler);
    const v11Outcome = await open(v11Opening('order-second'), store, handler);
    const v2Outcome = await open(v2Opening('order-third'), store, handler);

    expect(v1Outcome.state.data).toEqual({ stage: 'asking', answers: 0 });
    expect(v11Outcome.state.data).toEqual({
      stage: 'asking',
      answers: 0,
      rush: true,
    });
    // this one declared none, so it remembers none
    expect(v2Outcome.state.data).toBeNull();
  });

  it('lets each answer with what only it answers with', async () => {
    const store = new ScenarioStore();
    const v2Outcome = await open(v2Opening('order-third'), store);
    expect(v2Outcome.events[0]?.type).toBe('evt_order_shipped');
  });

  it('asks the services each version asks, and no others', async () => {
    const store = new ScenarioStore();
    const handler = declareHandler();

    const v1Outcome = await open(v1Opening('order-first'), store, handler);
    const v11Outcome = await open(v11Opening('order-second'), store, handler);

    expect(v1Outcome.events.map((event) => event.type).sort()).toEqual([
      'com_inventory_reserve',
      'com_payment_charge',
    ]);
    expect(v11Outcome.events.map((event) => event.type)).toEqual([
      'com_payment_charge',
    ]);
  });

  it('resumes each under its own version, interleaved', async () => {
    const store = new ScenarioStore();
    const handler = declareHandler();

    const v1Outcome = await open(v1Opening('order-first'), store, handler);
    const v11Outcome = await open(v11Opening('order-second'), store, handler);

    // the second completes first, which is what interleaving means
    const v11Completion = await handler.execute({
      event: serviceAnswer(v11Outcome, 'order-second', paymentV1),
      state: store.resolver,
      attempt: 0,
    });
    if (v11Completion.kind !== 'produced') throw new Error('not answered');
    store.commit(v11Completion.state);

    // and the first needs both of its answers
    const v1Partial = await handler.execute({
      event: serviceAnswer(v1Outcome, 'order-first', inventoryV1, 0),
      state: store.resolver,
      attempt: 0,
    });
    if (v1Partial.kind !== 'produced') throw new Error('not recorded');
    store.commit(v1Partial.state);

    const v1Completion = await handler.execute({
      event: serviceAnswer(v1Outcome, 'order-first', paymentV1, 1),
      state: store.resolver,
      attempt: 0,
    });
    if (v1Completion.kind !== 'produced') throw new Error('not answered');

    expect(v11Completion.state.version).toBe('1.1.0');
    expect(v1Completion.state.version).toBe('1.0.0');
    expect(v11Completion.state.data).toMatchObject({ rush: true });
    expect(v1Completion.state.data).toEqual({ stage: 'answering', answers: 2 });
  });

  it('keeps each execution under its own identity', async () => {
    const store = new ScenarioStore();
    const handler = declareHandler();
    await open(v1Opening('order-first'), store, handler);
    await open(v11Opening('order-second'), store, handler);
    await open(v2Opening('order-third'), store, handler);

    expect(store.rows.size).toBe(3);
    expect(new Set([...store.rows.keys()]).size).toBe(3);
  });
});

describe('a rolling upgrade, seen from outside', () => {
  it('strands the executions of a version that was removed', async () => {
    const store = new ScenarioStore();
    const handlerBeforeDrain = declareHandler();
    const openingOutcome = await open(
      v1Opening('order-first'),
      store,
      handlerBeforeDrain,
    );

    // the version is drained and removed, and this execution was still open
    const handlerAfterDrain = declareHandlerAfterDrain();
    const refusal = await handlerAfterDrain.tryExecute({
      event: serviceAnswer(openingOutcome, 'order-first', inventoryV1),
      state: store.resolver,
      attempt: 0,
    });

    expect(!refusal.ok && refusal.error.faultKind).toBe('version_not_declared');
  });

  it('tells each stranded caller, so nobody waits for an answer that is not coming', async () => {
    const store = new ScenarioStore();
    const openingOutcome = await open(v1Opening('order-first'), store);
    const handlerAfterDrain = declareHandlerAfterDrain();

    const refusal = await handlerAfterDrain.tryExecute({
      event: serviceAnswer(openingOutcome, 'order-first', inventoryV1),
      state: store.resolver,
      attempt: 0,
    });
    if (refusal.ok) throw new Error('nothing was refused');

    const abandonment = JSON.parse(String(refusal.error.abandonmentEvent)) as {
      type: string;
      to: string;
      data: { errorName: string };
    };
    expect(abandonment.to).toBe('com.web.checkout');
    expect(abandonment.type).toBe(fulfilV1.error.type);
  });

  it('keeps taking new work at the versions that remain', async () => {
    const store = new ScenarioStore();
    const handlerAfterDrain = declareHandlerAfterDrain();

    const outcome = await handlerAfterDrain.execute({
      event: v11Opening('order-second'),
      state: store.resolver,
      attempt: 0,
    });
    expect(outcome.kind).toBe('produced');
    expect(outcome.kind === 'produced' && outcome.state.version).toBe('1.1.0');
  });

  it('refuses new work at the version that went', async () => {
    const handlerAfterDrain = declareHandlerAfterDrain();
    const refusal = await handlerAfterDrain.tryExecute({
      event: v1Opening('order-first'),
      state: new ScenarioStore().resolver,
      attempt: 0,
    });
    expect(!refusal.ok && refusal.error.faultKind).toBe('event_unclassifiable');
  });
});
