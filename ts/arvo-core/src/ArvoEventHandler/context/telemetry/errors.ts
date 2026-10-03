import {
  buildErrorIssueMessage,
  type ErrorIssue,
} from '../../../utils/error-issue.js';

/**
 * Thrown where what an execution would record against is not something it
 * can: no span, a span missing what a span answers to, or a meter or
 * logger that is neither `null` nor usable.
 *
 * Thrown where telemetry is built, never during an execution — so a
 * deployment learns its wiring is wrong before any work depends on it.
 * Never an `ArvoHandlerFault`: nothing was being executed.
 *
 * The message names every rule broken; {@link issues} carries the same
 * individually.
 */
export class ArvoExecutionContextTelemetryValidationError extends Error {
  /** Discriminant for identifying this error without an `instanceof` check. */
  readonly _tag = 'ArvoExecutionContextTelemetryValidationError';

  /** Every rule it broke, not merely the first one found. */
  readonly issues: readonly ErrorIssue[];

  /**
   * @param issues - Every rule what was handed over failed.
   * @param options - Standard `ErrorOptions`. Pass `cause` to preserve an
   * underlying error where one exists.
   */
  constructor(issues: ErrorIssue[], options?: ErrorOptions) {
    super(
      buildErrorIssueMessage(
        'this is not something an execution can record against.',
        issues,
      ),
      options,
    );
    this.name = this._tag;
    this.issues = Object.freeze([...issues]);
  }
}
