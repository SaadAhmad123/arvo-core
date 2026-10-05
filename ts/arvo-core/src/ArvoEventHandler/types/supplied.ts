import type * as z from 'zod/v4/core';
import type { ArvoEvent } from '../../ArvoEvent/index.js';
import type { PromiseAble } from '../../types.js';
import type { ArvoExecutionState } from '../state/index.js';

/**
 * Whatever a handler's executors are given to work with. Supplied per
 * execution by whatever runs the handler, never stored, and never part of
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
 * execution — so there is no value for TypeScript to infer their types
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

/**
 * How dependencies reach an executor: a value used as given, or a factory
 * called exactly once for the execution.
 *
 * The factory form is what makes a cancellation signal readable, since it
 * is handed the event and the record and can consult whatever the
 * application maintains before the executor runs.
 */
export type ArvoDependencyResolver<
  TDependencies extends ArvoDependencies,
  TDataSchema extends z.$ZodObject,
> =
  | TDependencies
  | ((param: {
      /** The event that caused this execution. */
      event: ArvoEvent;
      /**
       * What the execution remembers, or `null` where it has none yet.
       *
       * `null` on an event opening an execution: nothing was read, and
       * there is nothing a record could say about an execution that did
       * not exist a moment ago. Present on one answering an execution,
       * already validated.
       *
       * Which it is therefore says whether this is opening something or
       * resuming it, and a factory may reasonably open different
       * resources for each.
       */
      state: ArvoExecutionState<TDataSchema> | null;
      /**
       * The execution this is for, whether or not a record exists yet.
       *
       * Supplied so that something keyed on the execution — a lock, a
       * lease, a scoped client — can be built on the execution that
       * opens one as readily as on one that resumes it.
       */
      executionId: string;
      /** Which attempt this is, counting from 0. */
      attempt: number;
    }) => PromiseAble<TDependencies>);
