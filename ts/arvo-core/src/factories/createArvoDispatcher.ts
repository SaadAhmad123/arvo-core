import { err, ok } from 'neverthrow';
import { ArvoDispatcherValidationError } from '../ArvoDispatcher/errors.js';
import { ArvoDispatcher } from '../ArvoDispatcher/index.js';
import type {
  ArvoDispatcherMember,
  ArvoDispatcherOptions,
} from '../ArvoDispatcher/types.js';
import { fromNeverthrow } from '../result.js';
import type { Result } from '../types.js';

/**
 * Declares a dispatcher, reporting an invalid declaration rather than
 * throwing.
 *
 * The error names every rule the declaration broke, not just the first. For a
 * declaration you wrote yourself and expect to be valid, `new ArvoDispatcher()`
 * or {@link createArvoDispatcher} says the same thing by throwing.
 *
 * @param options - The handlers, the layers and the telemetry. See
 * {@link ArvoDispatcherOptions} for the rules a declaration is held to. Pass
 * the handler list inline or as an unannotated `const`, so each handler keeps
 * its own types.
 *
 * @example
 * const declared = tryCreateArvoDispatcher({
 *   handlers: [orderHandler, paymentHandler],
 * });
 * if (declared.ok) declared.value.handles('com_order_create');
 * else declared.error.issues;
 */
export const tryCreateArvoDispatcher = <
  const TMembers extends readonly ArvoDispatcherMember[],
>(
  options: ArvoDispatcherOptions<TMembers>,
): Result<ArvoDispatcher<TMembers>, ArvoDispatcherValidationError> => {
  try {
    return fromNeverthrow(ok(new ArvoDispatcher<TMembers>(options)));
  } catch (thrown) {
    if (thrown instanceof ArvoDispatcherValidationError) {
      return fromNeverthrow(err(thrown));
    }
    // Anything else is not an invalid declaration, so reporting it here would
    // make the error type say something untrue. It goes up as it arrived.
    throw thrown;
  }
};

/**
 * Declares a dispatcher, throwing if the declaration is invalid.
 *
 * Identical to `new ArvoDispatcher()`, in function form. Use
 * {@link tryCreateArvoDispatcher} to handle an invalid declaration as a value
 * instead.
 *
 * @param options - The handlers, the layers and the telemetry. See
 * {@link ArvoDispatcherOptions} for the rules a declaration is held to. Pass
 * the handler list inline or as an unannotated `const`, so each handler keeps
 * its own types.
 *
 * @throws {ArvoDispatcherValidationError} If the declaration breaks any rule,
 * naming every rule it broke.
 *
 * @example
 * const dispatcher = createArvoDispatcher({
 *   handlers: [orderHandler, paymentHandler],
 * });
 * dispatcher.handles('com_payment_charge'); // true
 */
export const createArvoDispatcher = <
  const TMembers extends readonly ArvoDispatcherMember[],
>(
  options: ArvoDispatcherOptions<TMembers>,
): ArvoDispatcher<TMembers> => {
  const attempt = tryCreateArvoDispatcher<TMembers>(options);
  if (attempt.ok) return attempt.value;
  throw attempt.error;
};
