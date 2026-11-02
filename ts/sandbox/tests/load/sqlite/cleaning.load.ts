import { describe, expect, it } from 'vitest';
import { buildRecord, buildState } from '../../../src/load/harness/builders.js';
import { LatencySamples } from '../../../src/load/harness/measure.js';
import { startChild } from '../../../src/load/harness/processes.js';
import {
  ageEverything,
  countRows,
} from '../../../src/load/harness/sqlite-file.js';
import {
  type OpenedSubject,
  sqliteSubject,
} from '../../../src/load/harness/subjects.js';

/** Commits `count` events in batches, and marks them all seen. */
const commitSeenEvents = async (opened: OpenedSubject, count: number) => {
  for (let committedCount = 0; committedCount < count; committedCount += 5000) {
    const records = Array.from(
      { length: Math.min(5000, count - committedCount) },
      () => buildRecord({ payloadBytes: 32 }),
    );
    await opened.outbox.commitEvents({ events: records });
    await opened.outbox.markEventsSeen(records.map((record) => record.id));
  }
};

/** Commits the first revision of `count` executions at one lifecycle. */
const commitStates = async (
  opened: OpenedSubject,
  count: number,
  lifecycle: string,
) => {
  for (let committedCount = 0; committedCount < count; committedCount += 1) {
    const executionId = crypto.randomUUID();
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
};

/** The SQLite outbox's own way to delete everything expired. */
const deleteExpired = (opened: OpenedSubject) => {
  if (opened.deleteExpired === null)
    throw new Error('only a SQLite outbox deletes on being asked');
  return opened.deleteExpired();
};

describe('sqlite: cleaning up', () => {
  it('deletes fifty thousand expired seen events and twenty thousand terminal states, timing it, keeping the rest', async () => {
    const check = 'deleting fifty thousand events and twenty thousand states';
    const opened = await sqliteSubject.open({
      sqlite: { retentionMs: { seenEvents: 60_000, terminalStates: 60_000 } },
    });
    try {
      await commitSeenEvents(opened, 50_000);
      await commitStates(opened, 20_000, 'success');
      ageEverything(opened.filename ?? '');
      await opened.outbox.commitEvents({ events: [buildRecord()] });
      await commitStates(opened, 500, 'waiting');
      ageEverything(opened.filename ?? '');
      const deleting = new LatencySamples();
      const deletedCounts = await deleting.time(() => deleteExpired(opened));
      deleting.report(check, 'delete everything expired');
      expect(deletedCounts).toEqual({ events: 50_000, states: 20_000 });
      expect(countRows(opened.filename ?? '')).toEqual({
        events: 1,
        states: 500,
      });
    } finally {
      await opened.close();
    }
  });

  it('keeps everything at an unending retention, and deletes seen events as they are marked at zero', async () => {
    const forever = await sqliteSubject.open({
      sqlite: {
        retentionMs: {
          seenEvents: Number.POSITIVE_INFINITY,
          terminalStates: Number.POSITIVE_INFINITY,
        },
      },
    });
    try {
      await commitSeenEvents(forever, 1000);
      await commitStates(forever, 100, 'success');
      ageEverything(forever.filename ?? '');
      expect(deleteExpired(forever)).toEqual({ events: 0, states: 0 });
    } finally {
      await forever.close();
    }
    const immediate = await sqliteSubject.open({
      sqlite: { retentionMs: { seenEvents: 0 } },
    });
    try {
      await commitSeenEvents(immediate, 400);
      expect(countRows(immediate.filename ?? '').events).toBe(0);
    } finally {
      await immediate.close();
    }
  });

  it('deletes only what expired while four other processes commit to the same file', async () => {
    const opened = await sqliteSubject.open({
      sqlite: { retentionMs: { seenEvents: 60_000, terminalStates: 60_000 } },
    });
    try {
      await commitSeenEvents(opened, 5000);
      ageEverything(opened.filename ?? '');
      const committers = Array.from({ length: 4 }, () =>
        startChild<{ kind: string; landed?: boolean }>('sqlite-committer', {
          filename: opened.filename,
          executionIds: Array.from({ length: 300 }, () => crypto.randomUUID()),
          eventsPerCommit: 5,
        }),
      );
      let deletedEvents = 0;
      let committersRunning = committers.length;
      for (const committer of committers) {
        committer.child.once('exit', () => {
          committersRunning -= 1;
        });
      }
      while (committersRunning > 0) {
        deletedEvents += deleteExpired(opened).events;
        await new Promise((settle) => setTimeout(settle, 10));
      }
      for (const ending of await Promise.all(
        committers.map((committer) => committer.ended),
      )) {
        expect(ending).toEqual({ code: 0, signal: null });
      }
      const landed = committers
        .flatMap((committer) => committer.messages)
        .filter((message) => message.landed === true).length;
      expect(landed).toBe(1200);
      expect(deletedEvents).toBe(5000);
      expect(countRows(opened.filename ?? '')).toEqual({
        events: 6000,
        states: 1200,
      });
    } finally {
      await opened.close();
    }
  });
});
