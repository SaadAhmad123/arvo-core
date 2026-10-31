import { z } from 'zod';
import type { ArvoOutboxCommitOutcome } from '../../ArvoOutbox/types/commit.js';
import type { Result } from '../../types.js';
import type { ErrorIssue } from '../../utils/error-issue.js';
import { checkAgainstSchema } from './check-against-schema.js';

/** The shape of a commit's answer, built per check so no schema is shared. */
const buildCommitOutcomeSchema = () =>
  z.discriminatedUnion('committed', [
    z.object({ committed: z.literal(true) }),
    z.object({
      committed: z.literal(false),
      refusal: z.enum(['state_exists', 'revision_stale', 'capacity_exhausted']),
    }),
  ]);

/** A commit's answer as one of the outcomes an outbox may answer, or why it is not. */
export const checkCommitOutcome = (
  answer: unknown,
): Result<ArvoOutboxCommitOutcome, readonly ErrorIssue[]> =>
  checkAgainstSchema(buildCommitOutcomeSchema(), answer, 'outcome');
