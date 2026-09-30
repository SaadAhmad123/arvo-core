import type { ArvoDomainInput } from '../../ArvoDomain/types.js';
import type { ArvoEvent } from '../../ArvoEvent/index.js';
import type { ArvoExecutionState } from '../state/index.js';

/**
 * How long to wait before another attempt, worked out per attempt.
 *
 * Given what was delivered, what the execution remembers, which attempt has
 * just failed, and how many are allowed. Returns milliseconds.
 *
 * It must not be able to fail. Where it throws or returns something that is
 * not a count of milliseconds, the protocol substitutes its own delay
 * rather than letting a retry policy take an execution down with it.
 */
export type ArvoRetryDelayFn = (
  event: ArvoEvent,
  state: ArvoExecutionState | null,
  attempt: number,
  maxRetryAttempts: number,
) => number;

/** Whether a version is entered once every answer is in, or on each one. */
export type ArvoCollectMode = 'all' | 'each';

/**
 * Every option governing how a version behaves, all of them settled.
 *
 * Complete: every option holds a value. A version declares only what it
 * wants to differ and inherits the rest, but that resolution happens before
 * anything reads these, so nothing downstream asks whether an option is
 * there.
 *
 * `null` on either timeout means unbounded, and is a value a version can
 * declare rather than the absence of one.
 */
export type ArvoEventHandlerOptions = {
  /** How deep an execution of this version may sit, or reach. */
  maxDepth: number;
  /** How many further attempts a retryable fault may be given. */
  maxRetryAttempts: number;
  /** How long to wait between attempts, fixed or worked out per attempt. */
  retryDelay: number | ArvoRetryDelayFn;
  /** How long one attempt may run, or `null` for unbounded. */
  runTimeout: number | null;
  /** How long the whole execution may live, or `null` for unbounded. */
  executionTimeout: number | null;
  /** Whether to enter on every answer, or once they are all in. */
  collect: ArvoCollectMode;
  /** Where this version's handler error events are addressed. */
  handlerErrorDomain: ArvoDomainInput | null;
};
