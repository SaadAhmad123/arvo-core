import { expect } from 'vitest';
import { buildEventRecord } from '../fixtures/event-record.js';
import { buildStateCommit } from '../fixtures/state-commit.js';
import type { ArvoOutboxConformanceCase } from '../types.js';

/** An event whose identifier is already committed is skipped, never failed. */
export const committedEventIsIgnoredCases: readonly ArvoOutboxConformanceCase[] =
  [
    {
      name: 'skips an event already committed when committing a state',
      check: async (outbox) => {
        const executionId = crypto.randomUUID();
        const originalEvent = buildEventRecord({
          executionId,
          casVersion: 0,
          payload: '"original"',
        });
        await outbox.commitStateAndEvents(
          buildStateCommit({
            executionId,
            casVersion: 0,
            events: [originalEvent],
          }),
        );
        const [storedEvent] = await outbox.readCommittedEvents({ executionId });
        const newEvent = buildEventRecord({ executionId, casVersion: 1 });
        expect(
          await outbox.commitStateAndEvents(
            buildStateCommit({
              executionId,
              casVersion: 1,
              events: [
                { ...originalEvent, casVersion: 1, payload: '"replacement"' },
                newEvent,
              ],
            }),
          ),
        ).toEqual({ committed: true });
        const committedEvents = await outbox.readCommittedEvents({
          executionId,
        });
        expect(
          committedEvents.find((event) => event.id === originalEvent.id),
        ).toStrictEqual(storedEvent);
        expect(committedEvents.map((event) => event.id)).toContain(newEvent.id);
      },
    },
    {
      name: 'skips an event already committed when committing events alone',
      check: async (outbox) => {
        const executionId = crypto.randomUUID();
        const originalEvent = buildEventRecord({
          executionId,
          payload: '"original"',
        });
        await outbox.commitEvents({ events: [originalEvent] });
        const [storedEvent] = await outbox.readCommittedEvents({ executionId });
        const newEvent = buildEventRecord({ executionId });
        await outbox.commitEvents({
          events: [{ ...originalEvent, payload: '"replacement"' }, newEvent],
        });
        const committedEvents = await outbox.readCommittedEvents({
          executionId,
        });
        expect(
          committedEvents.find((event) => event.id === originalEvent.id),
        ).toStrictEqual(storedEvent);
        expect(committedEvents.map((event) => event.id)).toContain(newEvent.id);
      },
    },
    {
      name: 'stores one of two events sharing an identifier in one commit',
      check: async (outbox) => {
        const executionId = crypto.randomUUID();
        const event = buildEventRecord({ executionId, casVersion: 0 });
        expect(
          await outbox.commitStateAndEvents(
            buildStateCommit({
              executionId,
              casVersion: 0,
              events: [event, { ...event }],
            }),
          ),
        ).toEqual({ committed: true });
        expect(
          (await outbox.readCommittedEvents({ executionId })).map(
            (committedEvent) => committedEvent.id,
          ),
        ).toEqual([event.id]);
      },
    },
  ];
