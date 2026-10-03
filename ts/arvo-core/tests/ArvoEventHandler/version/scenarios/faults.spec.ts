import { trace } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import type { ArvoEvent } from '../../../../src/ArvoEvent/index.js';
import { ArvoExecutionContextTelemetry } from '../../../../src/ArvoEventHandler/context/telemetry/index.js';
import type { ArvoHandlerFault } from '../../../../src/ArvoEventHandler/fault/index.js';
import type { ArvoFaultKind } from '../../../../src/ArvoEventHandler/fault/types.js';
import { deriveArvoExecutionId } from '../../../../src/ArvoEventHandler/helpers/execution-id.js';
import { createArvoEventFactory } from '../../../../src/factories/ArvoEventFactory/index.js';
import { cloneArvoEvent } from '../../../../src/factories/cloneArvoEvent.js';
import { createArvoEvent } from '../../../../src/factories/createArvoEvent.js';
import type { JSONObject } from '../../../../src/types.js';
import {
  type AuditContext,
  auditV1,
  declareVersions,
  inventoryV1,
  type OrderContext,
  orderV1,
} from './fixture.js';

/**
 * Every way an execution of a version can fail, and what each one must
 * carry.
 *
 * One row per kind in the version's scope: the kind itself, whether
 * another attempt is in prospect, which halves of the abandonment pair it
 * carries, and that nothing was emitted and nothing committed. A kind
 * that becomes unreachable through a refactor fails the last test in this
 * file rather than quietly ceasing to exist.
 */

/** The nine a handler raises before a version is reached. */
const BEFORE_A_VERSION_IS_KNOWN: ArvoFaultKind[] = [
  'event_unclassifiable',
  'category_mismatch',
  'state_resolution_failed',
  'record_unexpected',
  'record_expected',
  'version_not_declared',
  'type_not_receivable',
  'event_schema_rejected',
  'service_version_conflict',
];

const telemetry = () =>
  new ArvoExecutionContextTelemetry({
    span: trace.getTracer('faults').startSpan('execution'),
    meter: null,
    logger: null,
  });

const anOrder = (overrides: Record<string, unknown> = {}) =>
  createArvoEventFactory(orderV1).createInput({
    source: 'com.web.checkout',
    subject: 'order-1',
    to: orderV1.type,
    data: { items: ['book'] },
    ...overrides,
  });

/** Every kind this file reached, so the set can be judged at the end. */
const reached = new Set<ArvoFaultKind>();

/** One execution, run to its fault. */
const faulted = async (
  param: Record<string, unknown>,
  which: keyof ReturnType<typeof declareVersions>[string] = '1.0.0',
  versions = declareVersions(),
): Promise<ArvoHandlerFault> => {
  const version = versions[orderV1.type]?.[which];
  const event = (param.event as ArvoEvent) ?? anOrder();
  try {
    await version?.execute({
      entry: 'init',
      event,
      state: null,
      executionId: await deriveArvoExecutionId(event),
      attempt: 0,
      dependencies: {},
      hooks: {},
      telemetry: telemetry(),
      ...param,
    } as never);
  } catch (raised) {
    const fault = raised as ArvoHandlerFault;
    reached.add(fault.faultKind);
    return fault;
  }
  throw new Error('expected this execution to fault');
};

/** An order that has asked its two services and is waiting on them. */
const waiting = async () => {
  const versions = declareVersions();
  const opening = anOrder();
  const executionId = await deriveArvoExecutionId(opening);
  const response = await versions[orderV1.type]?.['1.0.0']?.execute({
    entry: 'init',
    event: opening,
    state: null,
    executionId,
    attempt: 0,
    dependencies: {},
    hooks: {},
    telemetry: telemetry(),
  } as never);

  if (response?.kind !== 'produced') throw new Error('expected it to produce');
  return {
    versions,
    opening,
    executionId,
    row: response.state as JSONObject,
    asked: response.events as ArvoEvent[],
  };
};

