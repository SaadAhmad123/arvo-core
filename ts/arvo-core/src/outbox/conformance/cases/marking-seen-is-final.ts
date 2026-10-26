import { expect } from 'vitest';
import type { IArvoOutbox } from '../../../ArvoOutbox/interface.js';
import { buildEventRecord } from '../fixtures/event-record.js';
import type { ArvoOutboxConformanceCase } from '../types.js';

/** Commits one event and reads it back as stored. */
const commitAndReadOneEvent = async (outbox: IArvoOutbox) => {
  const event = buildEventRecord();
  await outbox.commitEvents({ events: [event] });
  const readStoredEvent = async () =>
    (
      await outbox.readCommittedEvents({
        triggeringEventId: event.triggeringEventId,
      })
    )[0];
  return {
    eventId: event.id,
    storedEvent: await readStoredEvent(),
    readStoredEvent,
  };
};

/** Marking an event seen changes only that, and may be repeated. */
export const markingSeenIsFinalCases: readonly ArvoOutboxConformanceCase[] = [
  {
    name: 'marks an event seen and changes nothing else about it',
    check: async (outbox) => {
      const { eventId, storedEvent, readStoredEvent } =
        await commitAndReadOneEvent(outbox);
      await outbox.markEventsSeen([eventId]);
      expect(await readStoredEvent()).toStrictEqual({
        ...storedEvent,
        seen: true,
      });
    },
  },
  {
    name: 'marks an event already seen again without change or failure',
    check: async (outbox) => {
      const { eventId, readStoredEvent } = await commitAndReadOneEvent(outbox);
      await outbox.markEventsSeen([eventId]);
      const seenEvent = await readStoredEvent();
      await expect(
        Promise.resolve(outbox.markEventsSeen([eventId])),
      ).resolves.toBeUndefined();
      expect(await readStoredEvent()).toStrictEqual(seenEvent);
    },
  },
  {
    name: 'ignores an identifier no committed event carries',
    check: async (outbox) => {
      const { storedEvent, readStoredEvent } =
        await commitAndReadOneEvent(outbox);
      await expect(
        Promise.resolve(outbox.markEventsSeen([crypto.randomUUID()])),
      ).resolves.toBeUndefined();
      expect(await readStoredEvent()).toStrictEqual(storedEvent);
    },
  },
];
