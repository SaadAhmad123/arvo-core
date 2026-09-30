import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { ArvoEvent } from '../../../src/ArvoEvent/index.js';
import { createInitArvoExecutionContext } from '../../../src/ArvoEventHandler/context/factory.js';
import { ArvoHandlerFault } from '../../../src/ArvoEventHandler/fault/index.js';
import { ARVO_DEFAULT_HANDLER_OPTIONS } from '../../../src/ArvoEventHandler/helpers/defaults.js';
import {
  initEvent,
  orderContract,
  orderVersion,
  paymentVersion,
  services,
} from '../fixtures.js';

const orderData = z.object({ orderId: z.string(), attempts: z.number() });

const EXECUTION_ID = 'a'.repeat(64);
const PARENT_EXECUTION_ID = initEvent.executionid;

/** The factory reports rather than throws; a fixture wants the value. */
const ctx = () => {
  const opened = createInitArvoExecutionContext({
    contracts: { self: orderVersion, services },
    event: initEvent,
    executionId: EXECUTION_ID,
    parentExecutionId: PARENT_EXECUTION_ID,
    contractsSnapshot: {
      self: { uri: orderContract.uri, type: orderContract.type },
      services: [],
    },
    dataSchema: orderData,
    attempt: 0,
    options: ARVO_DEFAULT_HANDLER_OPTIONS,
    dependencies: {},
    hooks: {},
  });
  if (!opened.ok) throw opened.error;
  return opened.value;
};

/** An event asking the declared payment service to do something. */
const toService = async (param: Record<string, unknown> = {}) =>
  ctx().build({
    type: 'com_payment_charge',
    data: { amount: 10 },
    ...param,
  });

/** An event completing this execution back to whoever opened it. */
const toCaller = async (param: Record<string, unknown> = {}) =>
  ctx().build({
    type: 'com_order_created',
    data: { order_id: 'o-1' },
    ...param,
  });

