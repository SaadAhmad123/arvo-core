import { err, ok } from 'neverthrow';
import type * as z from 'zod/v4/core';
import type { VersionedArvoContract } from '../../ArvoContract/versioned/index.js';
import { fromNeverthrow } from '../../result.js';
import type { AsyncResult, Result } from '../../types.js';
import { ErrorIssue } from '../../utils/error-issue.js';
import {
  ARVO_OPENING_CAS_VERSION,
  ARVO_OPENING_LIFECYCLE,
  ARVO_RECORD_FORMAT_VERSION,
} from '../helpers/defaults.js';
import { ArvoExecutionStateValidationError } from '../state/errors.js';
import { ArvoExecutionState } from '../state/index.js';
import type { ArvoExecutionStateSerializerError } from '../state/serializer/errors.js';
import { ArvoExecutionStateSerializer } from '../state/serializer/index.js';
import { mutateState } from '../state/utils.js';
import type { ArvoServiceMap } from '../types/services.js';
import type {
  ArvoDependencies,
  ArvoMechanismHooks,
} from '../types/supplied.js';
import { ArvoExecutionContext } from './index.js';
import type {
  ArvoContextState,
  ArvoFollowupContextParam,
  ArvoInitContextParam,
} from './types.js';

/**
 * An executor's context for an execution that opens an execution.
 *
 * There is no stored record, so one is built. The workflow, the depth and
 * what is implemented are read off the event and the contracts. The
 * execution's identity and the contracts snapshot are supplied, never
 * derived here.
 *
 * @example
 * ```typescript
 * const opened = createInitArvoExecutionContext({
 *   contracts: { self: orderContract.versions['1.0.0'], services },
 *   event: initEvent,
 *   executionId,
 *   parentExecutionId: initEvent.executionid,
 *   dataSchema: orderData,
 *   options: resolvedOptions,
 *   attempt: 0,
 *   telemetry,
 *   dependencies: { db },
 *   hooks: {},
 * });
 * ```
 */
export const createInitArvoExecutionContext = <
  TSelf extends VersionedArvoContract,
  TServices extends ArvoServiceMap,
  TDataSchema extends z.$ZodObject,
  TDependencies extends ArvoDependencies,
  TMechanismHooks extends ArvoMechanismHooks,
>(
  param: ArvoInitContextParam<
    TSelf,
    TServices,
    TDataSchema,
    TDependencies,
    TMechanismHooks
  >,
): Result<
  ArvoExecutionContext<
    TSelf,
    TServices,
    TDataSchema,
    TDependencies,
    TMechanismHooks
  >,
  ArvoExecutionStateValidationError
> => {
  try {
    const state = new ArvoExecutionState({
      data: null,
      subject: param.event.subject,
      executionId: param.executionId,
      parentExecutionId: param.parentExecutionId,
      depth: param.event.depth,
      source: param.contracts.self.type,
      version: param.contracts.self.version,
      lifecycle: ARVO_OPENING_LIFECYCLE,
      lifecycleDescription: null,
      initEvent: param.event,
      triggeringEvent: param.event,
      eventIds: [{ id: param.event.id, direction: 'received' }],
      inFlightEventMap: new Map(),
      recordFormatVersion: ARVO_RECORD_FORMAT_VERSION,
      casVersion: ARVO_OPENING_CAS_VERSION,
    });

    return fromNeverthrow(
      ok(
        new ArvoExecutionContext<
          TSelf,
          TServices,
          TDataSchema,
          TDependencies,
          TMechanismHooks
        >({
          contracts: param.contracts,
          state: state,
          dataSchema: param.dataSchema,
          entry: 'init',
          attempt: param.attempt,
          telemetry: param.telemetry,
          options: param.options,
          dependencies: param.dependencies,
          hooks: param.hooks,
        }),
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
 * An executor's context for an execution that answers something an execution
 * was waiting for.
 *
 * The record answers everything opening one had to be told, so only the
 * row and the execution it must name are supplied. The event log and what
 * is awaited are left as stored. The one field replaced is the event that
 * caused this execution; the stored one belongs to the execution before.
 *
 * @example
 * ```typescript
 * const resumed = await createFollowupArvoExecutionContext({
 *   contracts: { self: orderContract.versions['1.0.0'], services },
 *   event: chargedEvent,
 *   state: rowFromStore,
 *   executionId,
 *   dataSchema: orderData,
 *   options: resolvedOptions,
 *   attempt: 0,
 *   telemetry,
 *   dependencies: { db },
 *   hooks: {},
 * });
 * ```
 */
export const createFollowupArvoExecutionContext = async <
  TSelf extends VersionedArvoContract,
  TServices extends ArvoServiceMap,
  TDataSchema extends z.$ZodObject,
  TDependencies extends ArvoDependencies,
  TMechanismHooks extends ArvoMechanismHooks,
>(
  param: ArvoFollowupContextParam<
    TSelf,
    TServices,
    TDataSchema,
    TDependencies,
    TMechanismHooks
  >,
): AsyncResult<
  ArvoExecutionContext<
    TSelf,
    TServices,
    TDataSchema,
    TDependencies,
    TMechanismHooks
  >,
  ArvoExecutionStateSerializerError | ArvoExecutionStateValidationError
> => {
  const dataSchema = param.dataSchema;
  const serializer = new ArvoExecutionStateSerializer(dataSchema);
  const stored = await serializer.tryDeserialize(param.state);
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

  return fromNeverthrow(
    ok(
      new ArvoExecutionContext<
        TSelf,
        TServices,
        TDataSchema,
        TDependencies,
        TMechanismHooks
      >({
        contracts: param.contracts,
        // A restored record types both its events as bare events: the
        // serializer has no contracts to say otherwise. The contracts here do.
        state: mutateState(stored.value, {
          triggeringEvent: param.event,
        }) as ArvoContextState<TSelf, TServices, TDataSchema>,
        dataSchema,
        entry: 'followup',
        attempt: param.attempt,
        telemetry: param.telemetry,
        options: param.options,
        dependencies: param.dependencies,
        hooks: param.hooks,
      }),
    ),
  );
};
