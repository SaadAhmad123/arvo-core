import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createArvoEventFactory } from '../../../src/factories/ArvoEventFactory/index.js';
import { mutateArvoEvent } from '../../../src/factories/mutateArvoEvent.js';
import { setupArvoEventHandler } from '../../../src/factories/setupArvoEventHandler.js';
import type { JSONObject } from '../../../src/types.js';
import {
  declareHandler,
  fulfilContract,
  fulfilV1,
  fulfilV2,
  inventoryV1,
  paymentV1,
  type ScenarioDependencies,
} from './fixture.js';
import { NOT_A_RECORD, ScenarioStore } from './store.js';

/**
 * What the handler must survive from everything around it.
 *
 * Nothing is upstream of it, so a store that lies, a store that fails
 * and a transport that repeats itself are all inputs rather than
 * impossibilities. None of them may be read as a defect in the
 * execution.
 */

const anOrder = (subject = 'order-1') =>
  createArvoEventFactory(fulfilV1).createInput({
    source: 'com.web.checkout',
    subject,
    to: fulfilContract.type,
    data: { items: ['book'] },
  });

const anOpenExecution = async (store = new ScenarioStore()) => {
  const handler = declareHandler();
  const order = anOrder();
  const openingOutcome = await handler.execute({
    event: order,
    state: store.resolver,
    attempt: 0,
  });
  if (openingOutcome.kind !== 'produced') throw new Error('nothing was opened');
  store.commit(openingOutcome.state);
  return { handler, order, openingOutcome, store };
};

const inventoryAnswer = (
  execution: Awaited<ReturnType<typeof anOpenExecution>>,
  requestIndex = 0,
) =>
  createArvoEventFactory(inventoryV1).createOutput({
    type: 'evt_inventory_reserved',
    source: inventoryV1.type,
    subject: execution.order.subject,
    to: fulfilContract.type,
    executionid: String(execution.openingOutcome.state.executionId),
    initid: execution.openingOutcome.events[requestIndex]?.id,
    parentid: execution.openingOutcome.events[requestIndex]?.id,
    data: { held: 1 },
  });

const paymentAnswer = (
  execution: Awaited<ReturnType<typeof anOpenExecution>>,
  requestIndex = 1,
) =>
  createArvoEventFactory(paymentV1).createOutput({
    type: 'evt_payment_charged',
    source: paymentV1.type,
    subject: execution.order.subject,
    to: fulfilContract.type,
    executionid: String(execution.openingOutcome.state.executionId),
    initid: execution.openingOutcome.events[requestIndex]?.id,
    parentid: execution.openingOutcome.events[requestIndex]?.id,
    data: { receipt: 'r-1' },
  });

describe('a store that lies, each way separately', () => {
  it('refuses a row that is not a record at all', async () => {
    const execution = await anOpenExecution();
    execution.store.misbehave({ kind: 'returns', row: NOT_A_RECORD });
    const refusal = await execution.handler.tryExecute({
      event: inventoryAnswer(execution),
      state: execution.store.resolver,
      attempt: 0,
    });
    expect(!refusal.ok && refusal.error.faultKind).toBe('record_invalid');
  });

  it('refuses a record whose identity is not the one asked for', async () => {
    const execution = await anOpenExecution();
    execution.store.misbehave({
      kind: 'mutates',
      change: (row) => ({ ...row, executionId: 'somebody-elses' }),
    });
    const refusal = await execution.handler.tryExecute({
      event: inventoryAnswer(execution),
      state: execution.store.resolver,
      attempt: 0,
    });
    expect(!refusal.ok && refusal.error.faultKind).toBe('record_invalid');
  });

  it('refuses a record that disagrees with its own opening event', async () => {
    const execution = await anOpenExecution();
    execution.store.misbehave({
      kind: 'mutates',
      change: (row) => ({ ...row, subject: 'a-different-workflow' }),
    });
    const refusal = await execution.handler.tryExecute({
      event: inventoryAnswer(execution),
      state: execution.store.resolver,
      attempt: 0,
    });
    expect(!refusal.ok && refusal.error.faultKind).toBe('record_invalid');
  });

  it('refuses one whose opening event will not restore', async () => {
    const execution = await anOpenExecution();
    execution.store.misbehave({
      kind: 'mutates',
      change: (row) => ({ ...row, initEvent: { not: 'an event' } }),
    });
    const refusal = await execution.handler.tryExecute({
      event: inventoryAnswer(execution),
      state: execution.store.resolver,
      attempt: 0,
    });
    expect(!refusal.ok && refusal.error.faultKind).toBe(
      'record_event_unrestorable',
    );
  });

  it('writes nothing of its own when it refuses any of them', async () => {
    const execution = await anOpenExecution();
    const rowsBefore = new Map(execution.store.rows);
    execution.store.misbehave({ kind: 'returns', row: NOT_A_RECORD });
    await execution.handler.tryExecute({
      event: inventoryAnswer(execution),
      state: execution.store.resolver,
      attempt: 0,
    });
    expect(execution.store.rows).toEqual(rowsBefore);
  });
});

