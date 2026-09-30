import { describeValue } from '../../../utils/error-issue.js';

/**
 * Thrown when the boundary between a record and a string fails: a string
 * that is not JSON, JSON that is not a record at all, or a record holding a
 * value that cannot be turned into JSON.
 *
 * Distinct from a record being wrong, which is reported as
 * `ArvoExecutionStateValidationError` and names the fields at fault. This
 * says nothing was readable enough to judge.
 *
 * `cause` is always the original error, never discarded.
 */
export class ArvoExecutionStateSerializerError extends Error {
  /** Discriminant for identifying this error without an `instanceof` check. */
  readonly _tag = 'ArvoExecutionStateSerializerError';

  /** The original error this wraps. */
  override readonly cause: Error;

  /** @param cause - The failure this wraps. */
  constructor(cause: Error) {
    super(`ArvoExecutionStateSerializer failed: ${describeValue(cause)}`, {
      cause,
    });
    this.name = this._tag;
    this.cause = cause;
  }
}
