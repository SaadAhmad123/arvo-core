import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ArvoEvent } from '../../../src/ArvoEvent/index.js';
import type { ArvoHandlerFault } from '../../../src/ArvoEventHandler/fault/index.js';
import { ARVO_DEFAULT_HANDLER_OPTIONS } from '../../../src/ArvoEventHandler/helpers/defaults.js';
import { deriveArvoExecutionId } from '../../../src/ArvoEventHandler/helpers/execution-id.js';
import { ArvoExecutionStateSerializer } from '../../../src/ArvoEventHandler/state/serializer/index.js';
import type { ArvoEventHandlerExecuteResponse } from '../../../src/ArvoEventHandler/types/execute.js';
import type {
  ArvoDependencies,
  ArvoMechanismHooks,
} from '../../../src/ArvoEventHandler/types/supplied.js';
import { ArvoEventHandlerVersion } from '../../../src/ArvoEventHandler/version/index.js';
import type { ArvoEventHandlerVersionParam } from '../../../src/ArvoEventHandler/version/types.js';
import { mutateArvoEvent } from '../../../src/factories/mutateArvoEvent.js';
import type { JSONObject } from '../../../src/types.js';
import { heldDependencies, openedPerExecution } from '../dependency.js';
import {
  chargedEvent,
  initEvent,
  orderVersion,
  services,
  telemetry,
} from '../fixtures.js';
import { orderData } from '../state/fixtures.js';

/** What the event that opens this execution derives to, as the handler does. */
const EXECUTION_ID = await deriveArvoExecutionId(initEvent);

/** What a fixture may vary about how a version is declared. */
type VersionOverrides = Partial<
  ArvoEventHandlerVersionParam<
    typeof orderVersion,
    typeof services,
    typeof orderData,
    ArvoDependencies,
    ArvoMechanismHooks
  >
>;

/** A version that asks the payment service, then answers its caller. */
const declareVersion = (overrides: VersionOverrides = {}) =>
  new ArvoEventHandlerVersion({
    contracts: { self: orderVersion, services },
    options: ARVO_DEFAULT_HANDLER_OPTIONS,
    state: orderData,
    declaresState: true,
    middleware: null,
    execute: async (ctx) => {
      await ctx.setState({ data: { orderId: 'o-1', attempts: 1 } });
      return ctx.entry === 'init'
        ? await ctx.build({ type: 'com_payment_charge', data: { amount: 10 } })
        : await ctx.build({
            type: 'com_order_created',
            data: { order_id: 'o-1' },
          });
    },
    ...overrides,
  });

/** Opening an execution, as the version reports it. */
const open = (
  overrides: Record<string, unknown> = {},
  version = declareVersion(),
): Promise<ArvoEventHandlerExecuteResponse> =>
  version.execute({
    entry: 'init',
    event: initEvent,
    state: null,
    executionId: EXECUTION_ID,
    attempt: 0,
    dependencies: null,
    hooks: {},
    middleware: null,
    telemetry: telemetry().telemetry,
    ...overrides,
  });

/** The same, for a fixture that expects it to have produced something. */
const openProduced = async (
  overrides: Record<string, unknown> = {},
  version = declareVersion(),
) => {
  const response = await open(overrides, version);
  if (response.kind !== 'produced') {
    throw new Error(`expected it to produce, not to ${response.kind}`);
  }
  return response;
};

/** The service's answer to a request this execution made. */
const answerTo = (
  request: ArvoEvent,
  overrides: Record<string, unknown> = {},
) =>
  mutateArvoEvent(chargedEvent, {
    to: orderVersion.type,
    subject: initEvent.subject,
    executionid: EXECUTION_ID,
    parentid: request.id,
    initid: request.id,
    depth: request.depth,
    ...overrides,
  });

/** Answering what an opened execution asked for. */
const resume = async (
  overrides: Record<string, unknown> = {},
  version = declareVersion(),
) => {
  const openedResponse = await openProduced({}, version);
  return version.execute({
    entry: 'followup',
    event: answerTo(openedResponse.events[0] as ArvoEvent),
    state: openedResponse.state as JSONObject,
    executionId: EXECUTION_ID,
    attempt: 0,
    dependencies: null,
    hooks: {},
    middleware: null,
    telemetry: telemetry().telemetry,
    ...overrides,
  });
};

/** The same, for a fixture that expects it to have produced something. */
const resumeProduced = async (
  overrides: Record<string, unknown> = {},
  version = declareVersion(),
) => {
  const response = await resume(overrides, version);
  if (response.kind !== 'produced') {
    throw new Error(`expected it to produce, not to ${response.kind}`);
  }
  return response;
};

/** The fault an execution raised, for a fixture that expects one. */
const faultFrom = async (execution: Promise<unknown>) => {
  try {
    await execution;
  } catch (error_) {
    return error_ as ArvoHandlerFault;
  }
  throw new Error('expected the execution to fault');
};