describe('a store that fails and then does not', () => {
  it('faults retry-safe, then succeeds against an unchanged record', async () => {
    const execution = await anOpenExecution();
    const rowBefore = execution.store.rows.get(
      String(execution.openingOutcome.state.executionId),
    );

    execution.store.misbehave({ kind: 'unreachable' });
    const failedAttempt = await execution.handler.tryExecute({
      event: inventoryAnswer(execution),
      state: execution.store.resolver,
      attempt: 0,
    });
    expect(!failedAttempt.ok && failedAttempt.error.retry).not.toBeNull();

    execution.store.misbehave(null);
    const retryOutcome = await execution.handler.execute({
      event: inventoryAnswer(execution),
      state: execution.store.resolver,
      attempt: 1,
    });

    expect(retryOutcome.kind).toBe('produced');
    // the record it ran against is the one that was always there
    expect(
      execution.store.rows.get(
        String(execution.openingOutcome.state.executionId),
      ),
    ).toEqual(rowBefore);
  });

  it('reads the store afresh on every attempt, never a value held earlier', async () => {
    const execution = await anOpenExecution();
    const readsBefore = execution.store.reads.length;
    await execution.handler.execute({
      event: inventoryAnswer(execution),
      state: execution.store.resolver,
      attempt: 1,
    });
    expect(execution.store.reads).toHaveLength(readsBefore + 1);
  });

  it('asks for one execution and no other', async () => {
    const store = new ScenarioStore();
    const execution = await anOpenExecution(store);
    store.reads.length = 0;
    await execution.handler.execute({
      event: inventoryAnswer(execution),
      state: store.resolver,
      attempt: 0,
    });
    expect(new Set(store.reads).size).toBe(1);
    expect(store.reads[0]).toBe(
      String(execution.openingOutcome.state.executionId),
    );
  });
});

describe('a transport that repeats itself', () => {
  it('discards an answer the execution has already processed', async () => {
    const execution = await anOpenExecution();
    const answer = inventoryAnswer(execution);

    const answerOutcome = await execution.handler.execute({
      event: answer,
      state: execution.store.resolver,
      attempt: 0,
    });
    if (answerOutcome.kind !== 'produced') throw new Error('not recorded');
    execution.store.commit(answerOutcome.state);

    for (let repetition = 0; repetition < 5; repetition += 1) {
      const repeatOutcome = await execution.handler.execute({
        event: answer,
        state: execution.store.resolver,
        attempt: 0,
      });
      expect(repeatOutcome.kind).toBe('discarded');
    }
  });

  it('leaves the store exactly as the first one left it', async () => {
    const execution = await anOpenExecution();
    const answer = inventoryAnswer(execution);
    const answerOutcome = await execution.handler.execute({
      event: answer,
      state: execution.store.resolver,
      attempt: 0,
    });
    if (answerOutcome.kind !== 'produced') throw new Error('not recorded');
    execution.store.commit(answerOutcome.state);
    const rowsAfter = new Map(execution.store.rows);

    await execution.handler.execute({
      event: answer,
      state: execution.store.resolver,
      attempt: 0,
    });
    expect(execution.store.rows).toEqual(rowsAfter);
  });

  it('refuses a repeated opening event rather than opening a second', async () => {
    const execution = await anOpenExecution();
    const refusal = await execution.handler.tryExecute({
      event: execution.order,
      state: execution.store.resolver,
      attempt: 0,
    });
    expect(!refusal.ok && refusal.error.faultKind).toBe('record_unexpected');
    expect(execution.store.rows.size).toBe(1);
  });

  it('derives the same identity for the repeat, which is why it is caught', async () => {
    const execution = await anOpenExecution();
    const refusal = await execution.handler.tryExecute({
      event: execution.order,
      state: execution.store.resolver,
      attempt: 0,
    });
    expect(!refusal.ok && refusal.error.executionId).toBe(
      String(execution.openingOutcome.state.executionId),
    );
  });
});

