import { err, ok } from 'neverthrow';
import type * as z from 'zod/v4/core';
import type { VersionedArvoContract } from '../../ArvoContract/versioned/index.js';
import { fromNeverthrow } from '../../result.js';
import type { AsyncResult, Result } from '../../types.js';
import { ErrorIssue } from '../../utils/error-issue.js';
import type { ArvoContextState } from '../context/types.js';
import {
  ARVO_OPENING_CAS_VERSION,
  ARVO_OPENING_LIFECYCLE,
  ARVO_RECORD_FORMAT_VERSION,
} from '../helpers/defaults.js';
import type { ArvoServiceMap } from '../types/services.js';
import { ArvoExecutionStateValidationError } from './errors.js';
import { ArvoExecutionState } from './index.js';
import type { ArvoExecutionStateSerializerError } from './serializer/errors.js';
import { ArvoExecutionStateSerializer } from './serializer/index.js';
import type { ArvoFollowupStateParam, ArvoInitStateParam } from './types.js';
import { mutateState } from './utils.js';

/**
 * The record an execution opens with.
 *
 * There is no stored record, so one is built. The workflow and the depth
 * are read off the event, and what is implemented off the contract. The
 * execution's identity is supplied, never derived here.
 *
 * @param param - The event opening the execution, and the identity it
 * belongs to.
 *
 * @example
 * ```typescript
 * const opened = createInitArvoExecutionState({
 *   self: orderContract.versions['1.0.0'],
 *   event: initEvent,
 *   executionId,
 *   parentExecutionId: initEvent.executionid,
 * });
 * if (opened.ok) opened.value.lifecycle; // 'idle'
 * ```
 */
export const createInitArvoExecutionState = <
  TSelf extends VersionedArvoContract,
  TServices extends ArvoServiceMap,
  TDataSchema extends z.$ZodObject,
>(
  param: ArvoInitStateParam<TSelf>,
): Result<
  ArvoContextState<TSelf, TServices, TDataSchema>,
  ArvoExecutionStateValidationError
> => {
  try {
    return fromNeverthrow(
      ok(
        new ArvoExecutionState({
          data: null,
          subject: param.event.subject,
          executionId: param.executionId,
          parentExecutionId: param.parentExecutionId,
          depth: param.event.depth,
          source: param.self.type,
          version: param.self.version,
          lifecycle: ARVO_OPENING_LIFECYCLE,
          lifecycleDescription: null,
          initEvent: param.event,
          triggeringEvent: param.event,
          eventIds: [{ id: param.event.id, direction: 'received' }],
          inFlightEventMap: new Map(),
          recordFormatVersion: ARVO_RECORD_FORMAT_VERSION,
          casVersion: ARVO_OPENING_CAS_VERSION,
        }) as ArvoContextState<TSelf, TServices, TDataSchema>,
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
 * A stored record restored for the execution answering something it
 * awaited.
 *
 * Everything is taken as stored, the data hydrated against the schema the
 * version declares. The one field replaced is the event that caused this
 * execution; the stored one belongs to the execution before.
 *
 * A record naming a different execution is refused: the wrong row was
 * read, which is worth catching rather than running against.
 *
 * @param param - The row, the schema to read it under, and the execution
 * it must name.
 *
 * @example
 * ```typescript
 * const resumed = await createFollowupArvoExecutionState({
 *   dataSchema: orderData,
 *   event: chargedEvent,
 *   state: rowFromStore,
 *   executionId,
 * });
 * if (resumed.ok) resumed.value.triggeringEvent; // chargedEvent
 * ```
 */
export const createFollowupArvoExecutionState = async <
  TSelf extends VersionedArvoContract,
  TServices extends ArvoServiceMap,
  TDataSchema extends z.$ZodObject,
>(
  param: ArvoFollowupStateParam<TServices, TDataSchema>,
): AsyncResult<
  ArvoContextState<TSelf, TServices, TDataSchema>,
  ArvoExecutionStateSerializerError | ArvoExecutionStateValidationError
> => {
  const serializer = new ArvoExecutionStateSerializer(param.dataSchema);
  const stored = await serializer.tryDeserialize(JSON.stringify(param.state));
  if (!stored.ok) return stored;

  if (stored.value.executionId !== param.executionId) {
    return fromNeverthrow(
      err(
        new ArvoExecutionStateValidationError([
          new ErrorIssue({
            path: 'executionId',
            message: `does not name the execution this execution is for, ${param.executionId} — the wrong record was read`,
            received: stored.value.executionId,
          }),
        ]),
      ),
    );
  }

  // A restored record types both its events as bare events: the serializer
  // has no contracts to say otherwise. A caller's contracts do.
  return fromNeverthrow(
    ok(
      mutateState(stored.value, {
        triggeringEvent: param.event,
      }) as ArvoContextState<TSelf, TServices, TDataSchema>,
    ),
  );
};
