import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoContract } from '../../src/ArvoContract/index.js';
import { createArvoEventFactory } from '../../src/factories/ArvoEventFactory/index.js';
import { mutateArvoEvent } from '../../src/factories/mutateArvoEvent.js';

/**
 * What ties building to reading. The two share no code — asserting takes an
 * event and there is none yet while building — so the only thing that can hold
 * them together is this property.
 */
const orderVersion = new ArvoContract({
  type: 'com_order_create',
  versions: {
    '1.0.0': {
      input: z.object({
        items: z.array(z.string()),
        currency: z.string().default('GBP'),
      }),
      outputs: { com_order_created: z.object({ order_id: z.string() }) },
    },
  },
}).versions['1.0.0'];

const orderFactory = createArvoEventFactory(orderVersion);

describe('an event built from a version is one that version accepts', () => {
  it('accepts what was built as its accepted request', () => {
    const event = orderFactory.createInput({
      source: 'com.web.checkout',
      subject: 'order-42',
      data: { items: ['book'] },
    });

    const assertedEvent = orderVersion.assert(event);
    expect(assertedEvent.scope).toBe('input');
    expect(assertedEvent.version).toBe('1.0.0');
    expect(assertedEvent.event).toBe(event);
  });

  it('accepts what was built as one of its emitted events', () => {
    const event = orderFactory.createOutput({
      type: 'com_order_created',
      source: 'com.order.service',
      subject: 'order-42',
      data: { order_id: 'o-1' },
    });

    expect(orderVersion.assert(event).scope).toBe('output');
  });

  it('accepts what was built as its handler error', () => {
    const event = orderFactory.createError({
      source: 'com.order.service',
      subject: 'order-42',
      error: new Error('boom'),
    });

    expect(orderVersion.assert(event).scope).toBe('error');
  });

  it('accepts a payload the schema defaulted on the way out', () => {
    // The factory materializes a default; asserting must still accept it,
    // which is only true because both read the same declaration.
    const event = orderFactory.createInput({
      source: 'com.web.checkout',
      data: { items: [] },
    });

    expect(event.data.currency).toBe('GBP');
    expect(orderVersion.assert(event, 'com_order_create').scope).toBe('input');
  });

  it('agrees when the expected type is named too', () => {
    const event = orderFactory.createOutput({
      type: 'com_order_created',
      source: 'com.order.service',
      data: { order_id: 'o-1' },
    });

    const assertedEvent = orderVersion.assert(event, 'com_order_created');
    expect(assertedEvent.scope).toBe('output');
    expect(assertedEvent.event.data.order_id).toBe('o-1');
  });

  it('accepts what was built after it is mutated, the mutation being the same event', () => {
    const event = orderFactory.createInput({
      source: 'com.web.checkout',
      subject: 'order-42',
      data: { items: ['book'] },
    });
    const continued = mutateArvoEvent(event, {
      traceparent: `00-${'9'.repeat(32)}-${'8'.repeat(16)}-01`,
    });

    const assertedEvent = orderVersion.assert(continued);
    expect(assertedEvent.scope).toBe('input');
    expect(assertedEvent.event.id).toBe(event.id);
  });

  it('is accepted by the contract as well as the version', () => {
    const contract = new ArvoContract({
      type: 'com_order_create',
      versions: {
        '1.0.0': {
          input: z.object({ items: z.array(z.string()) }),
          outputs: {},
        },
      },
    });

    const event = createArvoEventFactory(
      contract.versions['1.0.0'],
    ).createInput({
      source: 'com.web.checkout',
      data: { items: ['book'] },
    });

    expect(contract.assert(event).version).toBe('1.0.0');
    expect(contract.assert(event).scope).toBe('input');
  });
});
