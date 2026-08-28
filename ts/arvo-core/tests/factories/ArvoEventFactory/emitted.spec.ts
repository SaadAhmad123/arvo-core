import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoContract } from '../../../src/ArvoContract/index.js';
import { createArvoEventFactory } from '../../../src/factories/ArvoEventFactory/index.js';

const contract = new ArvoContract({
  type: 'com_order_create',
  versions: {
    '1.0.0': {
      accepts: z.object({}),
      emits: {
        com_order_created: z.object({ order_id: z.string() }),
        com_order_shipped: z.object({ eta: z.string() }),
      },
    },
    '1.1.0': { accepts: z.object({}), emits: {} },
  },
});

const orders = createArvoEventFactory(contract.versions['1.0.0']);
const emitless = createArvoEventFactory(contract.versions['1.1.0']);

describe('an event a version emits', () => {
  it('carries the type named and the version dataschema', () => {
    const event = orders.createEmitted({
      type: 'com_order_created',
      source: 'com.order.service',
      data: { order_id: 'o-1' },
    });
    expect(event.type).toBe('com_order_created');
    expect(event.dataschema).toBe('#/com/order/create/1.0.0');
  });

  it('invents no recipient', () => {
    expect(
      orders.createEmitted({
        type: 'com_order_created',
        source: 'com.svc',
        data: { order_id: 'o-1' },
      }).to,
    ).toBeNull();
  });

  it('judges the payload by the named type, not a sibling', () => {
    // `eta` belongs to com_order_shipped; against com_order_created it is
    // `order_id` that is missing, so the declaration consulted is named.
    const attempt = orders.tryCreateEmitted({
      type: 'com_order_created',
      source: 'com.svc',
      data: { eta: 'tuesday' } as never,
    });
    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.error.issues[0]?.path).toBe('data.order_id');
    expect(attempt.error.issues[0]?.message).toContain(
      'emits[com_order_created]',
    );
  });

  it('judges each declared type by its own schema', () => {
    const shipped = orders.createEmitted({
      type: 'com_order_shipped',
      source: 'com.svc',
      data: { eta: 'tuesday' },
    });
    expect(shipped.data.eta).toBe('tuesday');
  });
});

describe('a type the version does not emit', () => {
  it('reports it at the type, naming what is declared', () => {
    const attempt = orders.tryCreateEmitted({
      // Only reachable without types: the parameter admits no other key.
      type: 'com_order_refunded' as 'com_order_created',
      source: 'com.svc',
      data: {} as never,
    });
    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.error.issues[0]?.path).toBe('type');
    expect(attempt.error.issues[0]?.received).toBe('com_order_refunded');
    expect(attempt.error.issues[0]?.message).toContain('com_order_created');
    expect(attempt.error.issues[0]?.message).toContain('com_order_shipped');
  });

  it('says so in its own words for a version declaring none', () => {
    const attempt = emitless.tryCreateEmitted({
      type: 'anything' as never,
      source: 'com.svc',
      data: {} as never,
    });
    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.error.issues[0]?.path).toBe('type');
    expect(attempt.error.issues[0]?.message).toContain('declares none');
  });

  it('refuses the handler error, which is derived rather than emitted', () => {
    const attempt = orders.tryCreateEmitted({
      type: 'handler_com_order_create_error' as 'com_order_created',
      source: 'com.svc',
      data: {} as never,
    });
    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.error.issues[0]?.path).toBe('type');
  });
});
