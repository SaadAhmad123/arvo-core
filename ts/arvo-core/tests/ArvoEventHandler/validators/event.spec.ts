import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoContract } from '../../../src/ArvoContract/index.js';
import { ArvoEventValidator } from '../../../src/ArvoEventHandler/validators/event/index.js';
import { createArvoEventFactory } from '../../../src/factories/ArvoEventFactory/index.js';
import { mutateArvoEvent } from '../../../src/factories/mutateArvoEvent.js';
import {
  chargedEvent,
  initEvent,
  orderContract,
  paymentContract,
  paymentVersion,
} from '../fixtures.js';

/** A second version of the implemented contract, so resolution has a choice. */
const twoVersionContract = new ArvoContract({
  type: 'com_order_create',
  versions: {
    '1.0.0': {
      input: z.object({ items: z.array(z.string()) }),
      outputs: { com_order_created: z.object({ order_id: z.string() }) },
    },
    '1.1.0': {
      input: z.object({ items: z.array(z.string()), rush: z.boolean() }),
      outputs: { com_order_shipped: z.object({ eta: z.string() }) },
    },
  },
});

const orderValidator = new ArvoEventValidator({
  contracts: { self: orderContract, services: { payments: paymentVersion } },
});

const twoVersionValidator = new ArvoEventValidator({
  contracts: {
    self: twoVersionContract,
    services: { payments: paymentVersion },
  },
});

describe('where an event arriving came from', () => {
  it('is the contract implemented, for one it takes in', () => {
    const origin = orderValidator.validateInput(initEvent);
    expect(origin.ok && origin.value).toMatchObject({
      source: 'self',
      version: '1.0.0',
    });
  });

  it('is the service, for an event one answers with', () => {
    const origin = orderValidator.validateInput(chargedEvent);
    expect(origin.ok && origin.value).toMatchObject({
      source: 'service',
      version: '1.0.0',
    });
  });

  it("is the service, for that service's handler error", () => {
    const handlerErrorEvent = createArvoEventFactory(
      paymentVersion,
    ).createError({
      source: 'com.payment.service',
      subject: initEvent.subject,
      error: new Error('card declined'),
    });
    const origin = orderValidator.validateInput(handlerErrorEvent);
    expect(origin.ok && origin.value.source).toBe('service');
  });

  it('is the version the event names, not one it was told', () => {
    const rushOrderEvent = createArvoEventFactory(
      twoVersionContract.versions['1.1.0'],
    ).createInput({
      source: 'com.web.checkout',
      subject: 'order-9',
      data: { items: ['book'], rush: true },
    });
    const origin = twoVersionValidator.validateInput(rushOrderEvent);
    expect(origin.ok && origin.value.version).toBe('1.1.0');
  });
});

describe('an event that could not have arrived', () => {
  const inputRefusal = (
    event: Parameters<typeof orderValidator.validateInput>[0],
  ) => {
    const validation = orderValidator.validateInput(event);
    if (validation.ok) throw new Error('expected the event to be refused');
    return validation.error;
  };

  it('names no contract this handler declared', () => {
    const strangerEvent = mutateArvoEvent(initEvent, {
      dataschema: '#/com/elsewhere/1.0.0',
    });
    expect(inputRefusal(strangerEvent).faultKind).toBe('event_unclassifiable');
  });

  it('says what it should have named', () => {
    const strangerEvent = mutateArvoEvent(initEvent, {
      dataschema: '#/com/elsewhere/1.0.0',
    });
    expect(inputRefusal(strangerEvent).issues[0]?.path).toBe('dataschema');
    expect(inputRefusal(strangerEvent).message).toContain(orderContract.uri);
  });

  it('is a version of the implemented contract that does not exist', () => {
    const futureVersionEvent = mutateArvoEvent(initEvent, {
      dataschema: `${orderContract.uri}/9.9.9`,
    });
    expect(inputRefusal(futureVersionEvent).faultKind).toBe(
      'event_unclassifiable',
    );
  });

  it('is not the type the implemented contract takes in', () => {
    const orderCreatedEvent = createArvoEventFactory(
      orderContract.versions['1.0.0'],
    ).createOutput({
      type: 'com_order_created',
      source: 'com.order.service',
      subject: initEvent.subject,
      data: { order_id: 'o-1' },
    });
    expect(inputRefusal(orderCreatedEvent).faultKind).toBe(
      'type_not_receivable',
    );
  });

  it('is not a type that service ever answers with', () => {
    const unknownTypeEvent = mutateArvoEvent(chargedEvent, {
      type: 'evt_unknown' as never,
    });
    expect(inputRefusal(unknownTypeEvent).faultKind).toBe(
      'type_not_receivable',
    );
    expect(inputRefusal(unknownTypeEvent).message).toContain(
      paymentContract.uri,
    );
  });

  it('carries a payload the schema refuses', () => {
    const badPayloadEvent = mutateArvoEvent(initEvent, {
      data: { items: 'not a list' } as never,
    });
    expect(inputRefusal(badPayloadEvent).faultKind).toBe(
      'event_schema_rejected',
    );
    expect(inputRefusal(badPayloadEvent).issues[0]?.path).toBe('data.items');
  });
});

