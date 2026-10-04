import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createArvoEventFactory } from '../../../src/factories/ArvoEventFactory/index.js';
import { cloneArvoEvent } from '../../../src/factories/cloneArvoEvent.js';
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

const opened = async (store = new ScenarioStore()) => {
  const handler = declareHandler();
  const order = anOrder();
  const ran = await handler.execute({
    event: order,
    state: store.resolver,
    attempt: 0,
  });
  if (ran.kind !== 'produced') throw new Error('nothing was opened');
  store.commit(ran.state);
  return { handler, order, ran, store };
};

const inventoryAnswers = (from: Awaited<ReturnType<typeof opened>>, at = 0) =>
  createArvoEventFactory(inventoryV1).createOutput({
    type: 'evt_inventory_reserved',
    source: inventoryV1.type,
    subject: from.order.subject,
    to: fulfilContract.type,
    executionid: String(from.ran.state.executionId),
    initid: from.ran.events[at]?.id,
    parentid: from.ran.events[at]?.id,
    data: { held: 1 },
  });

const paymentAnswers = (from: Awaited<ReturnType<typeof opened>>, at = 1) =>
  createArvoEventFactory(paymentV1).createOutput({
    type: 'evt_payment_charged',
    source: paymentV1.type,
    subject: from.order.subject,
    to: fulfilContract.type,
    executionid: String(from.ran.state.executionId),
    initid: from.ran.events[at]?.id,
    parentid: from.ran.events[at]?.id,
    data: { receipt: 'r-1' },
  });

describe('a store that lies, each way separately', () => {
  it('refuses a row that is not a record at all', async () => {
    const from = await opened();
    from.store.misbehave({ kind: 'returns', row: NOT_A_RECORD });
    const refused = await from.handler.tryExecute({
      event: inventoryAnswers(from),
      state: from.store.resolver,
      attempt: 0,
    });
    expect(!refused.ok && refused.error.faultKind).toBe('record_invalid');
  });

  it('refuses a record whose identity is not the one asked for', async () => {
    const from = await opened();
    from.store.misbehave({
      kind: 'mutates',
      change: (row) => ({ ...row, executionId: 'somebody-elses' }),
    });
    const refused = await from.handler.tryExecute({
      event: inventoryAnswers(from),
      state: from.store.resolver,
      attempt: 0,
    });
    expect(!refused.ok && refused.error.faultKind).toBe('record_invalid');
  });

  it('refuses a record that disagrees with its own opening event', async () => {
    const from = await opened();
    from.store.misbehave({
      kind: 'mutates',
      change: (row) => ({ ...row, subject: 'a-different-workflow' }),
    });
    const refused = await from.handler.tryExecute({
      event: inventoryAnswers(from),
      state: from.store.resolver,
      attempt: 0,
    });
    expect(!refused.ok && refused.error.faultKind).toBe('record_invalid');
  });

  it('refuses one whose opening event will not restore', async () => {
    const from = await opened();
    from.store.misbehave({
      kind: 'mutates',
      change: (row) => ({ ...row, initEvent: { not: 'an event' } }),
    });
    const refused = await from.handler.tryExecute({
      event: inventoryAnswers(from),
      state: from.store.resolver,
      attempt: 0,
    });
    expect(!refused.ok && refused.error.faultKind).toBe(
      'record_event_unrestorable',
    );
  });

  it('writes nothing of its own when it refuses any of them', async () => {
    const from = await opened();
    const before = new Map(from.store.rows);
    from.store.misbehave({ kind: 'returns', row: NOT_A_RECORD });
    await from.handler.tryExecute({
      event: inventoryAnswers(from),
      state: from.store.resolver,
      attempt: 0,
    });
    expect(from.store.rows).toEqual(before);
  });
});

