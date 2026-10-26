import Database from 'better-sqlite3';
import type { IArvoOutbox } from '../../ArvoOutbox/interface.js';
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

/**
 * An outbox kept in a SQLite file, for one machine.
 *
 * It creates the tables and indexes it needs in the file where they are
 * missing and leaves everything else in it alone, so what it committed is
 * there after a restart. Several outboxes may share one file, in one process
 * or several, and together meet every rule of {@link IArvoOutbox} as one
 * would: each commit takes the file's write lock before it checks the
 * revision. Every landing time, and the cut-off for listing unseen events,
 * comes from SQLite's own clock.
 *
 * Every operation answers directly, never through a promise, and holds the
 * thread until SQLite answers. Where another writer holds the file for
 * longer than `options.busyTimeoutMs`, the operation throws and stores
 * nothing. Sharing a file between several sweepers sends each event more
 * than once, which receivers drop as repeats; run one sweeper per file.
 *
 * It keeps each execution's latest state only, and deletes an event once it
 * has been seen for longer than `options.retainSeenEventsForMs`, a few at a
 * time as events are marked seen, or all at once through
 * {@link ArvoSqliteOutbox.deleteExpiredEvents}. An unseen event is never
 * deleted. A file it creates gives the space of what it deletes back to the
 * disk. It honours a lease asked for when listing unseen events, across
 * every outbox on the file.
 *
 * A file it creates is readable and writable by its owner alone. It syncs
 * every commit to disk in full, overwrites what it deletes, runs nothing a
 * file defines, and refuses a file whose outbox tables another version of
 * it wrote.
 *
 * It holds the file open until {@link ArvoSqliteOutbox.close} is called.
 *
 * @example
 * ```typescript
 * const outbox = new ArvoSqliteOutbox({ filename: '/var/lib/orders/outbox.sqlite' });
 * const outcome = outbox.commitStateAndEvents(commit);
 * const latestState = outbox.readLatestState(commit.executionId);
 * outbox.close();
 * ```
 */
export class ArvoSqliteOutbox implements IArvoOutbox {
  private readonly filename: string;
  private readonly retainSeenEventsForMs: number;
  private readonly database: Database.Database;
  private readonly statements: OutboxStatements;

