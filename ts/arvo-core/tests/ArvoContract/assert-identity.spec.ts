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

const v1 = contract.versions['1.0.0'];

const event = (data: Record<string, unknown>, type = 'com_order_create') =>
  new ArvoEvent({
    source: 'com.test.suite',
    subject: 'order-1',
    type,
    dataschema: v1.dataschema,
    data,
  });

describe('an assertion returns the event it was given', () => {
  it('returns the same instance from a version, asking', () => {
    const supplied = event({ items: ['a'] });
    expect(v1.assert(supplied).event).toBe(supplied);
  });

  it('returns the same instance from a version, expecting a type', () => {
    const supplied = event({ items: ['a'] });
    expect(v1.assert(supplied, 'com_order_create').event).toBe(supplied);
  });

  it('returns the same instance from a contract', () => {
    const supplied = event({ items: ['a'] });
    expect(contract.assert(supplied).event).toBe(supplied);
  });
});

describe('schema defaults are not applied', () => {
  it('leaves an omitted default absent', () => {
    const supplied = event({ items: ['a'] });
    const asserted = v1.assert(supplied, 'com_order_create');
    expect(asserted.event.data.currency).toBeUndefined();
    expect(Object.hasOwn(asserted.event.data, 'currency')).toBe(false);
  });

  it('leaves a supplied value alone', () => {
    const asserted = v1.assert(event({ items: ['a'], currency: 'USD' }));
    expect(asserted.event.data.currency).toBe('USD');
  });

  it('accepts a payload that only satisfies the schema once defaulted', () => {
    // The schema is satisfied because `currency` has a default, so the check
    // passes -- but the value the check produced is discarded.
    expect(v1.assert(event({ items: [] })).scope).toBe('input');
  });
});

describe('the event is unchanged by having been asserted', () => {
  it('holds the same payload afterwards', () => {
    const supplied = event({ items: ['a'] });
    const before = JSON.stringify(supplied.data);
    v1.assert(supplied);
    expect(JSON.stringify(supplied.data)).toBe(before);
  });

  it('holds the same fields afterwards', () => {
    const supplied = event({ items: ['a'] });
    const before = supplied.toString();
    contract.assert(supplied);
    expect(supplied.toString()).toBe(before);
  });

  it('is not replaced when the assertion fails either', () => {
    const supplied = event({ items: [1] });
    const before = JSON.stringify(supplied.data);
    expect(v1.tryAssert(supplied).ok).toBe(false);
    expect(JSON.stringify(supplied.data)).toBe(before);
  });
});
