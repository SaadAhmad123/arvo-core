import {
  buildErrorIssueMessage,
  describeValue,
  type ErrorIssue,
} from '../utils/error-issue.js';

/**
 * Why an {@link ArvoOutboxDriver} operation failed:
 *
 * - `state_exists` — the outbox refused a commit: a state already exists for
 *   the execution, and this one claimed to be its first;
 * - `revision_stale` — the outbox refused a commit: the stored revision is
 *   not the one this state follows;
 * - `unavailable` — the outbox threw, so it could not do its work;
 * - `malformed_state` — a state read answered something that is not a JSON
 *   object or none;
 * - `malformed_event` — an event record is missing a field, holds one of the
 *   wrong type, or its payload does not restore to an Arvo event;
 * - `malformed_response` — any other answer of the wrong shape.
 *
 * `unavailable` is usually worth trying again later; a `malformed_*` kind is
 * a defect in the outbox or in what it stored, and trying again will not
 * change it.
 */
export type ArvoOutboxDriverErrorKind =
  | 'state_exists'
  | 'revision_stale'
  | 'unavailable'
  | 'malformed_state'
  | 'malformed_event'
  | 'malformed_response';

/**
 * What an {@link ArvoOutboxDriverError} is built from.
 *
 * @example
 * ```typescript
 * const param: ArvoOutboxDriverErrorParam = {
 *   kind: 'unavailable',
 *   operationName: 'readLatestState',
 *   cause: thrown,
 * };
 * ```
 */
export type ArvoOutboxDriverErrorParam = {
  /** Why the operation failed. */
  readonly kind: ArvoOutboxDriverErrorKind;
  /** The driver's operation that failed. */
  readonly operationName: string;
  /** What the outbox threw, or what was wrong with what it answered. */
  readonly cause?: unknown;
  /** Every problem found in what the outbox answered. */
  readonly issues?: readonly ErrorIssue[];
};

/** What a kind means, as the message says it. */
const meaningOfKind = (kind: ArvoOutboxDriverErrorKind): string => {
  switch (kind) {
    case 'state_exists':
      return 'the outbox refused it: a state already exists for the execution, and this one claimed to be its first';
    case 'revision_stale':
      return 'the outbox refused it: the stored revision is not the one this state follows';
    case 'unavailable':
      return 'the outbox threw, so it could not do its work';
    case 'malformed_state':
      return 'the outbox answered a state that is not a JSON object or none';
    case 'malformed_event':
      return 'the outbox answered an event record missing a field, holding one of the wrong type, or whose payload does not restore to an Arvo event';
    case 'malformed_response':
      return 'the outbox answered with something of the wrong shape';
  }
};

/**
 * Answered by every `tryX` of {@link ArvoOutboxDriver}, and thrown by every
 * `X`, where an operation failed. Read {@link ArvoOutboxDriverError.kind} to
 * tell a commit that lost a race from an outbox that is down from one that
 * answered something broken.
 *
 * @example
 * ```typescript
 * const commitResult = await driver.tryCommitStateAndEvents(param);
 * if (!commitResult.ok && commitResult.error.kind === 'revision_stale') {
 *   // another delivery moved the execution on first
 * }
 * ```
 */
export class ArvoOutboxDriverError extends Error {
  /** Discriminant for identifying this error without an `instanceof` check. */
  readonly _tag = 'ArvoOutboxDriverError';

  /** Why the operation failed. */
  readonly kind: ArvoOutboxDriverErrorKind;

  /** The driver's operation that failed. */
  readonly operationName: string;

  /** Every problem found in what the outbox answered, where it answered wrongly. */
  readonly issues: readonly ErrorIssue[];

  /** @param param - Why, where, and the cause. See {@link ArvoOutboxDriverErrorParam}. */
  constructor(param: ArvoOutboxDriverErrorParam) {
    const heading = `ArvoOutboxDriver.${param.operationName} failed (${param.kind}): ${meaningOfKind(param.kind)}.`;
    const thrownText =
      param.kind === 'unavailable' && param.cause !== undefined
        ? ` It threw ${describeValue(param.cause)}.`
        : '';
    const issues = param.issues ?? [];
    super(buildErrorIssueMessage(`${heading}${thrownText}`, issues), {
      cause: param.cause,
    });
    this.name = this._tag;
    this.kind = param.kind;
    this.operationName = param.operationName;
    this.issues = Object.freeze([...issues]);
  }
}

/**
 * Thrown by {@link ArvoOutboxDriver} where the execution record it is handed
 * to commit lacks a field the commit carries beside it, or holds one of the
 * wrong type. A defect in whatever built the record, never a failure of the
 * outbox, which is not called.
 *
 * @example
 * ```typescript
 * try {
 *   await driver.commitStateAndEvents(param);
 * } catch (error_) {
 *   if (error_ instanceof ArvoOutboxDriverValidationError) console.error(error_.issues);
 * }
 * ```
 */
export class ArvoOutboxDriverValidationError extends Error {
  /** Discriminant for identifying this error without an `instanceof` check. */
  readonly _tag = 'ArvoOutboxDriverValidationError';

  /** Every field the driver could not lift, each with its path. */
  readonly issues: readonly ErrorIssue[];

  /** @param issues - Every field the driver could not lift. */
  constructor(issues: readonly ErrorIssue[]) {
    super(
      buildErrorIssueMessage(
        'The execution record handed to ArvoOutboxDriver cannot be committed, because it lacks fields the commit carries.',
        issues,
      ),
    );
    this.name = this._tag;
    this.issues = Object.freeze([...issues]);
  }
}