describe('an answer arriving at an execution that has finished', () => {
  const aFinishedExecution = async () => {
    const execution = await anOpenExecution();
    const inventoryOutcome = await execution.handler.execute({
      event: inventoryAnswer(execution),
      state: execution.store.resolver,
      attempt: 0,
    });
    if (inventoryOutcome.kind !== 'produced') throw new Error('not recorded');
    execution.store.commit(inventoryOutcome.state);

    const paymentOutcome = await execution.handler.execute({
      event: paymentAnswer(execution),
      state: execution.store.resolver,
      attempt: 0,
    });
    if (paymentOutcome.kind !== 'produced') throw new Error('not answered');
    execution.store.commit(paymentOutcome.state);
    expect(paymentOutcome.state.lifecycle).toBe('success');
    return execution;
  };

  it('is refused for being late rather than for what it carries', async () => {
    const execution = await aFinishedExecution();
    const lateAnswer = createArvoEventFactory(paymentV1).createOutput({
      type: 'evt_payment_charged',
      source: paymentV1.type,
      subject: execution.order.subject,
      to: fulfilContract.type,
      executionid: String(execution.openingOutcome.state.executionId),
      initid: 'a-request-from-long-ago',
      parentid: 'a-request-from-long-ago',
      data: { receipt: 'r-2' },
    });

    const refusal = await execution.handler.tryExecute({
      event: lateAnswer,
      state: execution.store.resolver,
      attempt: 0,
    });
    expect(!refusal.ok && refusal.error.faultKind).toBe('lifecycle_terminal');
  });

  it('is still refused for being late when its payload is also wrong', async () => {
    const execution = await aFinishedExecution();
    // the ordering this implementation had to be built carefully to keep:
    // judged for its payload first, this would carry an answer to a
    // caller that was answered once already
    const lateMalformedAnswer = mutateArvoEvent(
      createArvoEventFactory(paymentV1).createOutput({
        type: 'evt_payment_charged',
        source: paymentV1.type,
        subject: execution.order.subject,
        to: fulfilContract.type,
        executionid: String(execution.openingOutcome.state.executionId),
        initid: 'a-request-from-long-ago',
        parentid: 'a-request-from-long-ago',
        data: { receipt: 'r-2' },
      }),
      { data: { receipt: 7 as unknown as string } },
    );

    const refusal = await execution.handler.tryExecute({
      event: lateMalformedAnswer,
      state: execution.store.resolver,
      attempt: 0,
    });
    expect(!refusal.ok && refusal.error.faultKind).toBe('lifecycle_terminal');
  });

  it('sends that caller nothing, it having been answered once already', async () => {
    const execution = await aFinishedExecution();
    const lateAnswer = createArvoEventFactory(paymentV1).createOutput({
      type: 'evt_payment_charged',
      source: paymentV1.type,
      subject: execution.order.subject,
      to: fulfilContract.type,
      executionid: String(execution.openingOutcome.state.executionId),
      initid: 'a-request-from-long-ago',
      parentid: 'a-request-from-long-ago',
      data: { receipt: 'r-2' },
    });
    const refusal = await execution.handler.tryExecute({
      event: lateAnswer,
      state: execution.store.resolver,
      attempt: 0,
    });
    if (refusal.ok) throw new Error('nothing was refused');
    expect(refusal.error.abandonmentEvent).toBeNull();
    expect(refusal.error.abandonmentState).toBeNull();
  });
});

