import { err, ok } from 'neverthrow';
import type { VersionedArvoContract } from '../../ArvoContract/versioned/index.js';
import { createArvoEventFactory } from '../../factories/ArvoEventFactory/index.js';
import { fromNeverthrow } from '../../result.js';
import type { Result } from '../../types.js';
import {
  ARVO_CATEGORY_COMPLETE,
  ARVO_CATEGORY_INIT,
} from '../helpers/defaults.js';
import type { ArvoExecutionState } from '../state/index.js';
import type { ArvoServiceMap } from '../types/services.js';
import { resolveEmissionTarget } from './target.js';
import type {
  ArvoEmissionContext,
  ArvoEmissionParam,
  ArvoEmissionRefusal,
  ArvoEmissionTarget,
  ArvoEmittedEvent,
} from './types.js';

/** The fields whose value depends on where the event is going. */
const addressingFor = <TSelf extends VersionedArvoContract>(
  target: ArvoEmissionTarget<TSelf>,
  state: ArvoExecutionState,
) =>
  target.role === 'service'
    ? {
        to: target.contract.type,
        executionid: state.executionId,
        depth: state.depth + 1,
        initid: undefined,
        category: ARVO_CATEGORY_INIT,
      }
    : {
        to: state.initEvent.source,
        executionid: state.parentExecutionId,
        depth: state.depth,
        initid: state.initEvent.id,
        category: ARVO_CATEGORY_COMPLETE,
      };

/**
 * A fully addressed event from a type and a payload, or why it could not
 * be built. Every field the protocol fixes is set here.
 */
export const tryBuildEmittedEvent = <
  TSelf extends VersionedArvoContract,
  TServices extends ArvoServiceMap,
  TParam extends ArvoEmissionParam<TSelf, TServices>,
>(
  emissionContext: ArvoEmissionContext<TSelf, TServices>,
  param: TParam,
): Result<
  ArvoEmittedEvent<TSelf, TServices, TParam['type']>,
  ArvoEmissionRefusal
> => {
  const target = resolveEmissionTarget(
    emissionContext.self,
    emissionContext.services,
    param.type,
  );
  if (target === null) {
    return fromNeverthrow(
      err({
        faultKind: 'emission_not_permitted',
        message: `${param.type} is not a type this version may emit: it names neither a declared service's input nor one of this version's outputs`,
        violations: [],
      } as const),
    );
  }

  const state = emissionContext.state;
  const fields = {
    ...addressingFor(target, state),
    source: state.source,
    subject: state.subject,
    parentid: state.triggeringEvent.id,
    baggage: state.triggeringEvent.baggage,
    executionunits: param.executionunits ?? 0,
    traceparent: emissionContext.telemetry.traceparent ?? undefined,
    tracestate: emissionContext.telemetry.tracestate ?? undefined,
    ...param.unsafe,
  };

  // The two sources only this execution can answer for: the contract it
  // implements, and the event that caused it. Without them a version asking
  // for either would be told there is no domain, and its event would stay
  // on a path it asked to leave.
  const factory = createArvoEventFactory(target.contract, {
    domainCtx: {
      selfContract: emissionContext.self,
      triggeringEvent: state.triggeringEvent,
    },
  });
  const attempt =
    target.role === 'service'
      ? factory.tryCreateInput({
          ...fields,
          data: param.data,
          domain: param.domain,
        })
      : factory.tryCreateOutput({
          ...fields,
          type: param.type,
          data: param.data,
          domain: param.domain,
        });

  if (attempt.ok) {
    // The factory types its output off whichever contract was chosen at
    // runtime; the param's own type already fixes which that is.
    return fromNeverthrow(
      ok(attempt.value as ArvoEmittedEvent<TSelf, TServices, TParam['type']>),
    );
  }

  return fromNeverthrow(
    err({
      faultKind: 'emission_schema_rejected',
      message: attempt.error.message,
      violations: attempt.error.issues.map((issue) => issue.toString()),
    } as const),
  );
};
