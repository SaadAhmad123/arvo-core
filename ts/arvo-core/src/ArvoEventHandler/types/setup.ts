import type * as z from 'zod/v4/core';
import type { ArvoContract } from '../../ArvoContract/index.js';
import type { ArvoContractVersionMapParam } from '../../ArvoContract/types.js';
import type { ArvoSemanticVersion } from '../../semver/index.js';
import type { ArvoEventHandlerOptions } from './options.js';
import type { ArvoServiceMap } from './services.js';
import type { ArvoDependencies, ArvoMechanismHooks } from './supplied.js';

/**
 * Which versions a declaration has reached, and the state schema each
 * declared. Accumulated one `handler` call at a time.
 */
export type ArvoDeclaredVersions = Record<
  ArvoSemanticVersion,
  z.$ZodObject | undefined
>;

/**
 * Input for `setupArvoEventHandler(...)`, and for `ArvoEventHandler.setup(...)`
 * which is the same thing.
 *
 * Holds everything a handler has exactly one of. Each version is declared
 * after this, one `handler` call at a time, and nothing is checked until
 * `build`.
 */
export type ArvoEventHandlerSetupParam<
  T extends string,
  M extends ArvoContractVersionMapParam,
  X extends ArvoServiceMap,
  D extends ArvoDependencies,
  H extends ArvoMechanismHooks,
> = {
  /**
   * The contract this handler implements. A contract, not a version: every
   * version it declares needs a handler before `build` will accept it.
   */
  contract: ArvoContract<T, M>;
  /**
   * The contracts this handler may send events to, each at exactly one
   * version, under whatever local name you choose.
   *
   * No two may share an event type, with each other or with a version's own
   * outputs or handler error type, and no two may be versions of the same
   * contract. Naming the contract this handler implements is permitted, and
   * is how a handler calls itself.
   */
  services?: X;
  /**
   * Defaults for every version. Omit an option and the protocol's own
   * default fills it.
   */
  options?: Partial<ArvoEventHandlerOptions>;
  /**
   * Types only. Neither member carries a value, neither is stored, and
   * nothing reads them at runtime.
   *
   * They exist so a declaration can say what shape the mechanism running it
   * will supply, since both arrive per delivery and appear nowhere else.
   * Omit either and it is an empty object, so an executor cannot reach for
   * what was never declared.
   */
  types?: Partial<{
    /** What this handler's mechanism exposes to an executor. */
    mechanismHooks: H;
    /** What this handler's executors are given to work with. */
    dependencies: D;
  }>;
};
