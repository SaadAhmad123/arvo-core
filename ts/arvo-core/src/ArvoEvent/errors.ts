import {
  buildErrorIssueMessage,
  type ErrorIssue,
} from '../utils/error-issue.js';

/**
 * Thrown when an event is structurally invalid.
 *
 * This means the event itself is malformed — a missing field, a value of the
 * wrong shape, or a combination of fields that cannot occur together. It does
 * not mean the payload failed contract validation, which is a separate check.
 *
 * The message names every rule that was broken, so it can be acted on without
 * reading this source. {@link issues} carries the same information
 * individually for callers that would rather present it their own way.
 *
 * @see docs/adr/001-arvoevent-structure.md for the full field definitions and
 * structural rules.
 */
export class ArvoEventValidationError extends Error {
  /** Discriminant for identifying this error without an `instanceof` check. */
  readonly _tag = 'ArvoEventValidationError';

  /** Every rule the event broke, not merely the first one found. */
  readonly issues: readonly ErrorIssue[];

  /**
   * @param issues - Every structural rule the event failed.
   * @param options - Standard `ErrorOptions`. Pass `cause` to preserve an
   * underlying error where one exists.
   */
  constructor(issues: ErrorIssue[], options?: ErrorOptions) {
    super(
      buildErrorIssueMessage('ArvoEvent is not structurally valid.', issues),
      options,
    );
    this.name = this._tag;
    this.issues = Object.freeze([...issues]);
  }
}
