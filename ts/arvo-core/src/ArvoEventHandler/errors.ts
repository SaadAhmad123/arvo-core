import {
  buildErrorIssueMessage,
  type ErrorIssue,
} from '../utils/error-issue.js';

/**
 * Thrown when a handler declaration is not valid.
 *
 * Never means an execution failed. It is raised while a handler is being
 * declared, before any event exists, and a handler that was built is one
 * every rule accepted.
 *
 * The message names every rule the declaration broke rather than the first,
 * so one attempt tells you everything to fix. {@link issues} carries the
 * same information individually, each naming the position that broke it.
 *
 * One exception: where an issue is blocking, a value the remaining rules
 * depend on was itself invalid, so those rules never ran. That issue says
 * what depended on it, and the message says the list is partial. Fix it and
 * declare again to see the rest.
 */
export class ArvoEventHandlerValidationError extends Error {
  /** Discriminant for identifying this error without an `instanceof` check. */
  readonly _tag = 'ArvoEventHandlerValidationError';

  /**
   * Every rule the declaration broke that was evaluated.
   *
   * Not necessarily every rule it broke: where one of these is blocking,
   * the rules depending on it never ran. See `ErrorIssue.isBlocking`.
   */
  readonly issues: readonly ErrorIssue[];

  constructor(issues: ErrorIssue[], options?: ErrorOptions) {
    super(
      buildErrorIssueMessage('ArvoEventHandler is not valid.', issues),
      options,
    );
    this.name = this._tag;
    this.issues = Object.freeze([...issues]);
  }
}
