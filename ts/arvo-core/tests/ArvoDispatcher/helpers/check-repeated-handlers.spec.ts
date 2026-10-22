import { describe, expect, it } from 'vitest';
import { checkRepeatedHandlers } from '../../../src/ArvoDispatcher/helpers/check-repeated-handlers.js';
import { orderHandler, paymentHandler } from '../fixtures.js';

describe('the repeated-handler rule', () => {
  it('accepts distinct instances, even of one contract', () => {
    expect(checkRepeatedHandlers([orderHandler(), paymentHandler()])).toEqual(
      [],
    );
  });

  it('refuses one instance listed twice, naming it by its type and count', () => {
    const order = orderHandler();
    const [issue] = checkRepeatedHandlers([order, paymentHandler(), order]);
    expect(issue?.message).toContain('com_order_create');
    expect(issue?.message).toContain('2 times');
  });

  it('reports each repeated instance once', () => {
    const order = orderHandler();
    const payment = paymentHandler();
    expect(
      checkRepeatedHandlers([order, order, payment, payment, payment]),
    ).toHaveLength(2);
  });
});
