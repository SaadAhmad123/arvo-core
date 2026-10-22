import { describe, expect, it } from 'vitest';
import type { ArvoEvent } from '../../../src/ArvoEvent/index.js';
import type { ArvoHandlerFault } from '../../../src/ArvoEventHandler/fault/index.js';
import type { ArvoEventHandlerExecuteParam } from '../../../src/ArvoEventHandler/types/execute.js';
import { createArvoEventFactory } from '../../../src/factories/ArvoEventFactory/index.js';
import { mutateArvoEvent } from '../../../src/factories/mutateArvoEvent.js';
import type { JSONObject } from '../../../src/types.js';
import { heldDependencies, openedPerExecution } from '../dependency.js';
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
const runToFault = async (
  param: Partial<ArvoEventHandlerExecuteParam<ScenarioDependencies, never>> & {
    event: ArvoEvent;
  },
  store = new ScenarioStore(),
  handler = declareHandler(),
): Promise<{ fault: ArvoHandlerFault; store: ScenarioStore }> => {
  const outcome = await handler.tryExecute({
    state: store.resolver,
    attempt: 0,
    ...param,
  });
  if (outcome.ok) throw new Error(`nothing was refused: ${outcome.value.kind}`);
  return { fault: outcome.error, store };
};

/** An execution opened and committed, so a followup has one to answer. */
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

/** What a service answers an execution with. */
const inventoryAnswer = (
  execution: Awaited<ReturnType<typeof anOpenExecution>>,
  overrides: Record<string, unknown> = {},
) =>
  createArvoEventFactory(inventoryV1).createOutput({
    type: 'evt_inventory_reserved',
    source: inventoryV1.type,
    subject: execution.order.subject,
    to: fulfilContract.type,
    executionid: String(execution.openingOutcome.state.executionId),
    initid: execution.openingOutcome.events[0]?.id,
    parentid: execution.openingOutcome.events[0]?.id,
    data: { held: 1 },
    ...overrides,
  });

describe('an event naming a contract nothing declared', () => {
  const strayEvent = () =>
    createArvoEventFactory(strangerV1).createInput({
      source: 'com.web.checkout',
      subject: 'order-1',
      to: strangerV1.type,
      data: { whatever: 'this' },
    });

  it('is event_unclassifiable, and no further attempt changes that', async () => {
    const { fault } = await runToFault({ event: strayEvent() });
    expect(fault.faultKind).toBe('event_unclassifiable');
    expect(fault.retry).toBeNull();
  });

  it('names no execution, nothing having placed it', async () => {
    const { fault } = await runToFault({ event: strayEvent() });
    expect(fault.executionId).toBeNull();
  });

  it('carries nothing to give up with, there being nobody to tell', async () => {
    const { fault } = await runToFault({ event: strayEvent() });
    expect(fault.abandonmentEvent).toBeNull();
    expect(fault.abandonmentState).toBeNull();
  });

  it('says what it would have had to name', async () => {
    const { fault } = await runToFault({ event: strayEvent() });
    expect(fault.violations.join(' ')).toContain(fulfilContract.uri);
  });

  it('never reached the store', async () => {
    const { store } = await runToFault({ event: strayEvent() });
    expect(store.reads).toEqual([]);
  });
});

describe('an event naming a version nothing declares', () => {
  it('is event_unclassifiable rather than anything about its type', async () => {
    const { fault } = await runToFault({
      event: mutateArvoEvent(anOrder(), {
        dataschema: `${fulfilContract.uri}/9.9.9`,
      }),
    });
    expect(fault.faultKind).toBe('event_unclassifiable');
    expect(fault.violations.join(' ')).toContain('1.0.0');
  });
});