describe('a store that fails and then does not', () => {
  it('faults retry-safe, then succeeds against an unchanged record', async () => {
    const from = await opened();
    const before = from.store.rows.get(String(from.ran.state.executionId));

    from.store.misbehave({ kind: 'unreachable' });
    const first = await from.handler.tryExecute({
      event: inventoryAnswers(from),
      state: from.store.resolver,
      attempt: 0,
    });
    expect(!first.ok && first.error.retry).not.toBeNull();

    from.store.misbehave(null);
    const second = await from.handler.execute({
      event: inventoryAnswers(from),
      state: from.store.resolver,
      attempt: 1,
    });

    expect(second.kind).toBe('produced');
    // the record it ran against is the one that was always there
    expect(from.store.rows.get(String(from.ran.state.executionId))).toEqual(
      before,
    );
  });

  it('reads the store afresh on every attempt, never a value held earlier', async () => {
    const from = await opened();
    const asked = from.store.reads.length;
    await from.handler.execute({
      event: inventoryAnswers(from),
      state: from.store.resolver,
      attempt: 1,
    });
    expect(from.store.reads.length).toBe(asked + 1);
  });

  it('asks for one execution and no other', async () => {
    const store = new ScenarioStore();
    const from = await opened(store);
    store.reads.length = 0;
    await from.handler.execute({
      event: inventoryAnswers(from),
      state: store.resolver,
      attempt: 0,
    });
    expect(new Set(store.reads).size).toBe(1);
    expect(store.reads[0]).toBe(String(from.ran.state.executionId));
  });
});

describe('a transport that repeats itself', () => {
  it('discards an answer the execution has already processed', async () => {
    const from = await opened();
    const answered = inventoryAnswers(from);

    const first = await from.handler.execute({
      event: answered,
      state: from.store.resolver,
      attempt: 0,
    });
    if (first.kind !== 'produced') throw new Error('not recorded');
    from.store.commit(first.state);

    for (let again = 0; again < 5; again += 1) {
      const repeat = await from.handler.execute({
        event: answered,
        state: from.store.resolver,
        attempt: 0,
      });
      expect(repeat.kind).toBe('discarded');
    }
  });

  it('leaves the store exactly as the first one left it', async () => {
    const from = await opened();
    const answered = inventoryAnswers(from);
    const first = await from.handler.execute({
      event: answered,
      state: from.store.resolver,
      attempt: 0,
    });
    if (first.kind !== 'produced') throw new Error('not recorded');
    from.store.commit(first.state);
    const after = new Map(from.store.rows);

    await from.handler.execute({
      event: answered,
      state: from.store.resolver,
      attempt: 0,
    });
    expect(from.store.rows).toEqual(after);
  });

  it('refuses a repeated opening event rather than opening a second', async () => {
    const from = await opened();
    const refused = await from.handler.tryExecute({
      event: from.order,
      state: from.store.resolver,
      attempt: 0,
    });
    expect(!refused.ok && refused.error.faultKind).toBe('record_unexpected');
    expect(from.store.rows.size).toBe(1);
  });

  it('derives the same identity for the repeat, which is why it is caught', async () => {
    const from = await opened();
    const refused = await from.handler.tryExecute({
      event: from.order,
      state: from.store.resolver,
      attempt: 0,
    });
    expect(!refused.ok && refused.error.executionId).toBe(
      String(from.ran.state.executionId),
    );
  });
});

