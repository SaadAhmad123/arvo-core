import { expect } from 'vitest';
import { sortedEventIds } from '../fixtures/event-ids.js';
import { buildEventRecord } from '../fixtures/event-record.js';
import { withoutOutboxFields } from '../fixtures/without-outbox-fields.js';
import type { ArvoOutboxConformanceCase } from '../types.js';

/** Committed events are read by execution, by delivery, or by both. */
export const eventsAreReadByFilterCases: readonly ArvoOutboxConformanceCase[] =
  [
    {
      name: "reads exactly one delivery's events, as committed",
      check: async (outbox) => {
        const executionId = crypto.randomUUID();
        const triggeringEventId = crypto.randomUUID();
        const deliveryEvents = [
          buildEventRecord({ executionId, triggeringEventId }),
          buildEventRecord({ executionId, triggeringEventId }),
        ];
        await outbox.commitEvents({ events: deliveryEvents });
        await outbox.commitEvents({
          events: [buildEventRecord({ executionId })],
        });
        const committedEvents = await outbox.readCommittedEvents({
          triggeringEventId,
        });
        expect(sortedEventIds(committedEvents)).toEqual(
          sortedEventIds(deliveryEvents),
        );
        for (const committedEvent of committedEvents) {
          expect(withoutOutboxFields(committedEvent)).toStrictEqual(
            deliveryEvents.find((event) => event.id === committedEvent.id),
          );
        }
      },
    },
    {
      name: 'reads every event of one execution, across its deliveries',
      check: async (outbox) => {
        const executionId = crypto.randomUUID();
        const executionEvents = [
          buildEventRecord({ executionId }),
          buildEventRecord({ executionId }),
        ];
        await outbox.commitEvents({
          events: [executionEvents[0], buildEventRecord()],
        });
        await outbox.commitEvents({
          events: [executionEvents[1], buildEventRecord()],
        });
        expect(
          sortedEventIds(await outbox.readCommittedEvents({ executionId })),
        ).toEqual(sortedEventIds(executionEvents));
      },
    },
    {
      name: 'reads only the events matching both a delivery and an execution',
      check: async (outbox) => {
        const executionId = crypto.randomUUID();
        const triggeringEventId = crypto.randomUUID();
        const matchingEvent = buildEventRecord({
          executionId,
          triggeringEventId,
        });
        await outbox.commitEvents({
          events: [
            matchingEvent,
            buildEventRecord({ executionId }),
            buildEventRecord({ triggeringEventId }),
          ],
        });
        expect(
          sortedEventIds(
            await outbox.readCommittedEvents({
              executionId,
              triggeringEventId,
            }),
          ),
        ).toEqual([matchingEvent.id]);
      },
    },
    {
      name: 'reads events already seen, marked as seen',
      check: async (outbox) => {
        const executionId = crypto.randomUUID();
        const seenEvent = buildEventRecord({ executionId });
        const unseenEvent = buildEventRecord({ executionId });
        await outbox.commitEvents({ events: [seenEvent, unseenEvent] });
        await outbox.markEventsSeen([seenEvent.id]);
        const seenById = Object.fromEntries(
          (await outbox.readCommittedEvents({ executionId })).map((event) => [
            event.id,
            event.seen,
          ]),
        );
        expect(seenById).toEqual({
          [seenEvent.id]: true,
          [unseenEvent.id]: false,
        });
      },
    },
    {
      name: 'reads nothing for a delivery that committed nothing',
      check: async (outbox) => {
        await outbox.commitEvents({ events: [buildEventRecord()] });
        expect(
          await outbox.readCommittedEvents({
            triggeringEventId: crypto.randomUUID(),
          }),
        ).toEqual([]);
      },
    },
  ];
