import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoEvent } from '../../../src/ArvoEvent/index.js';
import { ArvoExecutionStateValidationError } from '../../../src/ArvoEventHandler/state/errors.js';
import {
  createFollowupArvoExecutionState,
  createInitArvoExecutionState,
} from '../../../src/ArvoEventHandler/state/factory.js';
import { ArvoExecutionStateSerializerError } from '../../../src/ArvoEventHandler/state/serializer/errors.js';
import { ArvoExecutionStateSerializer } from '../../../src/ArvoEventHandler/state/serializer/index.js';
import type { JSONObject } from '../../../src/types.js';
import {
  chargedEvent,
  initEvent,
  orderVersion,
  paymentFailedEvent,
  type services,
} from '../fixtures.js';

const orderData = z.object({ orderId: z.string(), attempts: z.number() });

const EXECUTION_ID = 'a'.repeat(64);

type Self = typeof orderVersion;
type Services = typeof services;
type Data = typeof orderData;

/** Opening an execution, as the factory reports it. */
const open = (overrides: Record<string, unknown> = {}) =>
  createInitArvoExecutionState<Self, Services, Data>({
    self: orderVersion,
    event: initEvent,
    executionId: EXECUTION_ID,
    parentExecutionId: initEvent.executionid,
    ...overrides,
  });

/** The same, for a fixture that expects it to have worked. */
const opened = (overrides: Record<string, unknown> = {}) => {
  const result = open(overrides);
  if (!result.ok) throw result.error;
  return result.value;
};

/** A stored row for an execution that has emitted a charge and is waiting. */
const storedRow = async (
  overrides: Record<string, unknown> = {},
): Promise<JSONObject> => {
  const serializer = new ArvoExecutionStateSerializer(orderData);
  const asStored = JSON.parse(await serializer.serialize(opened()));
  return {
    ...asStored,
    data: { orderId: 'o-1', attempts: 1 },
    lifecycle: 'waiting',
    casVersion: 2,
    eventIds: [
      { id: initEvent.id, direction: 'received' },
      { id: 'charge-request', direction: 'emitted' },
    ],
    inFlightEventMap: [['charge-request', null]],
    ...overrides,
  };
};

/** Resuming an execution, as the factory reports it. */
const resume = async (overrides: Record<string, unknown> = {}) =>
  createFollowupArvoExecutionState<Self, Services, Data>({
    dataSchema: orderData,
    event: chargedEvent,
    state: await storedRow(),
    executionId: EXECUTION_ID,
    ...overrides,
  });

/** The same, for a fixture that expects it to have worked. */
const resumed = async (overrides: Record<string, unknown> = {}) => {
  const result = await resume(overrides);
  if (!result.ok) throw result.error;
  return result.value;
};

describe('the record an execution opens with', () => {
  it('remembers nothing yet', () => {
    expect(opened().data).toBeNull();
  });

  it('rests where an execution rests before anything has run', () => {
    expect(opened().lifecycle).toBe('idle');
    expect(opened().lifecycleDescription).toBeNull();
  });

  it('has never been written', () => {
    expect(opened().casVersion).toBe(0);
  });

  it('says which shape of record it is', () => {
    expect(opened().recordFormatVersion).toBe('1.0.0');
  });

  it('takes the identity it was given rather than deriving one', () => {
    const state = opened();
    expect(state.executionId).toBe(EXECUTION_ID);
    expect(state.parentExecutionId).toBe(initEvent.executionid);
  });

  it('reads the workflow and the depth off the event', () => {
    const state = opened();
    expect(state.subject).toBe(initEvent.subject);
    expect(state.depth).toBe(initEvent.depth);
  });

  it('reads what it implements off the contract', () => {
    const state = opened();
    expect(state.source).toBe(orderVersion.type);
    expect(state.version).toBe(orderVersion.version);
  });

  it('holds the opening event as both events it has', () => {
    const state = opened();
    expect(state.initEvent).toBe(initEvent);
    expect(state.triggeringEvent).toBe(initEvent);
  });

  it('logs the opening event as received', () => {
    expect(opened().eventIds).toEqual([
      { id: initEvent.id, direction: 'received' },
    ]);
  });

  it('is waiting on nothing', () => {
    expect(opened().inFlightEventMap.size).toBe(0);
  });
});

describe('when an execution will not open', () => {
  it('reports rather than throwing', () => {
    expect(open({ executionId: '' }).ok).toBe(false);
  });

  it('names the field at fault', () => {
    const result = open({ executionId: '' });
    expect(
      !result.ok && result.error.issues.map((issue) => issue.path),
    ).toEqual(['executionId']);
  });

  it('lets anything that is not a rejected record through unconverted', () => {
    const unreadable = Object.create(ArvoEvent.prototype) as ArvoEvent;
    Object.assign(unreadable, { ...initEvent });
    Object.defineProperty(unreadable, 'depth', {
      get() {
        throw new RangeError('this field cannot be read');
      },
    });

    expect(() => open({ event: unreadable })).toThrow(RangeError);
  });
});

describe('the record a stored row restores to', () => {
  it('takes what was remembered', async () => {
    expect((await resumed()).data).toEqual({ orderId: 'o-1', attempts: 1 });
  });

  it('takes where the execution rests', async () => {
    expect((await resumed()).lifecycle).toBe('waiting');
  });

  it('takes the revision it was stored at', async () => {
    expect((await resumed()).casVersion).toBe(2);
  });

  it('takes the identity off the row', async () => {
    expect((await resumed()).executionId).toBe(EXECUTION_ID);
  });

  it('takes the event that opened the execution, restored as an event', async () => {
    const state = await resumed();
    expect(state.initEvent).toBeInstanceOf(ArvoEvent);
    expect(state.initEvent.id).toBe(initEvent.id);
  });

  it('leaves the event log exactly as it was stored', async () => {
    expect((await resumed()).eventIds).toEqual([
      { id: initEvent.id, direction: 'received' },
      { id: 'charge-request', direction: 'emitted' },
    ]);
  });

  it('leaves what is awaited exactly as it was stored', async () => {
    expect((await resumed()).inFlightEventMap.get('charge-request')).toBeNull();
  });
});

describe('the event that caused the execution being processed', () => {
  it('is this one, not the one the row was stored with', async () => {
    expect((await resumed()).triggeringEvent).toBe(chargedEvent);
  });

  it('is a service handler error like any other answer', async () => {
    const state = await resumed({ event: paymentFailedEvent });
    expect(state.triggeringEvent).toBe(paymentFailedEvent);
  });
});

describe('when a stored row will not restore', () => {
  it('refuses one that is not a record at all', async () => {
    const result = await resume({ state: 'not a row at all' });
    expect(!result.ok && result.error).toBeInstanceOf(
      ArvoExecutionStateSerializerError,
    );
  });

  it('refuses one that reads but is wrong', async () => {
    const result = await resume({ state: await storedRow({ depth: -1 }) });
    expect(!result.ok && result.error).toBeInstanceOf(
      ArvoExecutionStateValidationError,
    );
  });

  it('refuses one for a different execution', async () => {
    const result = await resume({ executionId: 'b'.repeat(64) });
    expect(!result.ok && result.error).toBeInstanceOf(
      ArvoExecutionStateValidationError,
    );
  });

  it('says which execution it was asked for and which it found', async () => {
    const result = await resume({ executionId: 'b'.repeat(64) });
    expect(
      !result.ok &&
        result.error instanceof ArvoExecutionStateValidationError &&
        result.error.issues[0]?.path,
    ).toBe('executionId');
  });
});
