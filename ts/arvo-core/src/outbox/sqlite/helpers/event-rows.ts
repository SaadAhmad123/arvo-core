import type {
  ArvoOutboxCommittedEventRecord,
  ArvoOutboxEventRecord,
} from '../../../ArvoOutbox/types/event-record.js';
import type { EventInsert, EventRow } from '../statements.js';

/** An event record as its insert binds it: exactly its own fields, and when it landed. */
export const toEventInsert = (
  eventRecord: ArvoOutboxEventRecord,
  committedAt: string,
): EventInsert => ({
  id: eventRecord.id,
  subject: eventRecord.subject,
  executionId: eventRecord.executionId,
  casVersion: eventRecord.casVersion,
  parentId: eventRecord.parentId,
  initId: eventRecord.initId,
  triggeringEventId: eventRecord.triggeringEventId,
  source: eventRecord.source,
  type: eventRecord.type,
  to: eventRecord.to,
  domain: eventRecord.domain,
  time: eventRecord.time,
  payload: eventRecord.payload,
  committedAt,
});

/** An event row as handed back. */
export const toCommittedEventRecord = (
  eventRow: EventRow,
): ArvoOutboxCommittedEventRecord => ({
  ...eventRow,
  seen: eventRow.seen === 1,
});
