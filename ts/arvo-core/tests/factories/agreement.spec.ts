import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoContract } from '../../src/ArvoContract/index.js';
import { createArvoEventFactory } from '../../src/factories/ArvoEventFactory/index.js';

/**
 * What ties building to reading. The two share no code — asserting takes an
 * event and there is none yet while building — so the only thing that can hold
 * them together is this property.
 */
const version = new ArvoContract({
  type: 'com_order_create',
  versions: {
    '1.0.0': {
      accepts: z.object({
        items: z.array(z.string()),
        currency: z.string().default('GBP'),
      }),
      emits: { com_order_created: z.object({ order_id: z.string() }) },
    },
  },
}).versions['1.0.0'];

const orders = createArvoEventFactory(version);

describe('an event built from a version is one that version accepts', () => {
  it('accepts what was built as its accepted request', () => {
    const built = orders.createAccepted({
      source: 'com.web.checkout',
      subject: 'order-42',
      data: { items: ['book'] },
    });

    const asserted = version.assert(built);
    expect(asserted.scope).toBe('accepts');
    expect(asserted.version).toBe('1.0.0');
    expect(asserted.event).toBe(built);
  });

  it('accepts what was built as one of its emitted events', () => {
    const built = orders.createEmitted({
      type: 'com_order_created',
      source: 'com.order.service',
      subject: 'order-42',
      data: { order_id: 'o-1' },
    });

    expect(version.assert(built).scope).toBe('emits');
  });

  it('accepts what was built as its handler error', () => {
    const built = orders.createError({
      source: 'com.order.service',
      subject: 'order-42',
      error: new Error('boom'),
    });

    expect(version.assert(built).scope).toBe('handlerError');
  });

  it('accepts a payload the schema defaulted on the way out', () => {
    // The factory materializes a default; asserting must still accept it,
    // which is only true because both read the same declaration.
    const built = orders.createAccepted({
      source: 'com.web.checkout',
      data: { items: [] },
    });

    expect(built.data.currency).toBe('GBP');
    expect(version.assert(built, 'com_order_create').scope).toBe('accepts');
  });

  it('agrees when the expected type is named too', () => {
    const built = orders.createEmitted({
      type: 'com_order_created',
      source: 'com.order.service',
      data: { order_id: 'o-1' },
    });

    const asserted = version.assert(built, 'com_order_created');
    expect(asserted.scope).toBe('emits');
    expect(asserted.event.data.order_id).toBe('o-1');
  });

  it('is accepted by the contract as well as the version', () => {
    const contract = new ArvoContract({
      type: 'com_order_create',
      versions: {
        '1.0.0': {
          accepts: z.object({ items: z.array(z.string()) }),
          emits: {},
        },
      },
    });

    const built = createArvoEventFactory(
      contract.versions['1.0.0'],
    ).createAccepted({
      source: 'com.web.checkout',
      data: { items: ['book'] },
    });

    expect(contract.assert(built).version).toBe('1.0.0');
    expect(contract.assert(built).scope).toBe('accepts');
  });
});
