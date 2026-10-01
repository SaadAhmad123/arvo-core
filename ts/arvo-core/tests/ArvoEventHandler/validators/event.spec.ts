import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoContract } from '../../../src/ArvoContract/index.js';
import { ArvoEventValidator } from '../../../src/ArvoEventHandler/validators/event/index.js';
import { createArvoEventFactory } from '../../../src/factories/ArvoEventFactory/index.js';
import { cloneArvoEvent } from '../../../src/factories/cloneArvoEvent.js';
import {
  chargedEvent,
  initEvent,
  orderContract,
  paymentContract,
  paymentVersion,
} from '../fixtures.js';

/** A second version of the implemented contract, so resolution has a choice. */
const twoVersions = new ArvoContract({
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

const validator = new ArvoEventValidator({
  contracts: { self: orderContract, services: { payments: paymentVersion } },
});

const across = new ArvoEventValidator({
  contracts: { self: twoVersions, services: { payments: paymentVersion } },
});

describe('where an event arriving came from', () => {
  it('is the contract implemented, for one it takes in', () => {
    const origin = validator.validateInput(initEvent);
    expect(origin.ok && origin.value).toEqual({
      source: 'self',
      version: '1.0.0',
    });
  });

  it('is the service, for an event one answers with', () => {
    const origin = validator.validateInput(chargedEvent);
    expect(origin.ok && origin.value).toEqual({
      source: 'service',
      version: '1.0.0',
    });
  });

  it("is the service, for that service's handler error", () => {
    const failed = createArvoEventFactory(paymentVersion).createError({
      source: 'com.payment.service',
      subject: initEvent.subject,
      error: new Error('card declined'),
    });
    const origin = validator.validateInput(failed);
    expect(origin.ok && origin.value.source).toBe('service');
  });

  it('is the version the event names, not one it was told', () => {
    const rush = createArvoEventFactory(
      twoVersions.versions['1.1.0'],
    ).createInput({
      source: 'com.web.checkout',
      subject: 'order-9',
      data: { items: ['book'], rush: true },
    });
    const origin = across.validateInput(rush);
    expect(origin.ok && origin.value.version).toBe('1.1.0');
  });
});

describe('an event that could not have arrived', () => {
  const refusal = (event: Parameters<typeof validator.validateInput>[0]) => {
    const result = validator.validateInput(event);
    if (result.ok) throw new Error('expected the event to be refused');
    return result.error;
  };

  it('names no contract this handler declared', () => {
    const stranger = cloneArvoEvent(initEvent, {
      dataschema: '#/com/elsewhere/1.0.0',
    });
    expect(refusal(stranger).faultKind).toBe('event_unclassifiable');
  });

  it('says what it should have named', () => {
    const stranger = cloneArvoEvent(initEvent, {
      dataschema: '#/com/elsewhere/1.0.0',
    });
    expect(refusal(stranger).issues[0]?.path).toBe('dataschema');
    expect(refusal(stranger).message).toContain(orderContract.uri);
  });

  it('is a version of the implemented contract that does not exist', () => {
    const future = cloneArvoEvent(initEvent, {
      dataschema: `${orderContract.uri}/9.9.9`,
    });
    expect(refusal(future).faultKind).toBe('event_unclassifiable');
  });

  it('is not the type the implemented contract takes in', () => {
    const output = createArvoEventFactory(
      orderContract.versions['1.0.0'],
    ).createOutput({
      type: 'com_order_created',
      source: 'com.order.service',
      subject: initEvent.subject,
      data: { order_id: 'o-1' },
    });
    expect(refusal(output).faultKind).toBe('type_not_receivable');
  });

  it('is not a type that service ever answers with', () => {
    const odd = cloneArvoEvent(chargedEvent, { type: 'evt_unknown' as never });
    expect(refusal(odd).faultKind).toBe('type_not_receivable');
    expect(refusal(odd).message).toContain(paymentContract.uri);
  });

  it('carries a payload the schema refuses', () => {
    const wrong = cloneArvoEvent(initEvent, {
      data: { items: 'not a list' } as never,
    });
    expect(refusal(wrong).faultKind).toBe('event_schema_rejected');
    expect(refusal(wrong).issues[0]?.path).toBe('data.items');
  });
});

describe('where an event being emitted is going', () => {
  it('is the service, for one of its input types', () => {
    const charge = createArvoEventFactory(paymentVersion).createInput({
      source: 'com_order_create',
      subject: initEvent.subject,
      data: { amount: 10 },
    });
    const origin = validator.validateOutput(charge);
    expect(origin.ok && origin.value).toEqual({
      source: 'service',
      version: '1.0.0',
    });
  });

  it('is the contract implemented, for one of its own outputs', () => {
    const done = createArvoEventFactory(
      orderContract.versions['1.0.0'],
    ).createOutput({
      type: 'com_order_created',
      source: 'com_order_create',
      subject: initEvent.subject,
      data: { order_id: 'o-1' },
    });
    const origin = validator.validateOutput(done);
    expect(origin.ok && origin.value).toEqual({
      source: 'self',
      version: '1.0.0',
    });
  });
});

describe('an event that may not be emitted', () => {
  const refusal = (event: Parameters<typeof validator.validateOutput>[0]) => {
    const result = validator.validateOutput(event);
    if (result.ok) throw new Error('expected the emission to be refused');
    return result.error;
  };

  it('is the handler error event of the contract implemented', () => {
    const own = createArvoEventFactory(
      orderContract.versions['1.0.0'],
    ).createError({
      source: 'com_order_create',
      subject: initEvent.subject,
      error: new Error('could not'),
    });
    expect(refusal(own).faultKind).toBe('emission_not_permitted');
  });

  it('is what the implemented contract takes in, which it receives', () => {
    expect(refusal(initEvent).faultKind).toBe('emission_not_permitted');
  });

  it('is an output of a version other than the one it names', () => {
    const shipped = createArvoEventFactory(
      twoVersions.versions['1.1.0'],
    ).createOutput({
      type: 'com_order_shipped',
      source: 'com_order_create',
      subject: initEvent.subject,
      data: { eta: 'tomorrow' },
    });
    const wrongVersion = cloneArvoEvent(shipped, {
      dataschema: twoVersions.versions['1.0.0'].dataschema,
    });
    expect(across.validateOutput(wrongVersion).ok).toBe(false);
  });

  it('names no contract this handler declared', () => {
    const stranger = cloneArvoEvent(chargedEvent, {
      dataschema: '#/com/elsewhere/1.0.0',
    });
    expect(refusal(stranger).faultKind).toBe('event_unclassifiable');
  });

  it('carries a payload the schema refuses', () => {
    const charge = createArvoEventFactory(paymentVersion).createInput({
      source: 'com_order_create',
      subject: initEvent.subject,
      data: { amount: 10 },
    });
    const wrong = cloneArvoEvent(charge, { data: { amount: 'ten' } as never });
    expect(refusal(wrong).faultKind).toBe('emission_schema_rejected');
  });

  it('says (root) where the payload itself is wrong, not one of its fields', () => {
    const refined = new ArvoContract({
      type: 'com_payment_charge',
      versions: {
        '1.0.0': {
          input: z
            .object({ amount: z.number() })
            .refine((value) => value.amount > 0, 'a charge needs an amount'),
          outputs: {},
        },
      },
    });
    const bound = new ArvoEventValidator({
      contracts: {
        self: orderContract,
        services: { payments: refined.versions['1.0.0'] },
      },
    });
    const charge = createArvoEventFactory(
      refined.versions['1.0.0'],
    ).createInput({
      source: 'com_order_create',
      subject: initEvent.subject,
      data: { amount: 10 },
    });
    const zero = cloneArvoEvent(charge, { data: { amount: 0 } });

    const result = bound.validateOutput(zero);
    expect(!result.ok && result.error.issues[0]?.path).toBe('data.(root)');
  });

  it('is an output type a version with none declared could never have', () => {
    const sink = new ArvoContract({
      type: 'com_order_create',
      versions: {
        '1.0.0': {
          input: z.object({ items: z.array(z.string()) }),
          outputs: {},
        },
      },
    });
    const bound = new ArvoEventValidator({
      contracts: { self: sink, services: { payments: paymentVersion } },
    });
    const done = cloneArvoEvent(initEvent, {
      type: 'com_order_created' as never,
    });
    const result = bound.validateOutput(done);
    expect(!result.ok && result.error.message).toContain(
      'this version declaring no outputs',
    );
  });

  it('is a service response, which a handler receives rather than sends', () => {
    expect(refusal(chargedEvent).faultKind).toBe('emission_not_permitted');
  });
});

describe('what a validator holds', () => {
  it('cannot have its contracts replaced', () => {
    expect(() => {
      (validator.contracts as unknown as Record<string, unknown>).self =
        twoVersions;
    }).toThrow();
  });

  it('copies the services, so a caller mutating theirs cannot change it', () => {
    const mutable = { payments: paymentVersion };
    const bound = new ArvoEventValidator({
      contracts: { self: orderContract, services: mutable },
    });
    delete (mutable as Record<string, unknown>).payments;
    expect(bound.contracts.services).toEqual({ payments: paymentVersion });
  });
});
