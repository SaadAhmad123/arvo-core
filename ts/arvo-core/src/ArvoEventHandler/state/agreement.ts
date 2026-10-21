import type { ArvoEvent } from '../../ArvoEvent/index.js';
import { deriveArvoExecutionId } from '../helpers/execution-id.js';
import type { ArvoExecutionState } from './index.js';

/** One field against what the init event says it must be. */
const disagrees = (
  field: string,
  storedValue: unknown,
  requiredValue: unknown,
  authority: string,
): string | null =>
  storedValue === requiredValue
    ? null
    : `${field}: stored state says ${String(storedValue)}, and ${authority} says ${String(requiredValue)}`;

/**
 * Every way a record contradicts its own init event, or none where it
 * contradicts it in no way.
 *
 * Several of a record's fields are copies or derivations of values inside
 * the init event, kept as fields of their own so that addressing a
 * completion never depends on restoring an event. A copy that has drifted
 * from its source misroutes that completion, and no shape check can see
 * it — both values are well-formed.
 *
 * Checked against the record's own init event, not against the event that
 * caused this execution: a record that contradicts itself is corrupt, and
 * should be reported as corrupt before it is compared with anything
 * outside it.
 *
 * @param state - The record, with its events already restored.
 *
 * @example
 * ```typescript
 * const drifted = await disagreementsWithInitEvent(restored);
 * if (drifted.length > 0) refuse('record_invalid', drifted);
 * ```
 */
export const disagreementsWithInitEvent = async (
  state: ArvoExecutionState,
): Promise<string[]> => {
  const initEvent: ArvoEvent = state.initEvent;
  const derivedExecutionId = await deriveArvoExecutionId(initEvent);

  const disagreements = [
    disagrees(
      'subject',
      state.subject,
      initEvent.subject,
      'the event that opened it',
    ),
    disagrees(
      'parentExecutionId',
      state.parentExecutionId,
      initEvent.executionid,
      'the event that opened it',
    ),
    disagrees(
      'depth',
      state.depth,
      initEvent.depth,
      'the event that opened it',
    ),
    disagrees(
      'executionId',
      state.executionId,
      derivedExecutionId,
      'what the event that opened it derives to',
    ),
    disagrees(
      'source',
      state.source,
      initEvent.to,
      'what the event that opened it was addressed to',
    ),
    disagrees(
      'version',
      state.version,
      initEvent.dataschema.slice(initEvent.dataschema.lastIndexOf('/') + 1),
      'the version the event that opened it names',
    ),
    state.eventIds.some(
      (touchedEvent) =>
        touchedEvent.id === initEvent.id &&
        touchedEvent.direction === 'received',
    )
      ? null
      : `eventIds: does not list ${initEvent.id}, the event that opened this execution, as received — every stored execution must`,
  ];

  for (const requestId of state.inFlightEventMap.keys()) {
    if (
      !state.eventIds.some(
        (touchedEvent) =>
          touchedEvent.id === requestId && touchedEvent.direction === 'emitted',
      )
    ) {
      disagreements.push(
        `inFlightEventMap: awaits request ${requestId}, which stored state does not list as having been sent`,
      );
    }
  }

  return disagreements.filter(
    (disagreement): disagreement is string => disagreement !== null,
  );
};
