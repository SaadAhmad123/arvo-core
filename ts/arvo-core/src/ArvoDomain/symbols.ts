/**
 * The symbols themselves, declared one per constant so each carries its own
 * type. Grouped into a registry by `index.ts`.
 *
 * A registry built from `Symbol(...)` calls inline would give every member the
 * type `symbol`, and a symbol meant for one field would satisfy another.
 */

/** @see ArvoDomain.LOCAL */
export const LOCAL: unique symbol = Symbol('arvo.domain.local');

/** @see ArvoDomain.FROM_EVENT_CONTRACT */
export const FROM_EVENT_CONTRACT: unique symbol = Symbol(
  'arvo.domain.from_event_contract',
);

/** @see ArvoDomain.FROM_SELF_CONTRACT */
export const FROM_SELF_CONTRACT: unique symbol = Symbol(
  'arvo.domain.from_self_contract',
);

/** @see ArvoDomain.FROM_TRIGGERING_EVENT */
export const FROM_TRIGGERING_EVENT: unique symbol = Symbol(
  'arvo.domain.from_triggering_event',
);
