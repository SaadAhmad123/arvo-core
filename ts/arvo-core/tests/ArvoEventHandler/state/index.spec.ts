import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoExecutionStateValidationError } from '../../../src/ArvoEventHandler/state/errors.js';
import { ArvoExecutionState } from '../../../src/ArvoEventHandler/state/index.js';
import { chargedEvent, initEvent, orderContract } from '../fixtures.js';

const orderData = z.object({ orderId: z.string(), attempts: z.number() });

const contracts = {
  self: { uri: orderContract.uri, type: orderContract.type },
  services: [],
};

const whole = (overrides: Record<string, unknown> = {}) => ({
  data: null,
  subject: initEvent.subject,
  executionId: initEvent.executionid,
  parentExecutionId: initEvent.executionid,
  depth: 0,
  source: 'com_order_create',
  version: '1.0.0',
  lifecycle: 'waiting',
  lifecycleDescription: null,
  initEvent,
  triggeringEvent: initEvent,
  eventIds: [{ id: initEvent.id, direction: 'received' }],
  inFlightEventMap: new Map<string, unknown>(),
  recordFormatVersion: '1.0.0',
  casVersion: 0,
  contracts,
  ...overrides,
});

const build = (overrides: Record<string, unknown> = {}) =>
  new ArvoExecutionState(whole(overrides) as never);

