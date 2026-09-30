import type * as z from 'zod/v4/core';
import type { VersionedArvoContract } from '../../ArvoContract/versioned/index.js';
import type {
  ArvoAnyServiceResponse,
  ArvoInitEvent,
  ArvoServiceMap,
} from '../types/services.js';
import type {
  ArvoDependencies,
  ArvoMechanismHooks,
} from '../types/supplied.js';

/**
 * How a delivery was classified before an executor was entered.
 *
 * `init` opened the execution; `followup` answers something it was waiting
 * for. Which one it is decides what the delivery can possibly carry, so it
 * is a type parameter and not only a value.
 */
export type ArvoEntryKind = 'init' | 'followup';

/**
 * What one delivery carries, which depends on how it was classified.
 *
 * An init carries the event this version takes in. A followup carries
 * whatever a declared service answered with, its handler error included.
 */
export type ArvoDeliveredEvent<
  TSelf extends VersionedArvoContract,
  TServices extends ArvoServiceMap,
  TArvoEntryKind extends ArvoEntryKind,
> = TArvoEntryKind extends 'init'
  ? ArvoInitEvent<TSelf>
  : ArvoAnyServiceResponse<TServices>;

/**
 * What this execution had remembered when the delivery arrived.
 *
 * An init opens the execution, so there is nothing yet and the only
 * possible value is `null`. A followup may find something stored, or `null`
 * where the delivery before it wrote nothing.
 */
export type ArvoStateOnArrival<
  TStateSchema extends z.$ZodObject,
  TArvoEntryKind extends ArvoEntryKind,
> = TArvoEntryKind extends 'init' ? null : z.output<TStateSchema> | null;

/**
 * What may be written as an execution's state: a value, or a function given
 * what is there now.
 *
 * The function form exists so that building on what is stored is not the
 * caller's bookkeeping. It receives `null` where nothing has been written.
 */
export type ArvoStateWrite<TStateSchema extends z.$ZodObject> =
  | z.input<TStateSchema>
  | ((current: z.output<TStateSchema> | null) => z.input<TStateSchema>);

/**
 * Everything one delivery hands an executor's context.
 *
 * No field is optional. A context is built once per delivery, and anything
 * it could default is something the delivery already knows, so defaulting
 * here would only hide a caller that forgot to say.
 */
export type ArvoExecutionContextParam<
  TSelf extends VersionedArvoContract,
  TServices extends ArvoServiceMap,
  TStateSchema extends z.$ZodObject,
  TArvoEntryKind extends ArvoEntryKind,
  TDependencies extends ArvoDependencies,
  TMechanismHooks extends ArvoMechanismHooks,
> = {
  /**
   * What this execution is bound to: this version of the contract it
   * implements, and every contract it may send events to.
   *
   * The self contract is a version rather than the whole contract, because
   * an execution belongs to exactly one and needs only that one's input,
   * outputs and handler error type.
   */
  contracts: {
    self: TSelf;
    services: TServices;
  };
  /** What this execution remembers, and what governs it. */
  state: {
    /**
     * The schema this execution's state is checked against, on every write.
     *
     * Always present. A version that declared none is given one accepting
     * any JSON object, so nothing has to ask whether there is a schema
     * before checking a value against it.
     */
    schema: TStateSchema;
    /** What the record held when this delivery arrived. */
    value: ArvoStateOnArrival<TStateSchema, TArvoEntryKind>;
  };
  /** How this delivery was classified. */
  entry: TArvoEntryKind;
  /** The event delivered, which follows from how it was classified. */
  event: ArvoDeliveredEvent<TSelf, TServices, TArvoEntryKind>;
  /** The event that opened this execution. The delivered event, on an init. */
  initEvent: ArvoInitEvent<TSelf>;
  /** Which attempt this delivery is, counting from 0. */
  attempt: number;
  /** What this delivery's executor is given to work with. */
  dependencies: TDependencies;
  /** What the mechanism running this handler exposes to an executor. */
  hooks: TMechanismHooks;
};
