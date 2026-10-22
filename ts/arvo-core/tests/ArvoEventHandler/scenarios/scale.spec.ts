import { describe, expect, it } from 'vitest';
import { createArvoEventFactory } from '../../../src/factories/ArvoEventFactory/index.js';
import { mutateArvoEvent } from '../../../src/factories/mutateArvoEvent.js';
import {
  declareHandler,
  fulfilContract,
  fulfilV1,
  fulfilV2,
  fulfilV11,
  inventoryV1,
} from './fixture.js';
import { ScenarioStore } from './store.js';

/**
 * What placing an event costs, and what it must not cost.
 *
 * The handler decides which execution an event concerns and which
 * version owns it. Neither answer may get slower as a store fills up:
 * one is derived from the event alone and the other is read from one
 * record, so the cost of both is fixed. A budget is asserted so a
 * regression that makes either grow fails the suite rather than merely
 * slowing it.
 */

const openingFields = (subject: string) => ({
  source: 'com.web.checkout',
  subject,
  to: fulfilContract.type,
});

const openingEvent = (
  version: '1.0.0' | '1.1.0' | '2.0.0',
  subject: string,
) => {
  if (version === '1.1.0') {
    return createArvoEventFactory(fulfilV11).createInput({
      ...openingFields(subject),
      data: { items: ['book'], rush: true },
    });
  }
  if (version === '2.0.0') {
    return createArvoEventFactory(fulfilV2).createInput({
      ...openingFields(subject),
      data: { items: ['book'] },
    });
  }
  return createArvoEventFactory(fulfilV1).createInput({
    ...openingFields(subject),
    data: { items: ['book'] },
  });
};

describe('ten thousand executions through one handler', () => {
  it('opens every one of them, across all three versions', async () => {
    const handler = declareHandler();
    const store = new ScenarioStore();
    const versions = ['1.0.0', '1.1.0', '2.0.0'] as const;

    const startMs = Date.now();
    for (let orderIndex = 0; orderIndex < 10_000; orderIndex += 1) {
      const version = versions[orderIndex % 3] as (typeof versions)[number];
      const outcome = await handler.execute({
        event: openingEvent(version, `order-${orderIndex}`),
        state: store.resolver,
        attempt: 0,
      });
      if (outcome.kind !== 'produced')
        throw new Error(`order-${orderIndex} did not open`);
      store.commit(outcome.state);
    }
    const elapsedMs = Date.now() - startMs;

    expect(store.rows.size).toBe(10_000);
    // every one under its own identity, so none collided
    expect(new Set([...store.rows.keys()]).size).toBe(10_000);
    expect(elapsedMs, `ten thousand took ${elapsedMs}ms`).toBeLessThan(20_000);
  }, 60_000);

  it('places the last event as cheaply as the first', async () => {
    const handler = declareHandler();
    const store = new ScenarioStore();

    const timeOpening = async (subject: string) => {
      const startMs = performance.now();
      const outcome = await handler.execute({
        event: openingEvent('1.0.0', subject),
        state: store.resolver,
        attempt: 0,
      });
      if (outcome.kind === 'produced') store.commit(outcome.state);
      return performance.now() - startMs;
    };

    const firstOpeningMs = await timeOpening('order-first');
    for (let orderIndex = 0; orderIndex < 2_000; orderIndex += 1)
      await timeOpening(`order-${orderIndex}`);
    const lastOpeningMs = await timeOpening('order-last');

    // generous, because one measurement is noisy; what it refuses is a
    // cost that grows with how many executions the store already holds
    expect(
      lastOpeningMs,
      `first ${firstOpeningMs}ms, last ${lastOpeningMs}ms`,
    ).toBeLessThan(Math.max(firstOpeningMs * 50, 50));
  }, 60_000);
});

