import { expect } from 'vitest';
import type { IArvoOutbox } from '../../../ArvoOutbox/interface.js';
import { buildEventRecord } from '../fixtures/event-record.js';
import { buildStateCommit } from '../fixtures/state-commit.js';
import type { ArvoOutboxConformanceCase } from '../types.js';

/** Commits one state with events, and the same number of events alone. */
const commitBothWays = async (outbox: IArvoOutbox, executionId: string) => {
  const stateTriggeringEventId = crypto.randomUUID();
  const eventsTriggeringEventId = crypto.randomUUID();
  await outbox.commitStateAndEvents(
    buildStateCommit({
      executionId,
      casVersion: 0,
      events: [0, 1, 2].map(() =>
        buildEventRecord({
          executionId,
          casVersion: 0,
          triggeringEventId: stateTriggeringEventId,
        }),
      ),
    }),
  );
  await outbox.commitEvents({
    events: [0, 1, 2].map(() =>
      buildEventRecord({
        executionId,
        triggeringEventId: eventsTriggeringEventId,
      }),
    ),
  });
  return [
    await outbox.readCommittedEvents({
      triggeringEventId: stateTriggeringEventId,
    }),
    await outbox.readCommittedEvents({
      triggeringEventId: eventsTriggeringEventId,
    }),
  ];
};

/** Each commit is stamped once, by the outbox's clock, and stored unseen. */
export const commitIsStampedWhenLandedCases: readonly ArvoOutboxConformanceCase[] =
  [
    {
      name: 'stamps every committed event with an instant and stores it unseen',
      check: async (outbox) => {
        const committedEventsByCommit = await commitBothWays(
          outbox,
          crypto.randomUUID(),
        );
        for (const committedEvent of committedEventsByCommit.flat()) {
          expect(new Date(committedEvent.committedAt).toISOString()).toBe(
            committedEvent.committedAt,
          );
          expect(committedEvent.seen).toBe(false);
        }
      },
    },
    {
      name: 'stamps every event of one commit with the same instant',
      check: async (outbox) => {
        const committedEventsByCommit = await commitBothWays(
          outbox,
          crypto.randomUUID(),
        );
        for (const committedEvents of committedEventsByCommit) {
          expect(committedEvents).toHaveLength(3);
          expect(
            new Set(committedEvents.map((event) => event.committedAt)).size,
          ).toBe(1);
        }
      },
    },
  ];
