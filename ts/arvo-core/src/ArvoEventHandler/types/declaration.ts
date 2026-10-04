import type * as z from 'zod/v4/core';
import type { ArvoContract } from '../../ArvoContract/index.js';
import type { VersionedArvoContract } from '../../ArvoContract/versioned/index.js';
import type { ArvoSemanticVersion } from '../../semver/index.js';
import type { ArvoEventHandlerSetup } from '../setup.js';
import type { ArvoEventHandlerExecutor } from './execute.js';
import type { ArvoEventHandlerOptions } from './options.js';
import type { ArvoServiceMap } from './services.js';
import type { ArvoDependencies, ArvoMechanismHooks } from './supplied.js';

/**
 * What one version of a handler is declared as.
 *
 * @example
 * ```typescript
 * {
 *   state: z.object({ orderId: z.string() }),
 *   options: { maxDepth: 250 },
 *   execute: async (ctx) => ctx.build({ type: 'com_payment_charge', data: { amount: 10 } }),
 * }
 * ```
 */
export type ArvoVersionDeclaration<
  TSelf extends VersionedArvoContract,
  TServices extends ArvoServiceMap,
  TDataSchema extends z.$ZodObject,
  TDependencies extends ArvoDependencies,
  TMechanismHooks extends ArvoMechanismHooks,
> = {
  /**
   * The schema governing what this version remembers between executions.
   *
   * Omit it for a version that remembers nothing: its record then carries
   * no business state, and `ctx.state` has nothing to read.
   */
  state?: TDataSchema;

  /**
   * Only the options this version wants to differ from the handler's.
   *
   * An option left out is inherited. For either timeout, writing `null`
   * is a declaration of its own — unbounded — and not the same as leaving
   * it out.
   */
  options?: Partial<ArvoEventHandlerOptions>;

  /** This version's business code. */
  execute: ArvoEventHandlerExecutor<
    TSelf,
    TServices,
    TDataSchema,
    TDependencies,
    TMechanismHooks
  >;
};

/**
 * A version declared in full, or as its executor alone.
 *
 * The executor alone is shorthand for a declaration with nothing else in
 * it: no state of its own, and every option inherited.
 */
export type ArvoVersionInput<
  TSelf extends VersionedArvoContract,
  TServices extends ArvoServiceMap,
  TDataSchema extends z.$ZodObject,
  TDependencies extends ArvoDependencies,
  TMechanismHooks extends ArvoMechanismHooks,
> =
  | ArvoVersionDeclaration<
      TSelf,
      TServices,
      TDataSchema,
      TDependencies,
      TMechanismHooks
    >
  | ArvoEventHandlerExecutor<
      TSelf,
      TServices,
      TDataSchema,
      TDependencies,
      TMechanismHooks
    >;

/**
 * A version written against whatever contracts and schema, as a chain
 * holds one before it knows which.
 *
 * What the chain settles both input forms through. A caller writes the
 * precise form instead.
 */
export type ArvoAnyVersionInput = ArvoVersionInput<
  VersionedArvoContract,
  ArvoServiceMap,
  z.$ZodObject,
  ArvoDependencies,
  ArvoMechanismHooks
>;

/**
 * One version as a chain has accumulated it, both input forms settled into
 * one shape.
 *
 * Every version carries a state schema, a version declaring none having
 * been given the one that admits no state of its own.
 */
export type ArvoAccumulatedVersion = {
  /** Which version of the self contract this declares. */
  readonly version: ArvoSemanticVersion;
  /** The schema governing what it remembers. */
  readonly state: z.$ZodObject;
  /** Whether that schema is one its author wrote. */
  readonly declaresState: boolean;
  /** What it wanted to differ, or `null` where it wanted nothing to. */
  readonly options: Partial<ArvoEventHandlerOptions> | null;
  /**
   * Its business code.
   *
   * Typed loosely here and nowhere else: each version was accumulated
   * under its own schema and contract version, which no one signature
   * over the whole list can name. Every declaration was checked against
   * its own types at the point it was written.
   */
  readonly execute: ArvoEventHandlerExecutor<any, any, any, any, any>;
};

/** Every version a chain has accumulated, in the order they were declared. */
export type ArvoAccumulatedVersions = readonly ArvoAccumulatedVersion[];

/**
 * A version written away from the chain, carrying the version it is for.
 *
 * Bound to the declaration it was written against, so one written for a
 * different handler will not assemble into this one: its executor was
 * typed by that handler's contracts, and nothing about it would be right
 * here.
 */
export type ArvoCreatedVersion<
  TSelf extends ArvoContract,
  TServices extends ArvoServiceMap,
  TDependencies extends ArvoDependencies,
  TMechanismHooks extends ArvoMechanismHooks,
> = ArvoAccumulatedVersion & {
  /**
   * Which declaration this was written against.
   *
   * Never present at runtime, and never read. It exists so the binding is
   * one the compiler can check, which a shape alone could not be.
   */
  readonly writtenFor: (
    declaration: ArvoEventHandlerSetup<
      TSelf,
      TServices,
      TDependencies,
      TMechanismHooks
    >,
  ) => void;
};
