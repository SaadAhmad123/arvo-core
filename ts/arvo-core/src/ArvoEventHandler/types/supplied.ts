/**
 * Whatever a handler's executors are given to work with. Supplied per
 * delivery by whatever runs the handler, never stored, and never part of
 * the model.
 *
 * TypeScript gives a `type` alias an implicit index signature and does not
 * give one to an `interface`, so a bag declared as an interface will not
 * satisfy this where the identical alias will.
 */
export type ArvoDependencies = Record<string, any>;

/**
 * Whatever the mechanism running a handler chooses to expose to an executor.
 * Undefined here and entirely that mechanism's own.
 *
 * The same `interface`-versus-`type` rule as {@link ArvoDependencies} applies.
 */
export type ArvoMechanismHooks = Record<string, any>;

/**
 * Declared neither dependencies nor hooks, so there is nothing to reach for.
 *
 * An empty object with no index signature, so reaching for something
 * never declared is the error, at the line that reached.
 */
export type ArvoNone = Record<never, never>;

/**
 * Where a declaration states the types of what a mechanism will supply.
 *
 * Read by nothing and stored by nothing. It exists because neither
 * dependencies nor hooks are part of a declaration — both arrive per
 * delivery — so there is no value for TypeScript to infer their types
 * from. Naming them here is the only way an executor's `ctx.dependencies`
 * and `ctx.hooks` are anything but `any`.
 *
 * Both are optional, and an omitted one declares nothing rather than
 * everything: reaching for what was never declared is then an error at the
 * line that reached.
 *
 * Must be written as a type alias. TypeScript gives an alias an implicit
 * index signature and an `interface` none, so an interface will not
 * satisfy the constraint an identical alias satisfies.
 *
 * @example
 * ```typescript
 * types: {} as {
 *   dependencies: { db: Db };
 *   mechanismHooks: { scheduler: Scheduler };
 * },
 * ```
 */
export type ArvoDeclaredTypes<
  TDependencies extends ArvoDependencies = ArvoNone,
  TMechanismHooks extends ArvoMechanismHooks = ArvoNone,
> = Partial<{
  /** What an executor finds on `ctx.dependencies`. */
  dependencies: TDependencies;
  /** What an executor finds on `ctx.hooks`. */
  mechanismHooks: TMechanismHooks;
}>;
