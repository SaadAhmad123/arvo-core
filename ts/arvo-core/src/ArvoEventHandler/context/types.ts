import type * as z from 'zod/v4/core';
import type { VersionedArvoContract } from '../../ArvoContract/versioned/index.js';
import type { ARVO_LOOSE_DATA_SCHEMA } from '../helpers/defaults.js';
import type { ArvoExecutionState } from '../state/index.js';
import type { ArvoRecordContracts } from '../state/types.js';
import type { ArvoEventHandlerOptions } from '../types/options.js';
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
 * Anything one delivery can carry: the event this version takes in, or
 * whatever a declared service answered with, its handler error included.
 *
 * A union rather than a type that narrows by how the delivery was
 * classified. Every member has a literal `type` and no two can share one,
 * because the collision rule refuses that at declaration, so narrowing on
 * `type` reaches the exact payload and needs nothing else to help it.
 */
export type ArvoDeliveredEvent<
  TSelf extends VersionedArvoContract,
  TServices extends ArvoServiceMap,
> = ArvoInitEvent<TSelf> | ArvoAnyServiceResponse<TServices>;

/**
 * What an execution remembers, typed by the contracts this delivery is
 * bound to.
 *
 * The record's two events are the ones this version can actually hold: the
 * event that opened the execution, and whatever this delivery classified
 * as.
 */
export type ArvoContextState<
  TSelf extends VersionedArvoContract,
  TServices extends ArvoServiceMap,
  TDataSchema extends z.$ZodObject,
> = ArvoExecutionState<
  TDataSchema,
  ArvoInitEvent<TSelf>,
  ArvoDeliveredEvent<TSelf, TServices>
>;

/**
 * What may be written as an execution's data: a value, or a function given
 * what is there now.
 *
 * The function form exists so that building on what is remembered is not
 * the caller's bookkeeping. It receives `null` where nothing has been
 * written.
 */
export type ArvoDataWrite<TDataSchema extends z.$ZodObject> =
  | z.input<TDataSchema>
  | ((current: z.output<TDataSchema> | null) => z.input<TDataSchema>);

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
  TDataSchema extends z.$ZodObject,
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
  /** What this execution remembers, as it stood when this delivery arrived. */
  state: ArvoContextState<TSelf, TServices, TDataSchema>;
  /** The schema this execution's data is checked against, on every write. */
  dataSchema: TDataSchema;
  /** The options in force for this version. */
  options: ArvoEventHandlerOptions;
  /** How this delivery was classified. */
  entry: ArvoEntryKind;
  /** Which attempt this delivery is, counting from 0. */
  attempt: number;
  /** What this delivery's executor is given to work with. */
  dependencies: TDependencies;
  /** What the mechanism running this handler exposes to an executor. */
  hooks: TMechanismHooks;
};

/**
 * The schema actually governing a version's data: the one it declared, or
 * the loose one where it declared none.
 *
 * A version may pass `null` to say it remembers nothing in particular.
 * Resolving that here rather than at each call site is what lets the data's
 * type follow from the same call that builds a context.
 */
export type ArvoDataSchemaInForce<TDeclared extends z.$ZodObject | null> =
  TDeclared extends z.$ZodObject ? TDeclared : typeof ARVO_LOOSE_DATA_SCHEMA;

/** What both context factories need, whichever way the delivery arrived. */
type ArvoContextFactoryCommon<
  TSelf extends VersionedArvoContract,
  TServices extends ArvoServiceMap,
  TDeclaredSchema extends z.$ZodObject | null,
  TDependencies extends ArvoDependencies,
  TMechanismHooks extends ArvoMechanismHooks,
> = {
  /** This version of the contract implemented, and what it may send to. */
  contracts: { self: TSelf; services: TServices };
  /** The schema this version declared, or `null` where it declared none. */
  dataSchema: TDeclaredSchema;
  /** Which attempt this delivery is, counting from 0. */
  attempt: number;
  /** The options in force for this version, every one of them settled. */
  options: ArvoEventHandlerOptions;
  /** What this delivery's executor is given to work with. */
  dependencies: TDependencies;
  /** What the mechanism running this handler exposes to an executor. */
  hooks: TMechanismHooks;
};

/**
 * What opening an execution needs.
 *
 * Everything a record holds that cannot be read off the event or the
 * contracts, because there is no record yet to read it from.
 */
export type ArvoInitContextParam<
  TSelf extends VersionedArvoContract,
  TServices extends ArvoServiceMap,
  TDeclaredSchema extends z.$ZodObject | null,
  TDependencies extends ArvoDependencies,
  TMechanismHooks extends ArvoMechanismHooks,
> = ArvoContextFactoryCommon<
  TSelf,
  TServices,
  TDeclaredSchema,
  TDependencies,
  TMechanismHooks
> & {
  /** The event opening this execution. */
  event: ArvoInitEvent<TSelf>;
  /**
   * This execution, derived before the store was consulted.
   *
   * Never derived here. Whatever looked for a record already had to know
   * which execution it was looking for, so deriving it again would be the
   * same value computed in two places.
   */
  executionId: string;
  /** The execution that caused this one. */
  parentExecutionId: string;
  /** The contracts as they are to be stored, for a reader years later. */
  contractsSnapshot: ArvoRecordContracts;
};

/**
 * What resuming an execution needs.
 *
 * Shorter than opening one, because the record answers everything the other
 * had to be told.
 */
export type ArvoFollowupContextParam<
  TSelf extends VersionedArvoContract,
  TServices extends ArvoServiceMap,
  TDeclaredSchema extends z.$ZodObject | null,
  TDependencies extends ArvoDependencies,
  TMechanismHooks extends ArvoMechanismHooks,
> = ArvoContextFactoryCommon<
  TSelf,
  TServices,
  TDeclaredSchema,
  TDependencies,
  TMechanismHooks
> & {
  /** What a declared service answered with. */
  event: ArvoAnyServiceResponse<TServices>;
  /** The record as it was stored. */
  state: string;
  /**
   * The execution this delivery is for, checked against the record read
   * back. A mismatch means the wrong record was fetched, which is worth
   * catching rather than running against.
   */
  executionId: string;
};
