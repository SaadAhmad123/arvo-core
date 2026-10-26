import { err, ok } from 'neverthrow';
import type { ArvoOutboxCommitOutcome } from '../../ArvoOutbox/types/commit.js';
import { fromNeverthrow } from '../../result.js';
import type { Result } from '../../types.js';
import { ErrorIssue } from '../../utils/error-issue.js';
import { isObjectRecord } from './is-object-record.js';

/** A commit's answer as one of the outcomes an outbox may answer, or why it is not. */
export const checkCommitOutcome = (
  answer: unknown,
): Result<ArvoOutboxCommitOutcome, readonly ErrorIssue[]> => {
  if (isObjectRecord(answer)) {
    if (answer.committed === true) {
      return fromNeverthrow(ok({ committed: true }));
    }
    if (
      answer.committed === false &&
      (answer.refusal === 'state_exists' || answer.refusal === 'revision_stale')
    ) {
      return fromNeverthrow(ok({ committed: false, refusal: answer.refusal }));
    }
  }
  return fromNeverthrow(
    err([
      new ErrorIssue({
        path: 'outcome',
        message:
          'must be { committed: true }, or { committed: false } with a refusal of state_exists or revision_stale',
        received: answer,
      }),
    ]),
  );
};
