import { describeValue } from '../../utils/error-issue.js';

/**
 * Thrown when {@link ArvoEventSerializer}'s own boundary work fails — a
 * malformed wire string, a payload that no longer parses as an `ArvoEvent`,
 * or a value that cannot be turned into JSON at all. `.cause` is always the
 * original error, never discarded.
 *
 * A `CloudEventTransformationError` from `CloudEventConverter` is never
 * wrapped here: it already names a transformation-shape defect, a distinct
 * category from a failure this class introduces at its own boundary. The
 * two are distinguishable with one `instanceof` check each.
 *
 * `cause` is typed as the general `Error`, not narrowed to the concrete
 * types this class currently produces (`SyntaxError`, `TypeError`,
 * `ArvoEventValidationError`) — narrowing would go stale the moment a new
 * boundary failure mode is added, and a caller who wants to distinguish
 * them already has to inspect `.cause`'s own type regardless of how wide
 * the declared type is.
 */
export class ArvoEventSerializerError extends Error {
  /** Discriminant for identifying this error without an `instanceof` check. */
  readonly _tag = 'ArvoEventSerializerError';

  /** The original error this wraps. */
  readonly cause: Error;

  constructor(cause: Error) {
    super(`ArvoEventSerializer failed: ${describeValue(cause)}`, { cause });
    this.name = this._tag;
    this.cause = cause;
  }
}
