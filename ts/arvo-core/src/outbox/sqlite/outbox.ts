import Database from 'better-sqlite3';
import type { IArvoOutbox } from '../../ArvoOutbox/interface.js';
import { ArvoOutboxLifecycle } from '../../ArvoOutbox/lifecycle.js';
import type {
  ArvoOutboxCommitOutcome,
  ArvoOutboxEventsCommit,
  ArvoOutboxStateCommit,
} from '../../ArvoOutbox/types/commit.js';
import type {
  ArvoOutboxCommittedEventRecord,
  ArvoOutboxEventRecord,
} from '../../ArvoOutbox/types/event-record.js';
import type {
  ArvoOutboxEventsFilter,
  ArvoOutboxUnseenEventsParam,
} from '../../ArvoOutbox/types/read.js';
import type { JSONObject } from '../../types.js';
import { refusalFor } from '../helpers/refusal-for.js';
import { refuseInvalidListing } from '../helpers/refuse-invalid-listing.js';
import { configureConnection } from './helpers/configure-connection.js';
import { createOwnerOnlyFile } from './helpers/create-owner-only-file.js';
import {
  defaultBusyTimeoutMs,
  defaultRetainSeenEventsForMs,
  expiredEventsDeletedPerMarking,
  pagesFreedPerMarking,
} from './helpers/defaults.js';
import { toCommittedEventRecord, toEventInsert } from './helpers/event-rows.js';
import { secondsAgo, secondsLater } from './helpers/seconds-modifier.js';
import { readSqliteNow } from './helpers/sqlite-now.js';
import { outboxSchema, outboxSchemaVersion } from './schema.js';
import { type OutboxStatements, prepareStatements } from './statements.js';
import type { ArvoSqliteOutboxOptions } from './types.js';

/** What an open outbox holds: its connection to the file, and what it prepared on it. */
type SqliteConnection = {
  readonly database: Database.Database;
  readonly statements: OutboxStatements;
};

/**
 * An outbox kept in a SQLite file, for one machine.
 *
 * Open it before use and close it after: building it touches no file, and
 * every operation throws before it is opened and once it is closed. Every
 * operation answers directly, holding the thread until SQLite answers, and
 * throws, storing nothing, where another writer holds the file for longer
 * than `options.busyTimeoutMs`. Landing times come from SQLite's own clock.
 *
 * Several outboxes may share one file, in one process or several, and
 * together meet every rule of {@link IArvoOutbox}, leases included. It keeps
 * each execution's latest state, and deletes an event once it has been seen
 * for longer than `options.retainSeenEventsForMs`; an unseen event is never
 * deleted. A file it creates is readable and writable by its owner alone.
 *
 * @example
 * ```typescript
 * const outbox = new ArvoSqliteOutbox({ filename: '/var/lib/orders/outbox.sqlite' });
 * await outbox.open();
 * const outcome = outbox.commitStateAndEvents(commit);
 * const latestState = outbox.readLatestState(commit.executionId);
 * await outbox.close();
 * ```
 */
export class ArvoSqliteOutbox implements IArvoOutbox {
  private readonly filename: string;
  private readonly busyTimeoutMs: number;
  private readonly retainSeenEventsForMs: number;
  private readonly lifecycle: ArvoOutboxLifecycle<SqliteConnection>;

  /**
   * Checks the options. Touches no file: {@link ArvoSqliteOutbox.open} does.
   *
   * @param options - Which file, how long to wait for it, and how long to keep seen events. See {@link ArvoSqliteOutboxOptions}.
   * @throws {RangeError} Where `options.busyTimeoutMs` or `options.retainSeenEventsForMs` is out of range.
   */
  constructor(options: ArvoSqliteOutboxOptions) {
    const busyTimeoutMs = options.busyTimeoutMs ?? defaultBusyTimeoutMs;
    if (!Number.isInteger(busyTimeoutMs) || busyTimeoutMs < 0) {
      throw new RangeError(
        `ArvoSqliteOutbox cannot be opened with busyTimeoutMs ${busyTimeoutMs}; it must be a whole number of milliseconds, zero or more.`,
      );
    }
    const retainSeenEventsForMs =
      options.retainSeenEventsForMs ?? defaultRetainSeenEventsForMs;
    if (
      retainSeenEventsForMs !== Number.POSITIVE_INFINITY &&
      (!Number.isInteger(retainSeenEventsForMs) || retainSeenEventsForMs < 0)
    ) {
      throw new RangeError(
        `ArvoSqliteOutbox cannot be opened with retainSeenEventsForMs ${retainSeenEventsForMs}; it must be a whole number of milliseconds, zero or more, or Infinity to keep seen events forever.`,
      );
    }
    this.filename = options.filename;
    this.busyTimeoutMs = busyTimeoutMs;
    this.retainSeenEventsForMs = retainSeenEventsForMs;
    this.lifecycle = new ArvoOutboxLifecycle(
      `ArvoSqliteOutbox on ${options.filename}`,
    );
  }