describe('where an event being emitted is going', () => {
  it('is the service, for one of its input types', () => {
    const chargeEvent = createArvoEventFactory(paymentVersion).createInput({
      source: 'com_order_create',
      subject: initEvent.subject,
      data: { amount: 10 },
    });
    const destination = orderValidator.validateOutput(chargeEvent);
    expect(destination.ok && destination.value).toMatchObject({
      source: 'service',
      version: '1.0.0',
    });
  });

  it('is the contract implemented, for one of its own outputs', () => {
    const orderCreatedEvent = createArvoEventFactory(
      orderContract.versions['1.0.0'],
    ).createOutput({
      type: 'com_order_created',
      source: 'com_order_create',
      subject: initEvent.subject,
      data: { order_id: 'o-1' },
    });
    const destination = orderValidator.validateOutput(orderCreatedEvent);
    expect(destination.ok && destination.value).toMatchObject({
      source: 'self',
      version: '1.0.0',
    });
  });
});

describe('an event that may not be emitted', () => {
  const emissionRefusal = (
    event: Parameters<typeof orderValidator.validateOutput>[0],
  ) => {
    const validation = orderValidator.validateOutput(event);
    if (validation.ok) throw new Error('expected the emission to be refused');
    return validation.error;
  };

  it('is the handler error event of the contract implemented', () => {
    const ownErrorEvent = createArvoEventFactory(
      orderContract.versions['1.0.0'],
    ).createError({
      source: 'com_order_create',
      subject: initEvent.subject,
      error: new Error('could not'),
    });
    expect(emissionRefusal(ownErrorEvent).faultKind).toBe(
      'emission_not_permitted',
    );
  });

  it('is what the implemented contract takes in, which it receives', () => {
    expect(emissionRefusal(initEvent).faultKind).toBe('emission_not_permitted');
  });

  it('is an output of a version other than the one it names', () => {
    const shippedEvent = createArvoEventFactory(
      twoVersionContract.versions['1.1.0'],
    ).createOutput({
      type: 'com_order_shipped',
      source: 'com_order_create',
      subject: initEvent.subject,
      data: { eta: 'tomorrow' },
    });
    const wrongVersionEvent = mutateArvoEvent(shippedEvent, {
      dataschema: twoVersionContract.versions['1.0.0'].dataschema,
    });
    expect(twoVersionValidator.validateOutput(wrongVersionEvent).ok).toBe(
      false,
    );
  });

  it('names no contract this handler declared', () => {
    const strangerEvent = mutateArvoEvent(chargedEvent, {
      dataschema: '#/com/elsewhere/1.0.0',
    });
    expect(emissionRefusal(strangerEvent).faultKind).toBe(
      'event_unclassifiable',
    );
  });

  it('carries a payload the schema refuses', () => {
    const chargeEvent = createArvoEventFactory(paymentVersion).createInput({
      source: 'com_order_create',
      subject: initEvent.subject,
      data: { amount: 10 },
    });
    const badPayloadEvent = mutateArvoEvent(chargeEvent, {
      data: { amount: 'ten' } as never,
    });
    expect(emissionRefusal(badPayloadEvent).faultKind).toBe(
      'emission_schema_rejected',
    );
  });

  it('says (root) where the payload itself is wrong, not one of its fields', () => {
    const refinedContract = new ArvoContract({
      type: 'com_payment_charge',
      versions: {
        '1.0.0': {
          input: z
            .object({ amount: z.number() })
            .refine(
              (payload) => payload.amount > 0,
              'a charge needs an amount',
            ),
          outputs: {},
        },
      },
    });
    const refinedValidator = new ArvoEventValidator({
      contracts: {
        self: orderContract,
        services: { payments: refinedContract.versions['1.0.0'] },
      },
    });
    const chargeEvent = createArvoEventFactory(
      refinedContract.versions['1.0.0'],
    ).createInput({
      source: 'com_order_create',
      subject: initEvent.subject,
      data: { amount: 10 },
    });
    const zeroChargeEvent = mutateArvoEvent(chargeEvent, {
      data: { amount: 0 },
    });

    const validation = refinedValidator.validateOutput(zeroChargeEvent);
    expect(!validation.ok && validation.error.issues[0]?.path).toBe(
      'data.(root)',
    );
  });

  it('is an output type a version with none declared could never have', () => {
    const sinkContract = new ArvoContract({
      type: 'com_order_create',
      versions: {
        '1.0.0': {
          input: z.object({ items: z.array(z.string()) }),
          outputs: {},
        },
      },
    });
    const sinkValidator = new ArvoEventValidator({
      contracts: { self: sinkContract, services: { payments: paymentVersion } },
    });
    const orderCreatedEvent = mutateArvoEvent(initEvent, {
      type: 'com_order_created' as never,
    });
    const validation = sinkValidator.validateOutput(orderCreatedEvent);
    expect(!validation.ok && validation.error.message).toContain(
      'this version declaring no outputs',
    );
  });

  it('is a service response, which a handler receives rather than sends', () => {
    expect(emissionRefusal(chargedEvent).faultKind).toBe(
      'emission_not_permitted',
    );
  });
});