describe('ArvoExecutionState', () => {
  describe('what it carries', () => {
    it('carries the execution it is the memory of', () => {
      const state = build();
      expect(state.subject).toBe(initEvent.subject);
      expect(state.executionId).toBe(initEvent.executionid);
      expect(state.parentExecutionId).toBe(initEvent.executionid);
      expect(state.depth).toBe(0);
    });

    it('carries the contract and version it belongs to', () => {
      const state = build();
      expect(state.source).toBe('com_order_create');
      expect(state.version).toBe('1.0.0');
    });

    it('carries where it rests, and why', () => {
      const state = build({
        lifecycle: 'error',
        lifecycleDescription: 'it failed',
      });
      expect(state.lifecycle).toBe('error');
      expect(state.lifecycleDescription).toBe('it failed');
    });

    it('carries no reason where nothing explains where it rests', () => {
      expect(build().lifecycleDescription).toBeNull();
    });

    it('carries the event that opened it and the one that caused this delivery', () => {
      const state = build({ triggeringEvent: chargedEvent });
      expect(state.initEvent).toBe(initEvent);
      expect(state.triggeringEvent).toBe(chargedEvent);
    });

    it('carries every event it has touched, and which way', () => {
      expect(build().eventIds).toEqual([
        { id: initEvent.id, direction: 'received' },
      ]);
    });

    it('carries what it is waiting on, keyed by the event it emitted', () => {
      const state = build({
        inFlightEventMap: new Map([['emitted-1', null]]),
      });
      expect(state.inFlightEventMap.get('emitted-1')).toBeNull();
    });

    it('carries an answered request as the event that answered it', () => {
      const state = build({
        inFlightEventMap: new Map([['emitted-1', chargedEvent]]),
      });
      expect(state.inFlightEventMap.get('emitted-1')).toBe(chargedEvent);
    });

    it('carries the bookkeeping whatever stores it needs', () => {
      const state = build({ casVersion: 3 });
      expect(state.recordFormatVersion).toBe('1.0.0');
      expect(state.casVersion).toBe(3);
    });

    it('carries the contracts as a snapshot for a reader', () => {
      expect(build().contracts).toEqual(contracts);
    });
  });

  describe('its data', () => {
    it('is null on an execution that has written nothing', () => {
      expect(build().data).toBeNull();
    });

    it('is what was written', () => {
      expect(build({ data: { orderId: 'o-1', attempts: 1 } }).data).toEqual({
        orderId: 'o-1',
        attempts: 1,
      });
    });

    it('is the only field that may be empty', () => {
      expect(() => build({ subject: undefined })).toThrow(
        ArvoExecutionStateValidationError,
      );
    });
  });

  describe('checking itself as it is built', () => {
    it('refuses a lifecycle that is not one of the six', () => {
      expect(() => build({ lifecycle: 'pondering' })).toThrow(
        ArvoExecutionStateValidationError,
      );
    });

    it.each(['idle', 'waiting', 'success', 'error', 'cancelled', 'failure'])(
      'accepts the lifecycle %s',
      (lifecycle) => {
        expect(build({ lifecycle }).lifecycle).toBe(lifecycle);
      },
    );

    it('refuses a negative depth', () => {
      expect(() => build({ depth: -1 })).toThrow(
        ArvoExecutionStateValidationError,
      );
    });

    it('refuses a negative revision', () => {
      expect(() => build({ casVersion: -1 })).toThrow(
        ArvoExecutionStateValidationError,
      );
    });

    it('refuses a format version that is not a semantic version', () => {
      expect(() => build({ recordFormatVersion: 'one' })).toThrow(
        ArvoExecutionStateValidationError,
      );
    });

    it('refuses something that is not an event where an event belongs', () => {
      expect(() => build({ initEvent: { id: 'not-an-event' } })).toThrow(
        ArvoExecutionStateValidationError,
      );
    });

    it('refuses a touched event with a direction it does not have', () => {
      expect(() =>
        build({ eventIds: [{ id: 'e-1', direction: 'sideways' }] }),
      ).toThrow(ArvoExecutionStateValidationError);
    });

    it('reports every rule it broke, not only the first', () => {
      try {
        build({ depth: -1, casVersion: -1, lifecycle: 'pondering' });
      } catch (raised) {
        expect(
          (raised as ArvoExecutionStateValidationError).issues.length,
        ).toBe(3);
        return;
      }
      throw new Error('expected the record to be refused');
    });

    it('names where each failure is', () => {
      try {
        build({ depth: -1 });
      } catch (raised) {
        expect(
          (raised as ArvoExecutionStateValidationError).issues[0]?.path,
        ).toBe('depth');
        return;
      }
      throw new Error('expected the record to be refused');
    });
  });

  describe('rebuilding one from what was stored', () => {
    it('builds a record from what was stored', () => {
      const result = ArvoExecutionState.tryBuild(whole(), orderData);
      expect(result.ok).toBe(true);
    });

    it('reports rather than throwing where the record is wrong', () => {
      const result = ArvoExecutionState.tryBuild(
        whole({ depth: -1 }),
        orderData,
      );
      expect(result.ok).toBe(false);
    });

    it('checks the data against the schema it is given', () => {
      const result = ArvoExecutionState.tryBuild(
        whole({ data: { orderId: 42 } }),
        orderData,
      );
      expect(result.ok).toBe(false);
    });

    it('accepts a record that has written nothing', () => {
      const result = ArvoExecutionState.tryBuild(
        whole({ data: null }),
        orderData,
      );
      expect(result.ok && result.value.data).toBeNull();
    });

    it('reads back what was stored, not what the schema would produce', () => {
      const withDefault = z.object({
        orderId: z.string(),
        currency: z.string().default('GBP'),
      });
      const result = ArvoExecutionState.tryBuild(
        whole({ data: { orderId: 'o-1' } }),
        withDefault,
      );
      expect(result.ok && result.value.data).toEqual({ orderId: 'o-1' });
    });

    it('judges the data against the schema without applying it', () => {
      const withDefault = z.object({
        orderId: z.string(),
        currency: z.string().default('GBP'),
      });
      expect(
        ArvoExecutionState.tryBuild(
          whole({ data: { orderId: 42 } }),
          withDefault,
        ).ok,
      ).toBe(false);
    });

    it('throws through the other form', () => {
      expect(() =>
        ArvoExecutionState.build(whole({ depth: -1 }), orderData),
      ).toThrow(ArvoExecutionStateValidationError);
    });

    it('gives back a record through the other form', () => {
      expect(ArvoExecutionState.build(whole(), orderData).depth).toBe(0);
    });

    it('says (root) where the data itself is wrong, not one of its fields', () => {
      const noBadOrders = z
        .object({ orderId: z.string() })
        .refine((value) => value.orderId !== 'bad', 'orderId must not be bad');
      const result = ArvoExecutionState.tryBuild(
        whole({ data: { orderId: 'bad' } }),
        noBadOrders,
      );
      expect(!result.ok && result.error.issues[0]?.path).toBe('data.(root)');
    });

    it('refuses something that is not a record at all', () => {
      expect(ArvoExecutionState.tryBuild('not a record', orderData).ok).toBe(
        false,
      );
    });
  });

  it('cannot be changed once built', () => {
    const state = build();
    expect(Object.isFrozen(state)).toBe(true);
    expect(() => {
      (state as unknown as Record<string, unknown>).depth = 9;
    }).toThrow();
  });
});