describe('a service answering at a version this handler did not declare', () => {
  it('is where version skew surfaces, and says so', async () => {
    const execution = await anOpenExecution();
    const skewedAnswer = createArvoEventFactory(inventoryV11).createOutput({
      type: 'evt_inventory_reserved',
      source: inventoryV1.type,
      subject: execution.order.subject,
      to: fulfilContract.type,
      executionid: String(execution.openingOutcome.state.executionId),
      initid: execution.openingOutcome.events[0]?.id,
      parentid: execution.openingOutcome.events[0]?.id,
      data: { held: 1 },
    });

    const { fault } = await runToFault(
      { event: skewedAnswer },
      execution.store,
      execution.handler,
    );
    expect(fault.faultKind).toBe('event_unclassifiable');
    expect(fault.message).toContain('1.0.0');
  });
});

describe('an event whose stated role contradicts what it was placed as', () => {
  const miscategorisedEvent = () =>
    mutateArvoEvent(anOrder(), {
      category: 'io.arvo.complete',
      initid: 'a-request-somewhere-else',
    });

  it('is category_mismatch, and no further attempt reconciles it', async () => {
    const { fault } = await runToFault({ event: miscategorisedEvent() });
    expect(fault.faultKind).toBe('category_mismatch');
    expect(fault.retry).toBeNull();
  });

  it('can still tell the caller, the event naming where it came from', async () => {
    const { fault } = await runToFault({ event: miscategorisedEvent() });
    expect(fault.abandonmentEvent).not.toBeNull();
  });

  it('writes no record, no execution having begun', async () => {
    const { fault } = await runToFault({ event: miscategorisedEvent() });
    expect(fault.abandonmentState).toBeNull();
  });
});

