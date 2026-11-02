import { writeFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { buildRecord, byText } from '../../../src/load/harness/builders.js';
import { recordSkip } from '../../../src/load/harness/results.js';
import { countRows } from '../../../src/load/harness/sqlite-file.js';
import {
  type OpenedSubject,
  sqliteSubject,
} from '../../../src/load/harness/subjects.js';

/**
 * SQLite reads the system clock, so these checks move it with libfaketime,
 * inside their own container only.
 */

const clockFile = process.env.LOAD_FAKED_CLOCK_FILE;
const hourMs = 60 * 60 * 1000;

/** The real time: the process started before any time was faked, and monotonic time is never faked. */
const realNowMs = () => performance.timeOrigin + performance.now();

/** SQLite's own time, as it reads it now. */
const sqliteNowMs = (): number => {
  const database = new Database(':memory:');
  try {
    return Date.parse(
      String(
        database
          .prepare("select strftime('%Y-%m-%dT%H:%M:%fZ', 'now')")
          .pluck()
          .get(),
      ),
    );
  } finally {
    database.close();
  }
};

/**
 * Sets the time every clock in this container reads, and waits until SQLite
 * reads it: libfaketime takes up a new time a moment after its file changes.
 * Answers whether SQLite came to read it.
 */
const tryFakedTime = (timeMs: number): boolean => {
  const isoTime = new Date(timeMs).toISOString();
  writeFileSync(
    clockFile ?? '',
    `@${isoTime.slice(0, 10)} ${isoTime.slice(11, 19)}\n`,
  );
  const waitUntil = performance.now() + 5000;
  while (performance.now() < waitUntil) {
    if (Math.abs(sqliteNowMs() - timeMs) < 5000) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
  return false;
};

/** Whether SQLite's own clock follows the faked time in this container. */
const sqliteFollowsFakedClock = (): boolean =>
  clockFile !== undefined &&
  tryFakedTime(Date.parse('2001-01-01T00:00:00.000Z'));

/** Sets the faked time, throwing where SQLite never came to read it. */
const setFakedTime = (timeMs: number): void => {
  if (!tryFakedTime(timeMs)) {
    throw new Error(
      `SQLite did not come to read the faked time ${new Date(timeMs).toISOString()}`,
    );
  }
};

/** Commits `count` unseen events, answering their identifiers. */
const commitUnseen = async (opened: OpenedSubject, count: number) => {
  const records = Array.from({ length: count }, () => buildRecord());
  await opened.outbox.commitEvents({ events: records });
  return records.map((record) => record.id);
};

/** Every unseen event's identifier, listed whatever its lease. */
const listAllUnseen = async (opened: OpenedSubject) =>
  (
    await opened.driver.listUnseenEvents({
      atMost: 10_000,
      olderThanMs: 0,
      restoreEvents: false,
    })
  ).map((entry) => entry.record.id);

describe('sqlite: a clock that jumps', () => {
  const baseMs = Date.parse('2030-06-01T12:00:00.000Z');

  it('loses nothing committed while its clock jumps back', async (context) => {
    if (!sqliteFollowsFakedClock()) {
      recordSkip({
        check: 'loses nothing committed while its clock jumps back',
        reason: 'SQLite did not follow the faked clock in this container',
      });
      context.skip();
      return;
    }
    setFakedTime(baseMs);
    const opened = await sqliteSubject.open();
    try {
      const beforeJump = await commitUnseen(opened, 100);
      setFakedTime(baseMs - 24 * hourMs);
      const afterJump = await commitUnseen(opened, 100);
      setFakedTime(baseMs + 60_000);
      expect((await listAllUnseen(opened)).sort(byText)).toEqual(
        [...beforeJump, ...afterJump].sort(byText),
      );
    } finally {
      setFakedTime(realNowMs());
      await opened.close();
    }
  });

  it('deletes a seen event only once the clock is past its retention, whichever way the clock moved', async (context) => {
    if (!sqliteFollowsFakedClock()) {
      recordSkip({
        check:
          'deletes a seen event only once the clock is past its retention, whichever way the clock moved',
        reason: 'SQLite did not follow the faked clock in this container',
      });
      context.skip();
      return;
    }
    setFakedTime(baseMs);
    const opened = await sqliteSubject.open({
      sqlite: { retentionMs: { seenEvents: hourMs } },
    });
    try {
      const firstSeen = await commitUnseen(opened, 50);
      await opened.driver.markEventsSeen({ eventIds: firstSeen });
      const unseen = await commitUnseen(opened, 50);
      setFakedTime(baseMs + 2 * hourMs);
      await opened.driver.markEventsSeen({ eventIds: [] });
      expect(countRows(opened.filename ?? '').events).toBe(50);
      await opened.driver.markEventsSeen({ eventIds: unseen });
      setFakedTime(baseMs);
      await opened.driver.markEventsSeen({ eventIds: [] });
      expect(countRows(opened.filename ?? '').events).toBe(50);
      setFakedTime(baseMs + 4 * hourMs);
      await opened.driver.markEventsSeen({ eventIds: [] });
      expect(countRows(opened.filename ?? '').events).toBe(0);
    } finally {
      setFakedTime(realNowMs());
      await opened.close();
    }
  });

  it('lists a leased event again once the clock passes its lease, after jumping either way', async (context) => {
    if (!sqliteFollowsFakedClock()) {
      recordSkip({
        check:
          'lists a leased event again once the clock passes its lease, after jumping either way',
        reason: 'SQLite did not follow the faked clock in this container',
      });
      context.skip();
      return;
    }
    setFakedTime(baseMs);
    const opened = await sqliteSubject.open();
    try {
      const eventIds = await commitUnseen(opened, 20);
      await opened.driver.listUnseenEvents({
        atMost: 100,
        olderThanMs: 0,
        leaseMs: hourMs,
        restoreEvents: false,
      });
      expect(
        await opened.driver.listUnseenEvents({ atMost: 100, olderThanMs: 0 }),
      ).toEqual([]);
      setFakedTime(baseMs + 2 * hourMs);
      expect((await listAllUnseen(opened)).sort(byText)).toEqual(
        [...eventIds].sort(byText),
      );
      await opened.driver.listUnseenEvents({
        atMost: 100,
        olderThanMs: 0,
        leaseMs: hourMs,
        restoreEvents: false,
      });
      setFakedTime(baseMs);
      expect(
        await opened.driver.listUnseenEvents({ atMost: 100, olderThanMs: 0 }),
      ).toEqual([]);
      setFakedTime(baseMs + 4 * hourMs);
      expect((await listAllUnseen(opened)).sort(byText)).toEqual(
        [...eventIds].sort(byText),
      );
    } finally {
      setFakedTime(realNowMs());
      await opened.close();
    }
  });
});