/** The record a response committed, read back. */
const readBack = (state: JSONObject) =>
  new ArvoExecutionStateSerializer(orderData).deserialize(
    JSON.stringify(state),
  );

describe('what a version says about itself', () => {
  it('is the version of the contract it implements', () => {
    expect(declareVersion().version).toBe('1.0.0');
  });

  it('holds the contracts it was declared with', () => {
    expect(declareVersion().contracts.self).toBe(orderVersion);
    expect(declareVersion().contracts.services).toEqual(services);
  });
});

describe('opening an execution', () => {
  it('produces exactly what the executor returned', async () => {
    const response = await openProduced();
    expect(response.events).toHaveLength(1);
    expect(response.events[0]?.type).toBe('com_payment_charge');
  });

  it('commits a record that reads back as what the execution remembered', async () => {
    const record = await readBack((await openProduced()).state);
    expect(record.data).toEqual({ orderId: 'o-1', attempts: 1 });
    expect(record.executionId).toBe(EXECUTION_ID);
  });

  it('rests the execution where it waits for the answer', async () => {
    const record = await readBack((await openProduced()).state);
    expect(record.lifecycle).toBe('waiting');
  });

  it('says what it is waiting for', async () => {
    const response = await openProduced();
    const record = await readBack(response.state);
    expect([...record.inFlightEventMap.keys()]).toEqual([
      response.events[0]?.id,
    ]);
  });

  it('logs the event it took in and the one it sent', async () => {
    const response = await openProduced();
    const record = await readBack(response.state);
    expect(record.eventIds).toEqual([
      { id: initEvent.id, direction: 'received' },
      { id: response.events[0]?.id, direction: 'emitted' },
    ]);
  });

  it('writes the record at the revision a store takes only where none exists', async () => {
    expect((await readBack((await openProduced()).state)).casVersion).toBe(0);
  });

  it('refuses one whose execution could not be named', async () => {
    const fault = await faultFrom(open({ executionId: '' }));
    expect(fault.faultKind).toBe('record_invalid');
  });

  it('tells the caller but stores nothing, where it is refused on the way in', async () => {
    const misaddressedEvent = mutateArvoEvent(initEvent, {
      to: 'com.somewhere.else',
    });
    const fault = await faultFrom(open({ event: misaddressedEvent }));
    expect(typeof fault.abandonmentEvent).toBe('string');
    expect(fault.abandonmentState).toBeNull();
  });

  it('stores nothing where what the executor works with would not resolve, that being the last way in', async () => {
    const fault = await faultFrom(
      open({
        dependencies: openedPerExecution(() => {
          throw new Error('the pool is exhausted');
        }).dependency,
      }),
    );
    expect(fault.abandonmentState).toBeNull();
    expect(typeof fault.abandonmentEvent).toBe('string');
  });

  it('stores the record it would have written, where it is refused once past the way in', async () => {
    const version = declareVersion({
      execute: async (ctx) => {
        await ctx.setState({ data: { orderId: 'o-1', attempts: 1 } });
        return { type: 'com_order_created' } as never;
      },
    });
    const fault = await faultFrom(open({}, version));
    expect(fault.faultKind).toBe('emission_not_permitted');
    const record = JSON.parse(fault.abandonmentState as string);
    expect(record.lifecycle).toBe('failure');
    expect(record.casVersion).toBe(0);
  });
});