describe('the boundaries, where an off-by-one would live', () => {
  it('runs a contract whose only version is the one asked for', async () => {
    const handler = declareHandler();
    const outcome = await handler.execute({
      event: openingEvent('2.0.0', 'order-1'),
      state: new ScenarioStore().resolver,
      attempt: 0,
    });
    expect(outcome.kind).toBe('produced');
  });

  it('refuses a dataschema with no version to read', async () => {
    const handler = declareHandler();
    const refusal = await handler.tryExecute({
      event: mutateArvoEvent(openingEvent('1.0.0', 'order-1'), {
        dataschema: 'nothing-separable',
      }),
      state: new ScenarioStore().resolver,
      attempt: 0,
    });
    expect(!refusal.ok && refusal.error.faultKind).toBe('event_unclassifiable');
  });

  it('reads the version from the last separator, not the first', async () => {
    // the contract's own uri carries separators, so splitting anywhere
    // else hands part of it to the version
    expect(fulfilContract.uri.includes('/')).toBe(true);
    const outcome = await declareHandler().execute({
      event: openingEvent('1.0.0', 'order-1'),
      state: new ScenarioStore().resolver,
      attempt: 0,
    });
    expect(outcome.kind === 'produced' && outcome.state.version).toBe('1.0.0');
  });

  it('takes the first attempt and the last alike', async () => {
    const handler = declareHandler();
    for (const attempt of [0, 3, 99]) {
      const outcome = await handler.execute({
        event: openingEvent('1.0.0', `order-${attempt}`),
        state: new ScenarioStore().resolver,
        attempt,
      });
      expect(outcome.kind).toBe('produced');
    }
  });

  it('tells an empty row from no row at all', async () => {
    const handler = declareHandler();
    const refusal = await handler.tryExecute({
      event: openingEvent('1.0.0', 'order-1'),
      state: () => ({}),
      attempt: 0,
    });
    // something is stored, so an opening event may not open a second
    expect(!refusal.ok && refusal.error.faultKind).toBe('record_unexpected');
  });
});

describe('payloads chosen to be awkward', () => {
  const handler = declareHandler();
  const freshStore = () => new ScenarioStore();

  it('refuses a type that is a property every object has', async () => {
    const refusal = await handler.tryExecute({
      event: mutateArvoEvent(openingEvent('1.0.0', 'order-1'), {
        type: 'constructor',
      }),
      state: freshStore().resolver,
      attempt: 0,
    });
    expect(!refusal.ok && refusal.error.faultKind).toBe('type_not_receivable');
  });

  it('carries a workflow name of emoji and surrogate pairs', async () => {
    const outcome = await handler.execute({
      event: openingEvent('1.0.0', 'order-🧾-𝔘𝔫𝔦𝔠𝔬𝔡𝔢'),
      state: freshStore().resolver,
      attempt: 0,
    });
    expect(outcome.kind === 'produced' && outcome.state.subject).toBe(
      'order-🧾-𝔘𝔫𝔦𝔠𝔬𝔡𝔢',
    );
  });

  it('carries a payload of a thousand items', async () => {
    const items = Array.from(
      { length: 1_000 },
      (_, itemIndex) => `item-${itemIndex}`,
    );
    const outcome = await handler.execute({
      event: createArvoEventFactory(fulfilV1).createInput({
        ...openingFields('order-many'),
        data: { items },
      }),
      state: freshStore().resolver,
      attempt: 0,
    });
    expect(outcome.kind).toBe('produced');
  });

  it('refuses a version named for a property every object inherits', async () => {
    for (const craftedName of ['__proto__', 'constructor', 'toString']) {
      const refusal = await handler.tryExecute({
        event: mutateArvoEvent(openingEvent('1.0.0', 'order-1'), {
          dataschema: `${fulfilContract.uri}/${craftedName}`,
        }),
        state: freshStore().resolver,
        attempt: 0,
      });
      expect(
        !refusal.ok && refusal.error.faultKind,
        `${craftedName} was not refused`,
      ).toBe('event_unclassifiable');
    }
  });

  it('refuses a type named for one, rather than finding what it inherits', async () => {
    for (const craftedName of ['constructor', 'toString', 'valueOf']) {
      const refusal = await handler.tryExecute({
        event: mutateArvoEvent(openingEvent('1.0.0', 'order-1'), {
          type: craftedName,
        }),
        state: freshStore().resolver,
        attempt: 0,
      });
      expect(
        !refusal.ok && refusal.error.faultKind,
        `${craftedName} was not refused`,
      ).toBe('type_not_receivable');
    }
  });

  it('refuses an answer typed for one, on the way back in', async () => {
    const openingOutcome = await handler.execute({
      event: openingEvent('1.0.0', 'order-1'),
      state: freshStore().resolver,
      attempt: 0,
    });
    if (openingOutcome.kind !== 'produced')
      throw new Error('nothing was opened');

    const committedStore = new ScenarioStore();
    committedStore.commit(openingOutcome.state);

    const craftedAnswer = mutateArvoEvent(
      createArvoEventFactory(inventoryV1).createOutput({
        type: 'evt_inventory_reserved',
        source: inventoryV1.type,
        subject: 'order-1',
        to: fulfilContract.type,
        executionid: String(openingOutcome.state.executionId),
        initid: openingOutcome.events[0]?.id,
        parentid: openingOutcome.events[0]?.id,
        data: { held: 1 },
      }),
      { type: 'constructor' },
    );

    const refusal = await handler.tryExecute({
      event: craftedAnswer,
      state: committedStore.resolver,
      attempt: 0,
    });
    expect(!refusal.ok && refusal.error.faultKind).toBe('type_not_receivable');
  });
});

