import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoContract } from '../../../src/ArvoContract/index.js';
import { createArvoEventFactory } from '../../../src/factories/ArvoEventFactory/index.js';

const orders = createArvoEventFactory(
  new ArvoContract({
    type: 'com_order_create',
    versions: {
      '1.0.0': {
        accepts: z.object({
          items: z.array(z.string()),
          currency: z.string().default('GBP'),
        }),
        emits: {},
      },
    },
  }).versions['1.0.0'],
);

describe('the event a version accepts', () => {
  it('takes its type and dataschema from the version', () => {
    const event = orders.createAccepted({
      source: 'com.web.checkout',
      data: { items: ['book'] },
    });
    expect(event.type).toBe('com_order_create');
    expect(event.dataschema).toBe('#/com/order/create/1.0.0');
  });

  it('addresses it to the handler that accepts it', () => {
    expect(
      orders.createAccepted({ source: 'com.web', data: { items: [] } }).to,
    ).toBe('com_order_create');
  });

  it('keeps a recipient the caller supplied', () => {
    expect(
      orders.createAccepted({
        source: 'com.web',
        data: { items: [] },
        to: 'com.elsewhere',
      }).to,
    ).toBe('com.elsewhere');
  });

  it('addresses it to the handler even when `to` is passed as undefined', () => {
    expect(
      orders.createAccepted({
        source: 'com.web',
        data: { items: [] },
        to: undefined,
      }).to,
    ).toBe('com_order_create');
  });
});

describe('the payload a version declares', () => {
  it('carries a value the schema defaults', () => {
    expect(
      orders.createAccepted({ source: 'com.web', data: { items: [] } }).data
        .currency,
    ).toBe('GBP');
  });

  it('does not replace a value the caller supplied', () => {
    expect(
      orders.createAccepted({
        source: 'com.web',
        data: { items: [], currency: 'USD' },
      }).data.currency,
    ).toBe('USD');
  });

  it('reports a rejected payload beneath its position', () => {
    const attempt = orders.tryCreateAccepted({
      source: 'com.web',
      data: { items: [1] } as never,
    });
    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.error.issues[0]?.path).toBe('data.items.0');
    expect(attempt.error.issues[0]?.message).toContain("contract's accepts");
  });

  it('reports every position that broke', () => {
    const attempt = orders.tryCreateAccepted({
      source: 'com.web',
      data: { items: [1, 2] } as never,
    });
    if (attempt.ok) throw new Error('expected a failure');
    expect(attempt.error.issues).toHaveLength(2);
  });

  it('builds no event when the payload is rejected', () => {
    expect(() =>
      orders.createAccepted({ source: 'com.web', data: {} as never }),
    ).toThrow(/items/);
  });
});

describe('a schema whose output is not what it was given', () => {
  const coercing = createArvoEventFactory(
    new ArvoContract({
      type: 'com_order_create',
      versions: {
        '1.0.0': { accepts: z.object({ at: z.coerce.date() }), emits: {} },
      },
    }).versions['1.0.0'],
  );

  it('serializes a Date the check produced, the payload walk having no other form for it', () => {
    // Declared as a `Date` by the schema's output type and not one on the
    // event: the divergence a transform introduces, pinned rather than fixed.
    const event = coercing.createAccepted({
      source: 'com.web',
      data: { at: '2026-01-01T00:00:00.000Z' },
    });
    expect(typeof event.data.at).toBe('string');
    expect(event.data.at).toBe('2026-01-01T00:00:00.000Z');
  });

  it('reports a value with no JSON form at its position', () => {
    const setting = createArvoEventFactory(
      new ArvoContract({
        type: 'com_order_create',
        versions: {
          '1.0.0': {
            accepts: z.object({
              tags: z.array(z.string()).transform((t) => new Set(t)),
            }),
            emits: {},
          },
        },
      }).versions['1.0.0'],
    );

    const attempt = setting.tryCreateAccepted({
      source: 'com.web',
      data: { tags: ['a'] },
    });
    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.error.issues[0]?.path).toBe('data.tags');
    expect(attempt.error.issues[0]?.message).toContain(
      'no JSON representation',
    );
  });
});