describe('what a validator holds', () => {
  it('cannot have its contracts replaced', () => {
    expect(() => {
      (orderValidator.contracts as unknown as Record<string, unknown>).self =
        twoVersionContract;
    }).toThrow();
  });

  it('copies the services, so a caller mutating theirs cannot change it', () => {
    const callerServices = { payments: paymentVersion };
    const copyingValidator = new ArvoEventValidator({
      contracts: { self: orderContract, services: callerServices },
    });
    delete (callerServices as Record<string, unknown>).payments;
    expect(copyingValidator.contracts.services).toEqual({
      payments: paymentVersion,
    });
  });
});

describe('a handler that declared its own contract as a service', () => {
  const recursiveContract = new ArvoContract({
    type: 'com_tree_walk',
    versions: {
      '1.0.0': {
        input: z.object({ node: z.string() }),
        outputs: { evt_tree_walked: z.object({ count: z.number() }) },
      },
      '1.1.0': {
        input: z.object({ node: z.string() }),
        outputs: { evt_tree_walked: z.object({ count: z.number() }) },
      },
    },
  });
  const recursiveV1 = recursiveContract.versions['1.0.0'];
  const recursiveValidator = new ArvoEventValidator({
    contracts: { self: recursiveContract, services: { self: recursiveV1 } },
  });

  const walkRequest = createArvoEventFactory(recursiveV1).createInput({
    source: 'com.web.walk',
    subject: 'walk-1',
    data: { node: 'root' },
  });
  const walkReply = createArvoEventFactory(recursiveV1).createOutput({
    type: 'evt_tree_walked',
    source: 'com_tree_walk',
    subject: 'walk-1',
    data: { count: 3 },
  });
  const handlerErrorEvent = createArvoEventFactory(recursiveV1).createError({
    source: 'com_tree_walk',
    subject: 'walk-1',
    error: new Error('the branch was unreadable'),
  });

  it('reads a request to itself as one opening an execution', () => {
    const origin = recursiveValidator.validateInput(walkRequest);
    expect(origin.ok && origin.value.source).toBe('self');
  });

  it('reads its own answer as one answering an execution', () => {
    const origin = recursiveValidator.validateInput(walkReply);
    expect(origin.ok && origin.value.source).toBe('service');
  });

  it('reads its own handler error the same way', () => {
    const origin = recursiveValidator.validateInput(handlerErrorEvent);
    expect(origin.ok && origin.value.source).toBe('service');
  });

  it('refuses a type that is neither what it takes in nor what it answers with', () => {
    const strayEvent = mutateArvoEvent(walkReply, {
      type: 'evt_nothing_declared',
    });
    const origin = recursiveValidator.validateInput(strayEvent);
    expect(!origin.ok && origin.error.faultKind).toBe('event_unclassifiable');
  });

  it('refuses its own answer at a version it did not open the child at', () => {
    const skewedReply = mutateArvoEvent(walkReply, {
      dataschema: recursiveContract.versions['1.1.0'].dataschema,
    });
    const origin = recursiveValidator.validateInput(skewedReply);
    expect(!origin.ok && origin.error.faultKind).toBe('event_unclassifiable');
  });

  it('still reads a request at its other version as one opening an execution', () => {
    const v110Request = createArvoEventFactory(
      recursiveContract.versions['1.1.0'],
    ).createInput({
      source: 'com.web.walk',
      subject: 'walk-1',
      data: { node: 'root' },
    });
    const origin = recursiveValidator.validateInput(v110Request);
    expect(origin.ok && origin.value.source).toBe('self');
  });
});

