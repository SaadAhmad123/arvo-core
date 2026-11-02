import { z } from 'zod';
import type { ArvoOutboxCommitOutcome } from '../../ArvoOutbox/types/commit.js';
import type { Result } from '../../types.js';
import { checkAgainstSchema } from '../../utils/check-against-schema.js';
import type { ErrorIssue } from '../../utils/error-issue.js';

/** The shape of a commit's answer, built once by each driver and held by it. */
export const buildCommitOutcomeSchema = () =>
  z.discriminatedUnion('committed', [
    z.object({ committed: z.literal(true) }),
    z.object({
      committed: z.literal(false),
      refusal: z.enum(['state_exists', 'revision_stale', 'capacity_exhausted']),
    }),
  ]);

/** A commit answer's schema, as {@link buildCommitOutcomeSchema} builds it. */
export type CommitOutcomeSchema = ReturnType<typeof buildCommitOutcomeSchema>;

/** A commit's answer as one of the outcomes an outbox may answer, or why it is not. */
export const checkCommitOutcome = (
  schema: CommitOutcomeSchema,
  answer: unknown,
): Result<ArvoOutboxCommitOutcome, readonly ErrorIssue[]> =>
  checkAgainstSchema(schema, answer, 'outcome');
