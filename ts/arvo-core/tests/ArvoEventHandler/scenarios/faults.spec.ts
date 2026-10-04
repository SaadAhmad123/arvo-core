import { describe, expect, it } from 'vitest';
import type { ArvoEvent } from '../../../src/ArvoEvent/index.js';
import type { ArvoHandlerFault } from '../../../src/ArvoEventHandler/fault/index.js';
import type { ArvoEventHandlerExecuteParam } from '../../../src/ArvoEventHandler/types/execute.js';
import { createArvoEventFactory } from '../../../src/factories/ArvoEventFactory/index.js';
import { cloneArvoEvent } from '../../../src/factories/cloneArvoEvent.js';
import type { JSONObject } from '../../../src/types.js';
import {
  declareHandler,
  declareHandlerAfterDrain,
  fulfilContract,
  fulfilV1,
  inventoryV1,
  inventoryV11,
  paymentV1,
  type ScenarioDependencies,
  strangerV1,
} from './fixture.js';
import { NOT_A_RECORD, ScenarioStore } from './store.js';

/**
 * Every fault the handler raises, caused through `execute`.
 *
 * Caused rather than constructed: a row here is a real event given to a
 * real handler against a real store, so a refactor that stops producing
 * one is caught. A helper called directly would keep passing.
 *
 * Each row asserts the whole fault, because a mechanism reads all of it:
 * the kind it branches on, whether another attempt is in prospect, what
 * it would take to give up, and that nothing was published or committed
 * on the way.
 */

const anOrder = (subject = 'order-1') =>
  createArvoEventFactory(fulfilV1).createInput({
    source: 'com.web.checkout',
    subject,
    to: fulfilContract.type,
    data: { items: ['book'] },
  });

/** The handler, run against a store, reporting whatever it refused. */
const refusing = async (
  param: Partial<ArvoEventHandlerExecuteParam<ScenarioDependencies, never>> & {
    event: ArvoEvent;
  },
  store = new ScenarioStore(),
  handler = declareHandler(),
): Promise<{ fault: ArvoHandlerFault; store: ScenarioStore }> => {
  const ran = await handler.tryExecute({
    state: store.resolver,
    attempt: 0,
    ...param,
  });
  if (ran.ok) throw new Error(`nothing was refused: ${ran.value.kind}`);
  return { fault: ran.error, store };
};

/** An execution opened and committed, so a followup has one to answer. */
const anOpenExecution = async (store = new ScenarioStore()) => {
  const handler = declareHandler();
  const order = anOrder();
  const opened = await handler.execute({
    event: order,
    state: store.resolver,
    attempt: 0,
  });
  if (opened.kind !== 'produced') throw new Error('nothing was opened');
  store.commit(opened.state);
  return { handler, order, opened, store };
};

/** What a service answers an execution with. */
const answering = (
  opened: Awaited<ReturnType<typeof anOpenExecution>>,
  overrides: Record<string, unknown> = {},
) =>
  createArvoEventFactory(inventoryV1).createOutput({
    type: 'evt_inventory_reserved',
    source: inventoryV1.type,
    subject: opened.order.subject,
    to: fulfilContract.type,
    executionid: String(opened.opened.state.executionId),
    initid: opened.opened.events[0]?.id,
    parentid: opened.opened.events[0]?.id,
    data: { held: 1 },
    ...overrides,
  });

describe('an event naming a contract nothing declared', () => {
  const stray = () =>
    createArvoEventFactory(strangerV1).createInput({
      source: 'com.web.checkout',
      subject: 'order-1',
      to: strangerV1.type,
      data: { whatever: 'this' },
    });

  it('is event_unclassifiable, and no further attempt changes that', async () => {
    const { fault } = await refusing({ event: stray() });
    expect(fault.faultKind).toBe('event_unclassifiable');
    expect(fault.retry).toBeNull();
  });

  it('names no execution, nothing having placed it', async () => {
    const { fault } = await refusing({ event: stray() });
    expect(fault.executionId).toBeNull();
  });

  it('carries nothing to give up with, there being nobody to tell', async () => {
    const { fault } = await refusing({ event: stray() });
    expect(fault.abandonmentEvent).toBeNull();
    expect(fault.abandonmentState).toBeNull();
  });

  it('says what it would have had to name', async () => {
    const { fault } = await refusing({ event: stray() });
    expect(fault.violations.join(' ')).toContain(fulfilContract.uri);
  });

  it('never reached the store', async () => {
    const { store } = await refusing({ event: stray() });
    expect(store.reads).toEqual([]);
  });
});

