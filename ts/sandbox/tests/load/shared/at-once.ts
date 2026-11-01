import { describe, expect, it } from 'vitest';
import {
  buildEvent,
  buildRecord,
  buildState,
  waitMs,
} from '../../../src/load/harness/builders.js';
import { recordMeasurement } from '../../../src/load/harness/results.js';
import type { LoadSubject } from '../../../src/load/harness/subjects.js';
import { runOrders } from './lattice-check.js';

/** The timers this process holds, so a check can tell whether closing left one behind. */
const activeTimerCount = () =>
  process.getActiveResourcesInfo().filter((resource) => resource === 'Timeout')
    .length;

/** Things happening at once, on one outbox. */
export const describeAtOnce = (subject: LoadSubject): void => {
  describe(`${subject.name}: things happening at once`, () => {
    it('lets exactly one of sixty-four racing commits of one revision land', async () => {
      const opened = await subject.open();
      try {
        const executionId = crypto.randomUUID();
        for (const casVersion of [0, 1]) {
          const commits = await Promise.all(
            Array.from({ length: 64 }, () =>
              opened.driver.tryCommitStateAndEvents({
                state: buildState({ executionId, casVersion }),
                events: [buildEvent({ executionId, dataBytes: 16 })],
                triggeringEvent: buildEvent({ executionId, dataBytes: 16 }),
              }),
            ),
          );
          expect(commits.filter((commit) => commit.ok)).toHaveLength(1);
          for (const commit of commits.filter((candidate) => !candidate.ok)) {
            expect(!commit.ok && commit.error.kind).toBe(
              casVersion === 0 ? 'state_exists' : 'revision_stale',
            );
          }
        }
      } finally {
        await opened.close();
      }
    });

    it('stores an event committed twice in one commit, and again in another, once', async () => {
      const opened = await subject.open();
      try {
        const record = buildRecord();
        await opened.outbox.commitEvents({ events: [record, { ...record }] });
        await Promise.all(
          Array.from({ length: 20 }, () =>
            opened.outbox.commitEvents({ events: [{ ...record }] }),
          ),
        );
        const stored = await opened.outbox.readCommittedEvents({
          triggeringEventId: record.triggeringEventId,
        });
        expect(stored.map((storedRecord) => storedRecord.id)).toEqual([
          record.id,
        ]);
      } finally {
        await opened.close();
      }
    });

    it('hands each event to exactly one of four sweepers holding leases', async () => {
      const opened = await subject.open();
      try {
        const records = Array.from({ length: 3000 }, () => buildRecord());
        for (let start = 0; start < records.length; start += 500) {
          await opened.outbox.commitEvents({
            events: records.slice(start, start + 500),
          });
        }
        const handOutCountById = new Map<string, number>();
        const sweepUntilEmpty = async () => {
          for (;;) {
            const entries = await opened.driver.listUnseenEvents({
              atMost: 100,
              olderThanMs: 0,
              leaseMs: 60_000,
              restoreEvents: false,
            });
            if (entries.length === 0) return;
            for (const entry of entries) {
              handOutCountById.set(
                entry.record.id,
                (handOutCountById.get(entry.record.id) ?? 0) + 1,
              );
            }
            await waitMs(1);
            await opened.driver.markEventsSeen({
              eventIds: entries.map((entry) => entry.record.id),
            });
          }
        };
        await Promise.all(Array.from({ length: 4 }, () => sweepUntilEmpty()));
        expect(handOutCountById.size).toBe(3000);
        expect(
          [...handOutCountById.values()].every(
            (handOutCount) => handOutCount === 1,
          ),
        ).toBe(true);
      } finally {
        await opened.close();
      }
    });

    it('lists an event again once its lease lapses mid-send, and takes the late marking', async () => {
      const opened = await subject.open();
      try {
        const records = Array.from({ length: 50 }, () => buildRecord());
        await opened.outbox.commitEvents({ events: records });
        const slowSweep = await opened.driver.listUnseenEvents({
          atMost: 50,
          olderThanMs: 0,
          leaseMs: 100,
          restoreEvents: false,
        });
        expect(slowSweep).toHaveLength(50);
        expect(
          await opened.driver.listUnseenEvents({
            atMost: 50,
            olderThanMs: 0,
            leaseMs: 100,
          }),
        ).toHaveLength(0);
        await waitMs(300);
        const secondSweep = await opened.driver.listUnseenEvents({
          atMost: 50,
          olderThanMs: 0,
          leaseMs: 100,
          restoreEvents: false,
        });
        expect(secondSweep).toHaveLength(50);
        await opened.driver.markEventsSeen({
          eventIds: secondSweep.map((entry) => entry.record.id),
        });
        await opened.driver.markEventsSeen({
          eventIds: slowSweep.map((entry) => entry.record.id),
        });
        expect(
          await opened.driver.listUnseenEvents({ atMost: 50, olderThanMs: 0 }),
        ).toEqual([]);
      } finally {
        await opened.close();
      }
    });

    it('keeps listing and marking seen racing each other consistent', async () => {
      const opened = await subject.open();
      try {
        const records = Array.from({ length: 5000 }, () => buildRecord());
        for (let start = 0; start < records.length; start += 1000) {
          await opened.outbox.commitEvents({
            events: records.slice(start, start + 1000),
          });
        }
        const markedIds = new Set<string>();
        const lister = async () => {
          for (let round = 0; round < 200; round += 1) {
            // only what was marked seen before this listing began may not be in it
            const markedBeforeListing = new Set(markedIds);
            const entries = await opened.driver.listUnseenEvents({
              atMost: 100,
              olderThanMs: 0,
              restoreEvents: false,
            });
            for (const entry of entries) {
              expect(markedBeforeListing.has(entry.record.id)).toBe(false);
            }
            await waitMs(0);
          }
        };
        const marker = async () => {
          for (let start = 0; start < records.length; start += 50) {
            const eventIds = records
              .slice(start, start + 50)
              .map((record) => record.id);
            await opened.driver.markEventsSeen({ eventIds });
            for (const eventId of eventIds) markedIds.add(eventId);
            await waitMs(0);
          }
        };
        await Promise.all([lister(), marker()]);
        expect(
          await opened.driver.listUnseenEvents({ atMost: 10, olderThanMs: 0 }),
        ).toEqual([]);
      } finally {
        await opened.close();
      }
    });

    it('runs orders with a sweeper sweeping while workers commit, and workers dying after commits', async () => {
      const opened = await subject.open();
      try {
        const outcome = await runOrders({
          subject: opened,
          orderCount: 30,
          width: 10,
          depth: 2,
          workerCount: 16,
          sweeper: {
            intervalMs: 10,
            olderThanMs: 0,
            atMost: 200,
            leaseMs: 2000,
          },
          unsentShare: 0.3,
        });
        expect(outcome.sweptEvents).toBeGreaterThan(0);
        recordMeasurement({
          check: 'orders while sweeping',
          name: 'events swept',
          value: outcome.sweptEvents,
          unit: 'events',
        });
      } finally {
        await opened.close();
      }
    });

    it('answers every commit racing a close as committed or unavailable, and throws none', async () => {
      const opened = await subject.open();
      const commits = Array.from({ length: 200 }, (_unused, commitNumber) => {
        const executionId = crypto.randomUUID();
        return (async () => {
          await waitMs(commitNumber % 20);
          return opened.driver.tryCommitStateAndEvents({
            state: buildState({ executionId, casVersion: 0 }),
            events: [buildEvent({ executionId, dataBytes: 16 })],
            triggeringEvent: buildEvent({ executionId, dataBytes: 16 }),
          });
        })();
      });
      await waitMs(5);
      await opened.close();
      const answers = await Promise.all(commits);
      for (const answer of answers) {
        if (!answer.ok) expect(answer.error.kind).toBe('unavailable');
      }
      expect(answers.some((answer) => !answer.ok)).toBe(true);
    });

    it('leaves no timer behind after being opened and closed two hundred times', async () => {
      const timersBefore = activeTimerCount();
      for (let cycle = 0; cycle < 200; cycle += 1) {
        const opened = await subject.open();
        await opened.close();
      }
      await waitMs(50);
      // fewer is a timer of an earlier check expiring; more is one left behind
      expect(activeTimerCount()).toBeLessThanOrEqual(timersBefore);
    });
  });
};
