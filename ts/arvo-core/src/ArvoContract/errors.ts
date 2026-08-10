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
 */
export class ArvoContractValidationError extends Error {
  /** Discriminant for identifying this error without an `instanceof` check. */
  readonly _tag = 'ArvoContractValidationError';

  /** Every rule the declaration broke. */
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