  /**
   * Opens the file, creating it, owner-only, where missing, and creating
   * what the outbox needs in it. Opening it again does nothing. Where
   * opening throws, the outbox stays unopened and may be opened again.
   *
   * @throws Where it has been closed: build a new one instead.
   * @throws Whatever SQLite throws where the file cannot be opened, is not a SQLite database, or holds outbox tables of another version.
   */
  async open(): Promise<void> {
    await this.lifecycle.open(() => this.openConnection());
  }

  /**
   * Releases the file. Closing it again does nothing, and every operation
   * throws once it is closed.
   */
  async close(): Promise<void> {
    await this.lifecycle.close(({ database }) => {
      database.close();
    });
  }

  readLatestState(executionId: string): JSONObject | null {
    const { statements } = this.lifecycle.resourcesFor('readLatestState');
    const stateRow = statements.selectLatestState.get({ executionId });
    return stateRow ? JSON.parse(stateRow.document) : null;
  }

  commitStateAndEvents(param: ArvoOutboxStateCommit): ArvoOutboxCommitOutcome {
    const { database, statements } = this.lifecycle.resourcesFor(
      'commitStateAndEvents',
    );
    const document = JSON.stringify(param.state);
    return database
      .transaction((): ArvoOutboxCommitOutcome => {
        const refusal = refusalFor({
          casVersion: param.casVersion,
          storedCasVersion: statements.selectLatestState.get({
            executionId: param.executionId,
          })?.casVersion,
        });
        if (refusal !== null) return { committed: false, refusal };
        statements.insertState.run({
          executionId: param.executionId,
          casVersion: param.casVersion,
          subject: param.subject,
          source: param.source,
          version: param.version,
          lifecycle: param.lifecycle,
          document,
        });
        statements.deleteEarlierStates.run({
          executionId: param.executionId,
          casVersion: param.casVersion,
        });
        this.insertEvents(statements, param.events);
        return { committed: true };
      })
      .immediate();
  }

  commitEvents(param: ArvoOutboxEventsCommit): void {
    const { database, statements } =
      this.lifecycle.resourcesFor('commitEvents');
    database
      .transaction(() => this.insertEvents(statements, param.events))
      .immediate();
  }

  readCommittedEvents(
    filter: ArvoOutboxEventsFilter,
  ): readonly ArvoOutboxCommittedEventRecord[] {
    const { statements } = this.lifecycle.resourcesFor('readCommittedEvents');
    if (!('triggeringEventId' in filter)) {
      return statements.selectEventsByExecution
        .all({ executionId: filter.executionId })
        .map(toCommittedEventRecord);
    }
    return (
      'executionId' in filter
        ? statements.selectEventsByTriggeringEventAndExecution.all({
            triggeringEventId: filter.triggeringEventId,
            executionId: filter.executionId,
          })
        : statements.selectEventsByTriggeringEvent.all({
            triggeringEventId: filter.triggeringEventId,
          })
    ).map(toCommittedEventRecord);
  }

