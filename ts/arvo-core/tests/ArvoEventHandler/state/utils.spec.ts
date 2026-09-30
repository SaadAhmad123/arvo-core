import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoExecutionStateValidationError } from '../../../src/ArvoEventHandler/state/errors.js';
import { ArvoExecutionState } from '../../../src/ArvoEventHandler/state/index.js';
import {
  mutateState,
  tryMutateState,
} from '../../../src/ArvoEventHandler/state/utils.js';
import { chargedEvent, initEvent, orderContract } from '../fixtures.js';

const orderData = z.object({ orderId: z.string(), attempts: z.number() });

const before = new ArvoExecutionState<typeof orderData>({
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
  contracts: {
    self: { uri: orderContract.uri, type: orderContract.type },
    services: [],
  },
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

const read = (state: unknown, field: string): unknown =>
  (state as Record<string, unknown>)[field];

describe('mutateState', () => {
  it('gives back a record, not a plain object', () => {
    expect(mutateState(before, {})).toBeInstanceOf(ArvoExecutionState);
  });

  it('gives back something other than what it was given', () => {
    expect(mutateState(before, {})).not.toBe(before);
  });

  it('leaves the record it was given exactly as it was', () => {
    mutateState(before, { data: { orderId: 'o-2', attempts: 9 }, depth: 7 });
    expect(before.data).toEqual({ orderId: 'o-1', attempts: 1 });
    expect(before.depth).toBe(2);
  });

  describe('replacing nothing', () => {
    it.each(EVERY_FIELD)('carries %s across untouched', (field) => {
      const after = mutateState(before, {});
      expect(read(after, field)).toEqual(read(before, field));
    });
  });

  describe('replacing what an executor owns', () => {
    it('carries the new data', () => {
      expect(
        mutateState(before, { data: { orderId: 'o-2', attempts: 9 } }).data,
      ).toEqual({ orderId: 'o-2', attempts: 9 });
    });

    it('takes data away where an execution is being emptied', () => {
      expect(mutateState(before, { data: null }).data).toBeNull();
    });

    it.each(EVERY_FIELD.filter((field) => field !== 'data'))(
      'leaves %s alone while data changes',
      (field) => {
        const after = mutateState(before, { data: null });
        expect(read(after, field)).toEqual(read(before, field));
      },
    );
  });

  describe('replacing anything else', () => {
    it('advances where an execution rests', () => {
      const after = mutateState(before, {
        lifecycle: 'success',
        lifecycleDescription: null,
      });
      expect(after.lifecycle).toBe('success');
      expect(after.lifecycleDescription).toBeNull();
    });

    it('advances the revision a store writes against', () => {
      expect(mutateState(before, { casVersion: 4 }).casVersion).toBe(4);
    });

    it('appends to the event log', () => {
      const after = mutateState(before, {
        eventIds: [
          ...before.eventIds,
          { id: 'e-2', direction: 'emitted' as const },
        ],
      });
      expect(after.eventIds).toHaveLength(2);
      expect(before.eventIds).toHaveLength(1);
    });

    it('answers something that was awaited', () => {
      const after = mutateState(before, {
        inFlightEventMap: new Map([['emitted-1', null]]),
      });
      expect(after.inFlightEventMap.get('emitted-1')).toBeNull();
      expect(before.inFlightEventMap.get('emitted-1')).toBe(chargedEvent);
    });

    it('replaces several at once', () => {
      const after = mutateState(before, {
        data: null,
        lifecycle: 'error',
        casVersion: 9,
      });
      expect([after.data, after.lifecycle, after.casVersion]).toEqual([
        null,
        'error',
        9,
      ]);
    });

    it('leaves what was not named alone', () => {
      const after = mutateState(before, { lifecycle: 'cancelled' });
      expect(after.subject).toBe(before.subject);
      expect(after.data).toEqual(before.data);
    });
  });

  it('refuses a replacement of the wrong shape, as building one does', () => {
    expect(() => mutateState(before, { depth: -1 })).toThrow(
      ArvoExecutionStateValidationError,
    );
  });

  it('refuses a field blanked rather than replaced', () => {
    expect(() =>
      mutateState(before, { subject: undefined as unknown as string }),
    ).toThrow(ArvoExecutionStateValidationError);
  });
});

describe('tryMutateState', () => {
  it('reports a record where the advance is sound', () => {
    const result = tryMutateState(before, { lifecycle: 'success' });
    expect(result.ok && result.value.lifecycle).toBe('success');
  });

  it('reports rather than throwing where it is not', () => {
    const result = tryMutateState(before, { depth: -1 });
    expect(result.ok).toBe(false);
  });

  it('names every rule the advance broke', () => {
    const result = tryMutateState(before, { depth: -1, casVersion: -1 });
    expect(
      !result.ok && result.error.issues.map((issue) => issue.path),
    ).toEqual(['depth', 'casVersion']);
  });

  it('agrees with the throwing form on a sound advance', () => {
    const result = tryMutateState(before, { casVersion: 4 });
    expect(result.ok && result.value.casVersion).toBe(
      mutateState(before, { casVersion: 4 }).casVersion,
    );
  });

  it('reports what the throwing form throws', () => {
    const result = tryMutateState(before, { depth: -1 });
    expect(() => mutateState(before, { depth: -1 })).toThrow(
      !result.ok ? result.error.message : undefined,
    );
  });

  it('lets anything that is not a rejected record through unconverted', () => {
    const unreadable = {};
    Object.defineProperty(unreadable, 'subject', {
      enumerable: true,
      get() {
        throw new RangeError('this field cannot be read');
      },
    });
    expect(() => tryMutateState(before, unreadable)).toThrow(RangeError);
  });
});
