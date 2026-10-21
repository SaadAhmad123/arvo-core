import type { SpanContext } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoContract } from '../../src/ArvoContract/index.js';
import { ArvoDomain } from '../../src/ArvoDomain/index.js';
import { ArvoEvent } from '../../src/ArvoEvent/index.js';
import { createArvoEventFactory } from '../../src/factories/ArvoEventFactory/index.js';
import { cloneArvoEvent } from '../../src/factories/cloneArvoEvent.js';
import { createArvoEvent } from '../../src/factories/createArvoEvent.js';

/**
 * Every field an event has, so nothing a caller may pass goes unexercised.
 * The optional and defaulted ones are where a factory could quietly drop a
 * value, since a required field missing would fail loudly anyway.
 */
const ALL_FIELDS = [
  'id',
  'parentid',
  'initid',
  'subject',
  'executionid',
  'category',
  'depth',
  'source',
  'to',
  'domain',
  'type',
  'data',
  'dataschema',
  'baggage',
  'time',
  'traceparent',
  'tracestate',
  'executionunits',
] as const;

/** Every field a caller may pass, each with a value distinct from any default. */
const allFieldValues = {
  id: 'event-1',
  parentid: 'parent-1',
  initid: 'init-1',
  subject: 'order-42',
  executionid: 'execution-1',
  category: 'io.arvo.transit',
  depth: 7,
  source: 'com.web.checkout',
  to: 'com.explicit.recipient',
  baggage: { tenant: 'acme', retry: 2, live: true },
  time: '2026-01-02T03:04:05.678Z',
  traceparent: `00-${'1'.repeat(32)}-${'2'.repeat(16)}-01`,
  tracestate: 'vendor=original',
  executionunits: 12.5,
} as const;

const contract = new ArvoContract({
  type: 'com_order_create',
  domain: 'orders',
  versions: {
    '1.0.0': {
      input: z.object({
        items: z.array(z.string()),
        currency: z.string().default('GBP'),
      }),
      outputs: { com_order_created: z.object({ order_id: z.string() }) },
    },
  },
});
const orderVersion = contract.versions['1.0.0'];
const orderFactory = createArvoEventFactory(orderVersion);

/** Asserts that every field a caller passed reached the event unchanged. */
const expectEveryFieldCarried = (event: ArvoEvent) => {
  expect(event.id).toBe(allFieldValues.id);
  expect(event.parentid).toBe(allFieldValues.parentid);
  expect(event.initid).toBe(allFieldValues.initid);
  expect(event.subject).toBe(allFieldValues.subject);
  expect(event.executionid).toBe(allFieldValues.executionid);
  expect(event.category).toBe(allFieldValues.category);
  expect(event.depth).toBe(allFieldValues.depth);
  expect(event.source).toBe(allFieldValues.source);
  expect(event.to).toBe(allFieldValues.to);
  expect(event.baggage).toEqual(allFieldValues.baggage);
  expect(event.time).toBe(allFieldValues.time);
  expect(event.traceparent).toBe(allFieldValues.traceparent);
  expect(event.tracestate).toBe(allFieldValues.tracestate);
  expect(event.executionunits).toBe(allFieldValues.executionunits);
};

/** No field left holding a default, so nothing is asserted vacuously. */
const expectNothingDefaulted = (event: ArvoEvent) => {
  const defaultedEvent = new ArvoEvent({
    source: 'com.other',
    subject: 'other',
    type: event.type,
    dataschema: event.dataschema,
    data: event.data,
  });
  for (const field of [
    'parentid',
    'initid',
    'category',
    'to',
    'executionunits',
  ] as const) {
    expect(event[field]).not.toBe(defaultedEvent[field]);
  }
  expect(event.depth).not.toBe(defaultedEvent.depth);
  expect(event.baggage).not.toEqual(defaultedEvent.baggage);
};

describe('createInput, given every field', () => {
  const event = orderFactory.createInput({
    ...allFieldValues,
    domain: 'orders_priority',
    data: { items: ['book'], currency: 'USD' },
  });

  it('carries every field the caller passed', () => {
    expectEveryFieldCarried(event);
  });

  it('leaves nothing at a default', () => {
    expectNothingDefaulted(event);
  });

  it('still takes type and dataschema from the version', () => {
    expect(event.type).toBe('com_order_create');
    expect(event.dataschema).toBe('#/com/order/create/1.0.0');
  });

  it('lets an explicit recipient beat the contract default', () => {
    expect(event.to).toBe('com.explicit.recipient');
  });

  it('carries the payload the caller supplied, defaults untouched', () => {
    expect(event.data).toEqual({ items: ['book'], currency: 'USD' });
  });

  it('carries an explicit domain', () => {
    expect(event.domain).toBe('orders_priority');
  });

  it('exercises all eighteen fields between the caller and the contract', () => {
    for (const field of ALL_FIELDS) {
      expect(event[field]).not.toBeUndefined();
    }
  });
});