  listUnseenEvents(
    param: ArvoOutboxUnseenEventsParam,
  ): readonly ArvoOutboxCommittedEventRecord[] {
    const { database, statements } =
      this.lifecycle.resourcesFor('listUnseenEvents');
    refuseInvalidListing('ArvoSqliteOutbox', param);
    const listUnseen = () => {
      const now = readSqliteNow(statements.selectNow);
      const eventRows = statements.selectUnseenEvents.all({
        now,
        cutOffModifier: secondsAgo(param.olderThanMs),
        atMost: param.atMost,
      });
      if (param.leaseMs !== undefined) {
        const leaseModifier = secondsLater(param.leaseMs);
        for (const eventRow of eventRows) {
          statements.leaseEvent.run({
            eventId: eventRow.id,
            now,
            leaseModifier,
          });
        }
      }
      return eventRows.map(toCommittedEventRecord);
    };
    // a lease is claimed under the write lock, so no other process claims the same events
    return param.leaseMs === undefined
      ? listUnseen()
      : database.transaction(listUnseen).immediate();
  }

  markEventsSeen(eventIds: readonly string[]): void {
    const { database, statements } =
      this.lifecycle.resourcesFor('markEventsSeen');
    database
      .transaction(() => {
        const seenAt = readSqliteNow(statements.selectNow);
        for (const eventId of eventIds) {
          statements.markEventSeen.run({ eventId, seenAt });
        }
        if (this.deleteExpiredBatch(statements) > 0) {
          database.pragma(`incremental_vacuum(${pagesFreedPerMarking})`);
        }
      })
      .immediate();
  }

  /**
   * Deletes every event seen for longer than the outbox keeps seen events,
   * and gives the space back to the disk. Marking events seen already does
   * this a few at a time; call it to catch up on a schedule of your own.
   *
   * @returns How many events were deleted.
   */
  deleteExpiredEvents(): number {
    const { database, statements } = this.lifecycle.resourcesFor(
      'deleteExpiredEvents',
    );
    let deletedEventCount = 0;
    let deletedInBatchCount = expiredEventsDeletedPerMarking;
    while (deletedInBatchCount === expiredEventsDeletedPerMarking) {
      deletedInBatchCount = database
        .transaction(() => this.deleteExpiredBatch(statements))
        .immediate();
      deletedEventCount += deletedInBatchCount;
    }
    database.pragma('incremental_vacuum');
    return deletedEventCount;
  }

  /** Inserts each event not already stored, all landing at one time by SQLite's clock. */
  private insertEvents(
    statements: OutboxStatements,
    eventRecords: readonly ArvoOutboxEventRecord[],
  ): void {
    const committedAt = readSqliteNow(statements.selectNow);
    for (const eventRecord of eventRecords) {
      statements.insertEvent.run(toEventInsert(eventRecord, committedAt));
    }
  }

  /** Opens the file and readies it, closing it again where any step throws. */
  private openConnection(): SqliteConnection {
    if (this.filename !== ':memory:' && this.filename !== '') {
      createOwnerOnlyFile(this.filename);
    }
    const database = new Database(this.filename, {
      timeout: this.busyTimeoutMs,
    });
    try {
      configureConnection(database);
      this.refuseUnknownSchemaVersion(database);
      database.transaction(() => database.exec(outboxSchema)).immediate();
      return { database, statements: prepareStatements(database) };
    } catch (error_) {
      database.close();
      throw error_;
    }
  }

  /** Deletes up to one batch of expired events, and says how many. */
  private deleteExpiredBatch(statements: OutboxStatements): number {
    if (this.retainSeenEventsForMs === Number.POSITIVE_INFINITY) return 0;
    return statements.deleteExpiredEvents.run({
      cutOffModifier: secondsAgo(this.retainSeenEventsForMs),
      batchSize: expiredEventsDeletedPerMarking,
    }).changes;
  }

  /** Throws, before anything is created, where the file holds outbox tables of another version. */
  private refuseUnknownSchemaVersion(database: Database.Database): void {
    const metaTable = database
      .prepare<[], { name: string }>(
        "select name from sqlite_schema where type = 'table' and name = 'arvo_outbox_meta'",
      )
      .get();
    if (metaTable === undefined) return;
    const versionRow = database
      .prepare<[], { value: string }>(
        "select value from arvo_outbox_meta where name = 'schema_version'",
      )
      .get();
    if (versionRow === undefined || versionRow.value === outboxSchemaVersion)
      return;
    throw new Error(
      `ArvoSqliteOutbox cannot open ${this.filename}: its outbox tables are at version ${versionRow.value}, and this outbox knows only version ${outboxSchemaVersion}. Open it with the version of arvo-core that wrote it.`,
    );
  }
}