describe('answering something an execution awaited', () => {
  it('produces what the executor returned on being re-entered', async () => {
    const response = await resumeProduced();
    expect(response.events[0]?.type).toBe('com_order_created');
  });

  it('finishes the execution', async () => {
    expect((await readBack((await resumeProduced()).state)).lifecycle).toBe(
      'success',
    );
  });

  it('holds the answer against the request it answers', async () => {
    const openedResponse = await openProduced();
    const request = openedResponse.events[0] as ArvoEvent;
    const answer = answerTo(request);
    const version = declareVersion({
      execute: async (ctx) => {
        await ctx.setState({ data: { orderId: 'o-1', attempts: 2 } });
        expect(ctx.state.inFlightEventMap.get(request.id)?.id).toBe(answer.id);
      },
    });
    await version.execute({
      entry: 'followup',
      event: answer,
      state: openedResponse.state as JSONObject,
      executionId: EXECUTION_ID,
      attempt: 0,
      dependencies: null,
      hooks: {},
      middleware: null,
      telemetry: telemetry().telemetry,
    });
  });

  it('writes the record a revision past the one it read', async () => {
    expect((await readBack((await resumeProduced()).state)).casVersion).toBe(1);
  });

  it('discards one it has already processed, there being nothing to commit', async () => {
    const openedResponse = await openProduced();
    const answer = answerTo(openedResponse.events[0] as ArvoEvent);
    const version = declareVersion();
    const followupResponse = await version.execute({
      entry: 'followup',
      event: answer,
      state: openedResponse.state as JSONObject,
      executionId: EXECUTION_ID,
      attempt: 0,
      dependencies: null,
      hooks: {},
      middleware: null,
      telemetry: telemetry().telemetry,
    });
    if (followupResponse.kind !== 'produced')
      throw new Error('expected it to produce');

    const repeatResponse = await version.execute({
      entry: 'followup',
      event: answer,
      state: followupResponse.state,
      executionId: EXECUTION_ID,
      attempt: 0,
      dependencies: null,
      hooks: {},
      middleware: null,
      telemetry: telemetry().telemetry,
    });
    expect(repeatResponse.kind).toBe('discarded');
  });

  it('refuses one nothing was waiting for', async () => {
    const openedResponse = await openProduced();
    const strayAnswer = answerTo(openedResponse.events[0] as ArvoEvent, {
      initid: 'never-asked',
    });
    const fault = await faultFrom(resume({ event: strayAnswer }));
    expect(fault.faultKind).toBe('response_unawaited');
  });

  it('refuses one reaching an execution that has finished', async () => {
    const finishedResponse = await resumeProduced();
    const lateAnswer = answerTo(finishedResponse.events[0] as ArvoEvent, {
      id: 'an-answer-nobody-waited-for',
    });
    const fault = await faultFrom(
      resume({ state: finishedResponse.state, event: lateAnswer }),
    );
    expect(fault.faultKind).toBe('lifecycle_terminal');
  });

  it('refuses a row that is not a stored record at all', async () => {
    const fault = await faultFrom(resume({ state: 'not a row' }));
    expect(fault.faultKind).toBe('record_invalid');
  });

  it('refuses a row that reads but is wrong', async () => {
    const openedResponse = await openProduced();
    const invalidState = { ...openedResponse.state, depth: -1 };
    const fault = await faultFrom(resume({ state: invalidState }));
    expect(fault.faultKind).toBe('record_invalid');
  });

  it('refuses a row that contradicts the event that opened it', async () => {
    const openedResponse = await openProduced();
    const driftedState = { ...openedResponse.state, depth: 4 };
    const fault = await faultFrom(resume({ state: driftedState }));
    expect(fault.faultKind).toBe('record_invalid');
    expect(
      fault.violations.some((violation) => violation.includes('depth')),
    ).toBe(true);
  });

  it('still answers the caller where only what it remembered was refused', async () => {
    const openedResponse = await openProduced();
    const staleDataState = { ...openedResponse.state, data: { orderId: 42 } };
    const fault = await faultFrom(resume({ state: staleDataState }));
    expect(fault.faultKind).toBe('record_invalid');
    expect(typeof fault.abandonmentEvent).toBe('string');
    expect(typeof fault.abandonmentState).toBe('string');
  });

  it('answers nobody where the row itself could not be read', async () => {
    const fault = await faultFrom(resume({ state: 'not a row' }));
    expect(fault.abandonmentEvent).toBeNull();
    expect(fault.abandonmentState).toBeNull();
  });

  it('refuses a row whose events will not restore', async () => {
    const openedResponse = await openProduced();
    const unrestorableState = {
      ...openedResponse.state,
      initEvent: { not: 'an event' },
    };
    const fault = await faultFrom(resume({ state: unrestorableState }));
    expect(fault.faultKind).toBe('record_event_unrestorable');
  });

  it('refuses a row belonging to another execution', async () => {
    const fault = await faultFrom(resume({ executionId: 'b'.repeat(64) }));
    expect(fault.faultKind).toBe('record_invalid');
  });
});

