import {
  buildErrorIssueMessage,
  type ErrorIssue,
} from '../utils/error-issue.js';

/**
 * Thrown when a contract declaration is not valid.
 *
 * The message names every rule the declaration broke, not just the first, so
 * one attempt tells you everything to fix. {@link issues} carries the same
 * information individually, each naming the position that broke it.
 *
 * One exception: when an issue is blocking, a value the remaining rules
 * depend on was itself invalid, so those rules did not run. That issue says
 * why, and the message says the list is partial. Fix it and declare again to
 * see any further problems.
 */
export class ArvoContractValidationError extends Error {
  /** Discriminant for identifying this error without an `instanceof` check. */
  readonly _tag = 'ArvoContractValidationError';

  /**
   * Every rule the declaration broke that was evaluated.
   *
   * Not necessarily every rule it broke: if one of these is blocking, the
   * rules depending on it never ran. See `ErrorIssue.isBlocking`.
   */
  readonly issues: readonly ErrorIssue[];

  constructor(issues: ErrorIssue[], options?: ErrorOptions) {
    super(
      buildErrorIssueMessage('ArvoContract is not valid.', issues),
      options,
    );
    this.name = this._tag;
    this.issues = Object.freeze([...issues]);
  }
}
