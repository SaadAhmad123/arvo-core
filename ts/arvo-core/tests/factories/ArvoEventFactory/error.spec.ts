import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoContract } from '../../../src/ArvoContract/index.js';
import { createArvoEventFactory } from '../../../src/factories/ArvoEventFactory/index.js';

const orderFactory = createArvoEventFactory(
  new ArvoContract({
    type: 'com_order_create',
    versions: { '1.0.0': { input: z.object({}), outputs: {} } },
  }).versions['1.0.0'],
);

describe("a version's handler error event", () => {
  it('composes the payload from the error', () => {
    const typeError = new TypeError('boom');
    const event = orderFactory.createError({
      source: 'com.svc',
      error: typeError,
    });
    expect(event.data.error_name).toBe('TypeError');
    expect(event.data.error_message).toBe('boom');
    expect(event.data.error_stack).toBe(typeError.stack);
  });

  it('reports no stack rather than omitting the field', () => {
    const stacklessError = new Error('boom');
    stacklessError.stack = undefined;
    const event = orderFactory.createError({
      source: 'com.svc',
      error: stacklessError,
    });
    expect(event.data.error_stack).toBeNull();
    expect(Object.hasOwn(event.data, 'error_stack')).toBe(true);
  });

  it('takes its type and dataschema from the version', () => {
    const event = orderFactory.createError({
      source: 'com.svc',
      error: new Error('boom'),
    });
    expect(event.type).toBe('handler_com_order_create_error');
    expect(event.dataschema).toBe('#/com/order/create/1.0.0');
  });

  it('invents no recipient', () => {
    expect(
      orderFactory.createError({ source: 'com.svc', error: new Error('x') }).to,
    ).toBeNull();
  });
});

describe('something that is not an error', () => {
  it('is reported rather than raised', () => {
    // Only reachable without types, and the reason the payload is checked at
    // all: the composed fields read as `undefined` instead of throwing.
    const createResult = orderFactory.tryCreateError({
      source: 'com.svc',
      error: null as unknown as Error,
    });
    expect(createResult.ok).toBe(false);
    if (createResult.ok) return;
    expect(createResult.error.issues.map((issue) => issue.path)).toEqual([
      'data.error_name',
      'data.error_message',
    ]);
  });

  it('is reported for a plain object too', () => {
    const createResult = orderFactory.tryCreateError({
      source: 'com.svc',
      error: { message: 'not really an error' } as Error,
    });
    expect(createResult.ok).toBe(false);
    if (createResult.ok) return;
    expect(createResult.error.issues[0]?.path).toBe('data.error_name');
  });
});
