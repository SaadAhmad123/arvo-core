import { describe, expect, it } from 'vitest';
import { checkSharedTypes } from '../../../src/ArvoDispatcher/helpers/check-shared-types.js';
import {
  orderHandler,
  paymentContractElsewhere,
  paymentHandler,
  paymentHandlerFor,
} from '../fixtures.js';

describe('the shared-type rule', () => {
  it('accepts handlers implementing different types', () => {
    expect(checkSharedTypes([orderHandler(), paymentHandler()])).toEqual([]);
  });

  it('refuses two handlers under one type and one uri, naming the type', () => {
    const [issue] = checkSharedTypes([paymentHandler(), paymentHandler()]);
    expect(issue?.message).toContain('com_payment_charge');
    expect(issue?.message).toContain('implemented once');
  });

  it('refuses two handlers under one type even where their uris differ', () => {
    const [issue] = checkSharedTypes([
      paymentHandler(),
      paymentHandlerFor(paymentContractElsewhere),
    ]);
    expect(issue?.message).toContain('com_payment_charge');
    expect(issue?.message).toContain(paymentContractElsewhere.uri);
  });

  it('leaves one instance listed twice to the repeated-handler rule', () => {
    const payment = paymentHandler();
    expect(checkSharedTypes([payment, payment])).toEqual([]);
  });
});
