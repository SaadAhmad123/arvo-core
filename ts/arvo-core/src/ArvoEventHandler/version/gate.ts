import type { VersionedArvoContract } from '../../ArvoContract/versioned/index.js';
import type { ArvoEvent } from '../../ArvoEvent/index.js';
import type { ArvoExecutionState } from '../state/index.js';
import type { ArvoGateRefusal } from './types.js';

/**
 * Whether this exact event has already been processed.
 *
 * Recognised by its `id` already appearing in the event log as received.
 * A duplicate is the transport doing its job under at-least-once
 * execution, so it is discarded quietly rather than faulted: the handler
 * has demonstrably processed it, and there is nothing to report.
 */
export const alreadySeen = (
  state: ArvoExecutionState,
  event: ArvoEvent,
): boolean =>
  state.eventIds.some(
    (logged) => logged.id === event.id && logged.direction === 'received',
  );

/**
 * Why a finished execution accepts nothing further, or `null` where it
 * still does.
 *
 * Checked before the clocks so that a late event reaching a concluded
 * execution is refused for having concluded, rather than abandoned for
 * time.
 */
export const refuseTerminal = (
  state: ArvoExecutionState,
): ArvoGateRefusal | null =>
  state.isTerminal
    ? {
        faultKind: 'lifecycle_terminal',
        message: `this execution rests at ${state.lifecycle} and accepts nothing further`,
        violations: [],
      }
    : null;

/**
 * Why an execution has outlived the time its version allows, or `null`
 * where it has not.
 *
 * Measured from the event that opened it to now. A version setting no
 * execution timeout passes always.
 */
export const refuseOutlived = (
  initEvent: ArvoEvent,
  executionTimeout: number | null,
  now: number,
): ArvoGateRefusal | null => {
  if (executionTimeout === null) return null;

  const elapsed = now - Date.parse(initEvent.time);
  if (elapsed < executionTimeout) return null;

  return {
    faultKind: 'execution_timeout',
    message: `this execution began at ${initEvent.time} and has run ${elapsed}ms, past the ${executionTimeout}ms its version allows`,
    violations: [],
  };
};

/**
 * Why the event, the handler and the record do not agree, or `null` where
 * they do.
 *
 * Every applicable comparison is reported together rather than stopping
 * at the first: an event misaddressed in two ways should say so once.
 */
export const refuseMisaddressed = (
  self: VersionedArvoContract,
  event: ArvoEvent,
  state: ArvoExecutionState | null,
): ArvoGateRefusal | null => {
  if (event.to === null) {
    return {
      faultKind: 'event_unaddressed',
      message:
        'this event names no destination, and `to` is what Arvo routes on',
      violations: [],
    };
  }

  const disagreements: string[] = [];
  if (event.to !== self.type) {
    disagreements.push(
      `to: must be ${self.type} to reach this handler, not ${event.to}`,
    );
  }
  if (state !== null) {
    if (state.source !== self.type) {
      disagreements.push(
        `state.source: the record names ${state.source}, and this handler implements ${self.type}`,
      );
    }
    if (state.executionId !== event.executionid) {
      disagreements.push(
        `state.executionId: the record is ${state.executionId} and the event answers ${event.executionid}`,
      );
    }
    if (state.subject !== event.subject) {
      disagreements.push(
        `state.subject: the record is in ${state.subject} and the event is in ${event.subject}`,
      );
    }
  }

  if (disagreements.length === 0) return null;
  return {
    faultKind: 'addressing_mismatch',
    message: 'the event, this handler and the record do not agree',
    violations: disagreements,
  };
};

/**
 * Why a response is one nothing awaited, or `null` where it was awaited.
 *
 * One rule covers three cases: a response naming no request, one naming a
 * request this execution never made, and one naming a request already
 * answered.
 */
export const refuseUnawaited = (
  state: ArvoExecutionState,
  event: ArvoEvent,
): ArvoGateRefusal | null => {
  const awaited = event.initid;
  const held =
    awaited === null ? undefined : state.inFlightEventMap.get(awaited);

  if (awaited === null) {
    return {
      faultKind: 'response_unawaited',
      message:
        'this response names no request, so nothing could be awaiting it',
      violations: [],
    };
  }
  if (held === undefined) {
    return {
      faultKind: 'response_unawaited',
      message: `this execution never awaited ${awaited}`,
      violations: [],
    };
  }
  if (held !== null) {
    return {
      faultKind: 'response_unawaited',
      message: `${awaited} is already answered, and an execution awaits one response per request`,
      violations: [],
    };
  }
  return null;
};
