import { expect } from 'vitest';
import { buildEventRecord } from '../fixtures/event-record.js';
import { listEveryUnseenEvent } from '../fixtures/unseen-param.js';
import type { ArvoOutboxConformanceCase } from '../types.js';

/** Asking for a lease never changes what the listing that asks returns. */
export const listingWithALeaseCases: readonly ArvoOutboxConformanceCase[] = [
  {
    name: 'lists unseen events when asked to lease them, as it would unasked',
    check: async (outbox) => {
      const events = [buildEventRecord(), buildEventRecord()];
      await outbox.commitEvents({ events });
      const leasedEvents = await outbox.listUnseenEvents({
        ...listEveryUnseenEvent,
        leaseMs: 60_000,
      });
      expect(leasedEvents.map((event) => event.id)).toEqual(
        events.map((event) => event.id),
      );
    },
  },
];
