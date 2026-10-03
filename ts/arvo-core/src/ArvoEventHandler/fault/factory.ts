import type { VersionedArvoContract } from '../../ArvoContract/versioned/index.js';
import type { ArvoDomainInput } from '../../ArvoDomain/types.js';
import type { ArvoEvent } from '../../ArvoEvent/index.js';
import { createArvoEventFactory } from '../../factories/ArvoEventFactory/index.js';
import { ArvoEventSerializer } from '../../serializers/ArvoEventSerializer/index.js';
import type { ArvoEntryKind } from '../context/types.js';
import type { ArvoExecutionState } from '../state/index.js';
import { atNextRevision } from '../state/revision.js';
import { ArvoExecutionStateSerializer } from '../state/serializer/index.js';
import { mutateState } from '../state/utils.js';
import { ArvoHandlerFault } from './index.js';
import { isRetrySafeFaultKind, resolveRetry } from './retry.js';
import type { ArvoHandlerFaultFactoryParam } from './types.js';

/** What an execution's own fields are, or what stands in where it has no record. */
type ArvoFaultOrigin = {
  /** The workflow the failing execution belongs to. */
  subject: string;
  /** The execution, or `null` where none was resolved. */
  executionId: string | null;
  /** The event that caused the execution. */
  event: ArvoEvent;
  /** The event that opened it, or `null` where that is unknown. */
  initEvent: ArvoEvent | null;
  /** What the handler error event is sent as, which the record also names. */
  source: string;
  /** Where the execution sits, which an event it sends must carry. */
  depth: number;
  /** The execution the handler error event answers to. */
  parentExecutionId: string;
};

/** Everything a fault names, read off the record or off the event instead. */
const originOf = (
  param: ArvoHandlerFaultFactoryParam,
  self: VersionedArvoContract,
): ArvoFaultOrigin =>
  param.state === null
    ? {
        subject: param.event.subject,
        executionId: param.executionId,
        event: param.event,
        initEvent: param.initEvent,
        source: self.type,
        depth: param.event.depth,
        parentExecutionId: param.event.executionid,
      }
    : {
        subject: param.state.subject,
        executionId: param.state.executionId,
        event: param.state.triggeringEvent,
        initEvent: param.state.initEvent,
        source: param.state.source,
        depth: param.state.depth,
        parentExecutionId: param.state.parentExecutionId,
      };

/**
 * The event a mechanism would publish if it gave up, written out, or `null`
 * where the execution could address nobody.
 *
 * Addressed to whoever opened the execution, so an execution whose opening
 * event is unknown has nobody to tell. Never thrown on: a fault that must
 * be raised must not be lost to a second failure while raising it.
 */
const abandonmentEventFor = async (
  self: VersionedArvoContract,
  origin: ArvoFaultOrigin,
  message: string,
  handlerErrorDomain: ArvoDomainInput | null,
): Promise<ArvoEvent | null> => {
  if (origin.initEvent === null) return null;

  const built = createArvoEventFactory(self).tryCreateError({
    error: new Error(message),
    domain: handlerErrorDomain ?? undefined,
    source: origin.source,
    subject: origin.subject,
    to: origin.initEvent.source,
    executionid: origin.parentExecutionId,
    parentid: origin.event.id,
    initid: origin.initEvent.id,
    depth: origin.depth,
  });

  return built.ok ? built.value : null;
};

/**
 * The record a mechanism would commit alongside the abandonment event,
 * written out, or `null` where there is no record to carry forward.
 *
 * Rested at `failure`, saying why, with the event it would publish logged
 * and the revision advanced.
 */
const abandonmentStateFor = async (
  state: ArvoExecutionState | null,
  entry: ArvoEntryKind,
  published: ArvoEvent | null,
  message: string,
): Promise<string | null> => {
  if (state === null) return null;

  const record = atNextRevision(
    mutateState(state, {
      lifecycle: 'failure',
      lifecycleDescription: message,
      eventIds:
        published === null
          ? state.eventIds
          : [...state.eventIds, { id: published.id, direction: 'emitted' }],
    }),
    entry,
  );

  const written = await new ArvoExecutionStateSerializer().trySerialize(record);
  return written.ok ? written.value : null;
};

/**
 * A fault about one execution, ready to throw.
 *
 * Where the execution has a record, everything the fault names is read off
 * it and a caller says only what went wrong. Where it has none — the
 * failure having happened before one could be read — what a record would
 * have answered is supplied instead.
 *
 * The pair a mechanism would abandon the execution with is built with it,
 * and neither half is acted on here. An execution already at rest carries
 * neither: it answered its caller once already, and overwriting how it
 * ended would erase that. The record given is left exactly as it was.
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
 *   faultKind: 'response_unawaited',
 *   message: 'this execution never asked for what this event answers',
 * });
 * ```
 */
export const createArvoHandlerFault = async (
  param: ArvoHandlerFaultFactoryParam,
): Promise<ArvoHandlerFault> => {
  const timestamp = Date.now();
  const self = param.contracts.self;
  const origin = originOf(param, self);

  // An execution already at rest answered its caller and rests where it
  // rests: a second answer would be discarded at that caller's gate, and
  // overwriting its lifecycle would erase how it actually ended.
  const carriesAbandonment = param.faultKind !== 'lifecycle_terminal';

  const published = carriesAbandonment
    ? await abandonmentEventFor(
        self,
        origin,
        param.message,
        param.options.handlerErrorDomain,
      )
    : null;
  const written =
    published === null
      ? null
      : await new ArvoEventSerializer({ type: 'arvoevent' }).trySerialize(
          published,
        );

  const fault = new ArvoHandlerFault({
    faultKind: param.faultKind,
    message: param.message,
    violations: param.violations ?? [],
    cause: param.cause ?? null,
    subject: origin.subject,
    executionId: origin.executionId,
    eventId: origin.event.id,
    attempt: param.attempt,
    timestamp,
    retry: resolveRetry({
      retrySafe: isRetrySafeFaultKind(param.faultKind, param.retryable ?? true),
      attempt: param.attempt,
      maxRetryAttempts: param.options.maxRetryAttempts,
      retryDelay: param.options.retryDelay,
      event: origin.event,
      state: param.state,
      timestamp,
    }),
    abandonmentEvent: written?.ok ? written.value : null,
    abandonmentState: carriesAbandonment
      ? await abandonmentStateFor(
          param.state,
          param.state === null ? 'init' : param.entry,
          published,
          param.message,
        )
      : null,
  });

  param.telemetry.recordFault(fault);
  return fault;
};
