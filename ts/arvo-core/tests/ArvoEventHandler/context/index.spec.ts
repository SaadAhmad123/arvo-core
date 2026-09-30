import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoExecutionContext } from '../../../src/ArvoEventHandler/context/index.js';
import { ArvoHandlerFault } from '../../../src/ArvoEventHandler/fault/index.js';
import {
  chargedEvent,
  initEvent,
  orderVersion,
  paymentFailedEvent,
  services,
} from '../fixtures.js';

/** What a version declares when it remembers something specific. */
const orderState = z.object({ orderId: z.string(), attempts: z.number() });

/** What a version that declares nothing of its own is given instead. */
const anyState = z.object({});

/** A schema that fills something in, to show a write reads back as parsed. */
const withDefault = z.object({
  orderId: z.string(),
  currency: z.string().default('GBP'),
});

const base = {
  contracts: { self: orderVersion, services },
  state: { schema: orderState, value: null },
  initEvent,
  attempt: 0,
  dependencies: {},
  hooks: {},
};

const onInit = (overrides: Record<string, unknown> = {}) =>
  new ArvoExecutionContext({
    ...base,
    entry: 'init',
    event: initEvent,
    ...overrides,
  } as never);

const onFollowup = (overrides: Record<string, unknown> = {}) =>
  new ArvoExecutionContext({
    ...base,
    entry: 'followup',
    event: chargedEvent,
    ...overrides,
  } as never);

