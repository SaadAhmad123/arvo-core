import type { ArvoEvent } from '../../ArvoEvent/index.js';
import { ARVO_RETRY_DELAY_FALLBACK_MS } from '../helpers/defaults.js';
import type { ArvoExecutionState } from '../state/index.js';
import type { ArvoRetryDelayFn } from '../types/options.js';
import type { ArvoFaultKind, ArvoFaultRetry } from './types.js';

/**
 * The kinds a redelivery could plausibly fix.
 *
 * Every other kind is reproduced exactly by a redelivery.
 * `executor_raised` is absent deliberately: it is the one kind whose
 * verdict the vocabulary leaves to the executor.
 */
export const ARVO_RETRY_SAFE_FAULT_KINDS: ReadonlySet<ArvoFaultKind> =
  Object.freeze(
    new Set<ArvoFaultKind>([
      'state_resolution_failed',
      'dependency_resolution_failed',
      'run_timeout',
    ]),
  );

/** Whether a kind is one a redelivery could fix, before exhaustion. */
export const isRetrySafeFaultKind = (
  faultKind: ArvoFaultKind,
  executorChoice: boolean,
): boolean =>
  faultKind === 'executor_raised'
    ? executorChoice
    : ARVO_RETRY_SAFE_FAULT_KINDS.has(faultKind);

/**
 * How long to wait before the next attempt.
 *
 * The function form must not be able to fail: where it throws or hands back
 * anything that is not a usable count of milliseconds, the protocol's own
 * delay is substituted rather than turning a recoverable failure into an
 * unrecoverable one.
 */
export const resolveRetryDelayMs = (
  retryDelay: number | ArvoRetryDelayFn,
  event: ArvoEvent,
  state: ArvoExecutionState | null,
  attempt: number,
  maxRetryAttempts: number,
): number => {
  if (typeof retryDelay === 'number') return retryDelay;
  try {
    const delay = retryDelay(event, state, attempt, maxRetryAttempts);
    return Number.isInteger(delay) && delay >= 0
      ? delay
      : ARVO_RETRY_DELAY_FALLBACK_MS;
  } catch {
    return ARVO_RETRY_DELAY_FALLBACK_MS;
  }
};

/** What a fault says about another attempt, or `null` where none is due. */
export type ArvoRetryVerdictParam = {
  /** Whether another attempt could fix this, already decided. */
  retrySafe: boolean;
  /** Which attempt just failed, counting from 0. */
  attempt: number;
  /** How many attempts this version allows. */
  maxRetryAttempts: number;
  /** How long to wait, fixed or worked out per attempt. */
  retryDelay: number | ArvoRetryDelayFn;
  /** The event delivered, passed to the function form. */
  event: ArvoEvent;
  /** What the execution remembers, or `null` where no record was read. */
  state: ArvoExecutionState | null;
  /** When this delivery was processed, as ms since the Unix epoch. */
  timestamp: number;
};

/**
 * When another attempt is due, or `null` where none is.
 *
 * `null` for a failure nothing would fix, and `null` once the attempts are
 * spent — a retry is in prospect while `attempt < maxRetryAttempts`, both
 * counting from 0. Whether a failure is fixable is decided beforehand, by
 * {@link isRetrySafeFaultKind}.
 */
export const resolveRetry = (
  param: ArvoRetryVerdictParam,
): ArvoFaultRetry | null => {
  if (!param.retrySafe) return null;
  if (param.attempt >= param.maxRetryAttempts) return null;

  const retryInMs = resolveRetryDelayMs(
    param.retryDelay,
    param.event,
    param.state,
    param.attempt,
    param.maxRetryAttempts,
  );

  return {
    maxRetryAttemptsAllowed: param.maxRetryAttempts,
    retryInMs,
    retryAt: param.timestamp + retryInMs,
  };
};
