import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoContract } from '../../src/ArvoContract/index.js';
import { ArvoEvent } from '../../src/ArvoEvent/index.js';

const contract = new ArvoContract({
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
});

const version100 = contract.versions['1.0.0'];

const event = (data: Record<string, unknown>, type = 'com_order_create') =>
  new ArvoEvent({
    source: 'com.test.suite',
    subject: 'order-1',
    type,
    dataschema: version100.dataschema,
    data,
  });

describe('an assertion returns the event it was given', () => {
  it('returns the same instance from a version, asking', () => {
    const suppliedEvent = event({ items: ['a'] });
    expect(version100.assert(suppliedEvent).event).toBe(suppliedEvent);
  });

  it('returns the same instance from a version, expecting a type', () => {
    const suppliedEvent = event({ items: ['a'] });
    expect(version100.assert(suppliedEvent, 'com_order_create').event).toBe(
      suppliedEvent,
    );
  });

  it('returns the same instance from a contract', () => {
    const suppliedEvent = event({ items: ['a'] });
    expect(contract.assert(suppliedEvent).event).toBe(suppliedEvent);
  });
});

describe('schema defaults are not applied', () => {
  it('leaves an omitted default absent', () => {
    const suppliedEvent = event({ items: ['a'] });
    const assertedEvent = version100.assert(suppliedEvent, 'com_order_create');
    expect(assertedEvent.event.data.currency).toBeUndefined();
    expect(Object.hasOwn(assertedEvent.event.data, 'currency')).toBe(false);
  });

  it('leaves a supplied value alone', () => {
    const assertedEvent = version100.assert(
      event({ items: ['a'], currency: 'USD' }),
    );
    expect(assertedEvent.event.data.currency).toBe('USD');
  });

  it('accepts a payload that only satisfies the schema once defaulted', () => {
    // The schema is satisfied because `currency` has a default, so the check
    // passes -- but the value the check produced is discarded.
    expect(version100.assert(event({ items: [] })).scope).toBe('input');
  });
});

describe('the event is unchanged by having been asserted', () => {
  it('holds the same payload afterwards', () => {
    const suppliedEvent = event({ items: ['a'] });
    const payloadJson = JSON.stringify(suppliedEvent.data);
    version100.assert(suppliedEvent);
    expect(JSON.stringify(suppliedEvent.data)).toBe(payloadJson);
  });

  it('holds the same fields afterwards', () => {
    const suppliedEvent = event({ items: ['a'] });
    const eventJson = suppliedEvent.toString();
    contract.assert(suppliedEvent);
    expect(suppliedEvent.toString()).toBe(eventJson);
  });

  it('is not replaced when the assertion fails either', () => {
    const suppliedEvent = event({ items: [1] });
    const payloadJson = JSON.stringify(suppliedEvent.data);
    expect(version100.tryAssert(suppliedEvent).ok).toBe(false);
    expect(JSON.stringify(suppliedEvent.data)).toBe(payloadJson);
  });
});
