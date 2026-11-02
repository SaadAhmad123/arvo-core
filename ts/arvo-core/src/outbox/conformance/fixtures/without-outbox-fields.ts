import type {
  ArvoOutboxCommittedEventRecord,
  ArvoOutboxEventRecord,
} from '../../../ArvoOutbox/types/event-record.js';

/** A committed event record without the fields its outbox set. */
export const withoutOutboxFields = ({
  committedAt: _committedAt,
  seen: _seen,
  ...eventRecord
}: ArvoOutboxCommittedEventRecord): ArvoOutboxEventRecord => eventRecord;