  /**
   * Opens the file, creating it and what the outbox needs in it where
   * missing.
   *
   * @param options - Which file, how long to wait for it, and how long to keep seen events. See {@link ArvoSqliteOutboxOptions}.
   * @throws {RangeError} Where `options.busyTimeoutMs` or `options.retainSeenEventsForMs` is out of range.
   * @throws Whatever SQLite throws where the file cannot be opened or is not a SQLite database.
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
    this.retainSeenEventsForMs = retainSeenEventsForMs;
    if (options.filename !== ':memory:' && options.filename !== '') {
      createOwnerOnlyFile(options.filename);
    }
    this.database = new Database(options.filename, { timeout: busyTimeoutMs });
    try {
      configureConnection(this.database);
      this.refuseUnknownSchemaVersion();
      this.database
        .transaction(() => this.database.exec(outboxSchema))
        .immediate();
      this.statements = prepareStatements(this.database);
    } catch (error_) {
      this.database.close();
      throw error_;
    }
  }

  readLatestState(executionId: string): JSONObject | null {
    this.refuseOnceClosed();
    const stateRow = this.statements.selectLatestState.get({ executionId });
    return stateRow ? JSON.parse(stateRow.document) : null;
  }

  commitStateAndEvents(param: ArvoOutboxStateCommit): ArvoOutboxCommitOutcome {
    this.refuseOnceClosed();
    const document = JSON.stringify(param.state);
    return this.database
      .transaction((): ArvoOutboxCommitOutcome => {
        const refusal = refusalFor({
          casVersion: param.casVersion,
          storedCasVersion: this.statements.selectLatestState.get({
            executionId: param.executionId,
          })?.casVersion,
        });
        if (refusal !== null) return { committed: false, refusal };
        this.statements.insertState.run({
          executionId: param.executionId,
          casVersion: param.casVersion,
          subject: param.subject,
          source: param.source,
          version: param.version,
          lifecycle: param.lifecycle,
          document,
        });
        this.statements.deleteEarlierStates.run({
          executionId: param.executionId,
          casVersion: param.casVersion,
        });
        this.insertEvents(param.events);
        return { committed: true };
      })
      .immediate();
  }

  commitEvents(param: ArvoOutboxEventsCommit): void {
    this.refuseOnceClosed();
    this.database
      .transaction(() => this.insertEvents(param.events))
      .immediate();
  }

  readCommittedEvents(
    filter: ArvoOutboxEventsFilter,
  ): readonly ArvoOutboxCommittedEventRecord[] {
    this.refuseOnceClosed();
    if (!('triggeringEventId' in filter)) {
      return this.statements.selectEventsByExecution
        .all({ executionId: filter.executionId })
        .map(toCommittedEventRecord);
    }
    return (
      'executionId' in filter
        ? this.statements.selectEventsByTriggeringEventAndExecution.all({
            triggeringEventId: filter.triggeringEventId,
            executionId: filter.executionId,
          })
        : this.statements.selectEventsByTriggeringEvent.all({
            triggeringEventId: filter.triggeringEventId,
          })
    ).map(toCommittedEventRecord);
  }

  listUnseenEvents(
    param: ArvoOutboxUnseenEventsParam,
  ): readonly ArvoOutboxCommittedEventRecord[] {
    this.refuseOnceClosed();
    refuseInvalidListing('ArvoSqliteOutbox', param);
    const listUnseen = () => {
      const now = readSqliteNow(this.statements.selectNow);
      const eventRows = this.statements.selectUnseenEvents.all({
        now,
        cutOffModifier: secondsAgo(param.olderThanMs),
        atMost: param.atMost,
      });
      if (param.leaseMs !== undefined) {
        const leaseModifier = secondsLater(param.leaseMs);
        for (const eventRow of eventRows) {
          this.statements.leaseEvent.run({
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
      : this.database.transaction(listUnseen).immediate();
  }

  markEventsSeen(eventIds: readonly string[]): void {
    this.refuseOnceClosed();
    this.database
      .transaction(() => {
        const seenAt = readSqliteNow(this.statements.selectNow);
        for (const eventId of eventIds) {
          this.statements.markEventSeen.run({ eventId, seenAt });
        }
        if (this.deleteExpiredBatch() > 0) {
          this.database.pragma(`incremental_vacuum(${pagesFreedPerMarking})`);
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
    this.refuseOnceClosed();
    let deletedEventCount = 0;
    let deletedInBatch = expiredEventsDeletedPerMarking;
    while (deletedInBatch === expiredEventsDeletedPerMarking) {
      deletedInBatch = this.database
        .transaction(() => this.deleteExpiredBatch())
        .immediate();
      deletedEventCount += deletedInBatch;
    }
    this.database.pragma('incremental_vacuum');
    return deletedEventCount;
  }

  /**
   * Releases the file. May be called again; every other operation throws
   * once it has been.
   */
  close(): void {
    if (this.database.open) this.database.close();
  }

  /** Inserts each event not already stored, all landing at one time by SQLite's clock. */
  private insertEvents(eventRecords: readonly ArvoOutboxEventRecord[]): void {
    const committedAt = readSqliteNow(this.statements.selectNow);
    for (const eventRecord of eventRecords) {
      this.statements.insertEvent.run(toEventInsert(eventRecord, committedAt));
    }
  }

  /** Deletes up to one batch of expired events, and says how many. */
  private deleteExpiredBatch(): number {
    if (this.retainSeenEventsForMs === Number.POSITIVE_INFINITY) return 0;
    return this.statements.deleteExpiredEvents.run({
      cutOffModifier: secondsAgo(this.retainSeenEventsForMs),
      batchSize: expiredEventsDeletedPerMarking,
    }).changes;
  }

  /** Throws, before anything is created, where the file holds outbox tables of another version. */
  private refuseUnknownSchemaVersion(): void {
    const metaTable = this.database
      .prepare<[], { name: string }>(
        "select name from sqlite_schema where type = 'table' and name = 'arvo_outbox_meta'",
      )
      .get();
    if (metaTable === undefined) return;
    const versionRow = this.database
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

  /** Throws where the file has been released. */
  private refuseOnceClosed(): void {
    if (!this.database.open) {
      throw new Error(
        `ArvoSqliteOutbox on ${this.filename} is closed; open a new one on the file to use it again.`,
      );
    }
  }
}
