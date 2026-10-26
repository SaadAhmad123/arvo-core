import type Database from 'better-sqlite3';
import type { ArvoOutboxCommittedEventRecord } from '../../ArvoOutbox/types/event-record.js';

/** SQLite's own clock, in the form `toISOString` writes. */
const sqliteNow = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;

/** An event row, with each column named as its field is, and `seen` as stored. */
export type EventRow = Omit<ArvoOutboxCommittedEventRecord, 'seen'> & {
  readonly seen: number;
};

/** Every field of an event row, as its insert binds them. */
export type EventInsert = Omit<EventRow, 'seen'>;

/** Every column of an event row, named as its field is. */
const eventColumns = `
  id, subject, execution_id as executionId, cas_version as casVersion,
  parent_id as parentId, init_id as initId,
  triggering_event_id as triggeringEventId, source, type,
  to_destination as "to", domain, time, payload,
  committed_at as committedAt, seen`;

/** The fields beside a state, as its insert binds them. */
type StateInsert = {
  executionId: string;
  casVersion: number;
  subject: string;
  source: string;
  version: string;
  lifecycle: string;
  document: string;
};

/** The statements an outbox runs. */
export type OutboxStatements = {
  readonly selectLatestState: Database.Statement<
    { executionId: string },
    { casVersion: number; document: string }
  >;
  readonly selectNow: Database.Statement<[], { now: string }>;
  readonly insertState: Database.Statement<StateInsert>;
  readonly insertEvent: Database.Statement<EventInsert>;
  readonly selectEventsByExecution: Database.Statement<
    { executionId: string },
    EventRow
  >;
  readonly selectEventsByTriggeringEvent: Database.Statement<
    { triggeringEventId: string },
    EventRow
  >;
  readonly selectEventsByTriggeringEventAndExecution: Database.Statement<
    { triggeringEventId: string; executionId: string },
    EventRow
  >;
  readonly selectUnseenEvents: Database.Statement<
    { now: string; cutOffModifier: string; atMost: number },
    EventRow
  >;
  readonly leaseEvent: Database.Statement<{
    eventId: string;
    now: string;
    leaseModifier: string;
  }>;
  readonly deleteEarlierStates: Database.Statement<{
    executionId: string;
    casVersion: number;
  }>;
  readonly markEventSeen: Database.Statement<{
    eventId: string;
    seenAt: string;
  }>;
  readonly deleteExpiredEvents: Database.Statement<{
    cutOffModifier: string;
    batchSize: number;
  }>;
};

/** The statements an outbox runs, prepared once against its file. */
export const prepareStatements = (
  database: Database.Database,
): OutboxStatements => ({
  selectLatestState: database.prepare<
    { executionId: string },
    { casVersion: number; document: string }
  >(
    `select cas_version as casVersion, document from arvo_outbox_state
     where execution_id = @executionId order by cas_version desc limit 1`,
  ),
  selectNow: database.prepare<[], { now: string }>(
    `select ${sqliteNow} as now`,
  ),
  insertState: database.prepare<StateInsert>(
    `insert into arvo_outbox_state
       (execution_id, cas_version, subject, source, version, lifecycle, document)
     values
       (@executionId, @casVersion, @subject, @source, @version, @lifecycle, @document)`,
  ),
  insertEvent: database.prepare<EventInsert>(
    `insert into arvo_outbox_event
       (id, subject, execution_id, cas_version, parent_id, init_id,
        triggering_event_id, source, type, to_destination, domain, time,
        payload, committed_at)
     values
       (@id, @subject, @executionId, @casVersion, @parentId, @initId,
        @triggeringEventId, @source, @type, @to, @domain, @time,
        @payload, @committedAt)
     on conflict (id) do nothing`,
  ),
  selectEventsByExecution: database.prepare<{ executionId: string }, EventRow>(
    `select ${eventColumns} from arvo_outbox_event
     where execution_id = @executionId order by sequence`,
  ),
  selectEventsByTriggeringEvent: database.prepare<
    { triggeringEventId: string },
    EventRow
  >(
    `select ${eventColumns} from arvo_outbox_event
     where triggering_event_id = @triggeringEventId order by sequence`,
  ),
  selectEventsByTriggeringEventAndExecution: database.prepare<
    { triggeringEventId: string; executionId: string },
    EventRow
  >(
    `select ${eventColumns} from arvo_outbox_event
     where triggering_event_id = @triggeringEventId and execution_id = @executionId
     order by sequence`,
  ),
  selectUnseenEvents: database.prepare<
    { now: string; cutOffModifier: string; atMost: number },
    EventRow
  >(
    `select ${eventColumns} from arvo_outbox_event
     where seen = 0
       and committed_at <= strftime('%Y-%m-%dT%H:%M:%fZ', @now, @cutOffModifier)
       and (leased_until is null or leased_until <= @now)
     order by committed_at, sequence limit @atMost`,
  ),
  leaseEvent: database.prepare<{
    eventId: string;
    now: string;
    leaseModifier: string;
  }>(
    `update arvo_outbox_event
     set leased_until = strftime('%Y-%m-%dT%H:%M:%fZ', @now, @leaseModifier)
     where id = @eventId`,
  ),
  deleteEarlierStates: database.prepare<{
    executionId: string;
    casVersion: number;
  }>(
    `delete from arvo_outbox_state
     where execution_id = @executionId and cas_version < @casVersion`,
  ),
  markEventSeen: database.prepare<{ eventId: string; seenAt: string }>(
    `update arvo_outbox_event set seen = 1, seen_at = @seenAt
     where id = @eventId and seen = 0`,
  ),
  deleteExpiredEvents: database.prepare<{
    cutOffModifier: string;
    batchSize: number;
  }>(
    `delete from arvo_outbox_event where sequence in (
       select sequence from arvo_outbox_event
       where seen = 1
         and seen_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', @cutOffModifier)
       order by seen_at, sequence limit @batchSize
     )`,
  ),
});