describe('an event naming a version nothing declares', () => {
  it('is event_unclassifiable rather than anything about its type', async () => {
    const { fault } = await refusing({
      event: cloneArvoEvent(anOrder(), {
        dataschema: `${fulfilContract.uri}/9.9.9`,
      }),
    });
    expect(fault.faultKind).toBe('event_unclassifiable');
    expect(fault.violations.join(' ')).toContain('1.0.0');
  });
});

describe('a service answering at a version this handler did not declare', () => {
  it('is where version skew surfaces, and says so', async () => {
    const opened = await anOpenExecution();
    const skewed = createArvoEventFactory(inventoryV11).createOutput({
      type: 'evt_inventory_reserved',
      source: inventoryV1.type,
      subject: opened.order.subject,
      to: fulfilContract.type,
      executionid: String(opened.opened.state.executionId),
      initid: opened.opened.events[0]?.id,
      parentid: opened.opened.events[0]?.id,
      data: { held: 1 },
    });

    const { fault } = await refusing(
      { event: skewed },
      opened.store,
      opened.handler,
    );
    expect(fault.faultKind).toBe('event_unclassifiable');
    expect(fault.message).toContain('1.0.0');
  });
});

describe('an event whose stated role contradicts what it was placed as', () => {
  const miscategorised = () =>
    cloneArvoEvent(anOrder(), {
      category: 'io.arvo.complete',
      initid: 'a-request-somewhere-else',
    });

  it('is category_mismatch, and no further attempt reconciles it', async () => {
    const { fault } = await refusing({ event: miscategorised() });
    expect(fault.faultKind).toBe('category_mismatch');
    expect(fault.retry).toBeNull();
  });

  it('can still tell the caller, the event naming where it came from', async () => {
    const { fault } = await refusing({ event: miscategorised() });
    expect(fault.abandonmentEvent).not.toBeNull();
  });

  it('writes no record, no execution having begun', async () => {
    const { fault } = await refusing({ event: miscategorised() });
    expect(fault.abandonmentState).toBeNull();
  });
});

describe('a store that cannot be read', () => {
  it('is state_resolution_failed, and is worth another attempt', async () => {
    const { fault } = await refusing(
      { event: anOrder() },
      new ScenarioStore().misbehave({ kind: 'unreachable' }),
    );
    expect(fault.faultKind).toBe('state_resolution_failed');
    expect(fault.retry).not.toBeNull();
  });

  it('keeps what the store said, however it said it', async () => {
    for (const as of ['error', 'rejection', 'string'] as const) {
      const { fault } = await refusing(
        { event: anOrder() },
        new ScenarioStore().misbehave({ kind: 'unreachable', as }),
      );
      expect(fault.faultKind).toBe('state_resolution_failed');
      expect(fault.cause).toContain('unreachable');
    }
  });

  it('stops being worth another attempt once they are spent', async () => {
    const { fault } = await refusing(
      { event: anOrder(), attempt: 3 },
      new ScenarioStore().misbehave({ kind: 'unreachable' }),
    );
    expect(fault.faultKind).toBe('state_resolution_failed');
    expect(fault.retry).toBeNull();
    expect(fault.abandonmentEvent).not.toBeNull();
  });
});

describe('an opening event for an execution that already exists', () => {
  it('is record_unexpected, so a second is never opened', async () => {
    const opened = await anOpenExecution();
    const { fault } = await refusing(
      { event: opened.order },
      opened.store,
      opened.handler,
    );
    expect(fault.faultKind).toBe('record_unexpected');
    expect(fault.retry).toBeNull();
  });

  it('names the execution it found', async () => {
    const opened = await anOpenExecution();
    const { fault } = await refusing(
      { event: opened.order },
      opened.store,
      opened.handler,
    );
    expect(fault.executionId).toBe(String(opened.opened.state.executionId));
  });
});

