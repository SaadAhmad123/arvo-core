import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { ArvoContract } from '../../../src/ArvoContract/index.js';
import { ArvoDomain } from '../../../src/ArvoDomain/index.js';
import type { ArvoDomainInput } from '../../../src/ArvoDomain/types.js';
import { ArvoEvent } from '../../../src/ArvoEvent/index.js';
import { ArvoExecutionContext } from '../../../src/ArvoEventHandler/context/index.js';
import { ArvoHandlerFault } from '../../../src/ArvoEventHandler/fault/index.js';
import { ARVO_DEFAULT_HANDLER_OPTIONS } from '../../../src/ArvoEventHandler/helpers/defaults.js';
import { createInitArvoExecutionState } from '../../../src/ArvoEventHandler/state/factory.js';
import { cloneArvoEvent } from '../../../src/factories/cloneArvoEvent.js';
import {
  initEvent,
  orderVersion,
  paymentVersion,
  placeholderIdempotencyKeys,
  services,
  telemetry,
} from '../fixtures.js';

/** What an execution records against; these tests only carry it. */
const { telemetry: sharedTelemetry } = telemetry();

const orderData = z.object({ orderId: z.string(), attempts: z.number() });

const EXECUTION_ID = 'a'.repeat(64);
const PARENT_EXECUTION_ID = initEvent.executionid;

/** The factory reports rather than throws; a fixture wants the value. */
const openingContext = () => {
  const stateCreation = createInitArvoExecutionState<
    typeof orderVersion,
    typeof services,
    typeof orderData
  >({
    self: orderVersion,
    event: initEvent,
    executionId: EXECUTION_ID,
    parentExecutionId: PARENT_EXECUTION_ID,
  });
  if (!stateCreation.ok) throw stateCreation.error;
  return new ArvoExecutionContext({
    contracts: { self: orderVersion, services },
    state: stateCreation.value,
    entry: 'init',
    dataSchema: orderData,
    attempt: 0,
    telemetry: sharedTelemetry,
    options: ARVO_DEFAULT_HANDLER_OPTIONS,
    idempotency: placeholderIdempotencyKeys,
    dependencies: {},
    hooks: {},
  });
};

/** An event asking the declared payment service to do something. */
const serviceEvent = async (param: Record<string, unknown> = {}) =>
  openingContext().build({
    type: 'com_payment_charge',
    data: { amount: 10 },
    ...param,
  });

/** An event completing this execution back to whoever opened it. */
const completionEvent = async (param: Record<string, unknown> = {}) =>
  openingContext().build({
    type: 'com_order_created',
    data: { order_id: 'o-1' },
    ...param,
  });

