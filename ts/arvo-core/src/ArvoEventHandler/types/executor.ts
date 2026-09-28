import type * as z from 'zod/v4/core';
import type { ArvoContractVersionMapParam } from '../../ArvoContract/types.js';
import type { ArvoEvent } from '../../ArvoEvent/index.js';
import type { ArvoSemanticVersion } from '../../semver/index.js';
import type { PromiseAble } from '../../types.js';
import type { ArvoExecutionContext } from './context.js';
import type { ArvoServiceMap } from './services.js';
import type { ArvoDependencies, ArvoMechanismHooks } from './supplied.js';

/**
 * Business code for one version.
 *
 * Return the events you want emitted, or nothing to emit nothing. Fail to
 * report that the work could not be done: what escapes becomes the
 * contract's handler error event, which your caller already handles.
 *
 * May be asynchronous or not, and returning nothing is written either way.
 */
export type ArvoEventHandlerExecutor<
  T extends string,
  M extends ArvoContractVersionMapParam,
  V extends keyof M & ArvoSemanticVersion,
  X extends ArvoServiceMap,
  S extends z.$ZodObject | undefined,
  D extends ArvoDependencies,
  H extends ArvoMechanismHooks,
> = (ctx: ArvoExecutionContext<T, M, V, X, S, D, H>) => PromiseAble<
  // biome-ignore lint/suspicious/noConfusingVoidType: an executor returning nothing is a declared outcome of the protocol, not an accident of an ignored return value
  ArvoEvent | ArvoEvent[] | void
>;
