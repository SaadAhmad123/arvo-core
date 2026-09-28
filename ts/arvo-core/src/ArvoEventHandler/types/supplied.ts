/**
 * Whatever a handler's executors are given to work with. Supplied per
 * delivery by whatever runs the handler, never stored, and never part of
 * the model.
 *
 * Declare the shape through `types.dependencies`. TypeScript gives a `type`
 * alias an implicit index signature and does not give one to an `interface`,
 * so a bag declared as an interface will not satisfy this where the
 * identical alias will.
 */
export type ArvoDependencies = Record<string, any>;

/**
 * Whatever the mechanism running a handler chooses to expose to an executor.
 * Undefined here and entirely that mechanism's own.
 *
 * Declare the shape through `types.mechanismHooks`. The same
 * `interface`-versus-`type` rule as {@link ArvoDependencies} applies.
 */
export type ArvoMechanismHooks = Record<string, any>;

/** Declared neither dependencies nor hooks, so there is nothing to reach for. */
export type ArvoNone = Record<string, never>;