describe('an answering event for an execution nothing holds', () => {
  it('is record_expected, and no attempt produces one', async () => {
    const opened = await anOpenExecution();
    const { fault } = await refusing(
      { event: answering(opened) },
      new ScenarioStore(),
      opened.handler,
    );
    expect(fault.faultKind).toBe('record_expected');
    expect(fault.retry).toBeNull();
  });

  it('tells nobody, its source naming the service rather than the caller', async () => {
    const opened = await anOpenExecution();
    const { fault } = await refusing(
      { event: answering(opened) },
      new ScenarioStore(),
      opened.handler,
    );
    expect(fault.abandonmentEvent).toBeNull();
    expect(fault.abandonmentState).toBeNull();
  });
});

describe('a stored row that is not a record', () => {
  it('is record_invalid, reported as corruption', async () => {
    const opened = await anOpenExecution();
    const { fault } = await refusing(
      { event: answering(opened) },
      new ScenarioStore().misbehave({ kind: 'returns', row: NOT_A_RECORD }),
      opened.handler,
    );
    expect(fault.faultKind).toBe('record_invalid');
    expect(fault.retry).toBeNull();
  });

  it('carries nothing, nothing about it being trustworthy', async () => {
    const opened = await anOpenExecution();
    const { fault } = await refusing(
      { event: answering(opened) },
      new ScenarioStore().misbehave({ kind: 'returns', row: NOT_A_RECORD }),
      opened.handler,
    );
    expect(fault.abandonmentEvent).toBeNull();
    expect(fault.abandonmentState).toBeNull();
  });
});

describe('a record holding an event that will not restore', () => {
  it('is record_event_unrestorable, which is a different diagnosis', async () => {
    const opened = await anOpenExecution();
    const { fault } = await refusing(
      { event: answering(opened) },
      new ScenarioStore()
        .misbehave({
          kind: 'mutates',
          change: (row) => ({ ...row, initEvent: { not: 'an event' } }),
        })
        .commit(opened.opened.state),
      opened.handler,
    );
    expect(fault.faultKind).toBe('record_event_unrestorable');
  });
});

describe('an execution at a version the handler no longer runs', () => {
  it('is version_not_declared, and tells its caller', async () => {
    const opened = await anOpenExecution();
    const drained = declareHandlerAfterDrain();

    const { fault } = await refusing(
      { event: answering(opened) },
      opened.store,
      drained as never,
    );
    expect(fault.faultKind).toBe('version_not_declared');
    expect(fault.retry).toBeNull();
    expect(fault.abandonmentEvent).not.toBeNull();
  });

  it('leaves a record resting at failure for a mechanism that gives up', async () => {
    const opened = await anOpenExecution();
    const drained = declareHandlerAfterDrain();
    const { fault } = await refusing(
      { event: answering(opened) },
      opened.store,
      drained as never,
    );
    const resting = JSON.parse(String(fault.abandonmentState)) as JSONObject;
    expect(resting.lifecycle).toBe('failure');
    expect(resting.casVersion).toBe(Number(opened.opened.state.casVersion) + 1);
  });

  it('says which versions are left', async () => {
    const opened = await anOpenExecution();
    const drained = declareHandlerAfterDrain();
    const { fault } = await refusing(
      { event: answering(opened) },
      opened.store,
      drained as never,
    );
    expect(fault.violations.join(' ')).toContain('1.1.0');
  });
});

describe('an event the contract it named cannot send here', () => {
  it('is type_not_receivable for a type it never takes in', async () => {
    const { fault } = await refusing({
      event: cloneArvoEvent(anOrder(), { type: 'evt_order_fulfilled' }),
    });
    expect(fault.faultKind).toBe('type_not_receivable');
    expect(fault.retry).toBeNull();
  });

  it('is event_schema_rejected for a payload its schema refuses', async () => {
    const { fault } = await refusing({
      event: cloneArvoEvent(anOrder(), {
        data: { items: [7] as unknown as string[] },
      }),
    });
    expect(fault.faultKind).toBe('event_schema_rejected');
  });

  it('names every part of the payload that was wrong, not only the first', async () => {
    const { fault } = await refusing({
      event: cloneArvoEvent(anOrder(), {
        data: { items: [7, 8] as unknown as string[] },
      }),
    });
    expect(fault.violations.length).toBeGreaterThan(1);
  });

  it('can still tell the caller, an opening event naming where it came from', async () => {
    const { fault } = await refusing({
      event: cloneArvoEvent(anOrder(), {
        data: { items: [7] as unknown as string[] },
      }),
    });
    expect(fault.abandonmentEvent).not.toBeNull();
  });
});

