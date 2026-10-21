import {
  buildErrorIssueMessage,
  type ErrorIssue,
} from '../../../utils/error-issue.js';
import type { ArvoFaultKind } from '../../fault/types.js';

/** The two faults the layers of an execution can become before any runs. */
export type ArvoComposedMiddlewareFaultKind = Extract<
  ArvoFaultKind,
  'middleware_instantiation_failed' | 'middleware_conflict'
>;

/**
 * Why the layers of an execution break a rule: an entry that is not a
 * layer, or two layers sharing an identifier.
 *
 * Not itself a fault: it describes the layers, not the execution. It
 * carries the `fault_kind` so whoever holds one raises it without
 * re-deciding.
 */
export class ArvoComposedMiddlewareValidationError extends Error {
  /** Discriminant for identifying this error without an `instanceof` check. */
  readonly _tag = 'ArvoComposedMiddlewareValidationError';

  /** Which fault this becomes where an execution raises it. */
  readonly faultKind: ArvoComposedMiddlewareFaultKind;

  /** Every rule the layers broke, not merely the first one found. */
  readonly issues: readonly ErrorIssue[];

  /**
   * @param faultKind - The fault this becomes on an execution.
   * @param heading - What was wrong, already punctuated.
   * @param issues - Every rule the layers broke.
   */
  constructor(
    faultKind: ArvoComposedMiddlewareFaultKind,
    heading: string,
    issues: ErrorIssue[],
  ) {
    super(buildErrorIssueMessage(heading, issues));
    this.name = this._tag;
    this.faultKind = faultKind;
    this.issues = Object.freeze([...issues]);
  }
}

/**
 * Why the layers of an execution could not be made: a way to make one
 * threw.
 *
 * Nothing was judged, so it carries no issues: code failed, and what it
 * threw is kept as the cause. It always becomes a failed instantiation.
 */
export class ArvoComposedMiddlewareResolutionError extends Error {
  /** Discriminant for identifying this error without an `instanceof` check. */
  readonly _tag = 'ArvoComposedMiddlewareResolutionError';

  /** Which fault this becomes where an execution raises it. */
  readonly faultKind = 'middleware_instantiation_failed' as const;

  /** Where the function sits, as `execute({ middleware })[1]`. */
  readonly position: string;

  /**
   * @param param.position - Where the way to make a layer sits.
   * @param param.thrown - What calling it threw, kept as the cause.
   */
  constructor(param: { position: string; thrown: unknown }) {
    const thrownMessage =
      param.thrown instanceof Error
        ? param.thrown.message
        : String(param.thrown);
    super(
      `This execution was not run: ${param.position} is a function that should return a middleware, and calling it threw: ${thrownMessage}. No middleware ran and the handler was not called. Fix the function, or pass the middleware object itself`,
      { cause: param.thrown },
    );
    this.name = this._tag;
    this.position = param.position;
  }
}
