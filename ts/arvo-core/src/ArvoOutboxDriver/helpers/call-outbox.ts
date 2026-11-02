import { err, ok } from 'neverthrow';
import { fromNeverthrow } from '../../result.js';
import type { AsyncResult, PromiseAble } from '../../types.js';
import { ArvoOutboxDriverError } from '../errors.js';

/**
 * One call to the outbox, its answer as given, or anything it threw or
 * rejected with as `unavailable`, carrying what was thrown.
 */
export const callOutbox = async <Answer>(
  operationName: string,
  call: () => PromiseAble<Answer>,
): AsyncResult<Answer, ArvoOutboxDriverError> => {
  try {
    return fromNeverthrow(ok(await call()));
  } catch (error_) {
    return fromNeverthrow(
      err(
        new ArvoOutboxDriverError({
          kind: 'unavailable',
          operationName,
          cause: error_,
        }),
      ),
    );
  }
};
