import type { ArvoDomainInput } from '../../ArvoDomain/types.js';
import type { ArvoEvent } from '../../ArvoEvent/index.js';
import type { ArvoExecutionState } from '../state/index.js';

/**
 * How long to wait before another attempt, worked out per attempt.
 *
 * Given the triggering event, what the execution remembers, which attempt
 * just failed, and how many are allowed. Returns milliseconds, and must
 * not be able to fail: where it throws or returns anything that is not a
 * count of them, the protocol substitutes its own delay.
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
 * Every option holds a value: a version declares only what it wants to
 * differ, and that resolution happens before anything reads these.
 *
 * `null` on either timeout means unbounded, which is a value a version
 * declares rather than the absence of one.
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
