import type * as z from 'zod/v4/core';
import type { VersionedArvoContract } from '../../ArvoContract/versioned/index.js';
import type { PromiseAble } from '../../types.js';
import type { ArvoExecutionContext } from '../context/index.js';
import type { ArvoExecutorEmission } from './execute.js';
import type { ArvoServiceMap } from './services.js';
import type { ArvoDependencies, ArvoMechanismHooks } from './supplied.js';

/**
 * A layer around a version's executor: a part that runs before it, a part
 * that runs after it, and a name.
 *
 * A layer may change what the executor sees, never what it emits: nothing
 * either part returns is read. An instance serves every execution at once,
 * so it keeps nothing about one on itself — use `ctx.setMiddleware`.
 *
 * See `docs/adr/016-executor-middleware.md`.
 *
 * @typeParam TId - The identifier, kept as the literal it was declared with.
 *
 * @example
 * ```typescript
 * class MeasureDuration implements IArvoEventHandlerMiddleware<'measure_duration'> {
 *   readonly id = 'measure_duration' as const;
 *
 *   async before(ctx: ArvoExecutionContext) {
 *     await ctx.setMiddleware('measure_duration.started_at', Date.now());
 *   }
 *
 *   after(ctx: ArvoExecutionContext) {
 *     const started = ctx.middleware['measure_duration.started_at'];
 *     if (typeof started === 'number') {
 *       ctx.telemetry.metric.record('order.duration', Date.now() - started);
 *     }
 *   }
 * }
 * ```
 */
export interface IArvoEventHandlerMiddleware<
  TId extends string = string,
  TSelf extends VersionedArvoContract = VersionedArvoContract,
  TServices extends ArvoServiceMap = ArvoServiceMap,
  TDataSchema extends z.$ZodObject = z.$ZodObject,
  TDependencies extends ArvoDependencies = ArvoDependencies,
  TMechanismHooks extends ArvoMechanismHooks = ArvoMechanismHooks,
> {
  /** Names this layer on the span and in a fault. Unique within an execution. */
  readonly id: TId;

  /**
   * Runs before the executor, and may do what an executor may.
   *
   * @param ctx - The context the executor will be given.
   * @throws Anything, which stops everything after it and fails the
   * execution as the executor raising it would: a fault built through
   * `ctx.fault` stays a fault, anything else is the handler error event.
   */
  before?(
    ctx: ArvoExecutionContext<
      TSelf,
      TServices,
      TDataSchema,
      TDependencies,
      TMechanismHooks
    >,
  ): PromiseAble<void>;

  /**
   * Runs after the executor returned, and only then. Nothing it does
   * changes what the execution produces.
   *
   * Under the executor's run clock: where the clock runs out here, the
   * executor's return stands and the remaining after parts are skipped.
   *
   * @param ctx - The context the executor was given.
   * @param emission - What the executor returned, read-only.
   * @throws Anything, which is recorded on the span and discarded; the
   * remaining after parts still run.
   */
  after?(
    ctx: ArvoExecutionContext<
      TSelf,
      TServices,
      TDataSchema,
      TDependencies,
      TMechanismHooks
    >,
    emission: Readonly<ArvoExecutorEmission>,
  ): PromiseAble<void>;
}

/**
 * One entry in a list of layers: a layer, or a way to make one.
 *
 * A way to make one is called once per execution, before any layer runs,
 * and the layer it returns serves that execution alone, so it may hold
 * what it learns on itself.
 *
 * @example
 * ```typescript
 * const entries: ArvoEventHandlerMiddlewareEntry[] = [
 *   new RequireTenant(),     // one instance, every execution
 *   () => new Stopwatch(),   // a fresh one per execution
 * ];
 * ```
 */
export type ArvoEventHandlerMiddlewareEntry<
  TSelf extends VersionedArvoContract = VersionedArvoContract,
  TServices extends ArvoServiceMap = ArvoServiceMap,
  TDataSchema extends z.$ZodObject = z.$ZodObject,
  TDependencies extends ArvoDependencies = ArvoDependencies,
  TMechanismHooks extends ArvoMechanismHooks = ArvoMechanismHooks,
> =
  | IArvoEventHandlerMiddleware<
      string,
      TSelf,
      TServices,
      TDataSchema,
      TDependencies,
      TMechanismHooks
    >
  | (() => PromiseAble<
      IArvoEventHandlerMiddleware<
        string,
        TSelf,
        TServices,
        TDataSchema,
        TDependencies,
        TMechanismHooks
      >
    >);
