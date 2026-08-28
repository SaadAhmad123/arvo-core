import { err, ok } from 'neverthrow';
import { ArvoEventValidationError } from '../../ArvoEvent/errors.js';
import { ArvoEvent } from '../../ArvoEvent/index.js';
import type { ArvoEventParam } from '../../ArvoEvent/types.js';
import { fromNeverthrow } from '../../result.js';
import type { PartialExcept, Result } from '../../types.js';

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
    throw error;
  }
};
