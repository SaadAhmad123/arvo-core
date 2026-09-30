import { err, ok } from 'neverthrow';
import type * as z from 'zod/v4/core';
import type { VersionedArvoContract } from '../../ArvoContract/versioned/index.js';
import { fromNeverthrow } from '../../result.js';
import type { AsyncResult, Result } from '../../types.js';
import { ErrorIssue } from '../../utils/error-issue.js';
import {
  ARVO_LOOSE_DATA_SCHEMA,
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
  ArvoDataSchemaInForce,
  ArvoFollowupContextParam,
  ArvoInitContextParam,
} from './types.js';

/** The schema a version declared, or the loose one where it declared none. */
const schemaInForce = <TDeclared extends z.$ZodObject | null>(
  declared: TDeclared,
): ArvoDataSchemaInForce<TDeclared> =>
  (declared ?? ARVO_LOOSE_DATA_SCHEMA) as ArvoDataSchemaInForce<TDeclared>;

/**
 * An executor's context for a delivery that opens an execution, reporting
 * the outcome rather than throwing.
 *
 * There is no stored record, so one is built. What it holds comes from the
 * event and the contracts wherever it can: the workflow, the depth, what is
 * implemented and which version of it. What cannot be read from either is
 * supplied — the execution's own identity, and the contracts as they are to
 * be stored.
 *
 * The identity is never derived here. Whatever looked for a record already
 * had to know which execution it was looking for, so deriving it again
 * would be the same value computed in two places.
 */
export const tryCreateInitArvoExecutionContext = <
  TSelf extends VersionedArvoContract,
  TServices extends ArvoServiceMap,
  TDeclaredSchema extends z.$ZodObject | null,
  TDependencies extends ArvoDependencies,
  TMechanismHooks extends ArvoMechanismHooks,