describe('building an event to emit', async () => {
  it('produces an event', async () => {
    expect(await serviceEvent()).toBeInstanceOf(ArvoEvent);
  });

  describe('an event asking a service to do something', async () => {
    it('is addressed to that service', async () => {
      expect((await serviceEvent()).to).toBe(paymentVersion.type);
    });

    it('carries this execution as the one to reply to', async () => {
      expect((await serviceEvent()).executionid).toBe(EXECUTION_ID);
    });

    it('sits one deeper than this execution', async () => {
      expect((await serviceEvent()).depth).toBe(initEvent.depth + 1);
    });

    it('answers no request, not being a completion', async () => {
      expect((await serviceEvent()).initid).toBeNull();
    });

    it('opens something, and says so', async () => {
      expect((await serviceEvent()).category).toBe('io.arvo.init');
    });

    it('is validated against that service contract', async () => {
      expect((await serviceEvent()).dataschema).toBe(paymentVersion.dataschema);
      expect((await serviceEvent()).data).toEqual({ amount: 10 });
    });
  });

  describe('an event completing this execution', async () => {
    it('is addressed to whoever opened the execution', async () => {
      expect((await completionEvent()).to).toBe(initEvent.source);
    });

    it('carries the caller as the one to reply to', async () => {
      expect((await completionEvent()).executionid).toBe(PARENT_EXECUTION_ID);
    });

    it('sits where this execution sits', async () => {
      expect((await completionEvent()).depth).toBe(initEvent.depth);
    });

    it('names the request it answers', async () => {
      expect((await completionEvent()).initid).toBe(initEvent.id);
    });

    it('completes something, and says so', async () => {
      expect((await completionEvent()).category).toBe('io.arvo.complete');
    });

    it('is validated against this version of the implemented contract', async () => {
      expect((await completionEvent()).dataschema).toBe(
        orderVersion.dataschema,
      );
    });
  });

  describe('what both carry', async () => {
    it('stays in the same workflow', async () => {
      expect((await serviceEvent()).subject).toBe(initEvent.subject);
      expect((await completionEvent()).subject).toBe(initEvent.subject);
    });

    it('names this handler as where it came from', async () => {
      expect((await serviceEvent()).source).toBe(orderVersion.type);
      expect((await completionEvent()).source).toBe(orderVersion.type);
    });

    it('names the event that caused it as its parent', async () => {
      expect((await serviceEvent()).parentid).toBe(initEvent.id);
      expect((await completionEvent()).parentid).toBe(initEvent.id);
    });

    it('costs nothing until something says otherwise', async () => {
      expect((await serviceEvent()).executionunits).toBe(0);
    });

    it('is given an id of its own', async () => {
      expect((await serviceEvent()).id).not.toBe((await serviceEvent()).id);
    });
  });

  describe('a type this version may not emit', async () => {
    const refusedTypeFault = async (type: string, data: unknown = {}) => {
      try {
        await openingContext().build({ type, data } as never);
      } catch (thrown) {
        return thrown as ArvoHandlerFault;
      }
      throw new Error('expected the emission to be refused');
    };

    it('raises a fault', async () => {
      expect(await refusedTypeFault('com_nothing_declared')).toBeInstanceOf(
        ArvoHandlerFault,
      );
    });

    it('names it as an emission the version may not make', async () => {
      expect((await refusedTypeFault('com_nothing_declared')).faultKind).toBe(
        'emission_not_permitted',
      );
    });

    it('says which type was asked for', async () => {
      expect(
        (await refusedTypeFault('com_nothing_declared')).message,
      ).toContain('com_nothing_declared');
    });

    it('refuses the handler error type, an executor having no means to emit one', async () => {
      expect((await refusedTypeFault(orderVersion.error.type)).faultKind).toBe(
        'emission_not_permitted',
      );
    });

    it('refuses this version input type, which it receives rather than sends', async () => {
      expect((await refusedTypeFault(orderVersion.type)).faultKind).toBe(
        'emission_not_permitted',
      );
    });
  });

  describe('a payload the schema refuses', async () => {
    const rejectedPayloadFault = async () => {
      try {
        await openingContext().build({
          type: 'com_payment_charge',
          data: { amount: 'ten' },
        } as never);
      } catch (thrown) {
        return thrown as ArvoHandlerFault;
      }
      throw new Error('expected the emission to be refused');
    };

    it('raises a fault', async () => {
      expect(await rejectedPayloadFault()).toBeInstanceOf(ArvoHandlerFault);
    });

    it('names it as a payload the schema would not take', async () => {
      expect((await rejectedPayloadFault()).faultKind).toBe(
        'emission_schema_rejected',
      );
    });

    it('says what was wrong with it', async () => {
      expect((await rejectedPayloadFault()).message).toContain('amount');
    });
  });

  describe('what an executor may set outright', async () => {
    it('takes a processing path', async () => {
      expect((await serviceEvent({ domain: 'analytics' })).domain).toBe(
        'analytics',
      );
    });

    it('takes a cost figure', async () => {
      expect((await serviceEvent({ executionunits: 12 })).executionunits).toBe(
        12,
      );
    });
  });

  describe('what it may set only through the unsafe surface', async () => {
    it('takes a reply path it was not given', async () => {
      const event = await serviceEvent({
        unsafe: { executionid: 'somewhere-else' },
      });
      expect(event.executionid).toBe('somewhere-else');
    });

    it('takes a destination it was not given', async () => {
      expect((await serviceEvent({ unsafe: { to: 'com.elsewhere' } })).to).toBe(
        'com.elsewhere',
      );
    });

    it('takes a depth it was not given, even a wrong one', async () => {
      expect((await serviceEvent({ unsafe: { depth: 99 } })).depth).toBe(99);
    });

    it('leaves the defaults alone where nothing was set', async () => {
      expect((await serviceEvent({ unsafe: {} })).to).toBe(paymentVersion.type);
    });
  });

  describe('what it gives back, read without a cast', async () => {
    it('is typed by the type it was asked for', async () => {
      const charge = await openingContext().build({
        type: 'com_payment_charge',
        data: { amount: 10 },
      });
      expectTypeOf(charge.type).toEqualTypeOf<'com_payment_charge'>();
      expectTypeOf(charge.data).toEqualTypeOf<{ amount: number }>();
      expect(charge.data.amount).toBe(10);
    });

    it('is typed by that type on a completion too', async () => {
      const completion = await openingContext().build({
        type: 'com_order_created',
        data: { order_id: 'o-1' },
      });
      expectTypeOf(completion.type).toEqualTypeOf<'com_order_created'>();
      expectTypeOf(completion.data).toEqualTypeOf<{ order_id: string }>();
      expect(completion.data.order_id).toBe('o-1');
    });
  });
});

