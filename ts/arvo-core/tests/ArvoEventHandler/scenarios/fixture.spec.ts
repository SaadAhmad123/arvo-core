import { describe, expect, it } from 'vitest';
import { createArvoEventFactory } from '../../../src/factories/ArvoEventFactory/index.js';
import {
  declareHandler,
  declareHandlerAfterDrain,
  declareWalker,
  fulfilContract,
  fulfilV1,
  fulfilV2,
  fulfilV11,
} from './fixture.js';
import { NOT_A_RECORD, ScenarioStore } from './store.js';

/**
 * The fixture and the store, proven before anything is built on them.
 *
 * A harness that quietly does not do what it claims produces a suite
 * that passes for the wrong reason, which the version's own suite found
 * five times over.
 */

describe('the handler the scenarios are built on', () => {
  const handler = declareHandler();

  it('runs all three versions of its contract', () => {
    expect([...handler.versions.keys()].sort()).toEqual([
      '1.0.0',
      '1.1.0',
      '2.0.0',
    ]);
  });

  it('binds each version to its own shapes, so routing is observable', () => {
    expect(handler.versions.get('1.0.0').contracts.self).toBe(fulfilV1);
    expect(handler.versions.get('1.1.0').contracts.self).toBe(fulfilV11);
    expect(handler.versions.get('2.0.0').contracts.self).toBe(fulfilV2);
  });

  it('gives each version a schema only it can satisfy', () => {
    const first = handler.versions.get('1.0.0').dataSchema;
    const second = handler.versions.get('1.1.0').dataSchema;
    expect(first).not.toBe(second);
    expect(handler.versions.get('2.0.0').declaresState).toBe(false);
  });

  it('lets a version hold options the others do not', () => {
    const shaped = declareHandler({
      options: { maxRetryAttempts: 5 },
      versionOptions: { '1.1.0': { maxDepth: 7 } },
    });
    expect(shaped.versions.get('1.1.0').options.maxDepth).toBe(7);
    expect(shaped.versions.get('1.0.0').options.maxDepth).not.toBe(7);
    expect(shaped.versions.get('1.0.0').options.maxRetryAttempts).toBe(5);
  });
});

describe('the same handler after a version is drained away', () => {
  it('no longer runs it, while its records are still addressed to it', () => {
    const drained = declareHandlerAfterDrain();
    expect([...drained.versions.keys()].sort()).toEqual(['1.1.0', '2.0.0']);
    expect(drained.contracts.self.uri).toBe(fulfilContract.uri);
  });
});

describe('the handler that calls itself', () => {
  it('declares its own contract among what it may send to', () => {
    const walker = declareWalker();
    expect(walker.contracts.services.deeper.uri).toBe(
      walker.contracts.self.uri,
    );
  });
});

describe('a store that behaves', () => {
  it('hands back what was committed, and records being asked', async () => {
    const store = new ScenarioStore();
    store.commit({ executionId: 'e-1', anything: true });
    expect(await store.resolver({ executionId: 'e-1' } as never)).toEqual({
      executionId: 'e-1',
      anything: true,
    });
    expect(store.reads).toEqual(['e-1']);
  });

  it('hands back nothing for an execution it never held', async () => {
    const store = new ScenarioStore();
    expect(await store.resolver({ executionId: 'e-1' } as never)).toBeNull();
  });
});

describe('a store that does not', () => {
  const asking = (store: ScenarioStore) =>
    store.resolver({ executionId: 'e-1' } as never);

  it('fails as an error', async () => {
    const store = new ScenarioStore().misbehave({ kind: 'unreachable' });
    await expect(async () => asking(store)).rejects.toThrow('unreachable');
  });

  it('fails as a rejection', async () => {
    const store = new ScenarioStore().misbehave({
      kind: 'unreachable',
      as: 'rejection',
    });
    await expect(asking(store)).rejects.toThrow('unreachable');
  });

  it('fails as something that is not an error at all', async () => {
    const store = new ScenarioStore().misbehave({
      kind: 'unreachable',
      as: 'string',
    });
    expect(() => asking(store)).toThrow();
  });

  it('answers with something that is not a record', async () => {
    const store = new ScenarioStore().misbehave({
      kind: 'returns',
      row: NOT_A_RECORD,
    });
    expect(await asking(store)).toEqual(NOT_A_RECORD);
  });

  it('answers wrongly once, and honestly afterwards', async () => {
    const store = new ScenarioStore();
    store.commit({ executionId: 'e-1', honest: true });
    store.misbehave({ kind: 'returnsOnce', row: NOT_A_RECORD });
    expect(await asking(store)).toEqual(NOT_A_RECORD);
    expect(await asking(store)).toEqual({ executionId: 'e-1', honest: true });
  });

  it('changes what it holds on the way out, leaving the store untouched', async () => {
    const store = new ScenarioStore();
    store.commit({ executionId: 'e-1', subject: 'right' });
    store.misbehave({
      kind: 'mutates',
      change: (row) => ({ ...row, subject: 'wrong' }),
    });
    expect(await asking(store)).toMatchObject({ subject: 'wrong' });
    expect(store.rows.get('e-1')).toMatchObject({ subject: 'right' });
  });
});

describe('what each version answers with, so routing is provable', () => {
  const opening = {
    source: 'com.web.checkout',
    subject: 'order-1',
    to: fulfilContract.type,
  };

  it('runs the version the event names, and no other', async () => {
    const handler = declareHandler();

    const shipped = await handler.execute({
      event: createArvoEventFactory(fulfilV2).createInput({
        ...opening,
        data: { items: ['book'] },
      }),
      state: new ScenarioStore().resolver,
      attempt: 0,
    });
    expect(shipped.kind === 'produced' && shipped.events[0]?.type).toBe(
      'evt_order_shipped',
    );

    const rushed = await handler.execute({
      event: createArvoEventFactory(fulfilV11).createInput({
        ...opening,
        data: { items: ['book'], rush: true },
      }),
      state: new ScenarioStore().resolver,
      attempt: 0,
    });
    expect(rushed.kind === 'produced' && rushed.events[0]?.type).toBe(
      'com_payment_charge',
    );

    const first = await handler.execute({
      event: createArvoEventFactory(fulfilV1).createInput({
        ...opening,
        data: { items: ['book'] },
      }),
      state: new ScenarioStore().resolver,
      attempt: 0,
    });
    expect(first.kind === 'produced' && first.events).toHaveLength(2);
  });
});
