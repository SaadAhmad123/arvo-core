import type * as z from 'zod/v4/core';
import type { VersionedArvoContract } from '../../ArvoContract/versioned/index.js';
import type { ArvoEvent } from '../../ArvoEvent/index.js';
import type { JSONObject, PromiseAble } from '../../types.js';
import type { ArvoExecutionContext } from '../context/index.js';
import type { ArvoExecutionContextTelemetry } from '../context/telemetry/index.js';
import type { ArvoServiceMap } from './services.js';
import type {
  ArvoDependencies,
  ArvoDependencyResolver,
  ArvoMechanismHooks,
} from './supplied.js';

/**
 * What one call to `execute` produced.
 *
 * Discriminated because committing nothing has two meanings. `produced`
 * says these events and this record go together, to be committed as one or
 * not at all. `discarded` says this event had already been processed and
 * there is nothing to do. A caller that cannot tell them apart cannot tell
 * a repeat from a lost execution.
 *
 * An execution whose work failed is `produced` like any other: what it
 * produced is the handler error event for its caller, and a record that
 * rests at `error`.
 */
export type ArvoEventHandlerExecuteResponse =
  | {
      readonly kind: 'produced';
      /**
       * Every event to publish: what the executor returned, or the handler
       * error event where its work failed.
       */
      readonly events: readonly ArvoEvent[];
      /** The record to commit alongside them. */
      readonly state: JSONObject;
    }
  | {
      readonly kind: 'discarded';
      /** Why nothing is to be committed. */
      readonly reason: string;
    };

/**
 * What a version's business code does with one execution.
 *
 * Receives everything it can know and do, and returns the events to emit:
 * one, several, or none. Throwing is how it says the work cannot be
 * finished, which reaches its caller as this contract's handler error
 * event — unless what it throws is a fault built through `ctx.fault`,
 * which stays a fault.
 */
export type ArvoEventHandlerExecutor<
  TSelf extends VersionedArvoContract,
  TServices extends ArvoServiceMap,
  TDataSchema extends z.$ZodObject,
  TDependencies extends ArvoDependencies,
  TMechanismHooks extends ArvoMechanismHooks,
> = (
  ctx: ArvoExecutionContext<
    TSelf,
    TServices,
    TDataSchema,
    TDependencies,
    TMechanismHooks
  >,
) => PromiseAble<ArvoExecutorEmission>;

/**
 * What an executor hands back: several events, one, or none at all.
 *
 * Emitting nothing is written as a body that returns nothing, so the
 * empty case is `void` rather than an explicit `undefined`.
 */
// biome-ignore lint/suspicious/noConfusingVoidType: see above.
export type ArvoExecutorEmission = ArvoEvent[] | ArvoEvent | void;

/**
 * How a handler reaches the store, supplied by whatever runs it.
 *
 * Takes one identifier and yields what is under it, parsed and nothing
 * more. It MUST read the store on every call rather than hand back
 * something read earlier, which is what makes a further attempt see a
 * record another execution advanced in between.
 *
 * Whether what comes back is a record, belongs to this event, or can
 * still be resumed is the handler's to judge, so this neither classifies
 * nor filters. The telemetry and the attempt are there to record against
 * and to tune the read by — a longer timeout, a different replica — and
 * never to change which record comes back.
 */
export type ArvoExecutionStateResolver = (param: {
  /** The execution to read, which the handler chose. */
  executionId: string;
  /** Where this execution records, so the read is traced as part of it. */
  telemetry: ArvoExecutionContextTelemetry;
  /** Which attempt this is, counting from 0. */
  attempt: number;
}) => PromiseAble<JSONObject | null>;

/**
 * What one execution of a handler brings with it.
 *
 * Everything a handler needs and nothing it holds: it reaches no store
 * and remembers nothing between one of these and the next.
 */
export type ArvoEventHandlerExecuteParam<
  TDependencies extends ArvoDependencies,
  TMechanismHooks extends ArvoMechanismHooks,
> = {
  /** The event that caused this execution. */
  event: ArvoEvent;

  /** How to reach the store. See {@link ArvoExecutionStateResolver}. */
  state: ArvoExecutionStateResolver;

  /**
   * Which attempt this is, counting from 0. A retry carries one more
   * than the attempt it repeats, and it is the only input a retry
   * inherits.
   */
  attempt: number;

  /**
   * What this version's executor is given to work with: a value used as
   * it stands, or a factory called exactly once for this execution.
   * Omitted, the executor finds an empty object.
   */
  dependencies?: ArvoDependencyResolver<TDependencies, z.$ZodObject>;

  /**
   * Whatever the mechanism running this handler exposes to an executor.
   * Omitted, the executor finds an empty object.
   *
   * A hook must be read-only, or change only what is the same however
   * many times this execution is attempted. One that could change what
   * this execution concludes breaks the atomicity the protocol rests on.
   */
  hooks?: TMechanismHooks;
};
