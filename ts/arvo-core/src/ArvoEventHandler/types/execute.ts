import type * as z from 'zod/v4/core';
import type { VersionedArvoContract } from '../../ArvoContract/versioned/index.js';
import type { ArvoEvent } from '../../ArvoEvent/index.js';
import type { JSONObject, PromiseAble } from '../../types.js';
import type { ArvoExecutionContext } from '../context/index.js';
import type { ArvoServiceMap } from './services.js';
import type { ArvoDependencies, ArvoMechanismHooks } from './supplied.js';

/**
 * What one call to `execute` produced.
 *
 * Discriminated because committing nothing has two meanings. `produced`
 * says these events and this record go together, under the outbox
 * guarantee. `discarded` says this event had already been processed and
 * there is nothing to commit. A caller that cannot tell them apart cannot
 * tell a duplicate from a lost execution.
 */
export type ArvoEventHandlerExecuteResponse =
  | {
      readonly kind: 'produced';
      /** Every event to publish, as the executor returned them. */
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
