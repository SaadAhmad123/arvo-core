import {
  buildErrorIssueMessage,
  type ErrorIssue,
} from '../../../utils/error-issue.js';
import type { ArvoFaultKind } from '../../fault/types.js';

/**
 * Why an event does not belong to the contracts a handler declared, or
 * does not satisfy the schema they select for it.
 *
 * Not itself a fault: it describes an event, not a delivery. It carries
 * the `fault_kind` so whoever holds one raises it without re-deciding.
 */
export class ArvoEventValidatorError extends Error {
  /** Discriminant for identifying this error without an `instanceof` check. */
  readonly _tag = 'ArvoEventValidatorError';

  /** Which fault this becomes where a delivery raises it. */
  readonly faultKind: ArvoFaultKind;

  /** Every rule the event broke, not merely the first one found. */
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