/** An answer to one of the requests that execution made. */
const answerTo = (
  asked: ArvoEvent,
  executionId: string,
  overrides: Record<string, unknown> = {},
) =>
  cloneArvoEvent(
    createArvoEventFactory(inventoryV1).createOutput({
      type: 'evt_inventory_reserved',
      source: inventoryV1.type,
      subject: asked.subject,
      to: orderV1.type,
      data: { held: 1 },
    }),
    {
      parentid: asked.id,
      initid: asked.id,
      executionid: executionId,
      depth: asked.depth,
      ...overrides,
    },
  );

/** Answering that execution, with whatever this row is made to be. */
const followup = async (
  built: Awaited<ReturnType<typeof waiting>>,
  param: Record<string, unknown> = {},
) =>
  faulted(
    {
      entry: 'followup',
      event: answerTo(built.asked[0] as ArvoEvent, built.executionId),
      state: built.row,
      executionId: built.executionId,
      ...param,
    },
    '1.0.0',
    built.versions,
  );

describe('what refuses an execution on the way in', () => {
  it('a stored record that will not read back', async () => {
    const built = await waiting();
    const fault = await followup(built, { state: { nothing: 'much' } });
    expect(fault.faultKind).toBe('record_event_unrestorable');
    expect(fault.retry).toBeNull();
    expect(fault.abandonmentEvent).toBeNull();
    expect(fault.abandonmentState).toBeNull();
  });

  it('a stored record whose own fields contradict it', async () => {
    const built = await waiting();
    const fault = await followup(built, {
      state: { ...built.row, depth: 9 },
    });
    expect(fault.faultKind).toBe('record_invalid');
    expect(fault.retry).toBeNull();
    expect(fault.violations.some((broken) => broken.includes('depth'))).toBe(
      true,
    );
    expect(typeof fault.abandonmentEvent).toBe('string');
    expect(typeof fault.abandonmentState).toBe('string');
  });

  it('an event arriving deeper than the version allows', async () => {
    const deep = cloneArvoEvent(anOrder(), {
      depth: 3,
      parentid: 'something-above',
    });
    const fault = await faulted(
      { event: deep },
      '1.0.0',
      declareVersions({ [orderV1.type]: { maxDepth: 3 } }),
    );
    expect(fault.faultKind).toBe('max_depth_event_received');
    expect(fault.retry).toBeNull();
    expect(typeof fault.abandonmentEvent).toBe('string');
    expect(fault.abandonmentState).toBeNull();
  });

  it('an event reaching an execution that has already ended', async () => {
    const built = await waiting();
    const fault = await followup(built, {
      state: { ...built.row, lifecycle: 'success' },
    });
    expect(fault.faultKind).toBe('lifecycle_terminal');
    expect(fault.retry).toBeNull();
    expect(fault.abandonmentEvent).toBeNull();
    expect(fault.abandonmentState).toBeNull();
  });

  it('an execution that has outlived the time it is allowed', async () => {
    const old = cloneArvoEvent(anOrder(), {
      time: new Date(Date.now() - 60_000).toISOString(),
    });
    const fault = await faulted(
      { event: old },
      '1.0.0',
      declareVersions({ [orderV1.type]: { executionTimeout: 1_000 } }),
    );
    expect(fault.faultKind).toBe('execution_timeout');
    expect(fault.retry).toBeNull();
    expect(typeof fault.abandonmentEvent).toBe('string');
    expect(fault.abandonmentState).toBeNull();
  });

  it('an event that names nowhere to go', async () => {
    // Built without a contract, because a contract's factory addresses
    // every event it makes and this one must name nowhere.
    const unaddressed = createArvoEvent({
      source: 'com.web.checkout',
      subject: 'order-1',
      type: orderV1.type,
      dataschema: orderV1.dataschema,
      data: { items: ['book'] },
    });
    const fault = await faulted({ event: unaddressed });
    expect(fault.faultKind).toBe('event_unaddressed');
    expect(fault.retry).toBeNull();
  });

  it('an event that does not belong to the execution it arrived with', async () => {
    const built = await waiting();
    const fault = await followup(built, {
      event: answerTo(built.asked[0] as ArvoEvent, built.executionId, {
        subject: 'another-workflow',
      }),
    });
    expect(fault.faultKind).toBe('addressing_mismatch');
    expect(fault.violations.length).toBeGreaterThan(0);
    expect(fault.retry).toBeNull();
  });

  it('an answer to something nothing asked for', async () => {
    const built = await waiting();
    const fault = await followup(built, {
      event: answerTo(built.asked[0] as ArvoEvent, built.executionId, {
        initid: 'never-asked',
      }),
    });
    expect(fault.faultKind).toBe('response_unawaited');
    expect(fault.retry).toBeNull();
    expect(typeof fault.abandonmentEvent).toBe('string');
    expect(typeof fault.abandonmentState).toBe('string');
  });

  it('dependencies that would not resolve, which may resolve later', async () => {
    const fault = await faulted({
      dependencies: () => {
        throw new Error('the pool is exhausted');
      },
    });
    expect(fault.faultKind).toBe('dependency_resolution_failed');
    expect(fault.retry).not.toBeNull();
    expect(fault.cause).toContain('the pool is exhausted');
    expect(typeof fault.abandonmentEvent).toBe('string');
    expect(fault.abandonmentState).toBeNull();
  });
});