describe('an answer arriving at an execution that has finished', () => {
  const finished = async () => {
    const from = await opened();
    const first = await from.handler.execute({
      event: inventoryAnswers(from),
      state: from.store.resolver,
      attempt: 0,
    });
    if (first.kind !== 'produced') throw new Error('not recorded');
    from.store.commit(first.state);

    const second = await from.handler.execute({
      event: paymentAnswers(from),
      state: from.store.resolver,
      attempt: 0,
    });
    if (second.kind !== 'produced') throw new Error('not answered');
    from.store.commit(second.state);
    expect(second.state.lifecycle).toBe('success');
    return from;
  };

  it('is refused for being late rather than for what it carries', async () => {
    const from = await finished();
    const late = createArvoEventFactory(paymentV1).createOutput({
      type: 'evt_payment_charged',
      source: paymentV1.type,
      subject: from.order.subject,
      to: fulfilContract.type,
      executionid: String(from.ran.state.executionId),
      initid: 'a-request-from-long-ago',
      parentid: 'a-request-from-long-ago',
      data: { receipt: 'r-2' },
    });

    const refused = await from.handler.tryExecute({
      event: late,
      state: from.store.resolver,
      attempt: 0,
    });
    expect(!refused.ok && refused.error.faultKind).toBe('lifecycle_terminal');
  });

  it('is still refused for being late when its payload is also wrong', async () => {
    const from = await finished();
    // the ordering this implementation had to be built carefully to keep:
    // judged for its payload first, this would carry an answer to a
    // caller that was answered once already
    const wrong = cloneArvoEvent(
      createArvoEventFactory(paymentV1).createOutput({
        type: 'evt_payment_charged',
        source: paymentV1.type,
        subject: from.order.subject,
        to: fulfilContract.type,
        executionid: String(from.ran.state.executionId),
        initid: 'a-request-from-long-ago',
        parentid: 'a-request-from-long-ago',
        data: { receipt: 'r-2' },
      }),
      { data: { receipt: 7 as unknown as string } },
    );

    const refused = await from.handler.tryExecute({
      event: wrong,
      state: from.store.resolver,
      attempt: 0,
    });
    expect(!refused.ok && refused.error.faultKind).toBe('lifecycle_terminal');
  });

  it('sends that caller nothing, it having been answered once already', async () => {
    const from = await finished();
    const late = createArvoEventFactory(paymentV1).createOutput({
      type: 'evt_payment_charged',
      source: paymentV1.type,
      subject: from.order.subject,
      to: fulfilContract.type,
      executionid: String(from.ran.state.executionId),
      initid: 'a-request-from-long-ago',
      parentid: 'a-request-from-long-ago',
      data: { receipt: 'r-2' },
    });
    const refused = await from.handler.tryExecute({
      event: late,
      state: from.store.resolver,
      attempt: 0,
    });
    if (refused.ok) throw new Error('nothing was refused');
    expect(refused.error.abandonmentEvent).toBeNull();
    expect(refused.error.abandonmentState).toBeNull();
  });
});

describe('a state schema changed under records already written', () => {
  it('refuses every execution that was open under the old shape', async () => {
    const store = new ScenarioStore();
    const from = await opened(store);

    // the same version, redeclared with a shape the stored data cannot
    // satisfy — which the protocol says fails every one of them
    const changed = setupArvoEventHandler({
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

    const refused = await changed.tryExecute({
      event: inventoryAnswers(from),
      state: store.resolver,
      attempt: 0,
    });

    expect(!refused.ok && refused.error.faultKind).toBe('record_invalid');
    expect(!refused.ok && refused.error.retry).toBeNull();
  });

  it('can still tell the caller, the record itself being sound', async () => {
    const store = new ScenarioStore();
    const from = await opened(store);
    const changed = setupArvoEventHandler({
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

    const refused = await changed.tryExecute({
      event: inventoryAnswers(from),
      state: store.resolver,
      attempt: 0,
    });
    if (refused.ok) throw new Error('nothing was refused');

    // the envelope passed and only the data failed, so the caller is
    // addressable and the record can be brought to rest
    expect(refused.error.abandonmentEvent).not.toBeNull();
    const resting = JSON.parse(
      String(refused.error.abandonmentState),
    ) as JSONObject;
    expect(resting.lifecycle).toBe('failure');
  });
});

describe('a version that remembers nothing, handed a record that does', () => {
  it('refuses even an empty object, its record carrying none at all', async () => {
    // the schema such a version is judged against admits {}, so this is
    // the one shape that reaches the rule rather than the schema
    const store = new ScenarioStore();
    const handler = declareHandler();

    const shipped = await handler.execute({
      event: createArvoEventFactory(fulfilV2).createInput({
        source: 'com.web.checkout',
        subject: 'order-1',
        to: fulfilContract.type,
        data: { items: ['book'] },
      }),
      state: store.resolver,
      attempt: 0,
    });
    if (shipped.kind !== 'produced') throw new Error('nothing was opened');
    expect(shipped.state.data).toBeNull();

    const answered = createArvoEventFactory(inventoryV1).createOutput({
      type: 'evt_inventory_reserved',
      source: inventoryV1.type,
      subject: 'order-1',
      to: fulfilContract.type,
      executionid: String(shipped.state.executionId),
      initid: 'a-request-it-never-sent',
      parentid: 'a-request-it-never-sent',
      data: { held: 1 },
    });

    const refused = await handler.tryExecute({
      event: answered,
      state: () => ({ ...shipped.state, data: {} }),
      attempt: 0,
    });

    expect(!refused.ok && refused.error.faultKind).toBe('record_invalid');
    expect(!refused.ok && refused.error.violations.join(' ')).toContain(
      'must be null',
    );
  });
});
