import {
  buildErrorIssueMessage,
  type ErrorIssue,
} from '../utils/error-issue.js';

/**
 * Returned by `ArvoSemanticVersion.tryCheck` when a value is not a valid
 * version.
 *
 * The message names every rule that was broken, so it can be acted on
 * without reading this source. {@link issues} carries the same information
 * individually for callers that would rather present it their own way.
 *
 * Never thrown by this module — `tryCheck` reports it as a value and
 * `check` discards it. It extends `Error` so that a caller who does choose
 * to throw it gets a stack and a usable message.
 */
export class ArvoSemanticVersionCheckError extends Error {
  /** Discriminant for identifying this error without an `instanceof` check. */
  readonly _tag = 'ArvoSemanticVersionCheckError';

  /** Every rule the value broke, not merely the first one found. */
  readonly issues: readonly ErrorIssue[];

  /**
   * @param issues - Every grammar rule the value failed.
   * @param options - Standard `ErrorOptions`. Pass `cause` to preserve an
   * underlying error where one exists.
   */
  constructor(issues: ErrorIssue[], options?: ErrorOptions) {
    super(
      buildErrorIssueMessage(
        'Value is not a valid ArvoSemanticVersion.',
        issues,
      ),
      options,
    );
    this.name = this._tag;
    this.issues = Object.freeze([...issues]);
  }
}
