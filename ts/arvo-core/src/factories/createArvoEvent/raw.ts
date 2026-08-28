import { err, ok } from 'neverthrow';
import { ArvoEventValidationError } from '../../ArvoEvent/errors.js';
import { ArvoEvent } from '../../ArvoEvent/index.js';
import type { ArvoEventParam } from '../../ArvoEvent/types.js';
import { fromNeverthrow } from '../../result.js';
import type { PartialExcept, Result } from '../../types.js';

/**
 * An event built from the fields it is given.
 *
 * `type`, `data`, `source` and `dataschema` are required, nothing else being
 * able to supply them. `subject` is generated when omitted, which starts the
 * event in an execution of its own — pass one to place it in an existing
 * execution. Every other field defaults exactly as constructing an event
 * directly defaults it.
 *
 * The single path every variant of this factory ends in, so every structural
 * rule an event has applies to all of them once, here.
 *
 * @param param - The event's fields. See {@link ArvoEventParam} for the rules
 * each one holds a caller to.
 */
export const raw = <
  T extends string = string,
  D extends Record<string, any> = Record<string, any>,
>(
  param: PartialExcept<
    ArvoEventParam<T, D>,
    'type' | 'data' | 'source' | 'dataschema'
  >,
): Result<ArvoEvent<T, D>, ArvoEventValidationError> => {
  try {
    return fromNeverthrow(
      ok(
        new ArvoEvent<T, D>({
          subject: crypto.randomUUID(),
          ...param,
        }),
      ),
    );
  } catch (error) {
    if (error instanceof ArvoEventValidationError) {
      return fromNeverthrow(err(error));
    }
    // Anything else is not an invalid event, so reporting it here would make
    // the error type say something untrue. It goes up as it arrived.
    throw error;
  }
};
