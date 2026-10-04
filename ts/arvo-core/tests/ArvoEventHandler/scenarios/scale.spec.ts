import { describe, expect, it } from 'vitest';
import { createArvoEventFactory } from '../../../src/factories/ArvoEventFactory/index.js';
import { cloneArvoEvent } from '../../../src/factories/cloneArvoEvent.js';
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

const opening = (subject: string) => ({
  source: 'com.web.checkout',
  subject,
  to: fulfilContract.type,
});

const atVersion = (version: '1.0.0' | '1.1.0' | '2.0.0', subject: string) => {
  if (version === '1.1.0') {
    return createArvoEventFactory(fulfilV11).createInput({
      ...opening(subject),
      data: { items: ['book'], rush: true },
    });
  }
  if (version === '2.0.0') {
    return createArvoEventFactory(fulfilV2).createInput({
      ...opening(subject),
      data: { items: ['book'] },
    });
  }
  return createArvoEventFactory(fulfilV1).createInput({
    ...opening(subject),
    data: { items: ['book'] },
  });
};

describe('ten thousand executions through one handler', () => {
  it('opens every one of them, across all three versions', async () => {
    const handler = declareHandler();
    const store = new ScenarioStore();
    const versions = ['1.0.0', '1.1.0', '2.0.0'] as const;

    const began = Date.now();
    for (let at = 0; at < 10_000; at += 1) {
      const version = versions[at % 3] as (typeof versions)[number];
      const ran = await handler.execute({
        event: atVersion(version, `order-${at}`),
        state: store.resolver,
        attempt: 0,
      });
      if (ran.kind !== 'produced') throw new Error(`order-${at} did not open`);
      store.commit(ran.state);
    }
    const took = Date.now() - began;

    expect(store.rows.size).toBe(10_000);
    // every one under its own identity, so none collided
    expect(new Set([...store.rows.keys()]).size).toBe(10_000);
    expect(took, `ten thousand took ${took}ms`).toBeLessThan(20_000);
  }, 60_000);

  it('places the last event as cheaply as the first', async () => {
    const handler = declareHandler();
    const store = new ScenarioStore();

    const timing = async (subject: string) => {
      const began = performance.now();
      const ran = await handler.execute({
        event: atVersion('1.0.0', subject),
        state: store.resolver,
        attempt: 0,
      });
      if (ran.kind === 'produced') store.commit(ran.state);
      return performance.now() - began;
    };

    const first = await timing('order-first');
    for (let at = 0; at < 2_000; at += 1) await timing(`order-${at}`);
    const last = await timing('order-last');

    // generous, because one measurement is noisy; what it refuses is a
    // cost that grows with how many executions the store already holds
    expect(last, `first ${first}ms, last ${last}ms`).toBeLessThan(
      Math.max(first * 50, 50),
    );
  }, 60_000);
});

describe('the boundaries, where an off-by-one would live', () => {
  it('runs a contract whose only version is the one asked for', async () => {
    const handler = declareHandler();
    const ran = await handler.execute({
      event: atVersion('2.0.0', 'order-1'),
      state: new ScenarioStore().resolver,
      attempt: 0,
    });
    expect(ran.kind).toBe('produced');
  });

  it('refuses a dataschema with no version to read', async () => {
    const handler = declareHandler();
    const refused = await handler.tryExecute({
      event: cloneArvoEvent(atVersion('1.0.0', 'order-1'), {
        dataschema: 'nothing-separable',
      }),
      state: new ScenarioStore().resolver,
      attempt: 0,
    });
    expect(!refused.ok && refused.error.faultKind).toBe('event_unclassifiable');
  });

  it('reads the version from the last separator, not the first', async () => {
    // the contract's own uri carries separators, so splitting anywhere
    // else hands part of it to the version
    expect(fulfilContract.uri.includes('/')).toBe(true);
    const ran = await declareHandler().execute({
      event: atVersion('1.0.0', 'order-1'),
      state: new ScenarioStore().resolver,
      attempt: 0,
    });
    expect(ran.kind === 'produced' && ran.state.version).toBe('1.0.0');
  });

  it('takes the first attempt and the last alike', async () => {
    const handler = declareHandler();
    for (const attempt of [0, 3, 99]) {
      const ran = await handler.execute({
        event: atVersion('1.0.0', `order-${attempt}`),
        state: new ScenarioStore().resolver,
        attempt,
      });
      expect(ran.kind).toBe('produced');
    }
  });

  it('tells an empty row from no row at all', async () => {
    const handler = declareHandler();
    const empty = await handler.tryExecute({
      event: atVersion('1.0.0', 'order-1'),
      state: () => ({}),
      attempt: 0,
    });
    // something is stored, so an opening event may not open a second
    expect(!empty.ok && empty.error.faultKind).toBe('record_unexpected');
  });
});

