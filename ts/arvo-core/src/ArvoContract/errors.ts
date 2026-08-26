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

/**
 * Thrown when an event does not satisfy the contract it was asserted
 * against, or when the assertion itself named something the contract does
 * not declare.
 *
 * Never means the contract is invalid — a declaration that reached this
 * point is valid, and the most common failure is a caller expecting a type
 * their contract does not declare. {@link issues} says which it was: the
 * position `expectedType` is the request, and any position beneath `event`
 * is the event.
 *
 * One issue is often the whole story. Everything checked before the payload
 * is a prerequisite for what follows, so the first of those to fail is
 * reported alone and says why. Only payload failures arrive together.
 */
export class ArvoContractAssertionError extends Error {
  /** Discriminant for identifying this error without an `instanceof` check. */
  readonly _tag = 'ArvoContractAssertionError';

  /**
   * Every rule that was evaluated and failed.
   *
   * Not necessarily every rule the event breaks: if one of these is
   * blocking, the rules depending on it never ran. See
   * `ErrorIssue.isBlocking`.
   */
  readonly issues: readonly ErrorIssue[];

  constructor(issues: ErrorIssue[], options?: ErrorOptions) {
    super(
      buildErrorIssueMessage(
        'ArvoEvent does not satisfy the contract it was asserted against.',
        issues,
      ),
      options,
    );
    this.name = this._tag;
    this.issues = Object.freeze([...issues]);
  }
}
