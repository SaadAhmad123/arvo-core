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
 * Declared on a handler, a layer runs for every version; supplied with an
 * execution, for that execution only. Supplied layers run outside declared
 * ones: before parts in that order and then the executor, after parts in
 * reverse.
 *
 * Nothing either part returns is read. The executor alone decides what an
 * execution emits; a layer influences what the executor sees, through the
 * context, and may observe what it returned.
 *
 * A layer listed as an instance serves every execution of the handler,
 * several at once, so it keeps nothing about one execution on itself —
 * that travels through `ctx.setMiddleware`. A layer listed as a way to make
 * one serves a single execution and may hold what it learns. See
 * {@link ArvoEventHandlerMiddlewareEntry}.
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
  /**
   * What names this layer on the span and in a fault. Unique among the
   * layers of one execution.
   */
  readonly id: TId;

  /**
   * Runs before the executor, and may do what an executor may.
   *
   * @param ctx - The context the executor will be given.
   * @throws Anything. Nothing after it runs — no further layer, not the
   * executor — and the execution fails as though the executor had raised
   * what this raised: a fault built through `ctx.fault` stays a fault,
   * anything else becomes the handler error event.
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
   * Runs after the executor returned, and only then. Sees what it
   * returned and cannot change it.
   *
   * Under the same run clock as the executor: where it runs out here, the
   * executor's return stands and the remaining after parts are skipped.
   *
   * @param ctx - The context the executor was given.
   * @param emission - What the executor returned, read-only.
   * @throws Anything. Recorded on the span and discarded; the executor's
   * return stands, and the remaining after parts still run.
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
 * and the layer it returns serves that execution alone — which is what
 * lets it hold what it learns on itself. A call that fails, or returns
 * something that is not a layer, fails the execution as
 * `middleware_instantiation_failed`, which no further attempt fixes.
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
