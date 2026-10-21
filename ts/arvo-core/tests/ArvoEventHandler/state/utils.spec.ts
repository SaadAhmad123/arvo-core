import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoExecutionStateValidationError } from '../../../src/ArvoEventHandler/state/errors.js';
import { ArvoExecutionState } from '../../../src/ArvoEventHandler/state/index.js';
import {
  mutateState,
  tryMutateState,
} from '../../../src/ArvoEventHandler/state/utils.js';
import { chargedEvent, initEvent } from '../fixtures.js';

const orderData = z.object({ orderId: z.string(), attempts: z.number() });

const waitingState = new ArvoExecutionState<typeof orderData>({
  data: { orderId: 'o-1', attempts: 1 },
  subject: initEvent.subject,
  executionId: initEvent.executionid,
  parentExecutionId: initEvent.executionid,
  depth: 2,
  source: 'com_order_create',
  version: '1.0.0',
  lifecycle: 'waiting',
  lifecycleDescription: 'awaiting payment',
  initEvent,
  triggeringEvent: chargedEvent,
  eventIds: [{ id: initEvent.id, direction: 'received' }],
  inFlightEventMap: new Map([['emitted-1', chargedEvent]]),
  recordFormatVersion: '1.0.0',
  casVersion: 3,
});

/** Every field a record holds, for asserting what was carried across. */
const EVERY_FIELD = [
  'data',
  'subject',
  'executionId',
  'parentExecutionId',
  'depth',
  'source',
  'version',
  'lifecycle',
  'lifecycleDescription',
  'initEvent',
  'triggeringEvent',
  'eventIds',
  'inFlightEventMap',
  'recordFormatVersion',
  'casVersion',
  'contracts',
] as const;

const fieldValue = (state: unknown, field: string): unknown =>
  (state as Record<string, unknown>)[field];

describe('mutateState', () => {
  it('gives back a record, not a plain object', () => {
    expect(mutateState(waitingState, {})).toBeInstanceOf(ArvoExecutionState);
  });

  it('gives back something other than what it was given', () => {
    expect(mutateState(waitingState, {})).not.toBe(waitingState);
  });

  it('leaves the record it was given exactly as it was', () => {
    mutateState(waitingState, {
      data: { orderId: 'o-2', attempts: 9 },
      depth: 7,
    });
    expect(waitingState.data).toEqual({ orderId: 'o-1', attempts: 1 });
    expect(waitingState.depth).toBe(2);
  });

  describe('replacing nothing', () => {
    it.each(EVERY_FIELD)('carries %s across untouched', (field) => {
      const mutatedState = mutateState(waitingState, {});
      expect(fieldValue(mutatedState, field)).toEqual(
        fieldValue(waitingState, field),
      );
    });
  });

  describe('replacing what an executor owns', () => {
    it('carries the new data', () => {
      expect(
        mutateState(waitingState, { data: { orderId: 'o-2', attempts: 9 } })
          .data,
      ).toEqual({ orderId: 'o-2', attempts: 9 });
    });

    it('takes data away where an execution is being emptied', () => {
      expect(mutateState(waitingState, { data: null }).data).toBeNull();
    });

    it.each(EVERY_FIELD.filter((field) => field !== 'data'))(
      'leaves %s alone while data changes',
      (field) => {
        const mutatedState = mutateState(waitingState, { data: null });
        expect(fieldValue(mutatedState, field)).toEqual(
          fieldValue(waitingState, field),
        );
      },
    );
  });

  describe('replacing anything else', () => {
    it('advances where an execution rests', () => {
      const mutatedState = mutateState(waitingState, {
        lifecycle: 'success',
        lifecycleDescription: null,
      });
      expect(mutatedState.lifecycle).toBe('success');
      expect(mutatedState.lifecycleDescription).toBeNull();
    });

    it('advances the revision a store writes against', () => {
      expect(mutateState(waitingState, { casVersion: 4 }).casVersion).toBe(4);
    });

    it('appends to the event log', () => {
      const mutatedState = mutateState(waitingState, {
        eventIds: [
          ...waitingState.eventIds,
          { id: 'e-2', direction: 'emitted' as const },
        ],
      });
      expect(mutatedState.eventIds).toHaveLength(2);
      expect(waitingState.eventIds).toHaveLength(1);
    });

    it('answers something that was awaited', () => {
      const mutatedState = mutateState(waitingState, {
        inFlightEventMap: new Map([['emitted-1', null]]),
      });
      expect(mutatedState.inFlightEventMap.get('emitted-1')).toBeNull();
      expect(waitingState.inFlightEventMap.get('emitted-1')).toBe(chargedEvent);
    });

    it('replaces several at once', () => {
      const mutatedState = mutateState(waitingState, {
        data: null,
        lifecycle: 'error',
        casVersion: 9,
      });
      expect([
        mutatedState.data,
        mutatedState.lifecycle,
        mutatedState.casVersion,
      ]).toEqual([null, 'error', 9]);
    });

    it('leaves what was not named alone', () => {
      const mutatedState = mutateState(waitingState, {
        lifecycle: 'cancelled',
      });
      expect(mutatedState.subject).toBe(waitingState.subject);
      expect(mutatedState.data).toEqual(waitingState.data);
    });
  });

  it('refuses a replacement of the wrong shape, as building one does', () => {
    expect(() => mutateState(waitingState, { depth: -1 })).toThrow(
      ArvoExecutionStateValidationError,
    );
  });

  it('refuses a field blanked rather than replaced', () => {
    expect(() =>
      mutateState(waitingState, { subject: undefined as unknown as string }),
    ).toThrow(ArvoExecutionStateValidationError);
  });
});

describe('tryMutateState', () => {
  it('reports a record where the advance is sound', () => {
    const mutation = tryMutateState(waitingState, { lifecycle: 'success' });
    expect(mutation.ok && mutation.value.lifecycle).toBe('success');
  });

  it('reports rather than throwing where it is not', () => {
    const mutation = tryMutateState(waitingState, { depth: -1 });
    expect(mutation.ok).toBe(false);
  });

  it('names every rule the advance broke', () => {
    const mutation = tryMutateState(waitingState, {
      depth: -1,
      casVersion: -1,
    });
    expect(
      !mutation.ok && mutation.error.issues.map((issue) => issue.path),
    ).toEqual(['depth', 'casVersion']);
  });

  it('agrees with the throwing form on a sound advance', () => {
    const mutation = tryMutateState(waitingState, { casVersion: 4 });
    expect(mutation.ok && mutation.value.casVersion).toBe(
      mutateState(waitingState, { casVersion: 4 }).casVersion,
    );
  });

  it('reports what the throwing form throws', () => {
    const mutation = tryMutateState(waitingState, { depth: -1 });
    expect(() => mutateState(waitingState, { depth: -1 })).toThrow(
      !mutation.ok ? mutation.error.message : undefined,
    );
  });

  it('lets anything that is not a rejected record through unconverted', () => {
    const unreadableChanges = {};
    Object.defineProperty(unreadableChanges, 'subject', {
      enumerable: true,
      get() {
        throw new RangeError('this field cannot be read');
      },
    });
    expect(() => tryMutateState(waitingState, unreadableChanges)).toThrow(
      RangeError,
    );
  });
});
