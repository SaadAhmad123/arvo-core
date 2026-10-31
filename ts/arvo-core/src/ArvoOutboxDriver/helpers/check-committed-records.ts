import { err, ok } from 'neverthrow';
import { z } from 'zod';
import type { ArvoOutboxCommittedEventRecord } from '../../ArvoOutbox/types/event-record.js';
import { fromNeverthrow } from '../../result.js';
import type { Result } from '../../types.js';
import { ErrorIssue } from '../../utils/error-issue.js';
import { checkAgainstSchema } from './check-against-schema.js';

/** Why a read of events answered wrongly, and every place it did. */
export type CommittedRecordsFailure = {
  readonly kind: 'malformed_response' | 'malformed_event';
  readonly issues: readonly ErrorIssue[];
};

/** The shape of every committed event record, built per check so no schema is shared. */
const buildCommittedRecordsSchema = () =>
  z.array(
    z.object({
      id: z.string(),
      subject: z.string(),
      executionId: z.string(),
      casVersion: z.number().int().nonnegative().nullable(),
      parentId: z.string().nullable(),
      initId: z.string().nullable(),
      triggeringEventId: z.string(),
      source: z.string(),
      type: z.string(),
      to: z.string().nullable(),
      domain: z.string().nullable(),
      time: z.string(),
      payload: z.string(),
      committedAt: z.string(),
      seen: z.boolean(),
    }),
  );

/**
 * A read of events' answer as committed event records, every field of every
 * one with its type, or why not: `malformed_response` where the answer is no
 * list, `malformed_event` naming every field wrong in any record.
 */
export const checkCommittedRecords = (
  answer: unknown,
): Result<
  readonly ArvoOutboxCommittedEventRecord[],
  CommittedRecordsFailure
> => {
  if (!Array.isArray(answer)) {
    return fromNeverthrow(
      err({
        kind: 'malformed_response',
        issues: [
          new ErrorIssue({
            path: 'records',
            message: 'must be a list of committed event records',
            received: answer,
          }),
        ],
      }),
    );
  }
  const recordsResult = checkAgainstSchema(
    buildCommittedRecordsSchema(),
    answer,
    'records',
  );
  if (!recordsResult.ok) {
    return fromNeverthrow(
      err({ kind: 'malformed_event', issues: recordsResult.error }),
    );
  }
  return fromNeverthrow(ok(recordsResult.value));
};