describe('what every refusal has in common', () => {
  const everyWay = async () => {
    const opened = await anOpenExecution();
    return [
      await refusing(
        { event: anOrder() },
        new ScenarioStore().misbehave({ kind: 'unreachable' }),
      ),
      await refusing({
        event: cloneArvoEvent(anOrder(), { type: 'evt_order_fulfilled' }),
      }),
      await refusing({ event: opened.order }, opened.store, opened.handler),
      await refusing(
        { event: answering(opened) },
        new ScenarioStore().misbehave({ kind: 'returns', row: NOT_A_RECORD }),
        opened.handler,
      ),
    ];
  };

  it('names the event it was about', async () => {
    for (const { fault } of await everyWay()) {
      expect(fault.eventId).not.toBe('');
    }
  });

  it('names the workflow it was in', async () => {
    for (const { fault } of await everyWay()) {
      expect(fault.subject).toBe('order-1');
    }
  });

  it('says which attempt it was', async () => {
    for (const { fault } of await everyWay()) {
      expect(fault.attempt).toBe(0);
    }
  });

  it('says what it is in a message a reader can act on', async () => {
    for (const { fault } of await everyWay()) {
      expect(fault.message.length).toBeGreaterThan(40);
    }
  });

  it('is an ArvoHandlerFault by name, which is what crosses the wire', async () => {
    for (const { fault } of await everyWay()) {
      expect(fault.name).toBe('ArvoHandlerFault');
    }
  });

  it('survives being written out, since giving up means storing it', async () => {
    for (const { fault } of await everyWay()) {
      expect(() => JSON.stringify(fault.toJSON())).not.toThrow();
    }
  });
});

describe('what the handler passes through from the version unaltered', () => {
  it('a response nothing was awaiting', async () => {
    const opened = await anOpenExecution();
    const unasked = createArvoEventFactory(paymentV1).createOutput({
      type: 'evt_payment_charged',
      source: paymentV1.type,
      subject: opened.order.subject,
      to: fulfilContract.type,
      executionid: String(opened.opened.state.executionId),
      initid: 'a-request-never-sent',
      parentid: 'a-request-never-sent',
      data: { receipt: 'r-1' },
    });
    const { fault } = await refusing(
      { event: unasked },
      opened.store,
      opened.handler,
    );
    expect(fault.faultKind).toBe('response_unawaited');
  });

  it('an event addressed to somebody else', async () => {
    // `to` does not place an event — `dataschema` does — so one naming
    // this contract and addressed elsewhere is placed and then refused
    // for disagreeing about where it was going
    const { fault } = await refusing({
      event: cloneArvoEvent(anOrder(), { to: 'com_somebody_else' }),
    });
    expect(fault.faultKind).toBe('addressing_mismatch');
    expect(fault.violations.join(' ')).toContain('com_somebody_else');
  });

  it('a dependency factory that could not answer', async () => {
    const { fault } = await refusing({
      event: anOrder(),
      dependencies: () => {
        throw new Error('the pool is exhausted');
      },
    });
    expect(fault.faultKind).toBe('dependency_resolution_failed');
    expect(fault.retry).not.toBeNull();
  });

  it('an executor that raised one deliberately', async () => {
    const { fault } = await refusing({
      event: anOrder(),
      dependencies: {
        behave: async (ctx) => {
          throw await ctx.fault({
            faultKind: 'executor_raised',
            message: 'the executor said so',
          });
        },
      },
    });
    expect(fault.faultKind).toBe('executor_raised');
    expect(fault.message).toContain('the executor said so');
  });
});
