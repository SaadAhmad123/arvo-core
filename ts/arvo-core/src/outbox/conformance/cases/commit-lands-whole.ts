import { expect } from 'vitest';
import { sortedEventIds } from '../fixtures/event-ids.js';
import { buildEventRecord } from '../fixtures/event-record.js';
import { buildStateCommit } from '../fixtures/state-commit.js';
import type { ArvoOutboxConformanceCase } from '../types.js';

/** A commit lands whole or leaves nothing behind. */
export const commitLandsWholeCases: readonly ArvoOutboxConformanceCase[] = [
  {
    name: 'stores a committed state and every event committed with it',
    check: async (outbox) => {
      const executionId = crypto.randomUUID();
      const events = [
        buildEventRecord({ executionId, casVersion: 0 }),
        buildEventRecord({ executionId, casVersion: 0 }),
      ];
      await outbox.commitStateAndEvents(
        buildStateCommit({
          executionId,
          casVersion: 0,
          state: { landed: true },
          events,
        }),
      );
      expect(await outbox.readLatestState(executionId)).toEqual({
        landed: true,
      });
      expect(
        sortedEventIds(await outbox.readCommittedEvents({ executionId })),
      ).toEqual(sortedEventIds(events));
    },
  },
  {
    name: 'stores neither the state nor any event of a refused commit',
    check: async (outbox) => {
      const executionId = crypto.randomUUID();
      const committedEvent = buildEventRecord({ executionId, casVersion: 0 });
      await outbox.commitStateAndEvents(
        buildStateCommit({
          executionId,
          casVersion: 0,
          state: { winner: true },
          events: [committedEvent],
        }),
      );
      const refusedTriggeringEventId = crypto.randomUUID();
      await outbox.commitStateAndEvents(
        buildStateCommit({
          executionId,
          casVersion: 0,
          state: { winner: false },
          events: [
            buildEventRecord({
              executionId,
              casVersion: 0,
              triggeringEventId: refusedTriggeringEventId,
            }),
          ],
        }),
      );
      expect(await outbox.readLatestState(executionId)).toEqual({
        winner: true,
      });
      expect(
        await outbox.readCommittedEvents({
          triggeringEventId: refusedTriggeringEventId,
        }),
      ).toEqual([]);
      expect(
        sortedEventIds(await outbox.readCommittedEvents({ executionId })),
      ).toEqual([committedEvent.id]);
    },
  },
];
