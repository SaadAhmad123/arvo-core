import { expect } from 'vitest';
import type { IArvoOutbox } from '../../../ArvoOutbox/interface.js';
import { buildEventRecord } from '../fixtures/event-record.js';
import { buildStateCommit } from '../fixtures/state-commit.js';
import type { ArvoOutboxConformanceCase } from '../types.js';

/** Every operation, each called as on a working outbox, answering through a promise. */
const everyOperation = (outbox: IArvoOutbox) => {
  const executionId = crypto.randomUUID();
  return [
    async () => outbox.readLatestState(executionId),
    async () =>
      outbox.commitStateAndEvents(
        buildStateCommit({ executionId, casVersion: 0 }),
      ),
    async () => outbox.commitEvents({ events: [buildEventRecord()] }),
    async () => outbox.readCommittedEvents({ executionId }),
    async () => outbox.listUnseenEvents({ atMost: 10, olderThanMs: 0 }),
    async () => outbox.markEventsSeen([crypto.randomUUID()]),
  ];
};

/** An outbox may be opened and closed again, and nothing works once it is closed. */
export const outboxIsOpenedAndClosedCases: readonly ArvoOutboxConformanceCase[] =
  [
    {
      name: 'opens again without failing, and still works',
      check: async (outbox) => {
        await outbox.open();
        const event = buildEventRecord();
        await outbox.commitEvents({ events: [event] });
        const committedEvents = await outbox.readCommittedEvents({
          triggeringEventId: event.triggeringEventId,
        });
        expect(
          committedEvents.map((committedEvent) => committedEvent.id),
        ).toEqual([event.id]);
      },
    },
    {
      name: 'closes again without failing',
      check: async (outbox) => {
        await outbox.close();
        await expect(
          Promise.resolve().then(() => outbox.close()),
        ).resolves.toBeUndefined();
      },
    },
    {
      name: 'throws on every operation once closed',
      check: async (outbox) => {
        await outbox.close();
        for (const operation of everyOperation(outbox)) {
          await expect(operation()).rejects.toThrow();
        }
      },
    },
  ];
