import type { ArvoDomainInput } from '../../ArvoDomain/types.js';
import type { ArvoEvent } from '../../ArvoEvent/index.js';

/**
 * Works out how long to wait before the next attempt, in milliseconds.
 *
 * Receives the delivered event, the execution record or `null` where none
 * was read, which attempt this was counting from 0, and how many attempts
 * the version allows. It must not fail: where it throws or returns anything
 * that is not a usable number, the protocol's own default is substituted.
 */
export type ArvoRetryDelayFn = (param: {
  event: ArvoEvent;
  record: Record<string, unknown> | null;
  attempt: number;
  maxRetryAttempts: number;
}) => number;

/**
 * The seven options governing a version, each holding a value.
 *
 * Declare them at the handler, at a version, or at neither. A version's
 * value wins where it wrote one; otherwise the handler's applies; and the
 * handler always holds one, because the protocol's own default fills
 * anything you omit. Both declaration sites therefore take
 * `Partial<ArvoEventHandlerOptions>` while this type is what is in force.
 *
 * Omitting an option and writing `null` are different answers, and only the
 * two timeouts accept `null` at all: omitted means inherit, `null` means
 * unbounded.
 */
export type ArvoEventHandlerOptions = {
  /**
   * How deep an execution of this version may sit or reach. Crossing it is
   * always a non-retryable fault. Defaults to `10000`.
   */
  maxDepth: number;
  /**
   * How many attempts a retryable fault may be given, counting from 0.
   * Defaults to `3`.
   */
  maxRetryAttempts: number;
  /**
   * Milliseconds to wait before the next attempt, or a function returning
   * them. Defaults to `300`.
   */
  retryDelay: number | ArvoRetryDelayFn;
  /**
   * Milliseconds one attempt may spend in the executor before the handler
   * stops waiting. `null` is unbounded. Defaults to `30000`.
   *
   * Expiry is a retryable fault. The protocol stops waiting; whether your
   * code is interrupted is not something it can promise, so an executor with
   * side effects must not assume it was stopped.
   */
  runTimeout: number | null;
  /**
   * Milliseconds an execution may live, from its init event to the moment it
   * becomes terminal. `null` is unbounded. Defaults to `null`.
   *
   * Expiry is a non-retryable fault. It must not be below the run timeout in
   * force, and must be `null` where that is `null`.
   */
  executionTimeout: number | null;
  /**
   * `'all'` enters the executor once every outstanding response is in.
   * `'each'` enters it on every response, which requires an executor safe to
   * enter repeatedly. Defaults to `'all'`.
   */
  collect: 'all' | 'each';
  /**
   * The `domain` this version's handler error event carries: a literal, or
   * one of `ArvoDomain`'s symbols naming where to read one from. Defaults to
   * `ArvoDomain.LOCAL`.
   */
  handlerErrorDomain: ArvoDomainInput;
};
