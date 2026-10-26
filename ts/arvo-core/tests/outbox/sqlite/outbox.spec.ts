import {
  existsSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import Database from 'better-sqlite3';
import { afterAll, describe, expect, it } from 'vitest';
import { buildEventRecord } from '../../../src/outbox/conformance/fixtures/event-record.js';
import { buildStateCommit } from '../../../src/outbox/conformance/fixtures/state-commit.js';
import { expiredEventsDeletedPerMarking } from '../../../src/outbox/sqlite/helpers/defaults.js';
import {
  ArvoSqliteOutbox,
  type ArvoSqliteOutboxOptions,
} from '../../../src/outbox/sqlite/index.js';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'arvo-sqlite-outbox-'));
const openedOutboxes: ArvoSqliteOutbox[] = [];

afterAll(async () => {
  for (const openedOutbox of openedOutboxes) await openedOutbox.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

/** A file name in the test's own directory that nothing has used. */
const newFilename = () =>
  join(temporaryDirectory, `${crypto.randomUUID()}.sqlite`);

/** Opens an outbox that is closed when the suite ends, if the test does not. */
const openOutbox = async (options: ArvoSqliteOutboxOptions) => {
  const outbox = new ArvoSqliteOutbox(options);
  openedOutboxes.push(outbox);
  await outbox.open();
  return outbox;
};

/** Opens an outbox on a file and closes it, leaving the file as an outbox makes it. */
const openAndClose = async (filename: string) => {
  const outbox = new ArvoSqliteOutbox({ filename });
  await outbox.open();
  await outbox.close();
};

/** Reads from the file through a connection of its own. */
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

/** Writes to the file through a connection of its own, as another process would. */
const writeAsAnotherConnection = (
  filename: string,
  write: (otherConnection: Database.Database) => void,
) => {
  const otherConnection = new Database(filename);
  try {
    write(otherConnection);
  } finally {
    otherConnection.close();
  }
};

describe('ArvoSqliteOutbox and its file', () => {
  it('creates a new file with everything it needs, writing ahead of its log', async () => {
    const filename = newFilename();
    await openOutbox({ filename });
    expect(existsSync(filename)).toBe(true);
    const schemaNames = inspect(filename, (inspector) =>
      inspector
        .prepare<[], { name: string }>(
          "select name from sqlite_schema where name like 'arvo_outbox%' order by name",
        )
        .all()
        .map((schemaEntry) => schemaEntry.name),
    );
    expect(schemaNames).toEqual(
      expect.arrayContaining(['arvo_outbox_event', 'arvo_outbox_state']),
    );
    expect(schemaNames.length).toBeGreaterThan(2);
    expect(
      inspect(filename, (inspector) =>
        inspector.pragma('journal_mode', { simple: true }),
      ),
    ).toBe('wal');
  });

  it('throws on a file that is not a SQLite database, leaving it as it was', async () => {
    const filename = newFilename();
    writeFileSync(
      filename,
      'not a database, but long enough to have a header page',
    );
    const outbox = new ArvoSqliteOutbox({ filename });
    await expect(outbox.open()).rejects.toThrow(/not a database/);
    expect(existsSync(filename)).toBe(true);
    expect(() => outbox.readLatestState(crypto.randomUUID())).toThrow(
      `ArvoSqliteOutbox on ${filename} is not open`,
    );
  });

  it('leaves in place what a file it did not make already holds', async () => {
    const filename = newFilename();
    writeAsAnotherConnection(filename, (ownerOfTheFile) =>
      ownerOfTheFile.exec(
        "create table other_table (note text); insert into other_table values ('kept')",
      ),
    );
    const outbox = await openOutbox({ filename });
    outbox.commitEvents({ events: [buildEventRecord()] });
    expect(
      inspect(filename, (inspector) =>
        inspector
          .prepare<[], { note: string }>('select note from other_table')
          .get(),
      ),
    ).toEqual({ note: 'kept' });
  });

  it('reads back everything committed, as it was, once closed and opened again', async () => {
    const filename = newFilename();
    const executionId = crypto.randomUUID();
    const seenEvent = buildEventRecord({ executionId, casVersion: 1 });
    const unseenEvent = buildEventRecord({ executionId, casVersion: 1 });
    const firstOutbox = new ArvoSqliteOutbox({ filename });
    await firstOutbox.open();
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
    await firstOutbox.close();

    const reopenedOutbox = await openOutbox({ filename });
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

  it('stamps every event of one commit with one time, in an event time form, by its own clock', async () => {
    const outbox = await openOutbox({ filename: newFilename() });
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
  it('refuses the second of two outboxes on one file committing one revision', async () => {
    const filename = newFilename();
    const executionId = crypto.randomUUID();
    const firstOutbox = await openOutbox({ filename });
    const secondOutbox = await openOutbox({ filename });
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
    await openOutbox({ filename });
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

  it('throws where another writer holds the file beyond its wait, having stored nothing', async () => {
    const filename = newFilename();
    const outbox = await openOutbox({ filename, busyTimeoutMs: 50 });
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

describe('ArvoSqliteOutbox and how it answers', () => {
  it('answers every operation directly, not through a promise', async () => {
    const outbox = await openOutbox({ filename: newFilename() });
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
      outbox.deleteExpiredEvents(),
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
  ) =>
    writeAsAnotherConnection(filename, (otherConnection) => {
      const backdateEvent = otherConnection.prepare<{ eventId: string }>(
        `update arvo_outbox_event set ${column} = '2000-01-01T00:00:00.000Z' where id = @eventId`,
      );
      for (const eventId of eventIds) backdateEvent.run({ eventId });
    });

  /** Commits events alone, in one commit, and returns them. */
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

  it('keeps only the latest revision of each state', async () => {
    const filename = newFilename();
    const outbox = await openOutbox({ filename });
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

  it('deletes events seen longer ago than it keeps them, when marking events seen', async () => {
    const filename = newFilename();
    const outbox = await openOutbox({ filename });
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

  it('never deletes an unseen event, however long ago it was committed', async () => {
    const filename = newFilename();
    const outbox = await openOutbox({ filename });
    const [staleUnseenEvent] = commitSomeEvents(outbox, 1);
    if (!staleUnseenEvent) throw new Error('one event was committed');
    backdate(filename, 'committed_at', [staleUnseenEvent.id]);
    outbox.markEventsSeen([]);
    expect(outbox.deleteExpiredEvents()).toBe(0);
    expect(keeps(outbox, staleUnseenEvent)).toBe(true);
  });

  it('deletes events as they are seen where it keeps seen events for no time', async () => {
    const outbox = await openOutbox({
      filename: newFilename(),
      retainSeenEventsForMs: 0,
    });
    const [seenEvent, unseenEvent] = commitSomeEvents(outbox, 2);
    if (!seenEvent || !unseenEvent)
      throw new Error('two events were committed');
    outbox.markEventsSeen([seenEvent.id]);
    expect(keeps(outbox, seenEvent)).toBe(false);
    expect(keeps(outbox, unseenEvent)).toBe(true);
  });

  it('keeps seen events forever where told to keep them for an unending time', async () => {
    const filename = newFilename();
    const outbox = await openOutbox({
      filename,
      retainSeenEventsForMs: Number.POSITIVE_INFINITY,
    });
    const [seenEvent] = commitSomeEvents(outbox, 1);
    if (!seenEvent) throw new Error('one event was committed');
    outbox.markEventsSeen([seenEvent.id]);
    backdate(filename, 'seen_at', [seenEvent.id]);
    outbox.markEventsSeen([]);
    expect(outbox.deleteExpiredEvents()).toBe(0);
    expect(keeps(outbox, seenEvent)).toBe(true);
  });

  it('deletes a bounded batch per marking, and the rest on being asked', async () => {
    const filename = newFilename();
    const outbox = await openOutbox({ filename });
    const events = commitSomeEvents(outbox, expiredEventsDeletedPerMarking + 7);
    const eventIds = events.map((event) => event.id);
    outbox.markEventsSeen(eventIds);
    backdate(filename, 'seen_at', eventIds);
    outbox.markEventsSeen([]);
    expect(events.filter((event) => keeps(outbox, event))).toHaveLength(7);
    expect(outbox.deleteExpiredEvents()).toBe(7);
    expect(events.filter((event) => keeps(outbox, event))).toHaveLength(0);
  });

  it('gives the space of deleted events back, so the file shrinks', async () => {
    const filename = newFilename();
    const outbox = await openOutbox({ filename });
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
  /** An outbox on a new file, opened, holding two unseen events. */
  const outboxWithTwoUnseenEvents = async () => {
    const filename = newFilename();
    const outbox = await openOutbox({ filename });
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
  const lapseEveryLease = (filename: string) =>
    writeAsAnotherConnection(filename, (otherConnection) =>
      otherConnection
        .prepare(
          "update arvo_outbox_event set leased_until = '2000-01-01T00:00:00.000Z' where leased_until is not null",
        )
        .run(),
    );

  it('claims nothing where no lease is asked for', async () => {
    const { outbox, eventIds, listedEventIds } =
      await outboxWithTwoUnseenEvents();
    expect(listedEventIds(outbox)).toEqual(eventIds);
    expect(listedEventIds(outbox)).toEqual(eventIds);
  });

  it('leaves leased events out of every listing on the file until the lease lapses', async () => {
    const { filename, outbox, eventIds, listedEventIds } =
      await outboxWithTwoUnseenEvents();
    const otherOutbox = await openOutbox({ filename });
    expect(listedEventIds(outbox, 60_000)).toEqual(eventIds);
    expect(listedEventIds(outbox)).toEqual([]);
    expect(listedEventIds(otherOutbox, 60_000)).toEqual([]);
    lapseEveryLease(filename);
    expect(listedEventIds(otherOutbox)).toEqual(eventIds);
  });

  it('leases only what it lists, so the rest is listed to the next caller', async () => {
    const { outbox, eventIds, listedEventIds } =
      await outboxWithTwoUnseenEvents();
    const leasedEvents = outbox.listUnseenEvents({
      atMost: 1,
      olderThanMs: 0,
      leaseMs: 60_000,
    });
    expect(leasedEvents.map((event) => event.id)).toEqual(eventIds.slice(0, 1));
    expect(listedEventIds(outbox)).toEqual(eventIds.slice(1));
  });

  it('ends a lease once the event is marked seen', async () => {
    const { filename, outbox, eventIds, listedEventIds } =
      await outboxWithTwoUnseenEvents();
    listedEventIds(outbox, 60_000);
    outbox.markEventsSeen(eventIds.slice(0, 1));
    lapseEveryLease(filename);
    expect(listedEventIds(outbox)).toEqual(eventIds.slice(1));
  });

  it.each([0, -1, 1.5, Number.NaN])(
    'refuses a lease of %s milliseconds, claiming nothing',
    async (leaseMs) => {
      const { outbox, eventIds, listedEventIds } =
        await outboxWithTwoUnseenEvents();
      expect(() =>
        outbox.listUnseenEvents({ atMost: 10, olderThanMs: 0, leaseMs }),
      ).toThrow(
        `ArvoSqliteOutbox cannot lease events for ${leaseMs} milliseconds; a lease must be a whole number of milliseconds greater than zero, or left out for none.`,
      );
      expect(listedEventIds(outbox)).toEqual(eventIds);
    },
  );
});

describe('ArvoSqliteOutbox and the safety of its file', () => {
  it('creates a new file that only its owner can read or write', async () => {
    const filename = newFilename();
    await openOutbox({ filename });
    expect(statSync(filename).mode & 0o777).toBe(0o600);
  });

  it('leaves the permissions of a file that already exists as they are', async () => {
    const filename = newFilename();
    writeFileSync(filename, '', { mode: 0o640 });
    await openOutbox({ filename });
    expect(statSync(filename).mode & 0o777).toBe(0o640);
  });

  it('opens a file in memory, with no file to create', async () => {
    const outbox = await openOutbox({ filename: ':memory:' });
    expect(outbox.readLatestState(crypto.randomUUID())).toBeNull();
  });

  it('marks a file it creates with the version of its tables, and opens it again', async () => {
    const filename = newFilename();
    await openAndClose(filename);
    expect(
      inspect(filename, (inspector) =>
        inspector
          .prepare<[], { value: string }>(
            "select value from arvo_outbox_meta where name = 'schema_version'",
          )
          .get(),
      ),
    ).toEqual({ value: '1' });
    await expect(openOutbox({ filename })).resolves.toBeInstanceOf(
      ArvoSqliteOutbox,
    );
  });

  it('refuses a file whose tables are of a version it does not know, changing nothing', async () => {
    const filename = newFilename();
    await openAndClose(filename);
    writeAsAnotherConnection(filename, (otherWriter) =>
      otherWriter.exec(
        "update arvo_outbox_meta set value = '2' where name = 'schema_version'",
      ),
    );
    const outbox = new ArvoSqliteOutbox({ filename });
    await expect(outbox.open()).rejects.toThrow(
      `ArvoSqliteOutbox cannot open ${filename}: its outbox tables are at version 2, and this outbox knows only version 1. Open it with the version of arvo-core that wrote it.`,
    );
    expect(
      inspect(filename, (inspector) =>
        inspector
          .prepare<[], { value: string }>('select value from arvo_outbox_meta')
          .get(),
      ),
    ).toEqual({ value: '2' });
  });

  it('refuses a row no outbox could have written', async () => {
    const filename = newFilename();
    await openOutbox({ filename });
    writeAsAnotherConnection(filename, (otherWriter) => {
      expect(() =>
        otherWriter.exec(
          "insert into arvo_outbox_state values ('execution', -1, 's', 's', '1.0.0', 'waiting', '{}')",
        ),
      ).toThrow(/CHECK constraint/);
      expect(() =>
        otherWriter.exec(
          "insert into arvo_outbox_state values ('execution', 0, 's', 's', '1.0.0', 'waiting', 'not json')",
        ),
      ).toThrow(/CHECK constraint/);
    });
  });

  it('refuses to list a negative number of events, rather than listing them all', async () => {
    const outbox = await openOutbox({ filename: newFilename() });
    outbox.commitEvents({ events: [buildEventRecord()] });
    expect(() =>
      outbox.listUnseenEvents({ atMost: -1, olderThanMs: 0 }),
    ).toThrow('ArvoSqliteOutbox cannot list -1 unseen events');
  });
});

describe('ArvoSqliteOutbox and its life', () => {
  /** Calls every operation, each as it would be called on a working outbox. */
  const everyOperation = (outbox: ArvoSqliteOutbox) => {
    const executionId = crypto.randomUUID();
    return [
      () => outbox.readLatestState(executionId),
      () =>
        outbox.commitStateAndEvents(
          buildStateCommit({ executionId, casVersion: 0 }),
        ),
      () => outbox.commitEvents({ events: [] }),
      () => outbox.readCommittedEvents({ executionId }),
      () => outbox.listUnseenEvents({ atMost: 10, olderThanMs: 0 }),
      () => outbox.markEventsSeen([]),
      () => outbox.deleteExpiredEvents(),
    ];
  };

  it('touches no file until it is opened', async () => {
    const filename = newFilename();
    const outbox = new ArvoSqliteOutbox({ filename });
    expect(existsSync(filename)).toBe(false);
    await outbox.open();
    expect(existsSync(filename)).toBe(true);
    await outbox.close();
  });

  it('throws on every operation before it is opened, saying to open it', () => {
    const filename = newFilename();
    const outbox = new ArvoSqliteOutbox({ filename });
    for (const operation of everyOperation(outbox)) {
      expect(operation).toThrow(
        `ArvoSqliteOutbox on ${filename} is not open; call open() before`,
      );
    }
    expect(existsSync(filename)).toBe(false);
  });

  it('keeps its connection when opened again', async () => {
    const outbox = await openOutbox({ filename: newFilename() });
    const executionId = crypto.randomUUID();
    outbox.commitStateAndEvents(
      buildStateCommit({ executionId, casVersion: 0, state: { kept: true } }),
    );
    await outbox.open();
    expect(outbox.readLatestState(executionId)).toEqual({ kept: true });
  });

  it('opens again once a failed open is put right', async () => {
    const filename = newFilename();
    writeFileSync(
      filename,
      'not a database, but long enough to have a header page',
    );
    const outbox = new ArvoSqliteOutbox({ filename });
    openedOutboxes.push(outbox);
    await expect(outbox.open()).rejects.toThrow(/not a database/);
    rmSync(filename);
    await outbox.open();
    expect(outbox.readLatestState(crypto.randomUUID())).toBeNull();
  });

  it('throws on every operation once closed, and closes again without throwing', async () => {
    const filename = newFilename();
    const outbox = new ArvoSqliteOutbox({ filename });
    await outbox.open();
    await outbox.close();
    await expect(outbox.close()).resolves.toBeUndefined();
    for (const operation of everyOperation(outbox)) {
      expect(operation).toThrow(
        `ArvoSqliteOutbox on ${filename} is closed; build a new one to use it again.`,
      );
    }
  });

  it('throws on opening once closed, saying to build a new one', async () => {
    const filename = newFilename();
    const outbox = new ArvoSqliteOutbox({ filename });
    await outbox.open();
    await outbox.close();
    await expect(outbox.open()).rejects.toThrow(
      `ArvoSqliteOutbox on ${filename} is closed; build a new one to use it again.`,
    );
  });

  it('closes without throwing where it was never opened, and stays closed', async () => {
    const filename = newFilename();
    const outbox = new ArvoSqliteOutbox({ filename });
    await expect(outbox.close()).resolves.toBeUndefined();
    await expect(outbox.open()).rejects.toThrow(
      `ArvoSqliteOutbox on ${filename} is closed`,
    );
    expect(existsSync(filename)).toBe(false);
  });

  it('answers opening and closing through a promise', async () => {
    const outbox = new ArvoSqliteOutbox({ filename: newFilename() });
    const opening = outbox.open();
    expect(opening).toBeInstanceOf(Promise);
    await opening;
    const closing = outbox.close();
    expect(closing).toBeInstanceOf(Promise);
    await closing;
  });
});
