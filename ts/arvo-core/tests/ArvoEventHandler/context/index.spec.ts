import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoEvent } from '../../../src/ArvoEvent/index.js';
import { ArvoExecutionContext } from '../../../src/ArvoEventHandler/context/index.js';
import { ArvoHandlerFault } from '../../../src/ArvoEventHandler/fault/index.js';
import { ARVO_DEFAULT_HANDLER_OPTIONS } from '../../../src/ArvoEventHandler/helpers/defaults.js';
import { ArvoExecutionState } from '../../../src/ArvoEventHandler/state/index.js';
import {
  chargedEvent,
  initEvent,
  orderContract,
  orderVersion,
  paymentFailedEvent,
  services,
} from '../fixtures.js';

/** What a version declares when it remembers something specific. */
const orderData = z.object({ orderId: z.string(), attempts: z.number() });

/** What a version that declares nothing of its own is given instead. */
const anyData = z.looseObject({});

/** A schema that fills something in, to show a write reads back as parsed. */
const withDefault = z.object({
  orderId: z.string(),
  currency: z.string().default('GBP'),
});

const record = (overrides: Record<string, unknown> = {}) =>
  new ArvoExecutionState({
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
    inFlightEventMap: new Map(),
    recordFormatVersion: '1.0.0',
    casVersion: 0,
    contracts: {
      self: { uri: orderContract.uri, type: orderContract.type },
      services: [],
    },
    ...overrides,
  } as never);

const base = {
  contracts: { self: orderVersion, services },
  dataSchema: orderData,
  attempt: 0,
  options: ARVO_DEFAULT_HANDLER_OPTIONS,
  dependencies: {},
  hooks: {},
};

const onInit = (overrides: Record<string, unknown> = {}) =>
  new ArvoExecutionContext({
    ...base,
    entry: 'init',
    state: record(),
    ...overrides,
  } as never);