>(
  param: ArvoInitContextParam<
    TSelf,
    TServices,
    TDeclaredSchema,
    TDependencies,
    TMechanismHooks
  >,
): Result<
  ArvoExecutionContext<
    TSelf,
    TServices,
    ArvoDataSchemaInForce<TDeclaredSchema>,
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
      contracts: param.contractsSnapshot,
    });

    return fromNeverthrow(
      ok(
        new ArvoExecutionContext<
          TSelf,
          TServices,
          ArvoDataSchemaInForce<TDeclaredSchema>,
          TDependencies,
          TMechanismHooks
        >({
          contracts: param.contracts,
          state: state,
          dataSchema: schemaInForce(param.dataSchema),
          entry: 'init',
          attempt: param.attempt,
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
 * An executor's context for a delivery that opens an execution.
 *
 * There is no stored record, so one is built. What it holds comes from the
 * event and the contracts wherever it can: the workflow, the depth, what is
 * implemented and which version of it. What cannot be read from either is
 * supplied — the execution's own identity, and the contracts as they are to
 * be stored.
 *
 * @throws {ArvoExecutionStateValidationError} If what was supplied does not
 * make a valid record, naming every field at fault.
 *
 * @example
 * ```typescript
 * const ctx = createInitArvoExecutionContext({
 *   contracts: { self: orderContract.versions['1.0.0'], services },
 *   event: initEvent,
 *   executionId,
 *   parentExecutionId: initEvent.executionid,
 *   contractsSnapshot,
 *   dataSchema: orderData,
 *   options: resolvedOptions,
 *   attempt: 0,
 *   dependencies: { db },
 *   hooks: {},
 * });
 * ```
 */
export const createInitArvoExecutionContext = <
  TSelf extends VersionedArvoContract,
  TServices extends ArvoServiceMap,
  TDeclaredSchema extends z.$ZodObject | null,
  TDependencies extends ArvoDependencies,
  TMechanismHooks extends ArvoMechanismHooks,
>(
  param: ArvoInitContextParam<
    TSelf,
    TServices,
    TDeclaredSchema,
    TDependencies,
    TMechanismHooks
  >,
): ArvoExecutionContext<
  TSelf,
  TServices,
  ArvoDataSchemaInForce<TDeclaredSchema>,
  TDependencies,
  TMechanismHooks
> => {
  const result = tryCreateInitArvoExecutionContext(param);
  if (result.ok) return result.value;
  throw result.error;
};

/**
 * An executor's context for a delivery that answers something an execution
 * was waiting for, reporting the outcome rather than throwing.
 *
 * The record answers everything opening one had to be told, so only the row
 * itself and the execution it is expected to be are supplied. The event log
 * and what is awaited are left exactly as they were stored: both are the
 * caller's bookkeeping, not this factory's to edit.
 *
 * The one field it does replace is the event that caused this delivery. The
 * stored one belongs to the delivery before it.
 */
export const tryCreateFollowupArvoExecutionContext = async <
  TSelf extends VersionedArvoContract,
  TServices extends ArvoServiceMap,
  TDeclaredSchema extends z.$ZodObject | null,
  TDependencies extends ArvoDependencies,
  TMechanismHooks extends ArvoMechanismHooks,
>(
  param: ArvoFollowupContextParam<
    TSelf,
    TServices,
    TDeclaredSchema,
    TDependencies,
    TMechanismHooks
  >,
): AsyncResult<
  ArvoExecutionContext<
    TSelf,
    TServices,
    ArvoDataSchemaInForce<TDeclaredSchema>,
    TDependencies,
    TMechanismHooks
  >,
  ArvoExecutionStateSerializerError | ArvoExecutionStateValidationError
> => {
  const dataSchema = schemaInForce(param.dataSchema);
  const serializer = new ArvoExecutionStateSerializer(dataSchema);
  const stored = await serializer.tryDeserialize(param.state);
  if (!stored.ok) return stored;

  if (stored.value.executionId !== param.executionId) {
    return fromNeverthrow(
      err(
        new ArvoExecutionStateValidationError([
          new ErrorIssue({
            path: 'executionId',
            message: `does not name the execution this delivery is for, ${param.executionId} — the wrong record was read`,
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
        ArvoDataSchemaInForce<TDeclaredSchema>,
        TDependencies,
        TMechanismHooks
      >({
        contracts: param.contracts,
        // A restored record types both its events as bare events: the
        // serializer has no contracts to say otherwise. The contracts here do.
        state: mutateState(stored.value, {
          triggeringEvent: param.event,
        }) as ArvoContextState<
          TSelf,
          TServices,
          ArvoDataSchemaInForce<TDeclaredSchema>
        >,
        dataSchema,
        entry: 'followup',
        attempt: param.attempt,
        options: param.options,
        dependencies: param.dependencies,
        hooks: param.hooks,
      }),
    ),
  );
};

/**
 * An executor's context for a delivery that answers something an execution
 * was waiting for.
 *
 * The record answers everything opening one had to be told, so only the row
 * itself and the execution it is expected to be are supplied. The event log
 * and what is awaited are left exactly as they were stored. The event that
 * caused this delivery is replaced, the stored one belonging to the
 * delivery before it.
 *
 * @throws {ArvoExecutionStateSerializerError} If the row is not a stored
 * record at all.
 * @throws {ArvoExecutionStateValidationError} If it reads but is wrong, or
 * names a different execution than the one this delivery is for.
 *
 * @example
 * ```typescript
 * const ctx = await createFollowupArvoExecutionContext({
 *   contracts: { self: orderContract.versions['1.0.0'], services },
 *   event: chargedEvent,
 *   state: rowFromStore,
 *   executionId,
 *   dataSchema: orderData,
 *   options: resolvedOptions,
 *   attempt: 0,
 *   dependencies: { db },
 *   hooks: {},
 * });
 * ```
 */
export const createFollowupArvoExecutionContext = async <
  TSelf extends VersionedArvoContract,
  TServices extends ArvoServiceMap,
  TDeclaredSchema extends z.$ZodObject | null,
  TDependencies extends ArvoDependencies,
  TMechanismHooks extends ArvoMechanismHooks,
>(
  param: ArvoFollowupContextParam<
    TSelf,
    TServices,
    TDeclaredSchema,
    TDependencies,
    TMechanismHooks
  >,
): Promise<
  ArvoExecutionContext<
    TSelf,
    TServices,
    ArvoDataSchemaInForce<TDeclaredSchema>,
    TDependencies,
    TMechanismHooks
  >
> => {
  const result = await tryCreateFollowupArvoExecutionContext(param);
  if (result.ok) return result.value;
  throw result.error;
};
