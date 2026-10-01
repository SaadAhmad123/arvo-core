import {
  buildErrorIssueMessage,
  type ErrorIssue,
} from '../../../utils/error-issue.js';
import type { ArvoFaultKind } from '../../fault/types.js';

/**
 * Why an event sits too deep for the version judging it.
 *
 * Not itself a fault. It carries the `fault_kind` for where the breach was
 * found, so whoever holds a delivery raises it without re-deciding.
 */
export class ArvoEventDepthValidatorError extends Error {
  /** Discriminant for identifying this error without an `instanceof` check. */
  readonly _tag = 'ArvoEventDepthValidatorError';

  /** Which fault this becomes where a delivery raises it. */
  readonly faultKind: ArvoFaultKind;

  /** Every rule the event broke. */
  readonly issues: readonly ErrorIssue[];

  /**
   * @param faultKind - The fault this becomes on a delivery.
   * @param heading - What was wrong, already punctuated.
   * @param issues - Every rule the event failed.
   */
  constructor(faultKind: ArvoFaultKind, heading: string, issues: ErrorIssue[]) {
    super(buildErrorIssueMessage(heading, issues));
    this.name = this._tag;
    this.faultKind = faultKind;
    this.issues = Object.freeze([...issues]);
  }
}
