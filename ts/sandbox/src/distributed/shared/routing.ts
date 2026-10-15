import type { ArvoEvent } from 'arvo-core';
import { HANDLERS, type RoutableHandler } from '../handler/index.js';

/**
 * Where one event goes.
 *
 * Two fields decide it and nothing else does. A non-null `domain` means
 * the event must be lifted out of this lattice; otherwise `to` names the
 * handler, matched against that handler's own self contract type
 * (`docs/adr/006-arvoeventhandler-protocol.md`).
 *
 * Whether the event opens an execution or answers one is not decided
 * here. That is the handler's, and so is the execution identifier it
 * turns on.
 */

/** Where an event goes, and what a mechanism must do to get it there. */
export type Destination =
  /** To this handler, which will say what it is. */
  | { readonly kind: 'handled'; readonly handler: RoutableHandler }
  /** Out of the lattice. Nothing here may be given it. */
  | { readonly kind: 'left'; readonly domain: string }
  /** Nowhere here. A run's answer to its caller is this. */
  | { readonly kind: 'outside'; readonly addressedTo: string | null };

/**
 * The handler an event is addressed to, or `null` where none is.
 *
 * @param addressedTo - The event's `to`.
 */
export const handlerFor = (
  addressedTo: string | null,
): RoutableHandler | null => {
  if (addressedTo === null) return null;
  // own properties only: a `to` of `__proto__` matches on every object
  return Object.hasOwn(HANDLERS, addressedTo)
    ? ((HANDLERS as Record<string, RoutableHandler>)[addressedTo] ?? null)
    : null;
};

/**
 * Where one event goes.
 *
 * @param event - The event to route, as it was committed.
 */
export const destinationFor = (event: ArvoEvent): Destination => {
  if (event.domain !== null) return { kind: 'left', domain: event.domain };

  const handler = handlerFor(event.to);
  return handler === null
    ? { kind: 'outside', addressedTo: event.to }
    : { kind: 'handled', handler };
};
