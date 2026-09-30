import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoContract } from '../../../src/ArvoContract/index.js';
import { checkCollisions } from '../../../src/ArvoEventHandler/helpers/check-collisions.js';
import type { ArvoSemanticVersion } from '../../../src/semver/index.js';
import {
  orderContract,
  paymentContract,
  shippingContract,
} from './fixtures.js';

const both: ArvoSemanticVersion[] = ['1.0.0', '1.1.0'];

/** A contract whose own type equals one of the order contract's outputs. */
const clashesWithOutput = new ArvoContract({
  type: 'com_order_created',
  versions: { '1.0.0': { input: z.object({}), outputs: {} } },
});

/** A contract whose own type equals the order contract's handler error type. */
const clashesWithHandlerError = new ArvoContract({
  type: 'handler_com_order_create_error',
  versions: { '1.0.0': { input: z.object({}), outputs: {} } },
});

describe('checkCollisions', () => {
  describe('what is allowed', () => {
    it('allows no services', () => {
      expect(checkCollisions(orderContract, {}, both)).toEqual([]);
    });

    it('allows unrelated services', () => {
      expect(
        checkCollisions(
          orderContract,
          {
            payments: paymentContract.versions['1.0.0'],
            shipping: shippingContract.versions['1.0.0'],
          },
          both,
        ),
      ).toEqual([]);
    });

    it('allows the implemented contract as a service, which is recursion', () => {
      expect(
        checkCollisions(
          orderContract,
          { self: orderContract.versions['1.0.0'] },
          both,
        ),
      ).toEqual([]);
    });

    it('allows recursion on a version that also declares outputs', () => {
      expect(
        checkCollisions(
          orderContract,
          { self: orderContract.versions['1.0.0'] },
          ['1.0.0'],
        ),
      ).toEqual([]);
    });
  });

  describe('what is refused', () => {
    it('refuses two services sharing a type', () => {
      const issues = checkCollisions(
        orderContract,
        {
          payments: paymentContract.versions['1.0.0'],
          alias: paymentContract.versions['1.1.0'],
        },
        ['1.0.0'],
      );
      expect(issues).toHaveLength(1);
      expect(issues[0]?.received).toBe('com_payment_charge');
    });

    it('refuses a service colliding with an output of one version', () => {
      const issues = checkCollisions(
        orderContract,
        { clash: clashesWithOutput.versions['1.0.0'] },
        both,
      );
      expect(issues).toHaveLength(1);
      expect(issues[0]?.path).toBe('versions["1.0.0"]');
    });

    it('refuses a service colliding with a handler error type', () => {
      expect(
        checkCollisions(
          orderContract,
          { clash: clashesWithHandlerError.versions['1.0.0'] },
          ['1.1.0'],
        ),
      ).toHaveLength(1);
    });

    it('names both sides of the clash', () => {
      const [issue] = checkCollisions(
        orderContract,
        { clash: clashesWithOutput.versions['1.0.0'] },
        ['1.0.0'],
      );
      expect(issue?.message).toContain('the input of service clash');
      expect(issue?.message).toContain('com_order_created');
    });

    it('reports one issue per version that collides, and no others', () => {
      const issues = checkCollisions(
        orderContract,
        { clash: clashesWithHandlerError.versions['1.0.0'] },
        both,
      );
      expect(issues).toHaveLength(2);
      expect(issues.map((issue) => issue.path)).toEqual([
        'versions["1.0.0"]',
        'versions["1.1.0"]',
      ]);
    });

    it('reports nothing as blocking', () => {
      const [issue] = checkCollisions(
        orderContract,
        { clash: clashesWithOutput.versions['1.0.0'] },
        ['1.0.0'],
      );
      expect(issue?.isBlocking).toBe(false);
    });
  });

  it('checks a version it is given even where the contract does not declare it', () => {
    expect(
      checkCollisions(orderContract, { p: paymentContract.versions['1.0.0'] }, [
        '9.9.9' as ArvoSemanticVersion,
      ]),
    ).toEqual([]);
  });
});