describe('whether an answer re-enters the executor', () => {
  /** A version that asks two services at once. */
  const twoRequests = (overrides: VersionOverrides = {}) =>
    declareVersion({
      execute: async (ctx) => {
        await ctx.setState({ data: { orderId: 'o-1', attempts: 1 } });
        if (ctx.entry === 'followup') {
          return ctx.build({
            type: 'com_order_created',
            data: { order_id: 'o-1' },
          });
        }
        return [
          await ctx.build({ type: 'com_payment_charge', data: { amount: 1 } }),
          await ctx.build({ type: 'com_payment_charge', data: { amount: 2 } }),
        ];
      },
      ...overrides,
    });

  it('does not, where the version waits for all of them', async () => {
    const version = twoRequests();
    const openedResponse = await openProduced({}, version);
    const response = await version.execute({
      entry: 'followup',
      event: answerTo(openedResponse.events[0] as ArvoEvent),
      state: openedResponse.state as JSONObject,
      executionId: EXECUTION_ID,
      attempt: 0,
      dependencies: null,
      hooks: {},
      middleware: null,
      telemetry: telemetry().telemetry,
    });
    if (response.kind !== 'produced') throw new Error('expected it to produce');
    expect(response.events).toEqual([]);
    expect((await readBack(response.state)).lifecycle).toBe('waiting');
  });

  it('commits the answer it took in, so the next one completes the collection', async () => {
    const version = twoRequests();
    const openedResponse = await openProduced({}, version);
    const answer = answerTo(openedResponse.events[0] as ArvoEvent);
    const response = await version.execute({
      entry: 'followup',
      event: answer,
      state: openedResponse.state as JSONObject,
      executionId: EXECUTION_ID,
      attempt: 0,
      dependencies: null,
      hooks: {},
      middleware: null,
      telemetry: telemetry().telemetry,
    });
    if (response.kind !== 'produced') throw new Error('expected it to produce');
    const record = await readBack(response.state);
    expect(record.inFlightEventMap.get(answer.initid as string)?.id).toBe(
      answer.id,
    );
  });

  it('does, on every answer, where the version asked to be', async () => {
    const version = twoRequests({
      options: { ...ARVO_DEFAULT_HANDLER_OPTIONS, collect: 'each' },
    });
    const openedResponse = await openProduced({}, version);
    const response = await version.execute({
      entry: 'followup',
      event: answerTo(openedResponse.events[0] as ArvoEvent),
      state: openedResponse.state as JSONObject,
      executionId: EXECUTION_ID,
      attempt: 0,
      dependencies: null,
      hooks: {},
      middleware: null,
      telemetry: telemetry().telemetry,
    });
    if (response.kind !== 'produced') throw new Error('expected it to produce');
    expect(response.events[0]?.type).toBe('com_order_created');
  });
});

describe('what an executor is given to work with', () => {
  it('is what a dependency exposes, where one was handed over', async () => {
    const db = {};
    const exposedDbs: unknown[] = [];
    const version = declareVersion({
      execute: async (ctx) => {
        exposedDbs.push(ctx.dependencies?.db);
        await ctx.setState({ data: { orderId: 'o-1', attempts: 1 } });
      },
    });
    await open({ dependencies: heldDependencies({ db }).dependency }, version);
    expect(exposedDbs[0]).toBe(db);
  });

  it('is what one open yielded, called once with the execution so far', async () => {
    const calls: unknown[] = [];
    const version = declareVersion({
      execute: async (ctx) => {
        await ctx.setState({ data: { orderId: 'o-1', attempts: 1 } });
        expect(ctx.dependencies?.db).toBe('from the factory');
      },
    });
    await open(
      {
        dependencies: openedPerExecution(
          (executionSoFar: Record<string, unknown>) => {
            calls.push(executionSoFar);
            return { db: 'from the factory' };
          },
        ).dependency,
      },
      version,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ attempt: 0 });
  });

  it('is a fault where the factory could not answer', async () => {
    const fault = await faultFrom(
      open({
        dependencies: openedPerExecution(() => {
          throw new Error('the pool is exhausted');
        }).dependency,
      }),
    );
    expect(fault.faultKind).toBe('dependency_resolution_failed');
    expect(fault.cause).toContain('the pool is exhausted');
  });

  it('is worth another attempt, a pool recovering a moment later', async () => {
    const fault = await faultFrom(
      open({
        dependencies: openedPerExecution(() => {
          throw new Error('the pool is exhausted');
        }).dependency,
      }),
    );
    expect(fault.retry).not.toBeNull();
  });
});

describe('what an execution may not do on the way in', () => {
  it('may not arrive deeper than the version allows', async () => {
    const version = declareVersion({
      options: { ...ARVO_DEFAULT_HANDLER_OPTIONS, maxDepth: 1 },
    });
    const deepEvent = mutateArvoEvent(initEvent, {
      depth: 1,
      parentid: 'something-above',
    });
    const fault = await faultFrom(open({ event: deepEvent }, version));
    expect(fault.faultKind).toBe('max_depth_event_received');
  });

  it('may not arrive addressed somewhere else', async () => {
    const misaddressedEvent = mutateArvoEvent(initEvent, {
      to: 'com.somewhere.else',
    });
    const fault = await faultFrom(open({ event: misaddressedEvent }));
    expect(fault.faultKind).toBe('addressing_mismatch');
  });

  it('may not arrive at an execution that has outlived its time', async () => {
    const version = declareVersion({
      options: { ...ARVO_DEFAULT_HANDLER_OPTIONS, executionTimeout: 1 },
    });
    const staleEvent = mutateArvoEvent(initEvent, {
      time: new Date(Date.now() - 60_000).toISOString(),
    });
    const fault = await faultFrom(open({ event: staleEvent }, version));
    expect(fault.faultKind).toBe('execution_timeout');
  });
});

