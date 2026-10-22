import type { ArvoEventValidationError } from '../ArvoEvent/errors.js';
import type { ArvoEvent } from '../ArvoEvent/index.js';
import type { Result } from '../types.js';
import { tryMutateArvoEvent } from './mutateArvoEvent.js';

/**
 * A copy of an existing event, reporting an invalid result rather than
 * throwing.
 *
 * Every field is copied, `id` and `time` included — a copy sent alongside its
 * source needs a new `id`, consumers deduplicating on that field alone, and
 * {@link tryMutateArvoEvent} is how a field is replaced. Nothing is derived:
 * a copy is not a child of its source. The event copied is not modified.
 *
 * @example
 * const attempt = tryCloneArvoEvent(emitted);
 * if (attempt.ok) attempt.value.id === emitted.id; // true
 */
export const tryCloneArvoEvent = <
  T extends string,
  D extends Record<string, any>,
>(
  event: ArvoEvent<T, D>,
): Result<ArvoEvent<T, D>, ArvoEventValidationError> =>
  tryMutateArvoEvent<T, D, T, D>(event, {});

/**
 * A copy of an existing event, throwing if the result would be invalid.
 *
 * Every field is copied, `id` and `time` included — a copy sent alongside its
 * source needs a new `id`, consumers deduplicating on that field alone, and
 * {@link mutateArvoEvent} is how a field is replaced. Nothing is derived: a
 * copy is not a child of its source. The event copied is not modified.
 *
 * @throws {ArvoEventValidationError} If the copy would break a structural rule
 * of an event. The message names every rule that broke.
 *
 * @example
 * const copied = cloneArvoEvent(emitted);
 * copied.toString() === emitted.toString(); // true
 */
export const cloneArvoEvent = <T extends string, D extends Record<string, any>>(
  event: ArvoEvent<T, D>,
): ArvoEvent<T, D> => {
  const attempt = tryCloneArvoEvent(event);
  if (attempt.ok) return attempt.value;
  throw attempt.error;
};
