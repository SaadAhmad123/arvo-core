import { err, ok } from 'neverthrow';
import { ArvoEventValidationError } from '../ArvoEvent/errors.js';
import { ArvoEvent } from '../ArvoEvent/index.js';
import type { ArvoEventParam } from '../ArvoEvent/types.js';
import { fromNeverthrow } from '../result.js';
import type { PartialExcept, Result } from '../types.js';

/** The fields nothing but a caller can supply. */
type Required = 'type' | 'data' | 'source' | 'dataschema';

/**
 * An event from the fields you give it, reporting an invalid one rather than
 * throwing.
 *
 * No contract is involved, so nothing is derived and the payload is checked
 * against no schema — for an event a contract declares, build it from that
 * contract instead. `type`, `data`, `source` and `dataschema` are required.
 * `subject` is generated when omitted, which starts the event in an execution
 * of its own; pass one to place it in an existing execution. Every other field
 * defaults as it does when an event is constructed directly.
 *
 * A field that breaks a structural rule of an event comes back as an error
 * naming every rule that broke, each issue giving the field and what was wrong
 * with it.
 *
 * @example
 * const attempt = tryCreateArvoEvent({
 *   type: 'com_order_create',
 *   source: 'com.web.checkout',
 *   dataschema: '#/com/order/create/1.0.0',
 *   data: { items: ['book'] },
 * });
 * if (attempt.ok) send(attempt.value);
 * else attempt.error.issues.forEach((issue) => log(issue.path, issue.message));
 */
export const tryCreateArvoEvent = <
  T extends string = string,
  D extends Record<string, any> = Record<string, any>,
>(
  param: PartialExcept<ArvoEventParam<T, D>, Required>,
): Result<ArvoEvent<T, D>, ArvoEventValidationError> => {
  try {
    return fromNeverthrow(
      ok(
        new ArvoEvent<T, D>({
          ...param,
          subject: param.subject ?? crypto.randomUUID(),
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

/**
 * An event from the fields you give it, throwing if it would be invalid.
 *
 * No contract is involved, so nothing is derived and the payload is checked
 * against no schema — for an event a contract declares, build it from that
 * contract instead. `type`, `data`, `source` and `dataschema` are required.
 * `subject` is generated when omitted, which starts the event in an execution
 * of its own; pass one to place it in an existing execution. Every other field
 * defaults as it does when an event is constructed directly.
 *
 * @throws {ArvoEventValidationError} If a field breaks a structural rule of an
 * event. The message names every rule that broke.
 *
 * @example
 * const event = createArvoEvent({
 *   type: 'com_order_create',
 *   source: 'com.web.checkout',
 *   dataschema: '#/com/order/create/1.0.0',
 *   data: { items: ['book'] },
 * });
 * event.subject;  // a fresh execution, none having been passed
 */
export const createArvoEvent = <
  T extends string = string,
  D extends Record<string, any> = Record<string, any>,
>(
  param: PartialExcept<ArvoEventParam<T, D>, Required>,
): ArvoEvent<T, D> => {
  const built = tryCreateArvoEvent<T, D>(param);
  if (built.ok) return built.value;
  throw built.error;
};
