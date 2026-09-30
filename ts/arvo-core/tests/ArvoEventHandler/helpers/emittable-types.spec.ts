import { describe, expect, it } from 'vitest';
import { emittableTypes } from '../../../src/ArvoEventHandler/helpers/emittable-types.js';
import type { ArvoSemanticVersion } from '../../../src/semver/index.js';
import {
  orderContract,
  paymentContract,
  shippingContract,
} from './fixtures.js';

const services = {
  payments: paymentContract.versions['1.0.0'],
  shipping: shippingContract.versions['1.0.0'],
};

describe('emittableTypes', () => {
  it('carries every service input, the version outputs, and the handler error', () => {
    expect(
      [...emittableTypes(orderContract, services, '1.0.0')].sort(),
    ).toEqual([
      'com_order_created',
      'com_payment_charge',
      'com_shipping_book',
      'handler_com_order_create_error',
    ]);
  });

  it('differs by version, a version with no outputs carrying none', () => {
    expect(
      [...emittableTypes(orderContract, services, '1.1.0')].sort(),
    ).toEqual([
      'com_payment_charge',
      'com_shipping_book',
      'handler_com_order_create_error',
    ]);
  });

  it('carries the handler error even with no services and no outputs', () => {
    expect([...emittableTypes(orderContract, {}, '1.1.0')]).toEqual([
      'handler_com_order_create_error',
    ]);
  });

  it('is empty for a version the contract does not declare', () => {
    expect(
      emittableTypes(orderContract, {}, '9.9.9' as ArvoSemanticVersion).size,
    ).toBe(0);
  });

  it('cannot be added to by a caller that reads it', () => {
    expect(
      Object.isFrozen(emittableTypes(orderContract, services, '1.0.0')),
    ).toBe(true);
  });
});
