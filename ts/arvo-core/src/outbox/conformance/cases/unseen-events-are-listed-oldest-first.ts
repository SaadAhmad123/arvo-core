import { expect } from 'vitest';
import type { IArvoOutbox } from '../../../ArvoOutbox/interface.js';
import { buildEventRecord } from '../fixtures/event-record.js';
import {
  listEveryUnseenEvent,
  listNothingRecent,
} from '../fixtures/unseen-param.js';
import type { ArvoOutboxConformanceCase } from '../types.js';

/** Commits one event per commit, one commit after another, and returns them. */
const commitOneAfterAnother = async (outbox: IArvoOutbox) => {
  const events = [buildEventRecord(), buildEventRecord(), buildEventRecord()];
  for (const event of events) {
    await outbox.commitEvents({ events: [event] });
  }
  return events.map((event) => event.id);
};

/** Unseen events are listed oldest first, at most so many, old enough. */
export const unseenEventsAreListedOldestFirstCases: readonly ArvoOutboxConformanceCase[] =
  [
    {
      name: 'lists unseen events in the order their commits landed',
      check: async (outbox) => {
        const eventIdsInCommitOrder = await commitOneAfterAnother(outbox);
        const unseenEvents =
          await outbox.listUnseenEvents(listEveryUnseenEvent);
        expect(unseenEvents.map((event) => event.id)).toEqual(
          eventIdsInCommitOrder,
        );
      },
    },
    {
      name: 'lists no more unseen events than asked for, the oldest',
      check: async (outbox) => {
        const eventIdsInCommitOrder = await commitOneAfterAnother(outbox);
        const unseenEvents = await outbox.listUnseenEvents({
          ...listEveryUnseenEvent,
          atMost: 2,
        });
        expect(unseenEvents.map((event) => event.id)).toEqual(
          eventIdsInCommitOrder.slice(0, 2),
        );
      },
    },
    {
      name: 'lists no unseen event that landed more recently than asked',
      check: async (outbox) => {
        await commitOneAfterAnother(outbox);
        expect(await outbox.listUnseenEvents(listNothingRecent)).toEqual([]);
      },
    },
    {
      name: 'lists every unseen event that landed at least as long ago as asked',
      check: async (outbox) => {
        const eventIdsInCommitOrder = await commitOneAfterAnother(outbox);
        const unseenEvents =
          await outbox.listUnseenEvents(listEveryUnseenEvent);
        expect(unseenEvents).toHaveLength(eventIdsInCommitOrder.length);
        for (const unseenEvent of unseenEvents) {
          expect(unseenEvent.seen).toBe(false);
        }
      },
    },
    {
      name: 'lists no event once it is marked seen',
      check: async (outbox) => {
        const [seenEventId, ...unseenEventIds] =
          await commitOneAfterAnother(outbox);
        await outbox.markEventsSeen([seenEventId]);
        const unseenEvents =
          await outbox.listUnseenEvents(listEveryUnseenEvent);
        expect(unseenEvents.map((event) => event.id)).toEqual(unseenEventIds);
      },
    },
  ];
