import { describe, expect, it } from 'vitest';
import { checkServices } from '../../../src/ArvoEventHandler/helpers/check-services.js';
import {
  orderContract,
  paymentContract,
  shippingContract,
} from './fixtures.js';

describe('checkServices', () => {
  it('accepts no services at all', () => {
    expect(checkServices({})).toEqual([]);
  });

  it('accepts one service', () => {
    expect(
      checkServices({ payments: paymentContract.versions['1.0.0'] }),
    ).toEqual([]);
  });

  it('accepts two services that are different contracts', () => {
    expect(
      checkServices({
        payments: paymentContract.versions['1.0.0'],
        shipping: shippingContract.versions['1.0.0'],
      }),
    ).toEqual([]);
  });

  it('accepts the implemented contract among the services, which is recursion', () => {
    expect(checkServices({ self: orderContract.versions['1.0.0'] })).toEqual(
      [],
    );
  });

  it('refuses two versions of one contract', () => {
    const issues = checkServices({
      payments: paymentContract.versions['1.0.0'],
      paymentsNew: paymentContract.versions['1.1.0'],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.received).toBe(paymentContract.uri);
  });

  it('names the service already declared, so both sides are visible', () => {
    const [issue] = checkServices({
      payments: paymentContract.versions['1.0.0'],
      paymentsNew: paymentContract.versions['1.1.0'],
    });
    expect(issue?.path).toBe('services["paymentsNew"]');
    expect(issue?.message).toContain('payments');
  });

  it('reports one issue per contract named more than once', () => {
    expect(
      checkServices({
        a: paymentContract.versions['1.0.0'],
        b: paymentContract.versions['1.1.0'],
        c: shippingContract.versions['1.0.0'],
      }),
    ).toHaveLength(1);
  });

  it('reports nothing as blocking', () => {
    const [issue] = checkServices({
      a: paymentContract.versions['1.0.0'],
      b: paymentContract.versions['1.1.0'],
    });
    expect(issue?.isBlocking).toBe(false);
  });
});
