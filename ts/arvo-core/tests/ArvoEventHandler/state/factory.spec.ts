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
const tryOpenState = (overrides: Record<string, unknown> = {}) =>
  createInitArvoExecutionState<Self, Services, Data>({
    self: orderVersion,
    event: initEvent,
    executionId: EXECUTION_ID,
    parentExecutionId: initEvent.executionid,
    ...overrides,
  });

/** The same, for a fixture that expects it to have worked. */
const openState = (overrides: Record<string, unknown> = {}) => {
  const opening = tryOpenState(overrides);
  if (!opening.ok) throw opening.error;
  return opening.value;
};

/** A stored row for an execution that has emitted a charge and is waiting. */
const storedRow = async (
  overrides: Record<string, unknown> = {},
): Promise<JSONObject> => {
  const serializer = new ArvoExecutionStateSerializer(orderData);
  const storedRecord = JSON.parse(await serializer.serialize(openState()));
  return {
    ...storedRecord,
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
const tryResumeState = async (overrides: Record<string, unknown> = {}) =>
  createFollowupArvoExecutionState<Self, Services, Data>({
    dataSchema: orderData,
    event: chargedEvent,
    state: await storedRow(),
    executionId: EXECUTION_ID,
    ...overrides,
  });

/** The same, for a fixture that expects it to have worked. */
const resumeState = async (overrides: Record<string, unknown> = {}) => {
  const resumption = await tryResumeState(overrides);
  if (!resumption.ok) throw resumption.error;
  return resumption.value;
};

describe('the record an execution opens with', () => {
  it('remembers nothing yet', () => {
    expect(openState().data).toBeNull();
  });

  it('rests where an execution rests before anything has run', () => {
    expect(openState().lifecycle).toBe('idle');
    expect(openState().lifecycleDescription).toBeNull();
  });

  it('has never been written', () => {
    expect(openState().casVersion).toBe(0);
  });

  it('says which shape of record it is', () => {
    expect(openState().recordFormatVersion).toBe('1.0.0');
  });

  it('takes the identity it was given rather than deriving one', () => {
    const state = openState();
    expect(state.executionId).toBe(EXECUTION_ID);
    expect(state.parentExecutionId).toBe(initEvent.executionid);
  });

  it('reads the workflow and the depth off the event', () => {
    const state = openState();
    expect(state.subject).toBe(initEvent.subject);
    expect(state.depth).toBe(initEvent.depth);
  });

  it('reads what it implements off the contract', () => {
    const state = openState();
    expect(state.source).toBe(orderVersion.type);
    expect(state.version).toBe(orderVersion.version);
  });

  it('holds the opening event as both events it has', () => {
    const state = openState();
    expect(state.initEvent).toBe(initEvent);
    expect(state.triggeringEvent).toBe(initEvent);
  });

  it('logs the opening event as received', () => {
    expect(openState().eventIds).toEqual([
      { id: initEvent.id, direction: 'received' },
    ]);
  });

  it('is waiting on nothing', () => {
    expect(openState().inFlightEventMap.size).toBe(0);
  });
});

describe('when an execution will not open', () => {
  it('reports rather than throwing', () => {
    expect(tryOpenState({ executionId: '' }).ok).toBe(false);
  });

  it('names the field at fault', () => {
    const opening = tryOpenState({ executionId: '' });
    expect(
      !opening.ok && opening.error.issues.map((issue) => issue.path),
    ).toEqual(['executionId']);
  });

  it('lets anything that is not a rejected record through unconverted', () => {
    const unreadableEvent = Object.create(ArvoEvent.prototype) as ArvoEvent;
    Object.assign(unreadableEvent, { ...initEvent });
    Object.defineProperty(unreadableEvent, 'depth', {
      get() {
        throw new RangeError('this field cannot be read');
      },
    });

    expect(() => tryOpenState({ event: unreadableEvent })).toThrow(RangeError);
  });
});

describe('the record a stored row restores to', () => {
  it('takes what was remembered', async () => {
    expect((await resumeState()).data).toEqual({ orderId: 'o-1', attempts: 1 });
  });

  it('takes where the execution rests', async () => {
    expect((await resumeState()).lifecycle).toBe('waiting');
  });

  it('takes the revision it was stored at', async () => {
    expect((await resumeState()).casVersion).toBe(2);
  });

  it('takes the identity off the row', async () => {
    expect((await resumeState()).executionId).toBe(EXECUTION_ID);
  });

  it('takes the event that opened the execution, restored as an event', async () => {
    const state = await resumeState();
    expect(state.initEvent).toBeInstanceOf(ArvoEvent);
    expect(state.initEvent.id).toBe(initEvent.id);
  });

  it('leaves the event log exactly as it was stored', async () => {
    expect((await resumeState()).eventIds).toEqual([
      { id: initEvent.id, direction: 'received' },
      { id: 'charge-request', direction: 'emitted' },
    ]);
  });

  it('leaves what is awaited exactly as it was stored', async () => {
    expect(
      (await resumeState()).inFlightEventMap.get('charge-request'),
    ).toBeNull();
  });
});

describe('the event that caused the execution being processed', () => {
  it('is this one, not the one the row was stored with', async () => {
    expect((await resumeState()).triggeringEvent).toBe(chargedEvent);
  });

  it('is a service handler error like any other answer', async () => {
    const state = await resumeState({ event: paymentFailedEvent });
    expect(state.triggeringEvent).toBe(paymentFailedEvent);
  });
});

describe('when a stored row will not restore', () => {
  it('refuses one that is not a record at all', async () => {
    const resumption = await tryResumeState({ state: 'not a row at all' });
    expect(!resumption.ok && resumption.error).toBeInstanceOf(
      ArvoExecutionStateSerializerError,
    );
  });

  it('refuses one that reads but is wrong', async () => {
    const resumption = await tryResumeState({
      state: await storedRow({ depth: -1 }),
    });
    expect(!resumption.ok && resumption.error).toBeInstanceOf(
      ArvoExecutionStateValidationError,
    );
  });

  it('refuses one for a different execution', async () => {
    const resumption = await tryResumeState({ executionId: 'b'.repeat(64) });
    expect(!resumption.ok && resumption.error).toBeInstanceOf(
      ArvoExecutionStateValidationError,
    );
  });

  it('says which execution it was asked for and which it found', async () => {
    const resumption = await tryResumeState({ executionId: 'b'.repeat(64) });
    expect(
      !resumption.ok &&
        resumption.error instanceof ArvoExecutionStateValidationError &&
        resumption.error.issues[0]?.path,
    ).toBe('executionId');
  });
});
