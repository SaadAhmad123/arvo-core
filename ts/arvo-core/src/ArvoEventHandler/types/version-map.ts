import type * as z from 'zod/v4/core';
import type { ArvoContract } from '../../ArvoContract/index.js';
import type { ArvoSemanticVersion } from '../../semver/index.js';
import type { ArvoEventHandlerVersion } from '../version/index.js';
import type { ArvoServiceMap } from './services.js';
import type { ArvoDependencies, ArvoMechanismHooks } from './supplied.js';

/** One version of a handler, bound to that version of its contract. */
export type ArvoHandlerVersionOf<
  TSelf extends ArvoContract,
  TVersion extends keyof TSelf['versions'] & ArvoSemanticVersion,
  TServices extends ArvoServiceMap,
  TDependencies extends ArvoDependencies,
  TMechanismHooks extends ArvoMechanismHooks,
> = ArvoEventHandlerVersion<
  TSelf['versions'][TVersion],
  TServices,
  z.$ZodObject,
  TDependencies,
  TMechanismHooks
>;

/**
 * Every version of a handler, reachable by the version it runs.
 *
 * A `Map` underneath, retyped at its surface: a handler implements every
 * version its contract declares, so asking for one the contract declares
 * returns a version rather than a version-or-nothing, and asking for one
 * it does not is an error at the line that asked.
 */
export type ArvoVersionMap<
  TSelf extends ArvoContract,
  TServices extends ArvoServiceMap,
  TDependencies extends ArvoDependencies,
  TMechanismHooks extends ArvoMechanismHooks,
> = Omit<
  ReadonlyMap<
    keyof TSelf['versions'] & ArvoSemanticVersion,
    ArvoHandlerVersionOf<
      TSelf,
      keyof TSelf['versions'] & ArvoSemanticVersion,
      TServices,
      TDependencies,
      TMechanismHooks
    >
  >,
  'get'
> & {
  /** The version that runs executions of this version of the contract. */
  get<TVersion extends keyof TSelf['versions'] & ArvoSemanticVersion>(
    version: TVersion,
  ): ArvoHandlerVersionOf<
    TSelf,
    TVersion,
    TServices,
    TDependencies,
    TMechanismHooks
  >;
};