describe('createOutput, given every field', () => {
  const event = orderFactory.createOutput({
    ...allFieldValues,
    type: 'com_order_created',
    domain: ArvoDomain.FROM_EVENT_CONTRACT,
    data: { order_id: 'o-1' },
  });

  it('carries every field the caller passed', () => {
    expectEveryFieldCarried(event);
  });

  it('leaves nothing at a default', () => {
    expectNothingDefaulted(event);
  });

  it('carries the emitted type and the version dataschema', () => {
    expect(event.type).toBe('com_order_created');
    expect(event.dataschema).toBe('#/com/order/create/1.0.0');
  });

  it('resolves a domain read from the contract', () => {
    expect(event.domain).toBe('orders');
  });
});

describe('createError, given every field', () => {
  const error = new Error('boom');
  const event = orderFactory.createError({
    ...allFieldValues,
    domain: ArvoDomain.LOCAL,
    error,
  });

  it('carries every field the caller passed', () => {
    expectEveryFieldCarried(event);
  });

  it('leaves nothing at a default', () => {
    expectNothingDefaulted(event);
  });

  it('carries the handler error type and the version dataschema', () => {
    expect(event.type).toBe('handler_com_order_create_error');
    expect(event.dataschema).toBe('#/com/order/create/1.0.0');
  });

  it('composes the payload from the error rather than taking one', () => {
    expect(event.data).toEqual({
      error_name: 'Error',
      error_message: 'boom',
      error_stack: error.stack,
    });
  });

  it('reads no domain for LOCAL, whatever the contract declares', () => {
    expect(event.domain).toBeNull();
  });
});

describe('createArvoEvent, given every field', () => {
  const event = createArvoEvent({
    ...allFieldValues,
    domain: 'orders_priority',
    type: 'com_order_create',
    dataschema: '#/com/order/create/1.0.0',
    data: { items: ['book'] },
  });

  it('carries every field the caller passed', () => {
    expectEveryFieldCarried(event);
  });

  it('leaves nothing at a default', () => {
    expectNothingDefaulted(event);
  });

  it('carries the type, dataschema, domain and payload it was given', () => {
    expect(event.type).toBe('com_order_create');
    expect(event.dataschema).toBe('#/com/order/create/1.0.0');
    expect(event.domain).toBe('orders_priority');
    expect(event.data).toEqual({ items: ['book'] });
  });
});

describe('cloneArvoEvent, replacing every field', () => {
  const originalEvent = createArvoEvent({
    type: 'com_order_create',
    source: 'com.original',
    dataschema: '#/com/order/create/1.0.0',
    data: { items: [] },
  });

  const clonedEvent = cloneArvoEvent(originalEvent, {
    ...allFieldValues,
    domain: 'orders_priority',
    data: { items: ['replaced'] },
  });

  it('carries every replacement', () => {
    expectEveryFieldCarried(clonedEvent);
    expect(clonedEvent.domain).toBe('orders_priority');
    expect(clonedEvent.data).toEqual({ items: ['replaced'] });
  });

  it('keeps the type and dataschema of the event it cloned', () => {
    expect(clonedEvent.type).toBe(originalEvent.type);
    expect(clonedEvent.dataschema).toBe(originalEvent.dataschema);
  });

  it('leaves the event it cloned untouched', () => {
    expect(originalEvent.source).toBe('com.original');
    expect(originalEvent.data).toEqual({ items: [] });
  });
});

describe('a span in place of the trace headers', () => {
  const spanContext = {
    traceId: 'a'.repeat(32),
    spanId: 'b'.repeat(16),
    traceFlags: 1,
    traceState: { serialize: () => 'vendor=fromspan' },
  } as unknown as SpanContext;

  const {
    traceparent: _traceparent,
    tracestate: _tracestate,
    ...headerlessFields
  } = allFieldValues;

  it('derives both headers for an accepted event', () => {
    const event = orderFactory.createInput({
      ...headerlessFields,
      span: spanContext,
      data: { items: [] },
    });
    expect(event.traceparent).toBe(`00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`);
    expect(event.tracestate).toBe('vendor=fromspan');
  });

  it('derives both headers for an emitted event', () => {
    const event = orderFactory.createOutput({
      ...headerlessFields,
      span: spanContext,
      type: 'com_order_created',
      data: { order_id: 'o-1' },
    });
    expect(event.traceparent).toBe(`00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`);
  });

  it('derives both headers for a handler error event', () => {
    const event = orderFactory.createError({
      ...headerlessFields,
      span: spanContext,
      error: new Error('boom'),
    });
    expect(event.traceparent).toBe(`00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`);
  });

  it('derives both headers for an event with no contract', () => {
    const event = createArvoEvent({
      ...headerlessFields,
      span: spanContext,
      type: 'com_order_create',
      dataschema: '#/com/order/create/1.0.0',
      data: {},
    });
    expect(event.traceparent).toBe(`00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`);
  });
});