describe('payloads chosen to be awkward', () => {
  const handler = declareHandler();
  const store = () => new ScenarioStore();

  it('refuses a type that is a property every object has', async () => {
    const refused = await handler.tryExecute({
      event: cloneArvoEvent(atVersion('1.0.0', 'order-1'), {
        type: 'constructor',
      }),
      state: store().resolver,
      attempt: 0,
    });
    expect(!refused.ok && refused.error.faultKind).toBe('type_not_receivable');
  });

  it('carries a workflow name of emoji and surrogate pairs', async () => {
    const ran = await handler.execute({
      event: atVersion('1.0.0', 'order-🧾-𝔘𝔫𝔦𝔠𝔬𝔡𝔢'),
      state: store().resolver,
      attempt: 0,
    });
    expect(ran.kind === 'produced' && ran.state.subject).toBe(
      'order-🧾-𝔘𝔫𝔦𝔠𝔬𝔡𝔢',
    );
  });

  it('carries a payload of a thousand items', async () => {
    const many = Array.from({ length: 1_000 }, (_, at) => `item-${at}`);
    const ran = await handler.execute({
      event: createArvoEventFactory(fulfilV1).createInput({
        ...opening('order-many'),
        data: { items: many },
      }),
      state: store().resolver,
      attempt: 0,
    });
    expect(ran.kind).toBe('produced');
  });

  it('refuses a version named for a property every object inherits', async () => {
    for (const crafted of ['__proto__', 'constructor', 'toString']) {
      const refused = await handler.tryExecute({
        event: cloneArvoEvent(atVersion('1.0.0', 'order-1'), {
          dataschema: `${fulfilContract.uri}/${crafted}`,
        }),
        state: store().resolver,
        attempt: 0,
      });
      expect(
        !refused.ok && refused.error.faultKind,
        `${crafted} was not refused`,
      ).toBe('event_unclassifiable');
    }
  });

  it('refuses a type named for one, rather than finding what it inherits', async () => {
    for (const crafted of ['constructor', 'toString', 'valueOf']) {
      const refused = await handler.tryExecute({
        event: cloneArvoEvent(atVersion('1.0.0', 'order-1'), {
          type: crafted,
        }),
        state: store().resolver,
        attempt: 0,
      });
      expect(
        !refused.ok && refused.error.faultKind,
        `${crafted} was not refused`,
      ).toBe('type_not_receivable');
    }
  });

  it('refuses an answer typed for one, on the way back in', async () => {
    const opened = await handler.execute({
      event: atVersion('1.0.0', 'order-1'),
      state: store().resolver,
      attempt: 0,
    });
    if (opened.kind !== 'produced') throw new Error('nothing was opened');

    const held = new ScenarioStore();
    held.commit(opened.state);

    const crafted = cloneArvoEvent(
      createArvoEventFactory(inventoryV1).createOutput({
        type: 'evt_inventory_reserved',
        source: inventoryV1.type,
        subject: 'order-1',
        to: fulfilContract.type,
        executionid: String(opened.state.executionId),
        initid: opened.events[0]?.id,
        parentid: opened.events[0]?.id,
        data: { held: 1 },
      }),
      { type: 'constructor' },
    );

    const refused = await handler.tryExecute({
      event: crafted,
      state: held.resolver,
      attempt: 0,
    });
    expect(!refused.ok && refused.error.faultKind).toBe('type_not_receivable');
  });
});

describe('a handler holds nothing between executions', () => {
  it('runs two versions through one instance without either reaching the other', async () => {
    const handler = declareHandler();
    const store = new ScenarioStore();

    const first = await handler.execute({
      event: atVersion('1.0.0', 'order-first'),
      state: store.resolver,
      attempt: 0,
    });
    if (first.kind !== 'produced') throw new Error('not opened');
    store.commit(first.state);

    const second = await handler.execute({
      event: atVersion('1.1.0', 'order-second'),
      state: store.resolver,
      attempt: 0,
    });
    if (second.kind !== 'produced') throw new Error('not opened');
    store.commit(second.state);

    // the first is resumed after the second ran, and remembers only
    // what it wrote
    const answered = await handler.execute({
      event: createArvoEventFactory(inventoryV1).createOutput({
        type: 'evt_inventory_reserved',
        source: inventoryV1.type,
        subject: 'order-first',
        to: fulfilContract.type,
        executionid: String(first.state.executionId),
        initid: first.events[0]?.id,
        parentid: first.events[0]?.id,
        data: { held: 1 },
      }),
      state: store.resolver,
      attempt: 0,
    });

    expect(answered.kind === 'produced' && answered.state.version).toBe(
      '1.0.0',
    );
    expect(answered.kind === 'produced' && answered.state.subject).toBe(
      'order-first',
    );
  });

  it('is the same handler however many executions have passed through it', async () => {
    const handler = declareHandler();
    const store = new ScenarioStore();
    for (let at = 0; at < 200; at += 1) {
      const ran = await handler.execute({
        event: atVersion('1.0.0', `order-${at}`),
        state: store.resolver,
        attempt: 0,
      });
      if (ran.kind === 'produced') store.commit(ran.state);
    }

    const after = await handler.execute({
      event: atVersion('1.0.0', 'order-after'),
      state: store.resolver,
      attempt: 0,
    });
    expect(after.kind === 'produced' && after.state.casVersion).toBe(0);
    expect(after.kind === 'produced' && after.state.data).toEqual({
      stage: 'asking',
      answers: 0,
    });
  });
});
