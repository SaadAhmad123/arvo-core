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
 * @param state - The record as it stands.
 * @param mutation - The fields to replace.
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
  state: TState,
  mutation: ArvoExecutionStateMutation<TState>,
): Result<TState, ArvoExecutionStateValidationError> => {
  try {
    // Named field by field, so a change to the record's shape fails here.
    return fromNeverthrow(
      ok(
        new ArvoExecutionState({
          data: state.data,
          subject: state.subject,
          executionId: state.executionId,
          parentExecutionId: state.parentExecutionId,
          depth: state.depth,
          source: state.source,
          version: state.version,
          lifecycle: state.lifecycle,
          lifecycleDescription: state.lifecycleDescription,
          initEvent: state.initEvent,
          triggeringEvent: state.triggeringEvent,
          eventIds: state.eventIds,
          inFlightEventMap: state.inFlightEventMap,
          recordFormatVersion: state.recordFormatVersion,
          casVersion: state.casVersion,
          ...mutation,
        }) as TState,
      ),
    );
  } catch (error_) {
    if (error_ instanceof ArvoExecutionStateValidationError) {
      return fromNeverthrow(err(error_));
    }
    throw error_;
  }
};

/**
 * A new record with the fields in `next` replaced and every other one
 * carried across. `current` is not modified.
 *
 * A field written as `undefined` is not treated as absent, and the record
 * is refused for it. Data is not checked, a record carrying no schema.
 *
 * @param state - The record as it stands.
 * @param mutation - The fields to replace.
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
  state: TState,
  mutation: ArvoExecutionStateMutation<TState>,
): TState => {
  const attempt = tryMutateState(state, mutation);
  if (attempt.ok) return attempt.value;
  throw attempt.error;
};
