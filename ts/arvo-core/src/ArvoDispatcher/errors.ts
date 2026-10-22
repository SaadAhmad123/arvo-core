import {
  buildErrorIssueMessage,
  type ErrorIssue,
} from '../utils/error-issue.js';

/**
 * A dispatcher's declaration broke at least one rule, or a name may not stand
 * outside its set. `issues` names every rule broken, not just the first.
 */
export class ArvoDispatcherValidationError extends Error {
  readonly _tag = 'ArvoDispatcherValidationError';

  /** Every rule broken, each with the path of what broke it. */
  readonly issues: readonly ErrorIssue[];

  constructor(issues: ErrorIssue[], options?: ErrorOptions) {
    super(
      buildErrorIssueMessage('ArvoDispatcher is not valid.', issues),
      options,
    );
    this.name = this._tag;
    this.issues = Object.freeze([...issues]);
  }
}
