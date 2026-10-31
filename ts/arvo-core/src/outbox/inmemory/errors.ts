import {
  buildErrorIssueMessage,
  type ErrorIssue,
} from '../../utils/error-issue.js';

/**
 * Thrown by {@link ArvoMemoryOutbox} where it is built with options that
 * break a rule. `issues` names every problem, not just the first.
 *
 * @example
 * ```typescript
 * try {
 *   new ArvoMemoryOutbox(options);
 * } catch (error_) {
 *   if (error_ instanceof ArvoMemoryOutboxValidationError) console.error(error_.issues);
 * }
 * ```
 */
export class ArvoMemoryOutboxValidationError extends Error {
  /** Discriminant for identifying this error without an `instanceof` check. */
  readonly _tag = 'ArvoMemoryOutboxValidationError';

  /** Every problem in the options, each with its path. */
  readonly issues: readonly ErrorIssue[];

  /** @param issues - Every problem in the options. */
  constructor(issues: readonly ErrorIssue[]) {
    super(
      buildErrorIssueMessage(
        'ArvoMemoryOutbox cannot be built with these options.',
        issues,
      ),
    );
    this.name = this._tag;
    this.issues = Object.freeze([...issues]);
  }
}
