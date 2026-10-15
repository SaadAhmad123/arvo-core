import { describeValue } from '../../../utils/error-issue.js';

/**
 * Thrown where a record and a string will not cross: a string that is not
 * JSON, JSON that is not a record, or a record that will not stringify.
 *
 * A record that reads but is wrong is an
 * `ArvoExecutionStateValidationError` instead. `cause` is always the
 * original error.
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
