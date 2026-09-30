import {
  buildErrorIssueMessage,
  type ErrorIssue,
} from '../../utils/error-issue.js';

/**
 * Thrown when what an execution remembers could not be brought into being.
 *
 * Shape and domain only — a field of the wrong type, a lifecycle outside the
 * six, a negative depth, an event that is not an event. Whether a record
 * agrees with the contract it names is a different question, asked where a
 * delivery is admitted rather than here.
 *
 * Never means a delivery failed. That is an `ArvoHandlerFault`. This means
 * the record itself is wrong, which is either a defect in whatever built it
 * or a store handing back something corrupt.
 *
 * The message names every rule that was broken, so it can be acted on
 * without reading this source. {@link issues} carries the same information
 * individually for callers that would rather present it their own way.
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
