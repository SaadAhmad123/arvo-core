import { err, ok } from 'neverthrow';
import { fromNeverthrow } from '../../result.js';
import type { Result } from '../../types.js';
import { ArvoSqliteOutboxValidationError } from './errors.js';
import { ArvoSqliteOutbox } from './outbox.js';
import type { ArvoSqliteOutboxOptions } from './types.js';

/**
 * Builds a SQLite outbox, reporting options that break a rule rather than
 * throwing. Touches no file. The error names every problem, not just the
 * first.
 *
 * @param options - Which file, how long to wait for it, and how long to keep what it no longer needs. See {@link ArvoSqliteOutboxOptions}.
 *
 * @example
 * ```typescript
 * const outboxResult = tryCreateArvoSqliteOutbox({ filename });
 * if (outboxResult.ok) await outboxResult.value.open();
 * else outboxResult.error.issues;
 * ```
 */
export const tryCreateArvoSqliteOutbox = (
  options: ArvoSqliteOutboxOptions,
): Result<ArvoSqliteOutbox, ArvoSqliteOutboxValidationError> => {
  try {
    return fromNeverthrow(ok(new ArvoSqliteOutbox(options)));
  } catch (error_) {
    if (error_ instanceof ArvoSqliteOutboxValidationError) {
      return fromNeverthrow(err(error_));
    }
    // anything else is not a bad option, so it goes up as it arrived
    throw error_;
  }
};

/**
 * Builds a SQLite outbox, throwing where the options break a rule. Touches
 * no file.
 *
 * @param options - Which file, how long to wait for it, and how long to keep what it no longer needs. See {@link ArvoSqliteOutboxOptions}.
 * @throws {ArvoSqliteOutboxValidationError} Where the options break any rule. It names every problem.
 *
 * @example
 * ```typescript
 * const outbox = createArvoSqliteOutbox({ filename });
 * await outbox.open();
 * ```
 */
export const createArvoSqliteOutbox = (
  options: ArvoSqliteOutboxOptions,
): ArvoSqliteOutbox => {
  const outboxResult = tryCreateArvoSqliteOutbox(options);
  if (outboxResult.ok) return outboxResult.value;
  throw outboxResult.error;
};
