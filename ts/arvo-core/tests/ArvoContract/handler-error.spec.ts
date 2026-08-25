import { describe, expect, it } from 'vitest';
import {
  HANDLER_ERROR_SCHEMA,
  handlerErrorContract,
  handlerErrorType,
} from '../../src/ArvoContract/handler-error.js';

describe('handlerErrorType', () => {
  it('wraps a multi-segment type', () => {
    expect(handlerErrorType('com_payment_process')).toBe(
      'handler_com_payment_process_error',
    );
  });

  it('wraps a single-segment type', () => {
    expect(handlerErrorType('payment')).toBe('handler_payment_error');
  });

  it('wraps a type carrying digits', () => {
    expect(handlerErrorType('v2_order_create')).toBe(
      'handler_v2_order_create_error',
    );
  });

  it('produces a result that is itself a valid contract identifier', () => {
    // Wrapping can never introduce a leading, trailing, or doubled
    // underscore, because a valid type never starts or ends with one.
    const grammar = /^[a-z0-9]+(_[a-z0-9]+)*$/;
    for (const type of ['payment', 'com_payment_process', 'v2_order_create']) {
      expect(handlerErrorType(type)).toMatch(grammar);
    }
  });
});

describe('HANDLER_ERROR_SCHEMA', () => {
  it('accepts a fully populated error', () => {
    const parsed = HANDLER_ERROR_SCHEMA.parse({
      error_name: 'TypeError',
      error_message: 'boom',
      error_stack: 'at foo()',
    });
    expect(parsed.error_name).toBe('TypeError');
  });

  it('accepts a null stack', () => {
    expect(
      HANDLER_ERROR_SCHEMA.parse({
        error_name: 'Error',
        error_message: 'boom',
        error_stack: null,
      }).error_stack,
    ).toBeNull();
  });

  it('rejects a missing stack, which is nullable rather than optional', () => {
    expect(() =>
      HANDLER_ERROR_SCHEMA.parse({
        error_name: 'Error',
        error_message: 'boom',
      }),
    ).toThrow();
  });

  it('rejects a non-string name or message', () => {
    expect(() =>
      HANDLER_ERROR_SCHEMA.parse({
        error_name: 42,
        error_message: 'boom',
        error_stack: null,
      }),
    ).toThrow();
    expect(() =>
      HANDLER_ERROR_SCHEMA.parse({
        error_name: 'Error',
        error_message: null,
        error_stack: null,
      }),
    ).toThrow();
  });
});

describe('handlerErrorContract', () => {
  it('carries the derived type', () => {
    expect(handlerErrorContract('com_order_create').type).toBe(
      'handler_com_order_create_error',
    );
  });

  it('shares one schema instance across contracts', () => {
    const a = handlerErrorContract('com_order_create');
    const b = handlerErrorContract('com_payment_process');
    expect(a.schema).toBe(HANDLER_ERROR_SCHEMA);
    expect(a.schema).toBe(b.schema);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(handlerErrorContract('payment'))).toBe(true);
  });
});