describe('ArvoExecutionContext', () => {
  describe('the contracts it carries', () => {
    it('holds this version of the contract it implements', () => {
      expect(onInit().contracts.self).toBe(orderVersion);
    });

    it('holds the services it may send to', () => {
      expect(onInit().contracts.services).toEqual(services);
    });

    it('holds an empty set where no service was declared', () => {
      const ctx = onInit({ contracts: { self: orderVersion, services: {} } });
      expect(ctx.contracts.services).toEqual({});
    });

    it('copies the services, so a caller mutating theirs cannot change it', () => {
      const mutable = { payments: services.payments };
      const ctx = onInit({
        contracts: { self: orderVersion, services: mutable },
      });
      delete (mutable as Record<string, unknown>).payments;
      expect(ctx.contracts.services).toEqual(services);
    });
  });

  describe('the delivery it describes', () => {
    it('says how the delivery was classified', () => {
      expect(onInit().entry).toBe('init');
      expect(onFollowup().entry).toBe('followup');
    });

    it('carries the delivered event', () => {
      expect(onInit().event).toBe(initEvent);
      expect(onFollowup().event).toBe(chargedEvent);
    });

    it('carries a service handler error as a delivered event like any other', () => {
      expect(onFollowup({ event: paymentFailedEvent }).event).toBe(
        paymentFailedEvent,
      );
    });

    it('carries the event that opened the execution', () => {
      expect(onFollowup().initEvent).toBe(initEvent);
    });

    it('carries one event as both on an init delivery', () => {
      const ctx = onInit();
      expect(ctx.event).toBe(ctx.initEvent);
    });

    it('carries which attempt this is', () => {
      expect(onInit({ attempt: 2 }).attempt).toBe(2);
    });
  });

  describe('what the mechanism supplied', () => {
    it('carries the dependencies resolved for this delivery', () => {
      const db = { find: () => 'x' };
      expect(onInit({ dependencies: { db } }).dependencies.db).toBe(db);
    });

    it('carries whatever hooks the mechanism exposed', () => {
      const scheduler = {};
      expect(onInit({ hooks: { scheduler } }).hooks.scheduler).toBe(scheduler);
    });

    it('carries an empty object where a mechanism supplied neither', () => {
      const ctx = onInit();
      expect(ctx.dependencies).toEqual({});
      expect(ctx.hooks).toEqual({});
    });
  });

  describe('reading state', () => {
    it('always has a schema, which a version that declared none is given', () => {
      expect(onInit().stateSchema).toBe(orderState);
      expect(
        onInit({ state: { schema: anyState, value: null } }).stateSchema,
      ).toBe(anyState);
    });

    it('is null on an execution that has written nothing', () => {
      expect(onInit().state).toBeNull();
    });

    it('is what a followup found stored', () => {
      const stored = { orderId: 'o-1', attempts: 1 };
      expect(
        onFollowup({ state: { schema: orderState, value: stored } }).state,
      ).toBe(stored);
    });
  });

  describe('writing state', () => {
    it('replaces it whole, with no merge', () => {
      const ctx = onFollowup({
        state: { schema: orderState, value: { orderId: 'o-1', attempts: 9 } },
      });
      ctx.setState({ orderId: 'o-2', attempts: 1 });
      expect(ctx.state).toEqual({ orderId: 'o-2', attempts: 1 });
    });

    it('reads back what was just written, so an executor can build on it', () => {
      const ctx = onInit();
      ctx.setState({ orderId: 'o-1', attempts: 1 });
      expect(ctx.state).toEqual({ orderId: 'o-1', attempts: 1 });
    });

    it('takes a function given what is stored now', () => {
      const ctx = onFollowup({
        state: { schema: orderState, value: { orderId: 'o-1', attempts: 1 } },
      });
      ctx.setState((current) => ({
        ...current,
        attempts: current.attempts + 1,
      }));
      expect(ctx.state).toEqual({ orderId: 'o-1', attempts: 2 });
    });

    it('gives that function null on the first write', () => {
      const ctx = onInit();
      let seen: unknown = 'not called';
      ctx.setState((current) => {
        seen = current;
        return { orderId: 'o-1', attempts: 1 };
      });
      expect(seen).toBeNull();
    });

    it('reads back what the schema produced, not what was written', () => {
      const ctx = onInit({ state: { schema: withDefault, value: null } });
      ctx.setState({ orderId: 'o-1' });
      expect(ctx.state).toEqual({ orderId: 'o-1', currency: 'GBP' });
    });

    it('leaves the value it was given alone when something else is written', () => {
      const asRead = { orderId: 'o-1', attempts: 1 };
      const ctx = onFollowup({ state: { schema: orderState, value: asRead } });
      ctx.setState({ orderId: 'o-2', attempts: 2 });
      expect(asRead).toEqual({ orderId: 'o-1', attempts: 1 });
    });

    it('accepts anything JSON-shaped where the version declared no schema', () => {
      const ctx = onInit({ state: { schema: anyState, value: null } });
      ctx.setState({ seen: 1, at: ['a', null] } as never);
      expect(ctx.state).toEqual({});
    });
  });

  describe('writing state the schema rejects', () => {
    const rejected = () => {
      const ctx = onInit();
      try {
        ctx.setState({ orderId: 42 } as never);
      } catch (raised) {
        return raised as ArvoHandlerFault;
      }
      throw new Error('expected the write to be refused');
    };

    it('raises a fault rather than a bare error', () => {
      expect(rejected()).toBeInstanceOf(ArvoHandlerFault);
    });

    it('names the fault, so a mechanism need not read the message', () => {
      expect(rejected().faultKind).toBe('state_schema_rejected');
    });

    it('says what was wrong and where', () => {
      expect(rejected().message).toContain('orderId');
    });

    it('reports every rule the value broke, not only the first', () => {
      expect(rejected().violations.length).toBeGreaterThan(1);
    });

    it('names the delivery it happened on', () => {
      const fault = rejected();
      expect(fault.subject).toBe(initEvent.subject);
      expect(fault.eventId).toBe(initEvent.id);
      expect(fault.executionId).toBe(initEvent.executionid);
      expect(fault.attempt).toBe(0);
    });

    it('leaves the state as it was, a refused write changing nothing', () => {
      const ctx = onFollowup({
        state: { schema: orderState, value: { orderId: 'o-1', attempts: 1 } },
      });
      expect(() => ctx.setState({ orderId: 42 } as never)).toThrow(
        ArvoHandlerFault,
      );
      expect(ctx.state).toEqual({ orderId: 'o-1', attempts: 1 });
    });

    it('says (root) where the value itself is wrong, not one of its fields', () => {
      const ctx = onInit();
      try {
        ctx.setState('not an object at all' as never);
      } catch (raised) {
        expect((raised as ArvoHandlerFault).violations[0]).toContain('(root)');
        expect((raised as ArvoHandlerFault).message).toContain('(root)');
        return;
      }
      throw new Error('expected the write to be refused');
    });

    it('refuses a function that returns something rejected, the same way', () => {
      const ctx = onInit();
      expect(() => ctx.setState(() => ({ orderId: 42 }) as never)).toThrow(
        ArvoHandlerFault,
      );
    });
  });

  describe('what a caller cannot do to it', () => {
    it('is frozen', () => {
      expect(Object.isFrozen(onInit())).toBe(true);
    });

    it('still accepts a write once frozen, state not being a property of it', () => {
      const ctx = onInit();
      expect(Object.isFrozen(ctx)).toBe(true);
      ctx.setState({ orderId: 'o-1', attempts: 1 });
      expect(ctx.state).toEqual({ orderId: 'o-1', attempts: 1 });
    });

    it.each([
      'contracts',
      'entry',
      'event',
      'initEvent',
      'attempt',
      'stateSchema',
    ])('cannot have its %s replaced', (member) => {
      const ctx = onInit();
      expect(() => {
        (ctx as unknown as Record<string, unknown>)[member] = 'anything';
      }).toThrow();
    });

    it('cannot have state assigned directly, only written through setState', () => {
      const ctx = onInit();
      expect(() => {
        (ctx as unknown as Record<string, unknown>).state = { orderId: 'o-9' };
      }).toThrow();
    });

    it('cannot have its declared contracts replaced', () => {
      const ctx = onInit();
      expect(() => {
        (ctx.contracts as unknown as Record<string, unknown>).self =
          orderVersion;
      }).toThrow();
    });

    it('exposes nothing beyond what a delivery gives it', () => {
      expect(Object.keys(onInit()).sort()).toEqual([
        'attempt',
        'contracts',
        'dependencies',
        'entry',
        'event',
        'hooks',
        'initEvent',
        'stateSchema',
      ]);
    });
  });
});