describe('what an executor may not return', () => {
  it('may not return something that is not an event', async () => {
    const version = declareVersion({
      execute: async (ctx) => {
        await ctx.setState({ data: { orderId: 'o-1', attempts: 1 } });
        return { type: 'com_order_created' } as never;
      },
    });
    const fault = await faultFrom(open({}, version));
    expect(fault.faultKind).toBe('emission_not_permitted');
  });

  it('may not answer its caller twice', async () => {
    const version = declareVersion({
      execute: async (ctx) => {
        await ctx.setState({ data: { orderId: 'o-1', attempts: 1 } });
        const answer = await ctx.build({
          type: 'com_order_created',
          data: { order_id: 'o-1' },
        });
        return [answer, mutateArvoEvent(answer, { id: 'a-second-answer' })];
      },
    });
    const fault = await faultFrom(open({}, version));
    expect(fault.faultKind).toBe('emission_not_permitted');
  });

  it('may not finish having remembered nothing', async () => {
    const version = declareVersion({
      execute: async (ctx) =>
        ctx.build({ type: 'com_order_created', data: { order_id: 'o-1' } }),
    });
    const fault = await faultFrom(open({}, version));
    expect(fault.faultKind).toBe('state_schema_rejected');
  });

  it('may return nothing at all, which leaves the execution idle', async () => {
    const version = declareVersion({
      execute: async (ctx) => {
        await ctx.setState({ data: { orderId: 'o-1', attempts: 1 } });
      },
    });
    const response = await openProduced({}, version);
    expect(response.events).toEqual([]);
    expect((await readBack(response.state)).lifecycle).toBe('idle');
  });

  it('may end the execution deliberately, where it still answers its caller', async () => {
    const version = declareVersion({
      execute: async (ctx) => {
        await ctx.setState({ data: { orderId: 'o-1', attempts: 1 } });
        ctx.cancel('the customer withdrew the order');
        return ctx.build({
          type: 'com_order_created',
          data: { order_id: 'o-1' },
        });
      },
    });
    const record = await readBack((await openProduced({}, version)).state);
    expect(record.lifecycle).toBe('cancelled');
    expect(record.lifecycleDescription).toBe('the customer withdrew the order');
  });

  it('may not end it deliberately and answer nobody', async () => {
    const version = declareVersion({
      execute: async (ctx) => {
        await ctx.setState({ data: { orderId: 'o-1', attempts: 1 } });
        ctx.cancel('the customer withdrew the order');
      },
    });
    const fault = await faultFrom(open({}, version));
    expect(fault.faultKind).toBe('execution_cancelled');
    expect(fault.message).toContain('the customer withdrew the order');
    expect(fault.retry).toBeNull();
  });

  it('may compensate as it ends, so long as it answers too', async () => {
    const version = declareVersion({
      execute: async (ctx) => {
        await ctx.setState({ data: { orderId: 'o-1', attempts: 1 } });
        ctx.cancel('the customer withdrew the order');
        return [
          await ctx.build({
            type: 'com_payment_charge',
            data: { amount: -10 },
          }),
          await ctx.build({
            type: 'com_order_created',
            data: { order_id: 'o-1' },
          }),
        ];
      },
    });
    const response = await openProduced({}, version);
    expect(response.events).toHaveLength(2);
    expect((await readBack(response.state)).lifecycle).toBe('cancelled');
  });
});