describe('a state schema changed under records already written', () => {
  it('refuses every execution that was open under the old shape', async () => {
    const store = new ScenarioStore();
    const execution = await anOpenExecution(store);

    // the same version, redeclared with a shape the stored data cannot
    // satisfy — which the protocol says fails every one of them
    const changedHandler = setupArvoEventHandler({
      contracts: { self: fulfilContract, services: { inventory: inventoryV1 } },
      types: {} as { dependencies: ScenarioDependencies },
    })
      .handler('1.0.0', {
        state: z.object({ somethingElse: z.string() }),
        execute: async () => {},
      })
      .handler('1.1.0', { execute: async () => {} })
      .handler('2.0.0', { execute: async () => {} })
      .build();

    const refusal = await changedHandler.tryExecute({
      event: inventoryAnswer(execution),
      state: store.resolver,
      attempt: 0,
    });

    expect(!refusal.ok && refusal.error.faultKind).toBe('record_invalid');
    expect(!refusal.ok && refusal.error.retry).toBeNull();
  });

  it('can still tell the caller, the record itself being sound', async () => {
    const store = new ScenarioStore();
    const execution = await anOpenExecution(store);
    const changedHandler = setupArvoEventHandler({
      contracts: { self: fulfilContract, services: { inventory: inventoryV1 } },
      types: {} as { dependencies: ScenarioDependencies },
    })
      .handler('1.0.0', {
        state: z.object({ somethingElse: z.string() }),
        execute: async () => {},
      })
      .handler('1.1.0', { execute: async () => {} })
      .handler('2.0.0', { execute: async () => {} })
      .build();

    const refusal = await changedHandler.tryExecute({
      event: inventoryAnswer(execution),
      state: store.resolver,
      attempt: 0,
    });
    if (refusal.ok) throw new Error('nothing was refused');

    // the envelope passed and only the data failed, so the caller is
    // addressable and the record can be brought to rest
    expect(refusal.error.abandonmentEvent).not.toBeNull();
    const restingRecord = JSON.parse(
      String(refusal.error.abandonmentState),
    ) as JSONObject;
    expect(restingRecord.lifecycle).toBe('failure');
  });
});

describe('a version that remembers nothing, handed a record that does', () => {
  it('refuses even an empty object, its record carrying none at all', async () => {
    // the schema such a version is judged against admits {}, so this is
    // the one shape that reaches the rule rather than the schema
    const store = new ScenarioStore();
    const handler = declareHandler();

    const v2Outcome = await handler.execute({
      event: createArvoEventFactory(fulfilV2).createInput({
        source: 'com.web.checkout',
        subject: 'order-1',
        to: fulfilContract.type,
        data: { items: ['book'] },
      }),
      state: store.resolver,
      attempt: 0,
    });
    if (v2Outcome.kind !== 'produced') throw new Error('nothing was opened');
    expect(v2Outcome.state.data).toBeNull();

    const unaskedAnswer = createArvoEventFactory(inventoryV1).createOutput({
      type: 'evt_inventory_reserved',
      source: inventoryV1.type,
      subject: 'order-1',
      to: fulfilContract.type,
      executionid: String(v2Outcome.state.executionId),
      initid: 'a-request-it-never-sent',
      parentid: 'a-request-it-never-sent',
      data: { held: 1 },
    });

    const refusal = await handler.tryExecute({
      event: unaskedAnswer,
      state: () => ({ ...v2Outcome.state, data: {} }),
      attempt: 0,
    });

    expect(!refusal.ok && refusal.error.faultKind).toBe('record_invalid');
    expect(!refusal.ok && refusal.error.violations.join(' ')).toContain(
      'must be null',
    );
  });
});
