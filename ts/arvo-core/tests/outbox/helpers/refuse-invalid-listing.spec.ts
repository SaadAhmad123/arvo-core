import { describe, expect, it } from 'vitest';
import { refuseInvalidListing } from '../../../src/outbox/helpers/refuse-invalid-listing.js';

describe('refusing a listing of unseen events that is no listing', () => {
  it('accepts a whole number to list, any age from zero, and a lease or none', () => {
    for (const param of [
      { atMost: 0, olderThanMs: 0 },
      { atMost: 10, olderThanMs: 1.5 },
      { atMost: 10, olderThanMs: 0, leaseMs: 1 },
    ]) {
      expect(() => refuseInvalidListing('AnOutbox', param)).not.toThrow();
    }
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses to list %s events',
    (atMost) => {
      expect(() =>
        refuseInvalidListing('AnOutbox', { atMost, olderThanMs: 0 }),
      ).toThrow(
        `AnOutbox cannot list ${atMost} unseen events; atMost must be a whole number, zero or more.`,
      );
    },
  );

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses to list events at least %s milliseconds old',
    (olderThanMs) => {
      expect(() =>
        refuseInvalidListing('AnOutbox', { atMost: 10, olderThanMs }),
      ).toThrow(
        `AnOutbox cannot list unseen events older than ${olderThanMs} milliseconds; olderThanMs must be a finite number, zero or more.`,
      );
    },
  );

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses a lease of %s milliseconds',
    (leaseMs) => {
      expect(() =>
        refuseInvalidListing('AnOutbox', {
          atMost: 10,
          olderThanMs: 0,
          leaseMs,
        }),
      ).toThrow(
        `AnOutbox cannot lease events for ${leaseMs} milliseconds; a lease must be a whole number of milliseconds greater than zero, or left out for none.`,
      );
    },
  );
});
