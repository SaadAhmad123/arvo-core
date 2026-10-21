import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoContract } from '../../../src/ArvoContract/index.js';
import { createArvoEventFactory } from '../../../src/factories/ArvoEventFactory/index.js';

const contract = new ArvoContract({
  type: 'com_order_create',
  versions: {
    '1.0.0': {
      input: z.object({}),
      outputs: {
        com_order_created: z.object({ order_id: z.string() }),
        com_order_shipped: z.object({ eta: z.string() }),
      },
    },
    '1.1.0': { input: z.object({}), outputs: {} },
  },
});

const orderFactory = createArvoEventFactory(contract.versions['1.0.0']);
const emitlessFactory = createArvoEventFactory(contract.versions['1.1.0']);

describe('an event a version emits', () => {
  it('carries the type named and the version dataschema', () => {
    const event = orderFactory.createOutput({
      type: 'com_order_created',
      source: 'com.order.service',
      data: { order_id: 'o-1' },
    });
    expect(event.type).toBe('com_order_created');
    expect(event.dataschema).toBe('#/com/order/create/1.0.0');
  });

  it('invents no recipient', () => {
    expect(
      orderFactory.createOutput({
        type: 'com_order_created',
        source: 'com.svc',
        data: { order_id: 'o-1' },
      }).to,
    ).toBeNull();
  });

  it('judges the payload by the named type, not a sibling', () => {
    // `eta` belongs to com_order_shipped; against com_order_created it is
    // `order_id` that is missing, so the declaration consulted is named.
    const createResult = orderFactory.tryCreateOutput({
      type: 'com_order_created',
      source: 'com.svc',
      data: { eta: 'tuesday' } as never,
    });
    expect(createResult.ok).toBe(false);
    if (createResult.ok) return;
    expect(createResult.error.issues[0]?.path).toBe('data.order_id');
    expect(createResult.error.issues[0]?.message).toContain(
      'outputs[com_order_created]',
    );
  });

  it('judges each declared type by its own schema', () => {
    const shippedEvent = orderFactory.createOutput({
      type: 'com_order_shipped',
      source: 'com.svc',
      data: { eta: 'tuesday' },
    });
    expect(shippedEvent.data.eta).toBe('tuesday');
  });
});

describe('a type the version does not emit', () => {
  it('reports it at the type, naming what is declared', () => {
    const createResult = orderFactory.tryCreateOutput({
      // Only reachable without types: the parameter admits no other key.
      type: 'com_order_refunded' as 'com_order_created',
      source: 'com.svc',
      data: {} as never,
    });
    expect(createResult.ok).toBe(false);
    if (createResult.ok) return;
    expect(createResult.error.issues[0]?.path).toBe('type');
    expect(createResult.error.issues[0]?.received).toBe('com_order_refunded');
    expect(createResult.error.issues[0]?.message).toContain(
      'com_order_created',
    );
    expect(createResult.error.issues[0]?.message).toContain(
      'com_order_shipped',
    );
  });

  it('says so in its own words for a version declaring none', () => {
    const createResult = emitlessFactory.tryCreateOutput({
      type: 'anything' as never,
      source: 'com.svc',
      data: {} as never,
    });
    expect(createResult.ok).toBe(false);
    if (createResult.ok) return;
    expect(createResult.error.issues[0]?.path).toBe('type');
    expect(createResult.error.issues[0]?.message).toContain('declares none');
  });

  it.each(['constructor', 'toString', 'hasOwnProperty', '__proto__'])(
    'reports the inherited name %s rather than crashing on it',
    (inheritedName) => {
      // Every object inherits these, so a lookup finds something real while
      // the version declares nothing of the sort. Judged by what is returned,
      // the check for a missing schema passed and the non-schema reached the
      // parser, which threw out of a function that must only report.
      const createResult = orderFactory.tryCreateOutput({
        type: inheritedName as 'com_order_created',
        source: 'com.svc',
        data: {} as never,
      });
      expect(createResult.ok).toBe(false);
      if (createResult.ok) return;
      expect(createResult.error.issues[0]?.path).toBe('type');
      expect(createResult.error.issues[0]?.received).toBe(inheritedName);
    },
  );

  it('throws the same failure from the throwing twin', () => {
    expect(() =>
      orderFactory.createOutput({
        type: 'constructor' as 'com_order_created',
        source: 'com.svc',
        data: {} as never,
      }),
    ).toThrow(/must be one of this version's outputs/);
  });

  it('refuses the handler error, which is derived rather than emitted', () => {
    const createResult = orderFactory.tryCreateOutput({
      type: 'handler_com_order_create_error' as 'com_order_created',
      source: 'com.svc',
      data: {} as never,
    });
    expect(createResult.ok).toBe(false);
    if (createResult.ok) return;
    expect(createResult.error.issues[0]?.path).toBe('type');
  });
});
