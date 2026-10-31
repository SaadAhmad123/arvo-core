import { err, ok } from 'neverthrow';
import { fromNeverthrow } from '../../result.js';
import type { Result } from '../../types.js';
import { ArvoMemoryOutboxValidationError } from './errors.js';
import { ArvoMemoryOutbox } from './outbox.js';
import type { ArvoMemoryOutboxOptions } from './types.js';

/**
 * Builds an in-memory outbox, reporting options that break a rule rather
 * than throwing. The error names every problem, not just the first.
 *
 * @param options - How it tells the time, how much it holds, and how long it keeps it. See {@link ArvoMemoryOutboxOptions}.
 *
 * @example
 * ```typescript
 * const outboxResult = tryCreateArvoMemoryOutbox({ buffers: { events: { size, tolerance } } });
 * if (outboxResult.ok) await outboxResult.value.open();
 * else outboxResult.error.issues;
 * ```
 */
export const tryCreateArvoMemoryOutbox = (
  options: ArvoMemoryOutboxOptions = {},
): Result<ArvoMemoryOutbox, ArvoMemoryOutboxValidationError> => {
  try {
    return fromNeverthrow(ok(new ArvoMemoryOutbox(options)));
  } catch (error_) {
    if (error_ instanceof ArvoMemoryOutboxValidationError) {
      return fromNeverthrow(err(error_));
    }
    // anything else is not a bad option, so it goes up as it arrived
    throw error_;
  }
};

/**
 * Builds an in-memory outbox, throwing where the options break a rule.
 *
 * @param options - How it tells the time, how much it holds, and how long it keeps it. See {@link ArvoMemoryOutboxOptions}.
 * @throws {ArvoMemoryOutboxValidationError} Where the options break any rule. It names every problem.
 *
 * @example
 * ```typescript
 * const outbox = createArvoMemoryOutbox();
 * await outbox.open();
 * ```
 */
export const createArvoMemoryOutbox = (
  options: ArvoMemoryOutboxOptions = {},
): ArvoMemoryOutbox => {
  const outboxResult = tryCreateArvoMemoryOutbox(options);
  if (outboxResult.ok) return outboxResult.value;
  throw outboxResult.error;
};
