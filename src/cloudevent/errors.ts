import type { ArvoEventValidationIssue } from '../ArvoEvent/errors.js';
import { describeValue } from '../utils.js';

const formatIssue = (issue: ArvoEventValidationIssue): string => {
  const received =
    'received' in issue ? ` (received ${describeValue(issue.received)})` : '';
  return `${issue.path}: ${issue.message}${received}`;
};

const formatIssues = (
  heading: string,
  issues: readonly ArvoEventValidationIssue[],
): string => {
  if (issues.length === 0) return heading;
  if (issues.length === 1)
    return `${heading} ${formatIssue(issues[0] as ArvoEventValidationIssue)}`;
  const lines = issues.map((issue) => `  - ${formatIssue(issue)}`).join('\n');
  return `${heading} (${issues.length} problems):\n${lines}`;
};

/**
 * One of two unrelated things that can go wrong crossing the CloudEvent
 * boundary: a structural rejection from the base mapping's own reverse
 * case, or a pipeline stage's own thrown failure. Narrow on `kind`.
 */
export type CloudEventTransformationErrorDetail =
  | { kind: 'strict' | 'foreign'; issues: readonly ArvoEventValidationIssue[] }
  | {
      kind: 'stage';
      direction: 'convert' | 'revert';
      stageIndex: number;
      cause: unknown;
    };

const formatMessage = (detail: CloudEventTransformationErrorDetail): string => {
  // Narrow on the single-literal `'stage'` member first: `kind`'s other
  // member is itself the union `'strict' | 'foreign'`, and TypeScript only
  // narrows a discriminant cleanly against a single-literal comparison.
  if (detail.kind === 'stage') {
    return `CloudEvent transformation stage ${detail.stageIndex} failed during ${detail.direction} (received ${describeValue(detail.cause)})`;
  }
  const heading =
    detail.kind === 'strict'
      ? 'CloudEvent is not strictly Arvo-shaped.'
      : 'Foreign CloudEvent could not be adapted into an ArvoEvent.';
  return formatIssues(heading, detail.issues);
};

/**
 * Thrown when a CloudEvent cannot be transformed to or from an ArvoEvent.
 *
 * {@link detail} carries one of two unrelated failure shapes, discriminated
 * by `kind`: `'strict'`/`'foreign'` for the base mapping's own structural
 * rejection (see {@link ArvoEventValidationIssue}), or `'stage'` for a
 * pipeline stage's own thrown failure, identified by which stage and which
 * direction.
 */
export class CloudEventTransformationError extends Error {
  /** Discriminant for identifying this error without an `instanceof` check. */
  readonly _tag = 'CloudEventTransformationError';

  readonly detail: CloudEventTransformationErrorDetail;

  /**
   * @param detail - Which of the two failure shapes occurred.
   * @param options - Standard `ErrorOptions`. Pass `cause` to preserve an
   * underlying error where one exists, independent of `detail.cause` on a
   * `'stage'` failure.
   */
  constructor(
    detail: CloudEventTransformationErrorDetail,
    options?: ErrorOptions,
  ) {
    super(formatMessage(detail), options);
    this.name = this._tag;
    this.detail = detail;
  }
}
