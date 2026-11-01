import Database from 'better-sqlite3';
import type { IArvoOutbox } from '../../ArvoOutbox/interface.js';
import { ArvoOutboxLifecycle } from '../../ArvoOutbox/lifecycle.js';
import type {
  ArvoOutboxCapacity,
  ArvoOutboxCapacityRequest,
} from '../../ArvoOutbox/types/capacity.js';
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
import { applyMigrations } from './helpers/apply-migrations.js';
import { checkOptions } from './helpers/check-options.js';
import { configureConnection } from './helpers/configure-connection.js';
import { createOwnerOnlyFile } from './helpers/create-owner-only-file.js';
import {
  expiredRowsDeletedPerMarking,
  pagesFreedPerMarking,
} from './helpers/defaults.js';
import { toCommittedEventRecord, toEventInsert } from './helpers/event-rows.js';
import {
  type ArvoSqliteOutboxResolvedOptions,
  resolveOptions,
} from './helpers/resolve-options.js';
import { secondsAgo, secondsLater } from './helpers/seconds-modifier.js';
import { readSqliteNow } from './helpers/sqlite-now.js';
import { outboxMigrations } from './migrations.js';
import { type OutboxStatements, prepareStatements } from './statements.js';
import type {
  ArvoSqliteOutboxDeletedCounts,
  ArvoSqliteOutboxOptions,
} from './types.js';

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
 * each execution's latest state. It deletes an event once it has been seen
 * for longer than `options.retentionMs.seenEvents`, and a state at
 * `success`, `error`, `cancelled` or `failure` once its last commit is older
 * than `options.retentionMs.terminalStates`, a few at a time as events are
 * marked seen, or all at once with {@link ArvoSqliteOutbox.deleteExpired}.
 * An unseen event, and a state at any other lifecycle, is never deleted. A file it creates is readable and writable by its owner alone.
 *
 * It limits nothing: its capacity is always `available`, and it refuses no
 * commit for lack of room. Watch the disk it is on.
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
  private readonly options: ArvoSqliteOutboxResolvedOptions;
  private readonly lifecycle: ArvoOutboxLifecycle<SqliteConnection>;

  /**
   * Checks the options. Touches no file: {@link ArvoSqliteOutbox.open} does.
   *
   * @param options - Which file, how long to wait for it, and how long to keep what it no longer needs. See {@link ArvoSqliteOutboxOptions}.
   * @throws {ArvoSqliteOutboxValidationError} Where the options break any rule. It names every problem.
   */
  constructor(options: ArvoSqliteOutboxOptions) {
    this.options = resolveOptions(checkOptions(options));
    this.lifecycle = new ArvoOutboxLifecycle(
      `ArvoSqliteOutbox on ${this.options.filename}`,
    );
  }

  /**
   * Opens the file, creating it, owner-only, where missing, and creating
   * what the outbox needs in it. Opening it again does nothing. Where
   * opening throws, the outbox stays unopened and may be opened again.
   *
   * @throws Where it has been closed: build a new one instead.
   * A file written by an older release is upgraded as it opens.
   *
   * @throws Whatever SQLite throws where the file cannot be opened, is not a SQLite database, or holds outbox tables of a newer release.
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
        const committedAt = readSqliteNow(statements.selectNow);
        statements.insertState.run({
          executionId: param.executionId,
          casVersion: param.casVersion,
          subject: param.subject,
          source: param.source,
          version: param.version,
          lifecycle: param.lifecycle,
          document,
          committedAt,
        });
        statements.deleteEarlierStates.run({
          executionId: param.executionId,
          casVersion: param.casVersion,
        });
        this.insertEvents(statements, param.events, committedAt);
        return { committed: true };
      })
      .immediate();
  }

  commitEvents(param: ArvoOutboxEventsCommit): ArvoOutboxCommitOutcome {
    const { database, statements } =
      this.lifecycle.resourcesFor('commitEvents');
    database
      .transaction(() =>
        this.insertEvents(
          statements,
          param.events,
          readSqliteNow(statements.selectNow),
        ),
      )
      .immediate();
    return { committed: true };
  }

  capacity(_request: ArvoOutboxCapacityRequest): ArvoOutboxCapacity {
    this.lifecycle.resourcesFor('capacity');
    return { status: 'available', buffers: {} };
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
        const deletedCounts = this.deleteExpiredBatch(statements);
        if (deletedCounts.events > 0 || deletedCounts.states > 0) {
          database.pragma(`incremental_vacuum(${pagesFreedPerMarking})`);
        }
      })
      .immediate();
  }

  /**
   * Deletes every event seen for longer than the outbox keeps seen events,
   * and every terminal state last committed longer ago than it keeps them,
   * and gives the space back to the disk. Marking events seen already does
   * this a few at a time; call it to catch up on a schedule of your own.
   *
   * @returns How many events, and how many states, were deleted.
   */
  deleteExpired(): ArvoSqliteOutboxDeletedCounts {
    const { database, statements } =
      this.lifecycle.resourcesFor('deleteExpired');
    let deletedEventCount = 0;
    let deletedStateCount = 0;
    let isBatchFull = true;
    while (isBatchFull) {
      const deletedCounts = database
        .transaction(() => this.deleteExpiredBatch(statements))
        .immediate();
      deletedEventCount += deletedCounts.events;
      deletedStateCount += deletedCounts.states;
      isBatchFull =
        deletedCounts.events === expiredRowsDeletedPerMarking ||
        deletedCounts.states === expiredRowsDeletedPerMarking;
    }
    database.pragma('incremental_vacuum');
    return { events: deletedEventCount, states: deletedStateCount };
  }

  /** Inserts each event not already stored, all landing at `committedAt`, the commit's one time by SQLite's clock. */
  private insertEvents(
    statements: OutboxStatements,
    eventRecords: readonly ArvoOutboxEventRecord[],
    committedAt: string,
  ): void {
    for (const eventRecord of eventRecords) {
      statements.insertEvent.run(toEventInsert(eventRecord, committedAt));
    }
  }

  /** Opens the file and readies it, closing it again where any step throws. */
  private openConnection(): SqliteConnection {
    if (this.options.filename !== ':memory:' && this.options.filename !== '') {
      createOwnerOnlyFile(this.options.filename);
    }
    const database = new Database(this.options.filename, {
      timeout: this.options.busyTimeoutMs,
    });
    try {
      configureConnection(database);
      database
        .transaction(() =>
          applyMigrations({
            database,
            migrations: outboxMigrations,
            filename: this.options.filename,
          }),
        )
        .immediate();
      return { database, statements: prepareStatements(database) };
    } catch (error_) {
      database.close();
      throw error_;
    }
  }

  /** Deletes up to one batch of expired events and one of expired terminal states, and says how many of each. */
  private deleteExpiredBatch(
    statements: OutboxStatements,
  ): ArvoSqliteOutboxDeletedCounts {
    const { seenEvents, terminalStates } = this.options.retentionMs;
    const deleteBatch = (
      statement: OutboxStatements['deleteExpiredEvents'],
      retentionMs: number,
    ) =>
      retentionMs === Number.POSITIVE_INFINITY
        ? 0
        : statement.run({
            cutOffModifier: secondsAgo(retentionMs),
            batchSize: expiredRowsDeletedPerMarking,
          }).changes;
    return {
      events: deleteBatch(statements.deleteExpiredEvents, seenEvents),
      states: deleteBatch(statements.deleteExpiredStates, terminalStates),
    };
  }
}
