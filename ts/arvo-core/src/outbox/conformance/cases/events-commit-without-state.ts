import { expect } from 'vitest';
import { sortedEventIds } from '../fixtures/event-ids.js';
import { buildEventRecord } from '../fixtures/event-record.js';
import { buildStateCommit } from '../fixtures/state-commit.js';
import type { ArvoOutboxConformanceCase } from '../types.js';

/** Events commit with no state, with nothing compared and nothing refused. */
export const eventsCommitWithoutStateCases: readonly ArvoOutboxConformanceCase[] =
  [
    {
      name: 'stores events committed with no state, each with no revision',
      check: async (outbox) => {
        const triggeringEventId = crypto.randomUUID();
        const events = [
          buildEventRecord({ triggeringEventId }),
          buildEventRecord({ triggeringEventId }),
        ];
        await outbox.commitEvents({ events });
        const committedEvents = await outbox.readCommittedEvents({
          triggeringEventId,
        });
        expect(sortedEventIds(committedEvents)).toEqual(sortedEventIds(events));
        for (const committedEvent of committedEvents) {
          expect(committedEvent.casVersion).toBeNull();
        }
      },
    },
    {
      name: 'leaves the stored state alone when events commit with no state',
      check: async (outbox) => {
        const executionId = crypto.randomUUID();
        await outbox.commitStateAndEvents(
          buildStateCommit({
            executionId,
            casVersion: 0,
            state: { untouched: true },
          }),
        );
        const event = buildEventRecord({ executionId });
        await outbox.commitEvents({ events: [event] });
        expect(
          sortedEventIds(await outbox.readCommittedEvents({ executionId })),
        ).toEqual([event.id]);
        expect(await outbox.readLatestState(executionId)).toEqual({
          untouched: true,
        });
        expect(
          await outbox.commitStateAndEvents(
            buildStateCommit({ executionId, casVersion: 1 }),
          ),
        ).toEqual({ committed: true });
      },
    },
  ];
