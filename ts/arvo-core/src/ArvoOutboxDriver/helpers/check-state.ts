import { err, ok } from 'neverthrow';
import { walkPayload } from '../../ArvoEvent/json.js';
import { fromNeverthrow } from '../../result.js';
import type { JSONObject, Result } from '../../types.js';
import type { ErrorIssue } from '../../utils/error-issue.js';

/**
 * A state read's answer as a JSON object at every depth, or none, or every
 * place it is not.
 */
export const checkState = (
  answer: unknown,
): Result<JSONObject | null, readonly ErrorIssue[]> => {
  if (answer === null) return fromNeverthrow(ok(null));
  const stateWalk = walkPayload(answer, 'state');
  if (stateWalk.issues.length > 0) {
    return fromNeverthrow(err(stateWalk.issues));
  }
  return fromNeverthrow(ok(stateWalk.value));
};