describe('a handler holds nothing between executions', () => {
  it('runs two versions through one instance without either reaching the other', async () => {
    const handler = declareHandler();
    const store = new ScenarioStore();

    const v1Outcome = await handler.execute({
      event: openingEvent('1.0.0', 'order-first'),
      state: store.resolver,
      attempt: 0,
    });
    if (v1Outcome.kind !== 'produced') throw new Error('not opened');
    store.commit(v1Outcome.state);

    const v11Outcome = await handler.execute({
      event: openingEvent('1.1.0', 'order-second'),
      state: store.resolver,
      attempt: 0,
    });
    if (v11Outcome.kind !== 'produced') throw new Error('not opened');
    store.commit(v11Outcome.state);

    // the first is resumed after the second ran, and remembers only
    // what it wrote
    const answerOutcome = await handler.execute({
      event: createArvoEventFactory(inventoryV1).createOutput({
        type: 'evt_inventory_reserved',
        source: inventoryV1.type,
        subject: 'order-first',
        to: fulfilContract.type,
        executionid: String(v1Outcome.state.executionId),
        initid: v1Outcome.events[0]?.id,
        parentid: v1Outcome.events[0]?.id,
        data: { held: 1 },
      }),
      state: store.resolver,
      attempt: 0,
    });

    expect(
      answerOutcome.kind === 'produced' && answerOutcome.state.version,
    ).toBe('1.0.0');
    expect(
      answerOutcome.kind === 'produced' && answerOutcome.state.subject,
    ).toBe('order-first');
  });

  it('is the same handler however many executions have passed through it', async () => {
    const handler = declareHandler();
    const store = new ScenarioStore();
    for (let orderIndex = 0; orderIndex < 200; orderIndex += 1) {
      const outcome = await handler.execute({
        event: openingEvent('1.0.0', `order-${orderIndex}`),
        state: store.resolver,
        attempt: 0,
      });
      if (outcome.kind === 'produced') store.commit(outcome.state);
    }

    const laterOutcome = await handler.execute({
      event: openingEvent('1.0.0', 'order-after'),
      state: store.resolver,
      attempt: 0,
    });
    expect(
      laterOutcome.kind === 'produced' && laterOutcome.state.casVersion,
    ).toBe(0);
    expect(laterOutcome.kind === 'produced' && laterOutcome.state.data).toEqual(
      {
        stage: 'asking',
        answers: 0,
      },
    );
  });
});
