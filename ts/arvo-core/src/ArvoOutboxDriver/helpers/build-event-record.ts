import type { ArvoEvent } from '../../ArvoEvent/index.js';
import type { ArvoOutboxEventRecord } from '../../ArvoOutbox/types/event-record.js';
import { ArvoEventSerializer } from '../../serializers/ArvoEventSerializer/index.js';

/** Writes every event as CloudEvent JSON, ADR-003's forward transformation. */
const cloudEventSerializer = new ArvoEventSerializer({ type: 'cloudevent' });

/** What an event record takes from the delivery and the commit, not the event. */
export type ArvoEventRecordContext = {
  readonly triggeringEventId: string;
  readonly casVersion: number | null;
};

/**
 * The event record that stores one live event: its own fields, the
 * delivered event's identifier, the record's revision or none, and the event
 * as CloudEvent JSON. Throws where one of Arvo's own events will not
 * serialize, a defect in the event rather than in the outbox.
 */
export const buildEventRecord = async (
  event: ArvoEvent,
  recordContext: ArvoEventRecordContext,
): Promise<ArvoOutboxEventRecord> => ({
  id: event.id,
  subject: event.subject,
  executionId: event.executionid,
  casVersion: recordContext.casVersion,
  parentId: event.parentid,
  initId: event.initid,
  triggeringEventId: recordContext.triggeringEventId,
  source: event.source,
  type: event.type,
  to: event.to,
  domain: event.domain,
  time: event.time,
  payload: await cloudEventSerializer.serialize(event),
});
