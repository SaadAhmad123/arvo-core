import {
  buildErrorIssueMessage,
  type ErrorIssue,
} from '../../utils/error-issue.js';

/**
 * Thrown by {@link ArvoSqliteOutbox} where it is built with options that
 * break a rule, before any file is touched. `issues` names every problem,
 * not just the first.
 *
 * @example
 * ```typescript
 * try {
 *   new ArvoSqliteOutbox(options);
 * } catch (error_) {
 *   if (error_ instanceof ArvoSqliteOutboxValidationError) console.error(error_.issues);
 * }
 * ```
 */
export class ArvoSqliteOutboxValidationError extends Error {
  /** Discriminant for identifying this error without an `instanceof` check. */
  readonly _tag = 'ArvoSqliteOutboxValidationError';

  /** Every problem in the options, each with its path. */
  readonly issues: readonly ErrorIssue[];

  /** @param issues - Every problem in the options. */
  constructor(issues: readonly ErrorIssue[]) {
    super(
      buildErrorIssueMessage(
        'ArvoSqliteOutbox cannot be built with these options.',
        issues,
      ),
    );
    this.name = this._tag;
    this.issues = Object.freeze([...issues]);
  }
}
