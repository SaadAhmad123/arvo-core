import type * as z from 'zod/v4/core';
import type { VersionedArvoContract } from '../../ArvoContract/versioned/index.js';
import type { JSONObject } from '../../types.js';
import type { ArvoExecutionContextTelemetry } from '../context/telemetry/index.js';
import type { ArvoEntryKind, ArvoTriggeringEvent } from '../context/types.js';
import type { ArvoFaultKind } from '../fault/types.js';
import type { ArvoEventHandlerExecutor } from '../types/execute.js';
import type { ArvoEventHandlerOptions } from '../types/options.js';
import type { ArvoServiceMap } from '../types/services.js';
import type {
  ArvoDeclaredTypes,
  ArvoDependencies,
  ArvoDependencyResolver,
  ArvoMechanismHooks,
} from '../types/supplied.js';

/** What one version of a handler is declared as. */
export type ArvoEventHandlerVersionParam<
  TSelf extends VersionedArvoContract,
  TServices extends ArvoServiceMap,
  TDataSchema extends z.$ZodObject,
  TDependencies extends ArvoDependencies,
  TMechanismHooks extends ArvoMechanismHooks,
> = {
  /** This version of the contract implemented, and what it may send to. */
  contracts: {
    self: TSelf;
    services: TServices;
  };

  /**
   * Every option in force, already settled. A version declares only what
   * it wants to differ and inherits the rest, and that resolution happens
   * before one of these exists.
   */
  options: ArvoEventHandlerOptions;

  /**
   * The schema governing what this version remembers. One remembering
   * nothing in particular declares a loose object rather than none.
   */
  state: TDataSchema;

  /** This version's business code. */
  execute: ArvoEventHandlerExecutor<
    TSelf,
    TServices,
    TDataSchema,
    TDependencies,
    TMechanismHooks
  >;

  /**
   * The types a mechanism will supply. Read by nothing and stored by
   * nothing; it exists so both can be named.
   */
  types?: ArvoDeclaredTypes<TDependencies, TMechanismHooks>;
};

/** What one execution to this version brings with it. */
export type ArvoEventHandlerVersionExecuteParam<
  TSelf extends VersionedArvoContract,
  TServices extends ArvoServiceMap,
  TDataSchema extends z.$ZodObject,
  TDependencies extends ArvoDependencies,
  TMechanismHooks extends ArvoMechanismHooks,
> = {
  /** How the handler classified it. */
  entry: ArvoEntryKind;
  /** The event that caused it. */
  event: ArvoTriggeringEvent<TSelf, TServices>;
  /**
   * What the store held, already parsed, or `null` where this execution
   * has no record yet. Hydrating it against this version's schema is this
   * version's, which is why it arrives unhydrated.
   */
  state: JSONObject | null;
  /** The execution, derived before the store was consulted. */
  executionId: string;
  /** Which attempt this is, counting from 0. */
  attempt: number;
  /** A value, or a factory called once for this execution. */
  dependencies: ArvoDependencyResolver<TDependencies, TDataSchema>;
  /** Whatever this mechanism exposes to an executor. */
  hooks: TMechanismHooks;
  /** This execution's telemetry, built by whatever runs the handler. */
  telemetry: ArvoExecutionContextTelemetry;
};

/** Why a gate step refuses an execution. */
export type ArvoGateRefusal = {
  /** Which fault this becomes. */
  readonly faultKind: ArvoFaultKind;
  /** What was wrong, readable without this source at hand. */
  readonly message: string;
  /** Every check that failed, where more than one was evaluated. */
  readonly violations: readonly string[];
};