describe('which processing path an emitted event takes', () => {
  /** A handler whose own contract declares where its traffic belongs. */
  const reviewedOrder = new ArvoContract({
    type: 'com_order_create',
    domain: 'orders',
    versions: {
      '1.0.0': {
        input: z.object({ items: z.array(z.string()) }),
        outputs: { com_order_created: z.object({ order_id: z.string() }) },
      },
    },
  }).versions['1.0.0'];

  /** A service that can only be fulfilled off the lattice. */
  const manualReview = new ArvoContract({
    type: 'com_manual_review',
    domain: 'human',
    versions: {
      '1.0.0': {
        input: z.object({ order_id: z.string() }),
        outputs: { evt_review_done: z.object({ approved: z.boolean() }) },
      },
    },
  }).versions['1.0.0'];

  /** An execution of the domained contract, triggered by a domained event. */
  const reviewingContext = () => {
    const triggeringEvent = cloneArvoEvent(initEvent, {
      dataschema: reviewedOrder.dataschema,
      domain: 'inherited',
    });
    const stateCreation = createInitArvoExecutionState<
      typeof reviewedOrder,
      { review: typeof manualReview },
      typeof orderData
    >({
      self: reviewedOrder,
      event: triggeringEvent,
      executionId: EXECUTION_ID,
      parentExecutionId: PARENT_EXECUTION_ID,
    });
    if (!stateCreation.ok) throw stateCreation.error;
    return new ArvoExecutionContext({
      contracts: { self: reviewedOrder, services: { review: manualReview } },
      state: stateCreation.value,
      entry: 'init',
      dataSchema: orderData,
      attempt: 0,
      telemetry: sharedTelemetry,
      options: ARVO_DEFAULT_HANDLER_OPTIONS,
      idempotency: placeholderIdempotencyKeys,
      dependencies: {},
      hooks: {},
    });
  };

  const buildReviewRequest = async (domain?: ArvoDomainInput) =>
    reviewingContext().build({
      type: 'com_manual_review',
      data: { order_id: 'o-1' },
      ...(domain === undefined ? {} : { domain }),
    });

  it('stays on the lattice where nothing asked otherwise', async () => {
    expect((await buildReviewRequest()).domain).toBeNull();
  });

  it('takes the path named outright', async () => {
    expect((await buildReviewRequest('escalations')).domain).toBe(
      'escalations',
    );
  });

  it('takes the path the contract it is built from declares', async () => {
    expect(
      (await buildReviewRequest(ArvoDomain.FROM_EVENT_CONTRACT)).domain,
    ).toBe('human');
  });

  it('takes the path this handler own contract declares', async () => {
    expect(
      (await buildReviewRequest(ArvoDomain.FROM_SELF_CONTRACT)).domain,
    ).toBe('orders');
  });

  it('takes the path the event that caused this execution came on', async () => {
    expect(
      (await buildReviewRequest(ArvoDomain.FROM_TRIGGERING_EVENT)).domain,
    ).toBe('inherited');
  });

  it('stays on the lattice where that is asked for outright', async () => {
    expect((await buildReviewRequest(ArvoDomain.LOCAL)).domain).toBeNull();
  });

  it('carries a value, never the symbol that named it', async () => {
    const reviewRequest = await buildReviewRequest(
      ArvoDomain.FROM_SELF_CONTRACT,
    );
    expect(typeof reviewRequest.domain).toBe('string');
    expect(JSON.parse(JSON.stringify({ ...reviewRequest })).domain).toBe(
      'orders',
    );
  });

  it('answers the caller on the same path, where the completion asks for it', async () => {
    const completion = await reviewingContext().build({
      type: 'com_order_created',
      data: { order_id: 'o-1' },
      domain: ArvoDomain.FROM_SELF_CONTRACT,
    });
    expect(completion.domain).toBe('orders');
  });
});