describe('when an executor cannot finish the work', () => {
  it('tells the caller, as this contract’s handler error event', async () => {
    const version = declareVersion({
      execute: async (ctx) => {
        await ctx.setState({ data: { orderId: 'o-1', attempts: 1 } });
        throw new Error('the warehouse is on fire');
      },
    });
    const response = await openProduced({}, version);
    expect(response.events[0]?.type).toBe(orderVersion.error.type);
    expect(response.events[0]?.to).toBe(initEvent.source);
  });

  it('ends the execution in error, saying what went wrong', async () => {
    const version = declareVersion({
      execute: async () => {
        throw new Error('the warehouse is on fire');
      },
    });
    const record = await readBack((await openProduced({}, version)).state);
    expect(record.lifecycle).toBe('error');
    expect(record.lifecycleDescription).toContain('the warehouse is on fire');
  });

  it('writes a record even where the executor remembered nothing', async () => {
    const version = declareVersion({
      execute: async () => {
        throw new Error('it failed before it could write anything');
      },
    });
    expect(
      (await readBack((await openProduced({}, version)).state)).data,
    ).toBeNull();
  });

  it('faults where the event that would tell the caller cannot be built', async () => {
    // A domain holding a control character: the option check accepts any
    // non-blank string, and no event may carry one
    // (`src/ArvoEvent/validator.ts`). So the handler error event cannot
    // be built for a reason that has nothing to do with the failure it
    // was going to report — and the failure must not be lost to it.
    const version = declareVersion({
      options: {
        ...ARVO_DEFAULT_HANDLER_OPTIONS,
        handlerErrorDomain: 'orders\u0000held',
      },
      execute: async () => {
        throw new Error('the warehouse is on fire');
      },
    });

    const fault = await faultFrom(open({}, version));
    expect(fault.faultKind).toBe('executor_raised');
    // both failures, the original one included
    expect(fault.message).toContain('the warehouse is on fire');
    expect(fault.message).toContain('could not be built');
    // and nothing was committed, there being nothing to answer with
    expect(fault.message).toContain('Nothing was emitted or stored');
  });

  it('faults where the record it would leave behind cannot be stored', async () => {
    // A failed execution still leaves a record, so a record that will
    // not serialize fails the reporting of the failure as well as the
    // work. The schema permits this value; JSON cannot carry it, which
    // a declared schema cannot prevent.
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const version = declareVersion({
      state: z.object({ anything: z.any() }) as unknown as typeof orderData,
      execute: async (ctx) => {
        await ctx.setState({
          data: { anything: circular } as unknown as never,
        });
        throw new Error('the warehouse is on fire');
      },
    });

    const fault = await faultFrom(open({}, version));
    expect(fault.faultKind).toBe('state_not_serializable');
    expect(fault.retry).toBeNull();
  });

  it('lets a fault it raised itself through, a fault being no answer', async () => {
    const version = declareVersion({
      execute: async (ctx) => {
        throw await ctx.fault({
          faultKind: 'executor_raised',
          message: 'the payment gateway refused the charge',
        });
      },
    });
    const fault = await faultFrom(open({}, version));
    expect(fault.faultKind).toBe('executor_raised');
    expect(fault.message).toBe('the payment gateway refused the charge');
  });
});

describe('an executor that does not come back', () => {
  it('is not waited for past the time one attempt allows', async () => {
    const version = declareVersion({
      options: { ...ARVO_DEFAULT_HANDLER_OPTIONS, runTimeout: 20 },
      execute: () => new Promise(() => undefined),
    });
    const fault = await faultFrom(open({}, version));
    expect(fault.faultKind).toBe('run_timeout');
    expect(fault.retry).not.toBeNull();
  });

  it('is reported for the whole execution where that bound passed too', async () => {
    const version = declareVersion({
      options: {
        ...ARVO_DEFAULT_HANDLER_OPTIONS,
        runTimeout: 20,
        executionTimeout: 60,
      },
      execute: () => new Promise(() => undefined),
    });
    const recentEvent = mutateArvoEvent(initEvent, {
      time: new Date(Date.now() - 50).toISOString(),
    });
    const fault = await faultFrom(open({ event: recentEvent }, version));
    expect(fault.faultKind).toBe('execution_timeout');
    expect(fault.retry).toBeNull();
  });

  it('is not listened to where it fails after the clock expired', async () => {
    const version = declareVersion({
      options: { ...ARVO_DEFAULT_HANDLER_OPTIONS, runTimeout: 20 },
      execute: () =>
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('far too late')), 60);
        }),
    });
    const fault = await faultFrom(open({}, version));
    expect(fault.faultKind).toBe('run_timeout');
    await new Promise((resolve) => setTimeout(resolve, 80));
  });

  it('is waited for as long as it takes where the version set no bound', async () => {
    const version = declareVersion({
      options: {
        ...ARVO_DEFAULT_HANDLER_OPTIONS,
        runTimeout: null,
        executionTimeout: null,
      },
      execute: async (ctx) => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        await ctx.setState({ data: { orderId: 'o-1', attempts: 1 } });
      },
    });
    expect((await openProduced({}, version)).events).toEqual([]);
  });
});

