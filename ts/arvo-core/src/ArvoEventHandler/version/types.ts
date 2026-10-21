import type * as z from 'zod/v4/core';
import type { VersionedArvoContract } from '../../ArvoContract/versioned/index.js';
import type { JSONObject } from '../../types.js';
import type { ArvoExecutionContextTelemetry } from '../context/telemetry/index.js';

import type { ArvoFaultKind } from '../fault/types.js';
import type { IArvoEventHandlerDependency } from '../types/dependency.js';
import type {
  ArvoEventHandlerExecutor,
  ArvoExecutorEmission,
} from '../types/execute.js';
import type { ArvoEventHandlerMiddlewareEntry } from '../types/middleware.js';
import type { ArvoEventHandlerOptions } from '../types/options.js';
import type {
  ArvoAnyServiceResponse,
  ArvoInitEvent,
  ArvoServiceMap,
} from '../types/services.js';
import type {
  ArvoDeclaredTypes,
  ArvoDependencies,
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

  /**
   * Whether that schema is one this version's author wrote.
   *
   * A version that declared none is given one that admits none, and is
   * not expected to write anything: its record rests with no state of
   * its own. One that declared a schema has something to remember, and
   * returning without writing it is a defect rather than a decision.
   */
  declaresState: boolean;

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

  /**
   * The layers the handler declared around every version's executor, or
   * `null` where it declared none. Already judged.
   */
  middleware:
    | readonly ArvoEventHandlerMiddlewareEntry<
        VersionedArvoContract,
        TServices,
        z.$ZodObject,
        TDependencies,
        TMechanismHooks
      >[]
    | null;
};

/** What every execution of a version brings with it, however it arrived. */
type ArvoVersionExecuteCommon<
  TDataSchema extends z.$ZodObject,
  TDependencies extends ArvoDependencies,
  TMechanismHooks extends ArvoMechanismHooks,
> = {
  /** The execution, derived before the store was consulted. */
  executionId: string;
  /** Which attempt this is, counting from 0. */
  attempt: number;
  /**
   * What the executor is given, or `null` where nothing was supplied.
   *
   * `null` rather than absent: the handler normalizes once at its own
   * boundary, so nothing below it has two spellings for nothing.
   *
   * Declared with this version's state schema, so a supplier written for
   * one version is handed a record typed by it. One written for a
   * handler still satisfies this: `open` and `close` are methods, whose
   * parameters TypeScript checks bivariantly.
   */
  dependencies: IArvoEventHandlerDependency<TDependencies, TDataSchema> | null;
  /**
   * Whatever this mechanism exposes to an executor, or `null` where it
   * exposed nothing.
   *
   * `null` rather than absent, and rather than an empty object: the
   * handler normalizes once at its own boundary, and a mechanism that
   * deliberately exposed nothing is then a different fact from one that
   * was never asked.
   */
  hooks: TMechanismHooks | null;
  /**
   * Layers supplied for this execution alone, or `null` where none were.
   * Not yet judged: a way to make one is called, and every identifier
   * checked, before any layer runs.
   */
  middleware:
    | readonly ArvoEventHandlerMiddlewareEntry<
        VersionedArvoContract,
        ArvoServiceMap,
        z.$ZodObject,
        TDependencies,
        TMechanismHooks
      >[]
    | null;
  /** This execution's telemetry, built by whatever runs the handler. */
  telemetry: ArvoExecutionContextTelemetry;

  /**
   * Whether the event itself is one this execution may act on, judged by
   * whoever resolved it.
   *
   * A version is handed an event already resolved to a contract, and
   * judging it against that contract is not a version's to do. What a
   * version owns is *when* it is judged: after the record has had its say
   * about depth, lifecycle, time and addressing, and before anything
   * reads the collection — so a late event reaching a finished execution
   * is refused for being late rather than for what it carries.
   *
   * Omitted, the event is taken as already judged.
   */
  checkEvent?: () => ArvoGateRefusal | null;
};

/**
 * What one execution to this version brings with it.
 *
 * Which entry it is decides what it can possibly carry: an execution that
 * opens one has no record and arrives on the event this version takes in,
 * and one that answers something awaited has a record and arrives on a
 * declared service's answer.
 */
export type ArvoEventHandlerVersionExecuteParam<
  TSelf extends VersionedArvoContract,
  TServices extends ArvoServiceMap,
  TDataSchema extends z.$ZodObject,
  TDependencies extends ArvoDependencies,
  TMechanismHooks extends ArvoMechanismHooks,
> = ArvoVersionExecuteCommon<TDataSchema, TDependencies, TMechanismHooks> &
  (
    | {
        /** This execution opens one. */
        entry: 'init';
        /** The event this version takes in. */
        event: ArvoInitEvent<TSelf>;
        /** No record, this execution being the one that opens it. */
        state: null;
      }
    | {
        /** This execution answers something an execution awaited. */
        entry: 'followup';
        /** What a declared service answered with. */
        event: ArvoAnyServiceResponse<TServices>;
        /**
         * What the store held, already parsed. Hydrating it against this
         * version's schema is this version's, which is why it arrives
         * unhydrated.
         */
        state: JSONObject;
      }
  );

/**
 * How an entry into an executor ended.
 *
 * `outran` says the run clock expired first, which is the one outcome the
 * executor itself does not report: it may still be running, and nothing it
 * does afterwards is accepted.
 */
export type ArvoExecutorRun =
  | {
      readonly kind: 'returned';
      readonly emission: ArvoExecutorEmission;
      /** When the executor returned. */
      readonly returnedAt: number;
    }
  | { readonly kind: 'raised'; readonly thrown: unknown }
  | { readonly kind: 'outran' };

/**
 * Why a check refuses an execution, on the way in or on what it returned.
 *
 * Reported rather than raised, because the checks are readers: what they
 * find becomes a fault one layer up, where the execution it describes is
 * in hand.
 */
export type ArvoGateRefusal = {
  /** Which fault this becomes. */
  readonly faultKind: ArvoFaultKind;
  /** What was wrong, readable without this source at hand. */
  readonly message: string;
  /** The underlying failure, where something underlies it. */
  readonly cause?: string;
  /** Every check that failed, where more than one was evaluated. */
  readonly violations: readonly string[];
  /**
   * Whether another attempt could fix this, where the kind leaves that
   * open. Only `executor_raised` does; every other kind carries the
   * verdict its own vocabulary fixes.
   */
  readonly retryable?: boolean;
};
