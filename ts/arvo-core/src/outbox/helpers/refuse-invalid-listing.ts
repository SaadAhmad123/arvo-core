import type { ArvoOutboxUnseenEventsParam } from '../../ArvoOutbox/types/read.js';

/**
 * Throws where a listing of unseen events asked of `outboxName` is no
 * listing at all, before anything is read or claimed. A negative `atMost`
 * would otherwise list everything, and an age that is no number would list
 * nothing, both silently.
 */
export const refuseInvalidListing = (
  outboxName: string,
  param: ArvoOutboxUnseenEventsParam,
): void => {
  if (!Number.isInteger(param.atMost) || param.atMost < 0) {
    throw new RangeError(
      `${outboxName} cannot list ${param.atMost} unseen events; atMost must be a whole number, zero or more.`,
    );
  }
  if (!Number.isFinite(param.olderThanMs) || param.olderThanMs < 0) {
    throw new RangeError(
      `${outboxName} cannot list unseen events older than ${param.olderThanMs} milliseconds; olderThanMs must be a finite number, zero or more.`,
    );
  }
  if (
    param.leaseMs !== undefined &&
    (!Number.isInteger(param.leaseMs) || param.leaseMs <= 0)
  ) {
    throw new RangeError(
      `${outboxName} cannot lease events for ${param.leaseMs} milliseconds; a lease must be a whole number of milliseconds greater than zero, or left out for none.`,
    );
  }
};