describe('what the clocks say when an executor returns', () => {
  it('is a fault where the execution passed its own bound while the attempt did not', async () => {
    const version = declareVersion({
      options: {
        ...ARVO_DEFAULT_HANDLER_OPTIONS,
        runTimeout: 60,
        executionTimeout: 60,
      },
      execute: async (ctx) => {
        await ctx.setState({ data: { orderId: 'o-1', attempts: 1 } });
        await new Promise((resolve) => setTimeout(resolve, 30));
      },
    });
    const partwayEvent = mutateArvoEvent(initEvent, {
      time: new Date(Date.now() - 40).toISOString(),
    });
    const fault = await faultFrom(open({ event: partwayEvent }, version));
    expect(fault.faultKind).toBe('execution_timeout');
    expect(fault.retry).toBeNull();
  });

  it('is a fault where a blocking attempt outran its run timeout', async () => {
    const version = declareVersion({
      options: { ...ARVO_DEFAULT_HANDLER_OPTIONS, runTimeout: 20 },
      execute: (ctx) => {
        // Blocking rather than awaiting, so the clock it would have fired
        // on never got the chance.
        const deadline = Date.now() + 40;
        while (Date.now() < deadline) {
          /* holding the thread */
        }
        return ctx.build({
          type: 'com_order_created',
          data: { order_id: 'x' },
        });
      },
    });
    const fault = await faultFrom(open({}, version));
    expect(fault.faultKind).toBe('run_timeout');
    expect(fault.retry).not.toBeNull();
  });

  it('is the execution clock where both expired, the broader verdict winning', async () => {
    const version = declareVersion({
      options: {
        ...ARVO_DEFAULT_HANDLER_OPTIONS,
        runTimeout: 20,
        executionTimeout: 60,
      },
      execute: async (ctx) => {
        await ctx.setState({ data: { orderId: 'o-1', attempts: 1 } });
        await new Promise((resolve) => setTimeout(resolve, 40));
      },
    });
    const recentEvent = mutateArvoEvent(initEvent, {
      time: new Date(Date.now() - 50).toISOString(),
    });
    const fault = await faultFrom(open({ event: recentEvent }, version));
    expect(fault.faultKind).toBe('execution_timeout');
  });
});

describe('what one execution records as it goes', () => {
  /** A telemetry object whose span keeps what it was told. */
  const watchingTelemetry = () => {
    const telemetryFixture = telemetry();
    return {
      ...telemetryFixture,
      events: vi.spyOn(telemetryFixture.span, 'addEvent'),
      attributes: vi.spyOn(telemetryFixture.span, 'setAttributes'),
    };
  };

  const stages = (telemetrySpy: ReturnType<typeof watchingTelemetry>) =>
    telemetrySpy.events.mock.calls.map((call: unknown[]) => call[0]);

  it('names the execution before anything can refuse it', async () => {
    const telemetrySpy = watchingTelemetry();
    await open({ telemetry: telemetrySpy.telemetry });
    expect(telemetrySpy.attributes).toHaveBeenCalledWith(
      expect.objectContaining({ 'arvo.execution.id': EXECUTION_ID }),
    );
  });

  it('marks every stage it passed through, in order', async () => {
    const telemetrySpy = watchingTelemetry();
    await open({ telemetry: telemetrySpy.telemetry });
    expect(stages(telemetrySpy)).toEqual([
      'arvo.stage.record_resolved',
      'arvo.stage.entry_judged',
      'arvo.stage.dependencies_resolved',
      'arvo.stage.executor_entered',
      'arvo.stage.executor_returned',
      'arvo.stage.returns_judged',
      'arvo.stage.record_written',
    ]);
  });

  it('stops at the stage that refused it, so a reader sees how far it got', async () => {
    const telemetrySpy = watchingTelemetry();
    const misaddressedEvent = mutateArvoEvent(initEvent, {
      to: 'com.somewhere.else',
    });
    await faultFrom(
      open({ event: misaddressedEvent, telemetry: telemetrySpy.telemetry }),
    );
    expect(stages(telemetrySpy)).toEqual([
      'arvo.stage.record_resolved',
      'arvo.stage.entry_judged',
    ]);
  });

  it('says it was discarded rather than leaving the span unjudged', async () => {
    const telemetrySpy = watchingTelemetry();
    const openedResponse = await openProduced();
    const answer = answerTo(openedResponse.events[0] as ArvoEvent);
    const version = declareVersion();
    const followupResponse = await version.execute({
      entry: 'followup',
      event: answer,
      state: openedResponse.state as JSONObject,
      executionId: EXECUTION_ID,
      attempt: 0,
      dependencies: null,
      hooks: {},
      middleware: null,
      telemetry: telemetry().telemetry,
    });
    if (followupResponse.kind !== 'produced')
      throw new Error('expected it to produce');

    await version.execute({
      entry: 'followup',
      event: answer,
      state: followupResponse.state,
      executionId: EXECUTION_ID,
      attempt: 0,
      dependencies: null,
      hooks: {},
      middleware: null,
      telemetry: telemetrySpy.telemetry,
    });
    expect(telemetrySpy.attributes).toHaveBeenCalledWith(
      expect.objectContaining({ 'arvo.outcome': 'discarded' }),
    );
  });

  it('says what it produced and where the execution came to rest', async () => {
    const telemetrySpy = watchingTelemetry();
    await open({ telemetry: telemetrySpy.telemetry });
    expect(telemetrySpy.attributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'arvo.outcome': 'produced',
        'arvo.lifecycle': 'waiting',
        'arvo.emitted': 1,
      }),
    );
  });

  it('marks an executor that did not come back as having outrun its time', async () => {
    const telemetrySpy = watchingTelemetry();
    const version = declareVersion({
      options: { ...ARVO_DEFAULT_HANDLER_OPTIONS, runTimeout: 20 },
      execute: () => new Promise(() => undefined),
    });
    await faultFrom(open({ telemetry: telemetrySpy.telemetry }, version));
    expect(stages(telemetrySpy)).toContain('arvo.stage.executor_outran');
  });
});

