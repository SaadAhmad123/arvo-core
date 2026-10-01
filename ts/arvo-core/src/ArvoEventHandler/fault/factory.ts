import type { VersionedArvoContract } from '../../ArvoContract/versioned/index.js';
import type { ArvoDomainInput } from '../../ArvoDomain/types.js';
import { createArvoEventFactory } from '../../factories/ArvoEventFactory/index.js';
import { ArvoEventSerializer } from '../../serializers/ArvoEventSerializer/index.js';
import type { ArvoExecutionState } from '../state/index.js';
import { ArvoExecutionStateSerializer } from '../state/serializer/index.js';
import { mutateState } from '../state/utils.js';
import { ArvoHandlerFault } from './index.js';
import { isRetrySafeFaultKind, resolveRetry } from './retry.js';
import type { ArvoHandlerFaultFactoryParam } from './types.js';

/**
 * What a mechanism would publish and commit if it gave up on an execution,
 * both already written out. Built, never acted on.
 *
 * Addressed to whoever opened the execution. Either half comes back `null`
 * rather than thrown on: a fault that must be raised must not be lost to a
 * second failure while raising it.
 */
const abandonmentFor = async (
  self: VersionedArvoContract,
  state: ArvoExecutionState,
  message: string,
  handlerErrorDomain: ArvoDomainInput | null,
): Promise<{ event: string | null; state: string | null }> => {
  const built = createArvoEventFactory(self).tryCreateError({
    error: new Error(message),
    domain: handlerErrorDomain ?? undefined,
    source: state.source,
    subject: state.subject,
    to: state.initEvent.source,
    executionid: state.parentExecutionId,
    parentid: state.triggeringEvent.id,
    initid: state.initEvent.id,
    depth: state.depth,
  });

  const event = built.ok ? built.value : null;
  const written =
    event === null
      ? null
      : await new ArvoEventSerializer({ type: 'arvoevent' }).trySerialize(
          event,
        );

  const record = mutateState(state, {
    lifecycle: 'failure',
    lifecycleDescription: message,
    eventIds:
      event === null
        ? state.eventIds
        : [...state.eventIds, { id: event.id, direction: 'emitted' }],
    casVersion: state.casVersion + 1,
  });
  const storedRecord = await new ArvoExecutionStateSerializer().trySerialize(
    record,
  );

  return {
    event: written?.ok ? written.value : null,
    state: storedRecord.ok ? storedRecord.value : null,
  };
};

/**
 * A fault about one execution, ready to throw.
 *
 * The execution is read off the record, so a caller says only what went
 * wrong. The pair a mechanism would abandon the execution with is built
 * with it, and neither half is acted on here. The record given is left
 * exactly as it was.
 *
 * Written to the span, a meter and a log as it is built. A fault writes no
 * record, so telemetry may be the only place a retried-away failure is
 * ever visible.
 *
 * @param param - The execution to describe, and what went wrong with it.
 *
 * @example
 * ```typescript
 * throw await createArvoHandlerFault({
 *   contracts: { self: orderVersion },
 *   state: record,
 *   options: resolvedOptions,
 *   attempt: 0,
 *   telemetry,
 *   faultKind: 'lifecycle_terminal',
 *   message: 'this execution rests at success and accepts nothing further',
 * });
 * ```
 */
export const createArvoHandlerFault = async (
  param: ArvoHandlerFaultFactoryParam,
): Promise<ArvoHandlerFault> => {
  const timestamp = Date.now();
  const abandonment = await abandonmentFor(
    param.contracts.self,
    param.state,
    param.message,
    param.options.handlerErrorDomain,
  );

  const fault = new ArvoHandlerFault({
    faultKind: param.faultKind,
    message: param.message,
    violations: param.violations ?? [],
    cause: param.cause ?? null,
    subject: param.state.subject,
    executionId: param.state.executionId,
    eventId: param.state.triggeringEvent.id,
    attempt: param.attempt,
    timestamp,
    retry: resolveRetry({
      retrySafe: isRetrySafeFaultKind(param.faultKind, param.retryable ?? true),
      attempt: param.attempt,
      maxRetryAttempts: param.options.maxRetryAttempts,
      retryDelay: param.options.retryDelay,
      event: param.state.triggeringEvent,
      state: param.state,
      timestamp,
    }),
    abandonmentEvent: abandonment.event,
    abandonmentState: abandonment.state,
  });

  param.telemetry.recordFault(fault);
  return fault;
};