describe('what refuses an execution once its executor has run', () => {
  const misbehaving = (behave: (ctx: OrderContext) => unknown) =>
    faulted({ dependencies: { behave } });

  it('an executor that did not come back in time', async () => {
    const versions = declareVersions({
      [orderV1.type]: { runTimeout: 20 },
    });
    const fault = await faulted(
      { dependencies: { behave: () => new Promise(() => undefined) } },
      '1.0.0',
      versions,
    );
    expect(fault.faultKind).toBe('run_timeout');
    expect(fault.retry).not.toBeNull();
  });

  it('an executor that ended the execution and answered nobody', async () => {
    const fault = await misbehaving(async (ctx) => {
      await ctx.setState({ data: { stage: 'stopping', answers: 0 } });
      ctx.cancel('the customer withdrew the order');
    });
    expect(fault.faultKind).toBe('execution_cancelled');
    expect(fault.retry).toBeNull();
    expect(typeof fault.abandonmentEvent).toBe('string');
    expect(typeof fault.abandonmentState).toBe('string');
  });

  it('an executor that raised a fault of its own', async () => {
    const fault = await misbehaving(async (ctx) => {
      throw await ctx.fault({
        faultKind: 'executor_raised',
        message: 'the gateway refused',
      });
    });
    expect(fault.faultKind).toBe('executor_raised');
    expect(fault.retry).not.toBeNull();
  });

  it('an executor that returned something that is not an event', async () => {
    const fault = await misbehaving(async (ctx) => {
      await ctx.setState({ data: { stage: 'done', answers: 0 } });
      return 'nearly an event';
    });
    expect(fault.faultKind).toBe('emission_not_permitted');
    expect(fault.retry).toBeNull();
    expect(typeof fault.abandonmentEvent).toBe('string');
    expect(typeof fault.abandonmentState).toBe('string');
  });

  it('an event whose payload its own schema refuses', async () => {
    const fault = await misbehaving(async (ctx) => {
      await ctx.setState({ data: { stage: 'done', answers: 0 } });
      const asked = await ctx.build({
        type: 'com_payment_charge',
        data: { amount: 1 },
      });
      return cloneArvoEvent(asked, { data: { amount: 'free' } as never });
    });
    expect(fault.faultKind).toBe('emission_schema_rejected');
    expect(fault.retry).toBeNull();
  });

  it('an event that would be sent deeper than the version allows', async () => {
    const versions = declareVersions({ [orderV1.type]: { maxDepth: 1 } });
    const fault = await faulted(
      {
        dependencies: {
          behave: async (ctx: OrderContext) => {
            await ctx.setState({ data: { stage: 'done', answers: 0 } });
            return ctx.build({
              type: 'com_payment_charge',
              data: { amount: 1 },
            });
          },
        },
      },
      '1.0.0',
      versions,
    );
    expect(fault.faultKind).toBe('max_depth_event_requested');
    expect(fault.retry).toBeNull();
  });

  it('a write the version own state schema refuses', async () => {
    const fault = await misbehaving(async (ctx) => {
      await ctx.setState({ data: { stage: 42 } as never });
    });
    expect(fault.faultKind).toBe('state_schema_rejected');
    expect(fault.retry).toBeNull();
  });

  it('an executor that finished having remembered nothing', async () => {
    const fault = await misbehaving(async (ctx) =>
      ctx.build({ type: 'evt_order_fulfilled', data: { order_id: 'o-1' } }),
    );
    expect(fault.faultKind).toBe('state_schema_rejected');
    expect(fault.message).toContain('ctx.setState()');
  });

  it('state that will not survive being written out', async () => {
    // Through a version that remembers anything, since a schema naming
    // its fields would have stripped what cannot be written before the
    // write was attempted.
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const writing = createArvoEventFactory(auditV1).createInput({
      source: 'com.web.checkout',
      subject: 'order-1',
      to: auditV1.type,
      data: { line: 'something happened' },
    });

    const versions = declareVersions();
    try {
      await versions[auditV1.type]?.['1.0.0']?.execute({
        entry: 'init',
        event: writing,
        state: null,
        executionId: await deriveArvoExecutionId(writing),
        attempt: 0,
        dependencies: {
          behave: async (ctx: AuditContext) => {
            await ctx.setState({ data: { circular } });
          },
        },
        hooks: {},
        telemetry: telemetry(),
      } as never);
    } catch (raised) {
      const fault = raised as ArvoHandlerFault;
      reached.add(fault.faultKind);
      expect(fault.faultKind).toBe('state_not_serializable');
      expect(fault.retry).toBeNull();
      expect(fault.message).toContain('ctx.setState()');
      return;
    }
    throw new Error('expected this execution to fault');
  });
});