describe('what a fault tells whoever has to fix it', () => {
  const VERSION = 'com_order_create@1.0.0';

  it('names the version whose executor returned something that is not an event', async () => {
    const version = declareVersion({
      execute: async (ctx) => {
        await ctx.setState({ data: { orderId: 'o-1', attempts: 1 } });
        return { type: 'com_order_created' } as never;
      },
    });
    const fault = await faultFrom(open({}, version));
    expect(fault.message).toContain(VERSION);
    expect(fault.message).toContain('ctx.build()');
  });

  it('says what stopped an execution from opening at all', async () => {
    const fault = await faultFrom(open({ executionId: '' }));
    expect(fault.message).toContain(VERSION);
    expect(fault.message).toContain('executionId');
  });

  it('says a stored state disagrees with the event that opened it, and lists the fields', async () => {
    const openedResponse = await openProduced();
    const fault = await faultFrom(
      resume({ state: { ...openedResponse.state, depth: 4 } }),
    );
    expect(fault.message).toContain('disagrees with the event that opened it');
    expect(fault.violations[0]).toContain('depth');
  });

  it('blames a state schema that no longer fits what is stored', async () => {
    const openedResponse = await openProduced();
    const fault = await faultFrom(
      resume({ state: { ...openedResponse.state, data: { orderId: 42 } } }),
    );
    expect(fault.message).toContain(VERSION);
    expect(fault.message).toContain('state schema');
  });

  it('says the dependencies would not resolve, and why, and that it may pass', async () => {
    const fault = await faultFrom(
      open({
        dependencies: openedPerExecution(() => {
          throw new Error('the pool is exhausted');
        }).dependency,
      }),
    );
    expect(fault.message).toContain('the pool is exhausted');
    expect(fault.message).toContain('never entered');
    expect(fault.message).toContain('Another attempt may succeed');
  });

  it('quotes the reason a cancelled execution gave, and says what was missing', async () => {
    const version = declareVersion({
      execute: async (ctx) => {
        await ctx.setState({ data: { orderId: 'o-1', attempts: 1 } });
        ctx.cancel('the customer withdrew the order');
      },
    });
    const fault = await faultFrom(open({}, version));
    expect(fault.message).toContain(
      'ctx.cancel("the customer withdrew the order")',
    );
    expect(fault.message).toContain('answers the caller');
  });

  it('names the option that bounded an executor that never came back', async () => {
    const version = declareVersion({
      options: { ...ARVO_DEFAULT_HANDLER_OPTIONS, runTimeout: 20 },
      execute: () => new Promise(() => undefined),
    });
    const fault = await faultFrom(open({}, version));
    expect(fault.message).toContain('runTimeout');
    expect(fault.message).toContain('may still be running');
  });

  it('says how long a blocking executor took, and that blocking cannot be stopped', async () => {
    const version = declareVersion({
      options: { ...ARVO_DEFAULT_HANDLER_OPTIONS, runTimeout: 20 },
      execute: (ctx) => {
        const deadline = Date.now() + 40;
        while (Date.now() < deadline) {
          /* holding the thread */
        }
        return ctx.build({
          type: 'com_order_created',
          data: { order_id: 'x' },
        });
      },
    });
    const fault = await faultFrom(open({}, version));
    expect(fault.message).toContain('runTimeout');
    expect(fault.message).toContain('blocks rather than awaits');
  });

  it('says how long an execution has lived against the bound it passed', async () => {
    const version = declareVersion({
      options: { ...ARVO_DEFAULT_HANDLER_OPTIONS, executionTimeout: 1 },
    });
    const staleEvent = mutateArvoEvent(initEvent, {
      time: new Date(Date.now() - 60_000).toISOString(),
    });
    const fault = await faultFrom(open({ event: staleEvent }, version));
    expect(fault.message).toContain('executionTimeout');
    expect(fault.message).toContain(VERSION);
  });

  it('repeats nothing the fault already carries as a field', async () => {
    const version = declareVersion({
      execute: async (ctx) => {
        await ctx.setState({ data: { orderId: 'o-1', attempts: 1 } });
        return { type: 'com_order_created' } as never;
      },
    });
    const fault = await faultFrom(open({}, version));
    expect(fault.subject).toBe(initEvent.subject);
    expect(fault.executionId).toBe(EXECUTION_ID);
    expect(fault.message).not.toContain(fault.subject);
    expect(fault.message).not.toContain(EXECUTION_ID);
    expect(fault.message).not.toContain(initEvent.id);
  });
});
