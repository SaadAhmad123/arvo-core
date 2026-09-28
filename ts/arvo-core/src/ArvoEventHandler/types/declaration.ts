import type * as z from 'zod/v4/core';
import type { ArvoContractVersionMapParam } from '../../ArvoContract/types.js';
import type { ArvoSemanticVersion } from '../../semver/index.js';
import type { ArvoEventHandlerExecutor } from './executor.js';
import type { ArvoEventHandlerOptions } from './options.js';
import type { ArvoServiceMap } from './services.js';
import type { ArvoDependencies, ArvoMechanismHooks } from './supplied.js';

/**
 * One version's declaration, where it has more to say than its executor.
 *
 * A version with nothing to say beyond its executor is declared as that
 * executor alone.
 */
export type ArvoVersionDeclaration<
  T extends string,
  M extends ArvoContractVersionMapParam,
  V extends keyof M & ArvoSemanticVersion,
  X extends ArvoServiceMap,
  D extends ArvoDependencies,
  H extends ArvoMechanismHooks,
  S extends z.$ZodObject | undefined = undefined,
> = {
  /**
   * What this version remembers between deliveries. Omit it for a version
   * that remembers nothing, and its executor will have no state to reach.
   *
   * Once a version is deployed and has records stored, every change to this
   * schema must stay compatible with what those records already hold. The
   * protocol cannot check that for you, and an incompatible change fails
   * every execution of that version still in flight.
   */
  state?: S;
  /** Only what differs from the handler's. Anything omitted is inherited. */
  options?: Partial<ArvoEventHandlerOptions>;
  /** Business code for this version. */
  execute: ArvoEventHandlerExecutor<T, M, V, X, S, D, H>;
};

/** A version declared either way: as a declaration, or as its executor alone. */
export type ArvoVersionInput<
  T extends string,
  M extends ArvoContractVersionMapParam,
  V extends keyof M & ArvoSemanticVersion,
  X extends ArvoServiceMap,
  D extends ArvoDependencies,
  H extends ArvoMechanismHooks,
  S extends z.$ZodObject | undefined = undefined,
> =
  | ArvoVersionDeclaration<T, M, V, X, D, H, S>
  | ArvoEventHandlerExecutor<T, M, V, X, undefined, D, H>;

/**
 * A version made by `createArvoEventHandlerVersion`, carrying the version it
 * was made for so a setup needs no second copy of it.
 */
export type ArvoCreatedVersion<
  T extends string,
  M extends ArvoContractVersionMapParam,
  V extends keyof M & ArvoSemanticVersion,
  X extends ArvoServiceMap,
  D extends ArvoDependencies,
  H extends ArvoMechanismHooks,
  S extends z.$ZodObject | undefined = undefined,
> = {
  readonly version: V;
  readonly declaration: ArvoVersionDeclaration<T, M, V, X, D, H, S>;
};