describe('building an event to emit', async () => {
  it('produces an event', async () => {
    expect(await toService()).toBeInstanceOf(ArvoEvent);
  });

  describe('an event asking a service to do something', async () => {
    it('is addressed to that service', async () => {
      expect((await toService()).to).toBe(paymentVersion.type);
    });

    it('carries this execution as the one to reply to', async () => {
      expect((await toService()).executionid).toBe(EXECUTION_ID);
    });

    it('sits one deeper than this execution', async () => {
      expect((await toService()).depth).toBe(initEvent.depth + 1);
    });

    it('answers no request, not being a completion', async () => {
      expect((await toService()).initid).toBeNull();
    });

    it('opens something, and says so', async () => {
      expect((await toService()).category).toBe('io.arvo.init');
    });

    it('is validated against that service contract', async () => {
      expect((await toService()).dataschema).toBe(paymentVersion.dataschema);
      expect((await toService()).data).toEqual({ amount: 10 });
    });
  });

  describe('an event completing this execution', async () => {
    it('is addressed to whoever opened the execution', async () => {
      expect((await toCaller()).to).toBe(initEvent.source);
    });

    it('carries the caller as the one to reply to', async () => {
      expect((await toCaller()).executionid).toBe(PARENT_EXECUTION_ID);
    });

    it('sits where this execution sits', async () => {
      expect((await toCaller()).depth).toBe(initEvent.depth);
    });

    it('names the request it answers', async () => {
      expect((await toCaller()).initid).toBe(initEvent.id);
    });

    it('completes something, and says so', async () => {
      expect((await toCaller()).category).toBe('io.arvo.complete');
    });

    it('is validated against this version of the implemented contract', async () => {
      expect((await toCaller()).dataschema).toBe(orderVersion.dataschema);
    });
  });

  describe('what both carry', async () => {
    it('stays in the same workflow', async () => {
      expect((await toService()).subject).toBe(initEvent.subject);
      expect((await toCaller()).subject).toBe(initEvent.subject);
    });

    it('names this handler as where it came from', async () => {
      expect((await toService()).source).toBe(orderVersion.type);
      expect((await toCaller()).source).toBe(orderVersion.type);
    });

    it('names the event that caused this delivery as its parent', async () => {
      expect((await toService()).parentid).toBe(initEvent.id);
      expect((await toCaller()).parentid).toBe(initEvent.id);
    });

    it('costs nothing until something says otherwise', async () => {
      expect((await toService()).executionunits).toBe(0);
    });

    it('is given an id of its own', async () => {
      expect((await toService()).id).not.toBe((await toService()).id);
    });
  });

  describe('a type this version may not emit', async () => {
    const refused = async (type: string, data: unknown = {}) => {
      try {
        await ctx().build({ type, data } as never);
      } catch (raised) {
        return raised as ArvoHandlerFault;
      }
      throw new Error('expected the emission to be refused');
    };

    it('raises a fault', async () => {
      expect(await refused('com_nothing_declared')).toBeInstanceOf(
        ArvoHandlerFault,
      );
    });

    it('names it as an emission the version may not make', async () => {
      expect((await refused('com_nothing_declared')).faultKind).toBe(
        'emission_not_permitted',
      );
    });

    it('says which type was asked for', async () => {
      expect((await refused('com_nothing_declared')).message).toContain(
        'com_nothing_declared',
      );
    });

    it('refuses the handler error type, an executor having no means to emit one', async () => {
      expect((await refused(orderVersion.error.type)).faultKind).toBe(
        'emission_not_permitted',
      );
    });

    it('refuses this version input type, which it receives rather than sends', async () => {
      expect((await refused(orderVersion.type)).faultKind).toBe(
        'emission_not_permitted',
      );
    });
  });

  describe('a payload the schema refuses', async () => {
    const refused = async () => {
      try {
        await ctx().build({
          type: 'com_payment_charge',
          data: { amount: 'ten' },
        } as never);
      } catch (raised) {
        return raised as ArvoHandlerFault;
      }
      throw new Error('expected the emission to be refused');
    };

    it('raises a fault', async () => {
      expect(await refused()).toBeInstanceOf(ArvoHandlerFault);
    });

    it('names it as a payload the schema would not take', async () => {
      expect((await refused()).faultKind).toBe('emission_schema_rejected');
    });

    it('says what was wrong with it', async () => {
      expect((await refused()).message).toContain('amount');
    });
  });

  describe('what an executor may set outright', async () => {
    it('takes a processing path', async () => {
      expect((await toService({ domain: 'analytics' })).domain).toBe(
        'analytics',
      );
    });

    it('takes a cost figure', async () => {
      expect((await toService({ executionunits: 12 })).executionunits).toBe(12);
    });
  });

  describe('what it may set only through the unsafe surface', async () => {
    it('takes a reply path it was not given', async () => {
      const event = await toService({
        unsafe: { executionid: 'somewhere-else' },
      });
      expect(event.executionid).toBe('somewhere-else');
    });

    it('takes a destination it was not given', async () => {
      expect((await toService({ unsafe: { to: 'com.elsewhere' } })).to).toBe(
        'com.elsewhere',
      );
    });

    it('takes a depth it was not given, even a wrong one', async () => {
      expect((await toService({ unsafe: { depth: 99 } })).depth).toBe(99);
    });

    it('leaves the defaults alone where nothing was set', async () => {
      expect((await toService({ unsafe: {} })).to).toBe(paymentVersion.type);
    });
  });

  describe('what it gives back, read without a cast', async () => {
    it('is typed by the type it was asked for', async () => {
      const charge = await ctx().build({
        type: 'com_payment_charge',
        data: { amount: 10 },
      });
      expectTypeOf(charge.type).toEqualTypeOf<'com_payment_charge'>();
      expectTypeOf(charge.data).toEqualTypeOf<{ amount: number }>();
      expect(charge.data.amount).toBe(10);
    });

    it('is typed by that type on a completion too', async () => {
      const done = await ctx().build({
        type: 'com_order_created',
        data: { order_id: 'o-1' },
      });
      expectTypeOf(done.type).toEqualTypeOf<'com_order_created'>();
      expectTypeOf(done.data).toEqualTypeOf<{ order_id: string }>();
      expect(done.data.order_id).toBe('o-1');
    });
  });
});
