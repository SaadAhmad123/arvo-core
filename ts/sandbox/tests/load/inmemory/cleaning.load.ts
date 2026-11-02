import { describe, expect, it, vi } from 'vitest';
import {
  buildRecord,
  buildState,
  waitMs,
} from '../../../src/load/harness/builders.js';
import { watchThread } from '../../../src/load/harness/measure.js';
import {
  inMemorySubject,
  type OpenedSubject,
} from '../../../src/load/harness/subjects.js';

/** A clock the check moves, starting now. */
const createSettableClock = () => {
  let nowMs = Date.now();
  return {
    clock: () => new Date(nowMs),
    moveBy: (durationMs: number) => {
      nowMs += durationMs;
    },
    setInvalid: () => {
      nowMs = Number.NaN;
    },
    set: (movedToMs: number) => {
      nowMs = movedToMs;
    },
    readMs: () => nowMs,
  };
};

/**
 * One sweep, by the outbox's own timer. No outbox here keeps anything
 * longer than ten seconds, so each sweeps every second.
 */
const letOneSweepRun = () => waitMs(1300);

/** Commits `count` events straight to the outbox, in batches, and marks them all seen. */
const commitSeenEvents = async (opened: OpenedSubject, count: number) => {
  for (
    let committedCount = 0;
    committedCount < count;
    committedCount += 10_000
  ) {
    const records = Array.from(
      { length: Math.min(10_000, count - committedCount) },
      () => buildRecord({ payloadBytes: 32 }),
    );
    await opened.outbox.commitEvents({ events: records });
    await opened.outbox.markEventsSeen(records.map((record) => record.id));
  }
};

/** How many events the outbox holds. */
const eventsHeld = async (opened: OpenedSubject) =>
  (await opened.outbox.capacity({ events: 0 })).buffers.events?.held ?? 0;

describe('inmemory: cleaning up', () => {
  it('deletes fifty thousand expired seen events in one sweep, timing how long it held the thread', async () => {
    const settableClock = createSettableClock();
    const opened = await inMemorySubject.open({
      inmemory: {
        clock: settableClock.clock,
        retentionMs: { seenEvents: 10_000 },
      },
    });
    try {
      await commitSeenEvents(opened, 50_000);
      expect(await eventsHeld(opened)).toBe(50_000);
      settableClock.moveBy(20_000);
      const thread = watchThread();
      await letOneSweepRun();
      thread.report('sweep of fifty thousand seen events');
      expect(await eventsHeld(opened)).toBe(0);
    } finally {
      await opened.close();
    }
  });

  it('keeps what has not expired, and what is unseen however old', async () => {
    const settableClock = createSettableClock();
    const opened = await inMemorySubject.open({
      inmemory: {
        clock: settableClock.clock,
        retentionMs: { seenEvents: 10_000 },
      },
    });
    try {
      await commitSeenEvents(opened, 1000);
      await opened.outbox.commitEvents({ events: [buildRecord()] });
      settableClock.moveBy(5000);
      await letOneSweepRun();
      expect(await eventsHeld(opened)).toBe(1001);
      settableClock.moveBy(365 * 24 * 60 * 60 * 1000);
      await letOneSweepRun();
      expect(await eventsHeld(opened)).toBe(1);
    } finally {
      await opened.close();
    }
  });

  it('deletes seen events within a second at a retention of zero', async () => {
    const opened = await inMemorySubject.open({
      inmemory: { retentionMs: { seenEvents: 0 } },
    });
    try {
      await commitSeenEvents(opened, 5000);
      await letOneSweepRun();
      expect(await eventsHeld(opened)).toBe(0);
    } finally {
      await opened.close();
    }
  });

  it('deletes twenty thousand expired terminal states and keeps every waiting one', async () => {
    const settableClock = createSettableClock();
    const opened = await inMemorySubject.open({
      inmemory: {
        clock: settableClock.clock,
        retentionMs: { terminalStates: 10_000 },
      },
    });
    try {
      const commitStates = async (count: number, lifecycle: string) => {
        const executionIds = Array.from({ length: count }, () =>
          crypto.randomUUID(),
        );
        for (const executionId of executionIds) {
          await opened.outbox.commitStateAndEvents({
            executionId,
            casVersion: 0,
            subject: executionId,
            source: 'com_load_source',
            version: '1.0.0',
            lifecycle,
            state: buildState({ executionId, casVersion: 0, lifecycle }),
            events: [],
          });
        }
        return executionIds;
      };
      const finished = await commitStates(20_000, 'success');
      const waiting = await commitStates(1000, 'waiting');
      settableClock.moveBy(20_000);
      const thread = watchThread();
      await letOneSweepRun();
      thread.report('sweep of twenty thousand terminal states');
      const statesHeld = (await opened.outbox.capacity({ events: 0 })).buffers
        .states?.held;
      expect(statesHeld).toBe(1000);
      expect(
        await opened.driver.readLatestState({ executionId: finished[0] ?? '' }),
      ).toBeNull();
      expect(
        await opened.driver.readLatestState({ executionId: waiting[0] ?? '' }),
      ).not.toBeNull();
    } finally {
      await opened.close();
    }
  });

  it('deletes nothing unexpired and loses nothing when the clock jumps back', async () => {
    const settableClock = createSettableClock();
    const opened = await inMemorySubject.open({
      inmemory: {
        clock: settableClock.clock,
        retentionMs: { seenEvents: 10_000 },
      },
    });
    try {
      const startMs = settableClock.readMs();
      await commitSeenEvents(opened, 1000);
      settableClock.set(startMs - 24 * 60 * 60 * 1000);
      await letOneSweepRun();
      await commitSeenEvents(opened, 1000);
      expect(await eventsHeld(opened)).toBe(2000);
      settableClock.set(startMs + 5000);
      await letOneSweepRun();
      expect(await eventsHeld(opened)).toBe(2000);
      settableClock.set(startMs + 15_000);
      await letOneSweepRun();
      // the first thousand, seen at the start, are past their retention now
      expect(await eventsHeld(opened)).toBeLessThan(2000);
    } finally {
      await opened.close();
    }
  });

  it('warns and deletes nothing where the clock returns no valid time, then sweeps as usual', async () => {
    const settableClock = createSettableClock();
    const opened = await inMemorySubject.open({
      inmemory: { clock: settableClock.clock, retentionMs: { seenEvents: 0 } },
    });
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    try {
      await commitSeenEvents(opened, 100);
      const validMs = settableClock.readMs();
      settableClock.setInvalid();
      await letOneSweepRun();
      expect(warnSpy).toHaveBeenCalled();
      settableClock.set(validMs);
      expect(await eventsHeld(opened)).toBe(100);
      await letOneSweepRun();
      expect(await eventsHeld(opened)).toBe(0);
    } finally {
      warnSpy.mockRestore();
      await opened.close();
    }
  });
});
