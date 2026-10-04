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
    expect(origin.ok && origin.value).toMatchObject({
      source: 'self',
      version: '1.0.0',
    });
  });

  it('is the service, for an event one answers with', () => {
    const origin = validator.validateInput(chargedEvent);
    expect(origin.ok && origin.value).toMatchObject({
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
    expect(origin.ok && origin.value).toMatchObject({
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
    expect(origin.ok && origin.value).toMatchObject({
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

describe('a handler that declared its own contract as a service', () => {
  const recursive = new ArvoContract({
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
  const recursiveV1 = recursive.versions['1.0.0'];
  const validator = new ArvoEventValidator({
    contracts: { self: recursive, services: { self: recursiveV1 } },
  });

  const request = createArvoEventFactory(recursiveV1).createInput({
    source: 'com.web.walk',
    subject: 'walk-1',
    data: { node: 'root' },
  });
  const reply = createArvoEventFactory(recursiveV1).createOutput({
    type: 'evt_tree_walked',
    source: 'com_tree_walk',
    subject: 'walk-1',
    data: { count: 3 },
  });
  const failed = createArvoEventFactory(recursiveV1).createError({
    source: 'com_tree_walk',
    subject: 'walk-1',
    error: new Error('the branch was unreadable'),
  });

  it('reads a request to itself as one opening an execution', () => {
    const resolved = validator.validateInput(request);
    expect(resolved.ok && resolved.value.source).toBe('self');
  });

  it('reads its own answer as one answering an execution', () => {
    const resolved = validator.validateInput(reply);
    expect(resolved.ok && resolved.value.source).toBe('service');
  });

  it('reads its own handler error the same way', () => {
    const resolved = validator.validateInput(failed);
    expect(resolved.ok && resolved.value.source).toBe('service');
  });

  it('refuses a type that is neither what it takes in nor what it answers with', () => {
    const stray = cloneArvoEvent(reply, { type: 'evt_nothing_declared' });
    const resolved = validator.validateInput(stray);
    expect(!resolved.ok && resolved.error.faultKind).toBe(
      'event_unclassifiable',
    );
  });

  it('refuses its own answer at a version it did not open the child at', () => {
    const skewed = cloneArvoEvent(reply, {
      dataschema: recursive.versions['1.1.0'].dataschema,
    });
    const resolved = validator.validateInput(skewed);
    expect(!resolved.ok && resolved.error.faultKind).toBe(
      'event_unclassifiable',
    );
  });

  it('still reads a request at its other version as one opening an execution', () => {
    const other = createArvoEventFactory(
      recursive.versions['1.1.0'],
    ).createInput({
      source: 'com.web.walk',
      subject: 'walk-1',
      data: { node: 'root' },
    });
    const resolved = validator.validateInput(other);
    expect(resolved.ok && resolved.value.source).toBe('self');
  });
});

describe('a service answering at a version this handler did not declare', () => {
  it('is refused as unclassifiable, which is where version skew surfaces', () => {
    const payments = new ArvoContract({
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
    const validator = new ArvoEventValidator({
      contracts: {
        self: orderContract,
        services: { payments: payments.versions['1.0.0'] },
      },
    });
    const answered = createArvoEventFactory(
      payments.versions['1.1.0'],
    ).createOutput({
      type: 'evt_payment_charged',
      source: 'com_payment_charge',
      subject: 'order-1',
      data: { receipt: 'r-1' },
    });

    const resolved = validator.validateInput(answered);
    expect(!resolved.ok && resolved.error.faultKind).toBe(
      'event_unclassifiable',
    );
    expect(!resolved.ok && resolved.error.message).toContain('1.0.0');
  });
});
