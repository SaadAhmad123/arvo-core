/**
 * Why an outbox could not be used:
 *
 * - `not_open` — it has not been opened;
 * - `still_opening` — it is being opened, and the opening has not finished;
 * - `closed` — it has been closed, for good.
 */
export type ArvoOutboxLifecycleErrorKind =
  | 'not_open'
  | 'still_opening'
  | 'closed';

/**
 * What an {@link ArvoOutboxLifecycleError} is built from.
 *
 * @example
 * ```typescript
 * const param: ArvoOutboxLifecycleErrorParam = {
 *   kind: 'not_open',
 *   outboxName: 'PostgresOutbox',
 *   operationName: 'readLatestState',
 * };
 * ```
 */
export type ArvoOutboxLifecycleErrorParam = {
  /** Why the outbox could not be used. */
  readonly kind: ArvoOutboxLifecycleErrorKind;
  /** The outbox, as its lifecycle was named when built. */
  readonly outboxName: string;
  /** The operation that was called, or `open` where opening was refused. */
  readonly operationName: string;
};

/**
 * Answered by {@link ArvoOutboxLifecycle}'s `tryOpen` and `tryResourcesFor`,
 * and thrown by `open` and `resourcesFor`, where an outbox is used outside
 * its open life. The message says what to do instead.
 *
 * It is never what your storage threw: a failure of acquiring or releasing
 * is passed on as it was thrown.
 *
 * @example
 * ```typescript
 * const resourcesResult = lifecycle.tryResourcesFor('readLatestState');
 * if (!resourcesResult.ok && resourcesResult.error.kind === 'still_opening') {
 *   await outbox.open();
 * }
 * ```
 */
export class ArvoOutboxLifecycleError extends Error {
  /** Discriminant for identifying this error without an `instanceof` check. */
  readonly _tag = 'ArvoOutboxLifecycleError';

  /** Why the outbox could not be used. */
  readonly kind: ArvoOutboxLifecycleErrorKind;

  /** The outbox that could not be used. */
  readonly outboxName: string;

  /** The operation that was called. */
  readonly operationName: string;

  /** @param param - Why, which outbox, and which operation. See {@link ArvoOutboxLifecycleErrorParam}. */
  constructor(param: ArvoOutboxLifecycleErrorParam) {
    super(lifecycleErrorMessage(param));
    this.name = this._tag;
    this.kind = param.kind;
    this.outboxName = param.outboxName;
    this.operationName = param.operationName;
  }
}

/** What went wrong and what to do instead, as a person reads it. */
const lifecycleErrorMessage = (
  param: ArvoOutboxLifecycleErrorParam,
): string => {
  switch (param.kind) {
    case 'not_open':
      return `${param.outboxName} is not open; call open() before ${param.operationName}.`;
    case 'still_opening':
      return `${param.outboxName} is still opening; await open() before ${param.operationName}.`;
    case 'closed':
      return `${param.outboxName} is closed; build a new one to use it again.`;
  }
};