describe('a service answering at a version this handler did not declare', () => {
  it('is refused as unclassifiable, which is where version skew surfaces', () => {
    const twoVersionPayments = new ArvoContract({
      type: 'com_payment_charge',
      versions: {
        '1.0.0': {
          input: z.object({ amount: z.number() }),
          outputs: { evt_payment_charged: z.object({ receipt: z.string() }) },
        },
        '1.1.0': {
          input: z.object({ amount: z.number() }),
          outputs: { evt_payment_charged: z.object({ receipt: z.string() }) },
        },
      },
    });
    const skewValidator = new ArvoEventValidator({
      contracts: {
        self: orderContract,
        services: { payments: twoVersionPayments.versions['1.0.0'] },
      },
    });
    const v110Answer = createArvoEventFactory(
      twoVersionPayments.versions['1.1.0'],
    ).createOutput({
      type: 'evt_payment_charged',
      source: 'com_payment_charge',
      subject: 'order-1',
      data: { receipt: 'r-1' },
    });

    const origin = skewValidator.validateInput(v110Answer);
    expect(!origin.ok && origin.error.faultKind).toBe('event_unclassifiable');
    expect(!origin.ok && origin.error.message).toContain('1.0.0');
  });
});

describe('a payload refused as a whole rather than at a field', () => {
  const strictContract = new ArvoContract({
    type: 'com_strict_input',
    versions: {
      '1.0.0': {
        input: z.strictObject({ only: z.string() }),
        outputs: { evt_strict_done: z.strictObject({ only: z.string() }) },
      },
    },
  });
  const strictV1 = strictContract.versions['1.0.0'];
  const strictValidator = new ArvoEventValidator({
    contracts: { self: strictContract, services: { other: paymentVersion } },
  });

  const openingEvent = createArvoEventFactory(strictV1).createInput({
    source: 'com.web.checkout',
    subject: 'order-1',
    to: strictContract.type,
    data: { only: 'this' },
  });

  it('reports the payload itself where nothing names a field', () => {
    const validation = strictValidator.validateInput(
      mutateArvoEvent(openingEvent, {
        data: { only: 'this', extra: 'unwanted' } as unknown as {
          only: string;
        },
      }),
    );
    expect(!validation.ok && validation.error.faultKind).toBe(
      'event_schema_rejected',
    );
    expect(!validation.ok && validation.error.issues[0]?.path).toBe(
      'data.(root)',
    );
  });

  it('does the same for one on its way out', () => {
    const answeringEvent = createArvoEventFactory(strictV1).createOutput({
      type: 'evt_strict_done',
      source: strictContract.type,
      subject: 'order-1',
      to: 'com.web.checkout',
      initid: openingEvent.id,
      parentid: openingEvent.id,
      data: { only: 'this' },
    });
    const validation = strictValidator.validateOutput(
      mutateArvoEvent(answeringEvent, {
        data: { only: 'this', extra: 'unwanted' } as unknown as {
          only: string;
        },
      }),
    );
    expect(!validation.ok && validation.error.issues[0]?.path).toBe(
      'data.(root)',
    );
  });
});
