import { describe, expect, it } from 'vitest';
import { ArvoDispatcherValidationError } from '../../src/ArvoDispatcher/errors.js';
import { ArvoDispatcher } from '../../src/ArvoDispatcher/index.js';
import { orderHandler, paymentHandler } from './fixtures.js';

describe('a name standing outside the set', () => {
  const dispatcher = new ArvoDispatcher({
    handlers: [orderHandler(), paymentHandler()],
  });

  it('returns an accepted name from the primitive', () => {
    const accepted = dispatcher.tryValidateCallerName('com_acme_api');
    expect(accepted.ok && accepted.value).toBe('com_acme_api');
  });

  it('reports a refused name as the dispatcher’s validation error', () => {
    const refused = dispatcher.tryValidateCallerName('com_order_create');
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error).toBeInstanceOf(ArvoDispatcherValidationError);
  });

  it('returns an accepted name from the throwing form', () => {
    expect(dispatcher.validateCallerName('com_acme_api')).toBe('com_acme_api');
  });

  it('throws what the primitive reports', () => {
    const refused = dispatcher.tryValidateCallerName('com.acme.api');
    if (refused.ok) throw new Error('expected a refusal');
    expect(() => dispatcher.validateCallerName('com.acme.api')).toThrow(
      refused.error.message,
    );
  });
});