describe('a store that cannot be read', () => {
  it('is state_resolution_failed, and is worth another attempt', async () => {
    const { fault } = await runToFault(
      { event: anOrder() },
      new ScenarioStore().misbehave({ kind: 'unreachable' }),
    );
    expect(fault.faultKind).toBe('state_resolution_failed');
    expect(fault.retry).not.toBeNull();
  });

  it('keeps what the store said, however it said it', async () => {
    for (const failureForm of ['error', 'rejection', 'string'] as const) {
      const { fault } = await runToFault(
        { event: anOrder() },
        new ScenarioStore().misbehave({ kind: 'unreachable', as: failureForm }),
      );
      expect(fault.faultKind).toBe('state_resolution_failed');
      expect(fault.cause).toContain('unreachable');
    }
  });

  it('stops being worth another attempt once they are spent', async () => {
    const { fault } = await runToFault(
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
    const execution = await anOpenExecution();
    const { fault } = await runToFault(
      { event: execution.order },
      execution.store,
      execution.handler,
    );
    expect(fault.faultKind).toBe('record_unexpected');
    expect(fault.retry).toBeNull();
  });

  it('names the execution it found', async () => {
    const execution = await anOpenExecution();
    const { fault } = await runToFault(
      { event: execution.order },
      execution.store,
      execution.handler,
    );
    expect(fault.executionId).toBe(
      String(execution.openingOutcome.state.executionId),
    );
  });
});

describe('an answering event for an execution nothing holds', () => {
  it('is record_expected, and no attempt produces one', async () => {
    const execution = await anOpenExecution();
    const { fault } = await runToFault(
      { event: inventoryAnswer(execution) },
      new ScenarioStore(),
      execution.handler,
    );
    expect(fault.faultKind).toBe('record_expected');
    expect(fault.retry).toBeNull();
  });

  it('tells nobody, its source naming the service rather than the caller', async () => {
    const execution = await anOpenExecution();
    const { fault } = await runToFault(
      { event: inventoryAnswer(execution) },
      new ScenarioStore(),
      execution.handler,
    );
    expect(fault.abandonmentEvent).toBeNull();
    expect(fault.abandonmentState).toBeNull();
  });
});

describe('a stored row that is not a record', () => {
  it('is record_invalid, reported as corruption', async () => {
    const execution = await anOpenExecution();
    const { fault } = await runToFault(
      { event: inventoryAnswer(execution) },
      new ScenarioStore().misbehave({ kind: 'returns', row: NOT_A_RECORD }),
      execution.handler,
    );
    expect(fault.faultKind).toBe('record_invalid');
    expect(fault.retry).toBeNull();
  });

  it('carries nothing, nothing about it being trustworthy', async () => {
    const execution = await anOpenExecution();
    const { fault } = await runToFault(
      { event: inventoryAnswer(execution) },
      new ScenarioStore().misbehave({ kind: 'returns', row: NOT_A_RECORD }),
      execution.handler,
    );
    expect(fault.abandonmentEvent).toBeNull();
    expect(fault.abandonmentState).toBeNull();
  });
});

describe('a record holding an event that will not restore', () => {
  it('is record_event_unrestorable, which is a different diagnosis', async () => {
    const execution = await anOpenExecution();
    const { fault } = await runToFault(
      { event: inventoryAnswer(execution) },
      new ScenarioStore()
        .misbehave({
          kind: 'mutates',
          change: (row) => ({ ...row, initEvent: { not: 'an event' } }),
        })
        .commit(execution.openingOutcome.state),
      execution.handler,
    );
    expect(fault.faultKind).toBe('record_event_unrestorable');
  });
});

describe('an execution at a version the handler no longer runs', () => {
  it('is version_not_declared, and tells its caller', async () => {
    const execution = await anOpenExecution();
    const drainedHandler = declareHandlerAfterDrain();

    const { fault } = await runToFault(
      { event: inventoryAnswer(execution) },
      execution.store,
      drainedHandler as never,
    );
    expect(fault.faultKind).toBe('version_not_declared');
    expect(fault.retry).toBeNull();
    expect(fault.abandonmentEvent).not.toBeNull();
  });

  it('leaves a record resting at failure for a mechanism that gives up', async () => {
    const execution = await anOpenExecution();
    const drainedHandler = declareHandlerAfterDrain();
    const { fault } = await runToFault(
      { event: inventoryAnswer(execution) },
      execution.store,
      drainedHandler as never,
    );
    const restingRecord = JSON.parse(
      String(fault.abandonmentState),
    ) as JSONObject;
    expect(restingRecord.lifecycle).toBe('failure');
    expect(restingRecord.casVersion).toBe(
      Number(execution.openingOutcome.state.casVersion) + 1,
    );
  });

  it('says which versions are left', async () => {
    const execution = await anOpenExecution();
    const drainedHandler = declareHandlerAfterDrain();
    const { fault } = await runToFault(
      { event: inventoryAnswer(execution) },
      execution.store,
      drainedHandler as never,
    );
    expect(fault.violations.join(' ')).toContain('1.1.0');
  });
});

describe('an event the contract it named cannot send here', () => {
  it('is type_not_receivable for a type it never takes in', async () => {
    const { fault } = await runToFault({
      event: mutateArvoEvent(anOrder(), { type: 'evt_order_fulfilled' }),
    });
    expect(fault.faultKind).toBe('type_not_receivable');
    expect(fault.retry).toBeNull();
  });

  it('is event_schema_rejected for a payload its schema refuses', async () => {
    const { fault } = await runToFault({
      event: mutateArvoEvent(anOrder(), {
        data: { items: [7] as unknown as string[] },
      }),
    });
    expect(fault.faultKind).toBe('event_schema_rejected');
  });

  it('names every part of the payload that was wrong, not only the first', async () => {
    const { fault } = await runToFault({
      event: mutateArvoEvent(anOrder(), {
        data: { items: [7, 8] as unknown as string[] },
      }),
    });
    expect(fault.violations.length).toBeGreaterThan(1);
  });

  it('can still tell the caller, an opening event naming where it came from', async () => {
    const { fault } = await runToFault({
      event: mutateArvoEvent(anOrder(), {
        data: { items: [7] as unknown as string[] },
      }),
    });
    expect(fault.abandonmentEvent).not.toBeNull();
  });
});

describe('what every refusal has in common', () => {
  const everyRefusal = async () => {
    const execution = await anOpenExecution();
    return [
      await runToFault(
        { event: anOrder() },
        new ScenarioStore().misbehave({ kind: 'unreachable' }),
      ),
      await runToFault({
        event: mutateArvoEvent(anOrder(), { type: 'evt_order_fulfilled' }),
      }),
      await runToFault(
        { event: execution.order },
        execution.store,
        execution.handler,
      ),
      await runToFault(
        { event: inventoryAnswer(execution) },
        new ScenarioStore().misbehave({ kind: 'returns', row: NOT_A_RECORD }),
        execution.handler,
      ),
    ];
  };

  it('names the event it was about', async () => {
    for (const { fault } of await everyRefusal()) {
      expect(fault.eventId).not.toBe('');
    }
  });

  it('names the workflow it was in', async () => {
    for (const { fault } of await everyRefusal()) {
      expect(fault.subject).toBe('order-1');
    }
  });

  it('says which attempt it was', async () => {
    for (const { fault } of await everyRefusal()) {
      expect(fault.attempt).toBe(0);
    }
  });

  it('says what it is in a message a reader can act on', async () => {
    for (const { fault } of await everyRefusal()) {
      expect(fault.message.length).toBeGreaterThan(40);
    }
  });

  it('is an ArvoHandlerFault by name, which is what crosses the wire', async () => {
    for (const { fault } of await everyRefusal()) {
      expect(fault.name).toBe('ArvoHandlerFault');
    }
  });

  it('survives being written out, since giving up means storing it', async () => {
    for (const { fault } of await everyRefusal()) {
      expect(() => JSON.stringify(fault.toJSON())).not.toThrow();
    }
  });
});

describe('what the handler passes through from the version unaltered', () => {
  it('a response nothing was awaiting', async () => {
    const execution = await anOpenExecution();
    const unaskedResponse = createArvoEventFactory(paymentV1).createOutput({
      type: 'evt_payment_charged',
      source: paymentV1.type,
      subject: execution.order.subject,
      to: fulfilContract.type,
      executionid: String(execution.openingOutcome.state.executionId),
      initid: 'a-request-never-sent',
      parentid: 'a-request-never-sent',
      data: { receipt: 'r-1' },
    });
    const { fault } = await runToFault(
      { event: unaskedResponse },
      execution.store,
      execution.handler,
    );
    expect(fault.faultKind).toBe('response_unawaited');
  });

  it('an event addressed to somebody else', async () => {
    // `to` does not place an event — `dataschema` does — so one naming
    // this contract and addressed elsewhere is placed and then refused
    // for disagreeing about where it was going
    const { fault } = await runToFault({
      event: mutateArvoEvent(anOrder(), { to: 'com_somebody_else' }),
    });
    expect(fault.faultKind).toBe('addressing_mismatch');
    expect(fault.violations.join(' ')).toContain('com_somebody_else');
  });

  it('a dependency that could not be opened', async () => {
    const { fault } = await runToFault({
      event: anOrder(),
      dependencies: openedPerExecution(() => {
        throw new Error('the pool is exhausted');
      }).dependency,
    });
    expect(fault.faultKind).toBe('dependency_resolution_failed');
    expect(fault.retry).not.toBeNull();
  });

  it('a dependency that failed to open with something that is not an error', async () => {
    const { fault } = await runToFault({
      event: anOrder(),
      dependencies: openedPerExecution(() => {
        throw 'the pool said only this';
      }).dependency,
    });
    expect(fault.faultKind).toBe('dependency_resolution_failed');
    expect(fault.cause).toBe('the pool said only this');
  });

  it('an executor that raised one deliberately', async () => {
    const { fault } = await runToFault({
      event: anOrder(),
      dependencies: heldDependencies<ScenarioDependencies>({
        behave: async (ctx) => {
          throw await ctx.fault({
            faultKind: 'executor_raised',
            message: 'the executor said so',
          });
        },
      }).dependency,
    });
    expect(fault.faultKind).toBe('executor_raised');
    expect(fault.message).toContain('the executor said so');
  });
});
