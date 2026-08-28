import {
  buildErrorIssueMessage,
  type ErrorIssue,
} from '../utils/error-issue.js';

/**
 * Thrown when an event could not be brought into being.
 *
 * Usually the event is malformed — a missing field, a value of the wrong
 * shape, or a combination of fields that cannot occur together. Where the
 * event was built from a contract, it also covers a payload that failed that
 * contract's schema: the declaration is part of what creating such an event
 * means, so a rejected payload is the event failing to exist rather than a
 * separate check. `issues` beneath `data` are that case.
 *
 * An event that already exists and does not match a contract is a different
 * question, reported separately when one is asserted against the other.
 *
 * The message names every rule that was broken, so it can be acted on without
 * reading this source. {@link issues} carries the same information
 * individually for callers that would rather present it their own way.
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
