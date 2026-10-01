import type { ArvoEvent } from '../../ArvoEvent/index.js';
import type { ArvoExecutionState } from './index.js';
import { logEvent } from './log.js';
import { mutateState } from './utils.js';

/**
 * The record with a service's response held against the request it
 * answers, and the response in the trail the execution leaves.
 *
 * The request is the one the response names, which is the `id` of the
 * event this execution emitted. Whether the response was awaited at all is
 * settled before this, so a response reaching here is one the execution
 * asked for.
 *
 * Nothing else about the execution moves, and the record given is not
 * changed.
 *
 * @param state - The record as it stands.
 * @param event - The response to take in.
 *
 * @example
 * ```typescript
 * const collected = collectResponse(state, response);
 * collected.inFlightEventMap.get(request.id); // the response
 * ```
 */
export const collectResponse = <TState extends ArvoExecutionState>(
  state: TState,
  event: ArvoEvent,
): TState => {
  const awaiting = new Map(state.inFlightEventMap);
  awaiting.set(event.initid as string, event);
  return logEvent(
    mutateState(state, { inFlightEventMap: awaiting }),
    event,
    'received',
  );
};
