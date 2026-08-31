import {
  FROM_EVENT_CONTRACT,
  FROM_SELF_CONTRACT,
  FROM_TRIGGERING_EVENT,
  LOCAL,
} from './symbols.js';

/**
 * Where an event's `domain` comes from, for a caller who does not have the
 * value at hand.
 *
 * Pass one of these as an event's `domain` and it is read from the place it
 * names, before the event is built. Nothing here reaches the event: what the
 * event carries is always a plain string or `null`.
 *
 * A `domain` you already know is passed as a string and used as it stands, so
 * none of this is on the ordinary path.
 *
 * ```typescript
 * // The domain the contract declares.
 * domain: ArvoDomain.FROM_EVENT_CONTRACT
 *
 * // No domain at all, whatever the contract declares.
 * domain: ArvoDomain.LOCAL
 * ```
 *
 * A symbol whose source was not supplied reads as `null` — the same answer as
 * a source that had no domain of its own.
 */
export const ArvoDomain = Object.freeze({
  /** No domain. The event stays where it is. */
  LOCAL,

  /** The `domain` declared by the contract this event is built from. */
  FROM_EVENT_CONTRACT,

  /**
   * The `domain` declared by the contract of the handler which is building the event,
   * where that differs from the event's own contract.
   */
  FROM_SELF_CONTRACT,

  /** The `domain` of the event that caused this one. */
  FROM_TRIGGERING_EVENT,
});
