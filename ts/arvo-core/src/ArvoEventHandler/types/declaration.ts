import type * as z from 'zod/v4/core';
import type { VersionedArvoContract } from '../../ArvoContract/versioned/index.js';
import type { ArvoSemanticVersion } from '../../semver/index.js';
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
