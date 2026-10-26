import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import Database from 'better-sqlite3';
import { afterAll, describe, expect, it } from 'vitest';
import { buildEventRecord } from '../../../src/outbox/conformance/fixtures/event-record.js';
import { buildStateCommit } from '../../../src/outbox/conformance/fixtures/state-commit.js';
import { expiredEventsDeletedPerMarking } from '../../../src/outbox/sqlite/helpers/defaults.js';
import { ArvoSqliteOutbox } from '../../../src/outbox/sqlite/index.js';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'arvo-sqlite-outbox-'));
const openedOutboxes: ArvoSqliteOutbox[] = [];

afterAll(() => {
  for (const openedOutbox of openedOutboxes) openedOutbox.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

/** A file name in the test's own directory that nothing has used. */
const newFilename = () =>
  join(temporaryDirectory, `${crypto.randomUUID()}.sqlite`);

/** Opens an outbox that is closed when the suite ends, if the test does not. */
const openOutbox = (filename: string, busyTimeoutMs?: number) => {
  const outbox = new ArvoSqliteOutbox({ filename, busyTimeoutMs });
  openedOutboxes.push(outbox);
  return outbox;
};

describe('ArvoSqliteOutbox and its file', () => {
  it('creates a new file with everything it needs, writing ahead of its log', () => {
    const filename = newFilename();
    openOutbox(filename);
    expect(existsSync(filename)).toBe(true);
    const inspector = new Database(filename, { readonly: true });
    const schemaNames = inspector
      .prepare<[], { name: string }>(
        "select name from sqlite_schema where name like 'arvo_outbox%' order by name",
      )
      .all()
      .map((schemaEntry) => schemaEntry.name);
    expect(schemaNames).toEqual(
      expect.arrayContaining(['arvo_outbox_event', 'arvo_outbox_state']),
    );
    expect(schemaNames.length).toBeGreaterThan(2);
    expect(inspector.pragma('journal_mode', { simple: true })).toBe('wal');
    inspector.close();
  });

  it('throws on a file that is not a SQLite database, leaving it as it was', () => {
    const filename = newFilename();
    writeFileSync(
      filename,
      'not a database, but long enough to have a header page',
    );
    expect(() => new ArvoSqliteOutbox({ filename })).toThrow(/not a database/);
    expect(existsSync(filename)).toBe(true);
  });

  it('leaves in place what a file it did not make already holds', () => {
    const filename = newFilename();
    const ownerOfTheFile = new Database(filename);
    ownerOfTheFile.exec(
      "create table other_table (note text); insert into other_table values ('kept')",
    );
    ownerOfTheFile.close();
    openOutbox(filename).commitEvents({ events: [buildEventRecord()] });
    const inspector = new Database(filename, { readonly: true });
    expect(
      inspector.prepare('select note from other_table').pluck().get(),
    ).toBe('kept');
    inspector.close();
  });

  it('reads back everything committed, as it was, once closed and opened again', () => {
    const filename = newFilename();
    const executionId = crypto.randomUUID();
    const seenEvent = buildEventRecord({ executionId, casVersion: 1 });
    const unseenEvent = buildEventRecord({ executionId, casVersion: 1 });
    const firstOutbox = new ArvoSqliteOutbox({ filename });
    firstOutbox.commitStateAndEvents(
      buildStateCommit({ executionId, casVersion: 0 }),
    );
    firstOutbox.commitStateAndEvents(
      buildStateCommit({
        executionId,
        casVersion: 1,
        state: { step: 'latest' },
        events: [seenEvent, unseenEvent],
      }),
    );
    firstOutbox.markEventsSeen([seenEvent.id]);
    const committedEvents = firstOutbox.readCommittedEvents({ executionId });
    firstOutbox.close();

    const reopenedOutbox = openOutbox(filename);
    expect(reopenedOutbox.readLatestState(executionId)).toEqual({
      step: 'latest',
    });
    expect(reopenedOutbox.readCommittedEvents({ executionId })).toEqual(
      committedEvents,
    );
    expect(committedEvents.map((event) => event.seen)).toEqual([true, false]);
    expect(
      reopenedOutbox.commitStateAndEvents(
        buildStateCommit({ executionId, casVersion: 2 }),
      ),
    ).toEqual({ committed: true });
  });

  it('stamps every event of one commit with one time, in an event time form, by its own clock', () => {
    const outbox = openOutbox(newFilename());
    const executionId = crypto.randomUUID();
    const beforeMs = Date.now();
    outbox.commitEvents({
      events: [0, 1, 2].map(() => buildEventRecord({ executionId })),
    });
    const afterMs = Date.now();
    const landingTimes = new Set(
      outbox
        .readCommittedEvents({ executionId })
        .map((event) => event.committedAt),
    );
    expect(landingTimes.size).toBe(1);
    const [committedAt = ''] = landingTimes;
    expect(new Date(committedAt).toISOString()).toBe(committedAt);
    expect(Date.parse(committedAt)).toBeGreaterThanOrEqual(beforeMs - 1000);
    expect(Date.parse(committedAt)).toBeLessThanOrEqual(afterMs + 1000);
  });
});

describe('ArvoSqliteOutbox beside other writers of its file', () => {
  it('refuses the second of two outboxes on one file committing one revision', () => {
    const filename = newFilename();
    const executionId = crypto.randomUUID();
    const firstOutbox = openOutbox(filename);
    const secondOutbox = openOutbox(filename);
    expect(
      firstOutbox.commitStateAndEvents(
        buildStateCommit({
          executionId,
          casVersion: 0,
          state: { winner: 'first' },
        }),
      ),
    ).toEqual({ committed: true });
    expect(
      secondOutbox.commitStateAndEvents(
        buildStateCommit({ executionId, casVersion: 0 }),
      ),
    ).toEqual({ committed: false, refusal: 'state_exists' });
    expect(secondOutbox.readLatestState(executionId)).toEqual({
      winner: 'first',
    });
  });

  it('commits each revision once where threads race for it on one file', async () => {
    const filename = newFilename();
    openOutbox(filename);
    const executionIds = Array.from({ length: 200 }, () => crypto.randomUUID());
    const startingLine = new SharedArrayBuffer(4);
    const raceOneThread = (racerName: string) =>
      new Promise<boolean[]>((answer, fail) => {
        const racer = new Worker(new URL('./racer.mts', import.meta.url), {
          workerData: { filename, executionIds, startingLine, racerName },
        });
        racer.once('message', answer);
        racer.once('error', fail);
      });
    const [firstRacerCommits, secondRacerCommits] = await Promise.all([
      raceOneThread('first'),
      raceOneThread('second'),
    ]);
    executionIds.forEach((_executionId, position) => {
      expect(
        [firstRacerCommits?.[position], secondRacerCommits?.[position]].filter(
          Boolean,
        ),
      ).toHaveLength(1);
    });
  });

  it('throws where another writer holds the file beyond its wait, having stored nothing', () => {
    const filename = newFilename();
    const outbox = openOutbox(filename, 50);
    const otherWriter = new Database(filename);
    otherWriter.exec('begin immediate');
    const executionId = crypto.randomUUID();
    const event = buildEventRecord({ executionId });
    try {
      expect(() =>
        outbox.commitStateAndEvents(
          buildStateCommit({ executionId, casVersion: 0, events: [event] }),
        ),
      ).toThrow(/locked|busy/i);
      expect(() => outbox.commitEvents({ events: [event] })).toThrow(
        /locked|busy/i,
      );
    } finally {
      otherWriter.exec('rollback');
      otherWriter.close();
    }
    expect(outbox.readLatestState(executionId)).toBeNull();
    expect(outbox.readCommittedEvents({ executionId })).toEqual([]);
  });
});

describe('ArvoSqliteOutbox once closed', () => {
  it('closes again without throwing', () => {
    const outbox = new ArvoSqliteOutbox({ filename: newFilename() });
    outbox.close();
    expect(() => outbox.close()).not.toThrow();
  });

  it('throws on every operation once closed', () => {
    const filename = newFilename();
    const outbox = new ArvoSqliteOutbox({ filename });
    outbox.close();
    const executionId = crypto.randomUUID();
    const operations = [
      () => outbox.readLatestState(executionId),
      () =>
        outbox.commitStateAndEvents(
          buildStateCommit({ executionId, casVersion: 0 }),
        ),
      () => outbox.commitEvents({ events: [] }),
      () => outbox.readCommittedEvents({ executionId }),
      () => outbox.listUnseenEvents({ atMost: 10, olderThanMs: 0 }),
      () => outbox.markEventsSeen([]),
    ];
    for (const operation of operations) {
      expect(operation).toThrow(
        `ArvoSqliteOutbox on ${filename} is closed; open a new one on the file to use it again.`,
      );
    }
  });
});

describe('ArvoSqliteOutbox and how it answers', () => {
  it('answers every operation directly, not through a promise', () => {
    const outbox = openOutbox(newFilename());
    const executionId = crypto.randomUUID();
    const answers = [
      outbox.readLatestState(executionId),
      outbox.commitStateAndEvents(
        buildStateCommit({ executionId, casVersion: 0 }),
      ),
      outbox.commitEvents({ events: [] }),
      outbox.readCommittedEvents({ executionId }),
      outbox.listUnseenEvents({ atMost: 10, olderThanMs: 0 }),
      outbox.markEventsSeen([]),
    ];
    for (const answer of answers) expect(answer).not.toBeInstanceOf(Promise);
    expect(answers.slice(0, 2)).toEqual([null, { committed: true }]);
  });

  it.each([-1, 1.5, Number.NaN])(
    'refuses to wait %s milliseconds for the file',
    (busyTimeoutMs) => {
      expect(
        () => new ArvoSqliteOutbox({ filename: newFilename(), busyTimeoutMs }),
      ).toThrow(
        `ArvoSqliteOutbox cannot be opened with busyTimeoutMs ${busyTimeoutMs}; it must be a whole number of milliseconds, zero or more.`,
      );
    },
  );
});

describe('ArvoSqliteOutbox and how much it keeps', () => {
  /** Moves a column of some events' rows far into the past, as another connection would. */
  const backdate = (
    filename: string,
    column: 'seen_at' | 'committed_at',
    eventIds: readonly string[],
  ) => {
    const otherConnection = new Database(filename);
    const backdateEvent = otherConnection.prepare<{ eventId: string }>(
      `update arvo_outbox_event set ${column} = '2000-01-01T00:00:00.000Z' where id = @eventId`,
    );
    for (const eventId of eventIds) backdateEvent.run({ eventId });
    otherConnection.close();
  };

  /** Commits events alone, one commit, and returns them. */
  const commitSomeEvents = (
    outbox: ArvoSqliteOutbox,
    eventCount: number,
    payload?: string,
  ) => {
    const events = Array.from({ length: eventCount }, () =>
      buildEventRecord(payload === undefined ? {} : { payload }),
    );
    outbox.commitEvents({ events });
    return events;
  };

  /** Whether the outbox still keeps an event. */
  const keeps = (
    outbox: ArvoSqliteOutbox,
    event: { readonly id: string; readonly triggeringEventId: string },
  ) =>
    outbox
      .readCommittedEvents({ triggeringEventId: event.triggeringEventId })
      .some((committedEvent) => committedEvent.id === event.id);

  /** Reads one value from the file through another connection. */
  const inspect = <Answer>(
    filename: string,
    query: (inspector: Database.Database) => Answer,
  ) => {
    const inspector = new Database(filename, { readonly: true });
    try {
      return query(inspector);
    } finally {
      inspector.close();
    }
  };

  it('keeps only the latest revision of each state', () => {
    const filename = newFilename();
    const outbox = openOutbox(filename);
    const executionId = crypto.randomUUID();
    for (const casVersion of [0, 1, 2]) {
      outbox.commitStateAndEvents(
        buildStateCommit({ executionId, casVersion }),
      );
    }
    expect(
      inspect(filename, (inspector) =>
        inspector
          .prepare<{ executionId: string }, { casVersion: number }>(
            'select cas_version as casVersion from arvo_outbox_state where execution_id = @executionId',
          )
          .all({ executionId }),
      ),
    ).toEqual([{ casVersion: 2 }]);
    expect(
      outbox.commitStateAndEvents(
        buildStateCommit({ executionId, casVersion: 2 }),
      ),
    ).toEqual({ committed: false, refusal: 'revision_stale' });
  });

  it('deletes events seen longer ago than it keeps them, when marking events seen', () => {
    const filename = newFilename();
    const outbox = openOutbox(filename);
    const [expiredEvent, recentlySeenEvent, unseenEvent] = commitSomeEvents(
      outbox,
      3,
    );
    if (!expiredEvent || !recentlySeenEvent || !unseenEvent)
      throw new Error('three events were committed');
    outbox.markEventsSeen([expiredEvent.id, recentlySeenEvent.id]);
    backdate(filename, 'seen_at', [expiredEvent.id]);
    outbox.markEventsSeen([]);
    expect(keeps(outbox, expiredEvent)).toBe(false);
    expect(keeps(outbox, recentlySeenEvent)).toBe(true);
    expect(keeps(outbox, unseenEvent)).toBe(true);
  });

  it('never deletes an unseen event, however long ago it was committed', () => {
    const filename = newFilename();
    const outbox = openOutbox(filename);
    const [staleUnseenEvent] = commitSomeEvents(outbox, 1);
    if (!staleUnseenEvent) throw new Error('one event was committed');
    backdate(filename, 'committed_at', [staleUnseenEvent.id]);
    outbox.markEventsSeen([]);
    expect(outbox.deleteExpiredEvents()).toBe(0);
    expect(keeps(outbox, staleUnseenEvent)).toBe(true);
  });

  it('deletes events as they are seen where it keeps seen events for no time', () => {
    const outbox = new ArvoSqliteOutbox({
      filename: newFilename(),
      retainSeenEventsForMs: 0,
    });
    openedOutboxes.push(outbox);
    const [seenEvent, unseenEvent] = commitSomeEvents(outbox, 2);
    if (!seenEvent || !unseenEvent)
      throw new Error('two events were committed');
    outbox.markEventsSeen([seenEvent.id]);
    expect(keeps(outbox, seenEvent)).toBe(false);
    expect(keeps(outbox, unseenEvent)).toBe(true);
  });

  it('keeps seen events forever where told to keep them for an unending time', () => {
    const filename = newFilename();
    const outbox = new ArvoSqliteOutbox({
      filename,
      retainSeenEventsForMs: Number.POSITIVE_INFINITY,
    });
    openedOutboxes.push(outbox);
    const [seenEvent] = commitSomeEvents(outbox, 1);
    if (!seenEvent) throw new Error('one event was committed');
    outbox.markEventsSeen([seenEvent.id]);
    backdate(filename, 'seen_at', [seenEvent.id]);
    outbox.markEventsSeen([]);
    expect(outbox.deleteExpiredEvents()).toBe(0);
    expect(keeps(outbox, seenEvent)).toBe(true);
  });

  it('deletes a bounded batch per marking, and the rest on being asked', () => {
    const filename = newFilename();
    const outbox = openOutbox(filename);
    const events = commitSomeEvents(outbox, expiredEventsDeletedPerMarking + 7);
    const eventIds = events.map((event) => event.id);
    outbox.markEventsSeen(eventIds);
    backdate(filename, 'seen_at', eventIds);
    outbox.markEventsSeen([]);
    expect(events.filter((event) => keeps(outbox, event))).toHaveLength(7);
    expect(outbox.deleteExpiredEvents()).toBe(7);
    expect(events.filter((event) => keeps(outbox, event))).toHaveLength(0);
  });

  it('gives the space of deleted events back, so the file shrinks', () => {
    const filename = newFilename();
    const outbox = openOutbox(filename);
    expect(
      inspect(filename, (inspector) =>
        inspector.pragma('auto_vacuum', { simple: true }),
      ),
    ).toBe(2);
    const events = commitSomeEvents(
      outbox,
      200,
      JSON.stringify('x'.repeat(4000)),
    );
    const eventIds = events.map((event) => event.id);
    outbox.markEventsSeen(eventIds);
    const pagesBeforeDeleting = inspect(filename, (inspector) =>
      inspector.pragma('page_count', { simple: true }),
    );
    backdate(filename, 'seen_at', eventIds);
    outbox.deleteExpiredEvents();
    const pagesAfterDeleting = inspect(filename, (inspector) =>
      inspector.pragma('page_count', { simple: true }),
    );
    expect(Number(pagesAfterDeleting)).toBeLessThan(
      Number(pagesBeforeDeleting) / 2,
    );
  });

  it('throws on deleting expired events once closed', () => {
    const filename = newFilename();
    const outbox = new ArvoSqliteOutbox({ filename });
    outbox.close();
    expect(() => outbox.deleteExpiredEvents()).toThrow(
      `ArvoSqliteOutbox on ${filename} is closed`,
    );
  });

  it.each([-1, 1.5, Number.NaN])(
    'refuses to keep seen events for %s milliseconds',
    (retainSeenEventsForMs) => {
      expect(
        () =>
          new ArvoSqliteOutbox({
            filename: newFilename(),
            retainSeenEventsForMs,
          }),
      ).toThrow(
        `ArvoSqliteOutbox cannot be opened with retainSeenEventsForMs ${retainSeenEventsForMs}; it must be a whole number of milliseconds, zero or more, or Infinity to keep seen events forever.`,
      );
    },
  );
});

describe('ArvoSqliteOutbox and leases', () => {
  /** An outbox on a new file, holding two unseen events. */
  const outboxWithTwoUnseenEvents = () => {
    const filename = newFilename();
    const outbox = openOutbox(filename);
    const events = [buildEventRecord(), buildEventRecord()];
    outbox.commitEvents({ events });
    const listedEventIds = (
      listingOutbox: ArvoSqliteOutbox,
      leaseMs?: number,
    ) =>
      listingOutbox
        .listUnseenEvents({ atMost: 10, olderThanMs: 0, leaseMs })
        .map((event) => event.id);
    return {
      filename,
      outbox,
      eventIds: events.map((event) => event.id),
      listedEventIds,
    };
  };

  /** Makes every lease on the file lapse, as time passing would. */
  const lapseEveryLease = (filename: string) => {
    const otherConnection = new Database(filename);
    otherConnection
      .prepare(
        "update arvo_outbox_event set leased_until = '2000-01-01T00:00:00.000Z' where leased_until is not null",
      )
      .run();
    otherConnection.close();
  };

  it('claims nothing where no lease is asked for', () => {
    const { outbox, eventIds, listedEventIds } = outboxWithTwoUnseenEvents();
    expect(listedEventIds(outbox)).toEqual(eventIds);
    expect(listedEventIds(outbox)).toEqual(eventIds);
  });

  it('leaves leased events out of every listing on the file until the lease lapses', () => {
    const { filename, outbox, eventIds, listedEventIds } =
      outboxWithTwoUnseenEvents();
    const otherOutbox = openOutbox(filename);
    expect(listedEventIds(outbox, 60_000)).toEqual(eventIds);
    expect(listedEventIds(outbox)).toEqual([]);
    expect(listedEventIds(otherOutbox, 60_000)).toEqual([]);
    lapseEveryLease(filename);
    expect(listedEventIds(otherOutbox)).toEqual(eventIds);
  });

  it('leases only what it lists, so the rest is listed to the next caller', () => {
    const { outbox, eventIds, listedEventIds } = outboxWithTwoUnseenEvents();
    const leasedEvents = outbox.listUnseenEvents({
      atMost: 1,
      olderThanMs: 0,
      leaseMs: 60_000,
    });
    expect(leasedEvents.map((event) => event.id)).toEqual(eventIds.slice(0, 1));
    expect(listedEventIds(outbox)).toEqual(eventIds.slice(1));
  });

  it('ends a lease once the event is marked seen', () => {
    const { filename, outbox, eventIds, listedEventIds } =
      outboxWithTwoUnseenEvents();
    listedEventIds(outbox, 60_000);
    outbox.markEventsSeen(eventIds.slice(0, 1));
    lapseEveryLease(filename);
    expect(listedEventIds(outbox)).toEqual(eventIds.slice(1));
  });

  it.each([0, -1, 1.5, Number.NaN])(
    'refuses a lease of %s milliseconds, claiming nothing',
    (leaseMs) => {
      const { outbox, eventIds, listedEventIds } = outboxWithTwoUnseenEvents();
      expect(() =>
        outbox.listUnseenEvents({ atMost: 10, olderThanMs: 0, leaseMs }),
      ).toThrow(
        `ArvoSqliteOutbox cannot lease events for ${leaseMs} milliseconds; a lease must be a whole number of milliseconds greater than zero, or left out for none.`,
      );
      expect(listedEventIds(outbox)).toEqual(eventIds);
    },
  );
});