describe('what every fault carries, whichever it is', () => {
  it('names the execution it happened to, where one was resolved', async () => {
    const fault = await faulted({
      dependencies: () => {
        throw new Error('no');
      },
    });
    expect(fault.subject).toBe('order-1');
    expect(fault.executionId).not.toBeNull();
    expect(fault.eventId).toBeTruthy();
    expect(fault.attempt).toBe(0);
  });

  it('survives being written out, for whatever stores it', async () => {
    const fault = await faulted({
      dependencies: () => {
        throw new Error('no');
      },
    });
    const written = JSON.parse(JSON.stringify(fault.toJSON()));
    expect(written.faultKind).toBe('dependency_resolution_failed');
    expect(written.retry.retryInMs).toBeGreaterThan(0);
  });
});

describe('the vocabulary a version can raise', () => {
  it('is every kind that is the version own, and no kind is unreachable', () => {
    const everyKind: ArvoFaultKind[] = [
      'event_unclassifiable',
      'category_mismatch',
      'state_resolution_failed',
      'record_unexpected',
      'record_expected',
      'record_invalid',
      'record_event_unrestorable',
      'version_not_declared',
      'max_depth_event_received',
      'lifecycle_terminal',
      'execution_timeout',
      'event_unaddressed',
      'addressing_mismatch',
      'type_not_receivable',
      'event_schema_rejected',
      'response_unawaited',
      'dependency_resolution_failed',
      'service_version_conflict',
      'run_timeout',
      'execution_cancelled',
      'executor_raised',
      'emission_not_permitted',
      'emission_schema_rejected',
      'max_depth_event_requested',
      'state_schema_rejected',
      'state_not_serializable',
    ];

    const owed = everyKind.filter(
      (kind) => !BEFORE_A_VERSION_IS_KNOWN.includes(kind),
    );
    expect([...reached].sort()).toEqual(owed.sort());
  });
});