const onFollowup = (overrides: Record<string, unknown> = {}) =>
  new ArvoExecutionContext({
    ...base,
    entry: 'followup',
    state: record({ triggeringEvent: chargedEvent }),
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

    it('carries which attempt this is', () => {
      expect(onInit({ attempt: 2 }).attempt).toBe(2);
    });
  });

  describe('reading the delivery through what is remembered', () => {
    it('reaches the delivered event there', () => {
      expect(onFollowup().state.triggeringEvent).toBe(chargedEvent);
    });

    it('reaches a service handler error there like any other event', () => {
      const ctx = onFollowup({
        state: record({ triggeringEvent: paymentFailedEvent }),
      });
      expect(ctx.state.triggeringEvent).toBe(paymentFailedEvent);
    });

    it('reaches the event that opened the execution there', () => {
      expect(onFollowup().state.initEvent).toBe(initEvent);
    });

    it('finds one event as both on an init delivery', () => {
      const ctx = onInit();
      expect(ctx.state.triggeringEvent).toBe(ctx.state.initEvent);
    });

    it('reports neither of them a second time on the context itself', () => {
      const ctx = onInit() as unknown as Record<string, unknown>;
      expect(ctx.event).toBeUndefined();
      expect(ctx.initEvent).toBeUndefined();
    });

    it('reaches the rest of what the execution knows there', () => {
      const ctx = onInit();
      expect(ctx.state.lifecycle).toBe('waiting');
      expect(ctx.state.depth).toBe(0);
      expect(ctx.state.casVersion).toBe(0);
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
      expect(onInit().dataSchema).toBe(orderData);
      expect(onInit({ dataSchema: anyData }).dataSchema).toBe(anyData);
    });

    it('is a record, not a bare payload', () => {
      expect(onInit().state).toBeInstanceOf(ArvoExecutionState);
    });

    it('has no data on an execution that has written nothing', () => {
      expect(onInit().state.data).toBeNull();
    });

    it('has what a followup found stored', () => {
      const stored = { orderId: 'o-1', attempts: 1 };
      const ctx = onFollowup({ state: record({ data: stored }) });
      expect(ctx.state.data).toBe(stored);
    });
  });

  describe('writing state', () => {
    it('replaces the data whole, with no merge', () => {
      const ctx = onFollowup({
        state: record({ data: { orderId: 'o-1', attempts: 9 } }),
      });
      ctx.setState({ data: { orderId: 'o-2', attempts: 1 } });
      expect(ctx.state.data).toEqual({ orderId: 'o-2', attempts: 1 });
    });

    it('reads back what was just written, so an executor can build on it', () => {
      const ctx = onInit();
      ctx.setState({ data: { orderId: 'o-1', attempts: 1 } });
      expect(ctx.state.data).toEqual({ orderId: 'o-1', attempts: 1 });
    });

    it('takes a function given what is remembered now', () => {
      const ctx = onFollowup({
        state: record({ data: { orderId: 'o-1', attempts: 1 } }),
      });
      ctx.setState({
        data: (current) => ({ ...current, attempts: current.attempts + 1 }),
      });
      expect(ctx.state.data).toEqual({ orderId: 'o-1', attempts: 2 });
    });

    it('gives that function null on the first write', () => {
      const ctx = onInit();
      let seen: unknown = 'not called';
      ctx.setState({
        data: (current) => {
          seen = current;
          return { orderId: 'o-1', attempts: 1 };
        },
      });
      expect(seen).toBeNull();
    });

    it('reads back what the schema produced, not what was written', () => {
      const ctx = onInit({ dataSchema: withDefault });
      ctx.setState({ data: { orderId: 'o-1' } });
      expect(ctx.state.data).toEqual({ orderId: 'o-1', currency: 'GBP' });
    });

    it('accepts anything JSON-shaped where the version declared no schema', () => {
      const ctx = onInit({ dataSchema: anyData });
      ctx.setState({ data: { seen: 1, at: ['a', null] } as never });
      expect(ctx.state.data).toEqual({ seen: 1, at: ['a', null] });
    });
  });

  describe('what a write does to the record', () => {
    it('mints a new record rather than changing the one it had', () => {
      const ctx = onInit();
      const before = ctx.state;
      ctx.setState({ data: { orderId: 'o-1', attempts: 1 } });
      expect(ctx.state).not.toBe(before);
      expect(before.data).toBeNull();
    });

    it('carries everything else across untouched', () => {
      const ctx = onInit();
      const before = ctx.state;
      ctx.setState({ data: { orderId: 'o-1', attempts: 1 } });

      expect(ctx.state.subject).toBe(before.subject);
      expect(ctx.state.executionId).toBe(before.executionId);
      expect(ctx.state.lifecycle).toBe(before.lifecycle);
      expect(ctx.state.casVersion).toBe(before.casVersion);
      expect(ctx.state.eventIds).toEqual(before.eventIds);
      expect(ctx.state.initEvent).toBe(before.initEvent);
      expect(ctx.state.triggeringEvent).toBe(before.triggeringEvent);
    });

    it('leaves the record it was given alone across two writes', () => {
      const ctx = onInit();
      const first = ctx.state;
      ctx.setState({ data: { orderId: 'o-1', attempts: 1 } });
      ctx.setState({ data: { orderId: 'o-2', attempts: 2 } });
      expect(first.data).toBeNull();
      expect(ctx.state.data).toEqual({ orderId: 'o-2', attempts: 2 });
    });
  });

  describe('writing state the schema rejects', () => {
    const rejected = () => {
      const ctx = onInit();
      try {
        ctx.setState({ data: { orderId: 42 } as never });
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

    it('leaves what is remembered as it was, a refused write changing nothing', () => {
      const ctx = onFollowup({
        state: record({ data: { orderId: 'o-1', attempts: 1 } }),
      });
      const before = ctx.state;
      expect(() => ctx.setState({ data: { orderId: 42 } as never })).toThrow(
        ArvoHandlerFault,
      );
      expect(ctx.state).toBe(before);
      expect(ctx.state.data).toEqual({ orderId: 'o-1', attempts: 1 });
    });

    it('says (root) where the value itself is wrong, not one of its fields', () => {
      const ctx = onInit();
      try {
        ctx.setState({ data: 'not an object at all' as never });
      } catch (raised) {
        expect((raised as ArvoHandlerFault).violations[0]).toContain('(root)');
        expect((raised as ArvoHandlerFault).message).toContain('(root)');
        return;
      }
      throw new Error('expected the write to be refused');
    });

    it('carries the event a caller would be sent if this were abandoned', () => {
      expect(rejected().abandonmentEvent).toBeInstanceOf(ArvoEvent);
    });

    it('addresses that event to whoever opened the execution', () => {
      const event = rejected().abandonmentEvent as ArvoEvent;
      expect(event.to).toBe(initEvent.source);
      expect(event.executionid).toBe(initEvent.executionid);
      expect(event.subject).toBe(initEvent.subject);
    });

    it('makes it this version handler error, so a caller can read it', () => {
      const event = rejected().abandonmentEvent as ArvoEvent;
      expect(event.type).toBe(orderVersion.error.type);
      expect(event.dataschema).toBe(orderVersion.dataschema);
    });

    it('completes rather than opening anything, so it carries the init event', () => {
      const event = rejected().abandonmentEvent as ArvoEvent;
      expect(event.initid).toBe(initEvent.id);
      expect(event.depth).toBe(0);
    });

    it('says in that event what went wrong', () => {
      const event = rejected().abandonmentEvent as ArvoEvent;
      expect(event.data.error_message).toContain('orderId');
    });

    it('carries the record a mechanism would commit alongside it', () => {
      expect(rejected().abandonmentState).toBeInstanceOf(ArvoExecutionState);
    });

    it('marks that record failed, carrying the fault own message as the reason', () => {
      const fault = rejected();
      const state = fault.abandonmentState as ArvoExecutionState;
      expect(state.lifecycle).toBe('failure');
      expect(state.lifecycleDescription).toBe(fault.message);
    });

    it('logs the abandonment event on that record as emitted', () => {
      const fault = rejected();
      const state = fault.abandonmentState as ArvoExecutionState;
      expect(state.eventIds.at(-1)).toEqual({
        id: (fault.abandonmentEvent as ArvoEvent).id,
        direction: 'emitted',
      });
    });

    it('advances that record revision, it being a write like any other', () => {
      const state = rejected().abandonmentState as ArvoExecutionState;
      expect(state.casVersion).toBe(1);
    });

    it('leaves the rest of that record as the execution stood', () => {
      const ctx = onFollowup({
        state: record({ data: { orderId: 'o-1', attempts: 1 } }),
      });
      let fault: ArvoHandlerFault | undefined;
      try {
        ctx.setState({ data: { orderId: 42 } as never });
      } catch (raised) {
        fault = raised as ArvoHandlerFault;
      }
      const abandoned = fault?.abandonmentState as ArvoExecutionState;
      expect(abandoned.data).toEqual({ orderId: 'o-1', attempts: 1 });
      expect(abandoned.executionId).toBe(ctx.state.executionId);
    });

    it('carries no event where one could not be built, the fault still raised', () => {
      const ctx = onInit({ state: record({ source: 'not a valid source!!' }) });
      let fault: ArvoHandlerFault | undefined;
      try {
        ctx.setState({ data: { orderId: 42 } as never });
      } catch (raised) {
        fault = raised as ArvoHandlerFault;
      }
      expect(fault).toBeInstanceOf(ArvoHandlerFault);
      expect(fault?.abandonmentEvent).toBeNull();
      expect(fault?.abandonmentState).toBeInstanceOf(ArvoExecutionState);
    });

    it('does not abandon anything by being raised', () => {
      const ctx = onInit();
      const before = ctx.state;
      expect(() => ctx.setState({ data: { orderId: 42 } as never })).toThrow();
      expect(ctx.state).toBe(before);
      expect(ctx.state.lifecycle).toBe('waiting');
    });

    it('refuses a function that returns something rejected, the same way', () => {
      const ctx = onInit();
      expect(() =>
        ctx.setState({ data: () => ({ orderId: 42 }) as never }),
      ).toThrow(ArvoHandlerFault);
    });
  });

  describe('what a caller cannot do to it', () => {
    it('is frozen', () => {
      expect(Object.isFrozen(onInit())).toBe(true);
    });

    it('still accepts a write once frozen, state not being a property of it', () => {
      const ctx = onInit();
      expect(Object.isFrozen(ctx)).toBe(true);
      ctx.setState({ data: { orderId: 'o-1', attempts: 1 } });
      expect(ctx.state.data).toEqual({ orderId: 'o-1', attempts: 1 });
    });

    it.each(['contracts', 'entry', 'attempt', 'dataSchema'])(
      'cannot have its %s replaced',
      (member) => {
        const ctx = onInit();
        expect(() => {
          (ctx as unknown as Record<string, unknown>)[member] = 'anything';
        }).toThrow();
      },
    );

    it('cannot have state assigned directly, only written through setState', () => {
      const ctx = onInit();
      expect(() => {
        (ctx as unknown as Record<string, unknown>).state = record();
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
        'dataSchema',
        'dependencies',
        'entry',
        'hooks',
        'options',
      ]);
    });
  });

  describe("raising a fault of an executor's own", () => {
    const raised = (param: Record<string, unknown> = {}) =>
      onFollowup().fault({
        faultKind: 'executor_raised',
        message: 'the payment gateway refused the charge',
        ...param,
      } as never);

    it('builds a fault rather than throwing one, so a caller decides where it leaves from', () => {
      expect(raised()).toBeInstanceOf(ArvoHandlerFault);
    });

    it('says which fault it is, and what went wrong', () => {
      const fault = raised();
      expect(fault.faultKind).toBe('executor_raised');
      expect(fault.message).toBe('the payment gateway refused the charge');
    });

    it('fills in the delivery, so an executor says only what failed', () => {
      const fault = raised();
      expect(fault.subject).toBe(initEvent.subject);
      expect(fault.executionId).toBe(initEvent.executionid);
      expect(fault.eventId).toBe(chargedEvent.id);
      expect(fault.attempt).toBe(0);
    });

    it('carries what underlies it where that was said', () => {
      expect(raised({ cause: 'HTTP 402' }).cause).toBe('HTTP 402');
    });

    it('carries nothing underneath where nothing was said', () => {
      expect(raised().cause).toBeNull();
    });

    it('carries the checks that failed where those were collected', () => {
      expect(raised({ violations: ['amount: too large'] }).violations).toEqual([
        'amount: too large',
      ]);
    });

    it('carries none where none were collected', () => {
      expect(raised().violations).toEqual([]);
    });

    it('says another attempt is due, an executor fault being retry safe by default', () => {
      const fault = raised();
      expect(fault.retry?.maxRetryAttemptsAllowed).toBe(3);
      expect(fault.retry?.retryInMs).toBe(300);
      expect(fault.retry?.retryAt).toBe(fault.timestamp + 300);
    });

    it('says none is in prospect where the executor said not', () => {
      expect(raised({ retryable: false }).retry).toBeNull();
    });

    it('carries what the execution would be abandoned with', () => {
      const fault = raised();
      expect(fault.abandonmentEvent).toBeInstanceOf(ArvoEvent);
      expect(fault.abandonmentState).toBeInstanceOf(ArvoExecutionState);
    });

    it('abandons nothing by being built', () => {
      const ctx = onFollowup();
      const before = ctx.state;
      ctx.fault({ faultKind: 'executor_raised', message: 'no' });
      expect(ctx.state).toBe(before);
      expect(ctx.state.lifecycle).toBe('waiting');
    });
  });
});
