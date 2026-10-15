import type { ArvoEvent } from '../../ArvoEvent/index.js';
import type { ArvoExecutionState } from './index.js';
import type { ArvoTouchedEventDirection } from './types.js';
import { mutateState } from './utils.js';

/**
 * The record with one more event in the trail it leaves, whichever way the
 * event went.
 *
 * An event already in the trail leaves it as it stands. An event `id` is
 * unique across the ecosystem, so a second appearance is the same event,
 * and a trail holding it twice would claim the execution handled two.
 *
 * Nothing else about the execution moves, and the record given is not
 * changed.
 *
 * @param state - The record as it stands.
 * @param event - The event the execution took in, or sent.
 * @param direction - Which way it went.
 *
 * @example
 * ```typescript
 * const logged = logEvent(state, response, 'received');
 * logged.eventIds.at(-1); // { id: response.id, direction: 'received' }
 * ```
 */
export const logEvent = <TState extends ArvoExecutionState>(
  state: TState,
  event: ArvoEvent,
  direction: ArvoTouchedEventDirection,
): TState =>
  state.eventIds.some((logged) => logged.id === event.id)
    ? state
    : mutateState(state, {
        eventIds: [...state.eventIds, { id: event.id, direction }],
      });
