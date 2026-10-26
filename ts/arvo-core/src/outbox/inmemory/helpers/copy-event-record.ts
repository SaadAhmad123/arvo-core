import type { ArvoOutboxEventRecord } from '../../../ArvoOutbox/types/event-record.js';

/**
 * A copy of an event record holding exactly its own fields, so nothing
 * else a caller attaches is stored. Every field is a string, a number or
 * null, so the copy shares nothing with what it was taken from.
 */
export const copyEventRecord = (
  eventRecord: ArvoOutboxEventRecord,
): ArvoOutboxEventRecord => ({
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
});
