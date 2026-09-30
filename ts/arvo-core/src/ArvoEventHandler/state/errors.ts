import {
  buildErrorIssueMessage,
  type ErrorIssue,
} from '../../utils/error-issue.js';

/**
 * Thrown when what an execution remembers could not be brought into being:
 * a field of the wrong type, a lifecycle outside the six, a negative depth,
 * an event that is not an event.
 *
 * Never means a delivery failed — that is an `ArvoHandlerFault`. The
 * message names every rule broken; {@link issues} carries the same
 * individually.
 */
export class ArvoExecutionStateValidationError extends Error {
  /** Discriminant for identifying this error without an `instanceof` check. */
  readonly _tag = 'ArvoExecutionStateValidationError';

  /** Every rule the record broke, not merely the first one found. */
  readonly issues: readonly ErrorIssue[];

  /**
   * @param issues - Every rule the record failed.
   * @param options - Standard `ErrorOptions`. Pass `cause` to preserve an
   * underlying error where one exists.
   */
  constructor(issues: ErrorIssue[], options?: ErrorOptions) {
    super(
      buildErrorIssueMessage(
        'ArvoExecutionState is not structurally valid.',
        issues,
      ),
      options,
    );
    this.name = this._tag;
    this.issues = Object.freeze([...issues]);
  }
}
