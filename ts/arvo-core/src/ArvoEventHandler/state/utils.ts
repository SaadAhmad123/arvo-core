import { err, ok } from 'neverthrow';
import { fromNeverthrow } from '../../result.js';
import type { Result } from '../../types.js';
import { ArvoExecutionStateValidationError } from './errors.js';
import { ArvoExecutionState } from './index.js';
import type { ArvoExecutionStateFields } from './types.js';

/** Any of the fields a record holds, with the rest left as they are. */
export type ArvoExecutionStateMutation<TState extends ArvoExecutionState> =
  Partial<
    ArvoExecutionStateFields<
      TState['data'],
      TState['initEvent'],
      TState['triggeringEvent']
    >
  >;

/**
 * A new record with the fields in `next` replaced and every other one
 * carried across, reporting the outcome rather than throwing. `current` is
 * not modified.
 *
 * A field written as `undefined` is not treated as absent, and the record
 * is refused for it. Data is not checked, a record carrying no schema.
 *
 * @param current - The record as it stands.
 * @param next - The fields to replace.
 *
 * @example
 * ```typescript
 * const result = tryMutateState(state, { lifecycle: 'success' });
 * if (!result.ok) {
 *   result.error.issues.map((issue) => issue.toString());
 *   return;
 * }
 * result.value.lifecycle; // 'success'
 * ```
 */
export const tryMutateState = <TState extends ArvoExecutionState>(
  current: TState,
  next: ArvoExecutionStateMutation<TState>,
): Result<TState, ArvoExecutionStateValidationError> => {
  try {
    // Named field by field, so a change to the record's shape fails here.
    return fromNeverthrow(
      ok(
        new ArvoExecutionState({
          data: current.data,
          subject: current.subject,
          executionId: current.executionId,
          parentExecutionId: current.parentExecutionId,
          depth: current.depth,
          source: current.source,
          version: current.version,
          lifecycle: current.lifecycle,
          lifecycleDescription: current.lifecycleDescription,
          initEvent: current.initEvent,
          triggeringEvent: current.triggeringEvent,
          eventIds: current.eventIds,
          inFlightEventMap: current.inFlightEventMap,
          recordFormatVersion: current.recordFormatVersion,
          casVersion: current.casVersion,
          ...next,
        }) as TState,
      ),
    );
  } catch (error) {
    if (error instanceof ArvoExecutionStateValidationError) {
      return fromNeverthrow(err(error));
    }
    throw error;
  }
};

/**
 * A new record with the fields in `next` replaced and every other one
 * carried across. `current` is not modified.
 *
 * A field written as `undefined` is not treated as absent, and the record
 * is refused for it. Data is not checked, a record carrying no schema.
 *
 * @param current - The record as it stands.
 * @param next - The fields to replace.
 * @throws {ArvoExecutionStateValidationError} If the new record would be of
 * the wrong shape, naming every field that is wrong.
 *
 * @example
 * ```typescript
 * const next = mutateState(state, { data: { orderId: 'o-1' } });
 * const done = mutateState(next, { lifecycle: 'success' });
 * ```
 */
export const mutateState = <TState extends ArvoExecutionState>(
  current: TState,
  next: ArvoExecutionStateMutation<TState>,
): TState => {
  const result = tryMutateState(current, next);
  if (result.ok) return result.value;
  throw result.error;
};
