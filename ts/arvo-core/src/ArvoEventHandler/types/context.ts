import type * as z from 'zod/v4/core';
import type { ArvoContractVersionMapParam } from '../../ArvoContract/types.js';
import type { ArvoEvent } from '../../ArvoEvent/index.js';
import type { ArvoSemanticVersion } from '../../semver/index.js';
import type { JSONObject } from '../../types.js';
import type { PayloadOf } from './schema.js';
import type { ArvoAnyServiceResponse, ArvoServiceMap } from './services.js';
import type { ArvoDependencies, ArvoMechanismHooks } from './supplied.js';

/** The event that opens an execution of one version. */
export type ArvoInitEvent<
  T extends string,
  M extends ArvoContractVersionMapParam,
  V extends keyof M & ArvoSemanticVersion,
> = ArvoEvent<T, PayloadOf<M[V]['input']>>;

/**
 * A version's business state, and how to replace it.
 *
 * Where the version declared a schema, that schema types both. Where it
 * declared none, state is any JSON object: an executor may still remember
 * whatever it likes between deliveries, and only what survives JSON.
 */
export type ArvoContextState<S extends z.$ZodObject | undefined> = {
  /** What was last written, or `null` until something is. */
  readonly state: ([S] extends [z.$ZodObject] ? z.infer<S> : JSONObject) | null;
  /**
   * Replaces the state whole. There is no partial write: carry forward
   * anything you want to keep. A value the schema rejects, or one that does
   * not survive a JSON round trip, is a fault.
   */
  setState(value: [S] extends [z.$ZodObject] ? z.input<S> : JSONObject): void;
};

/** What every delivery carries, whichever way it arrived. */
export type ArvoContextCore<
  T extends string,
  M extends ArvoContractVersionMapParam,
  V extends keyof M & ArvoSemanticVersion,
  D extends ArvoDependencies,
  H extends ArvoMechanismHooks,
> = {
  /** Which attempt this delivery is, counting from 0. */
  readonly attempt: number;
  /** The event that opened this execution. The delivered event, on an init. */
  readonly initEvent: ArvoInitEvent<T, M, V>;
  /** As resolved for this delivery, or empty where none were declared. */
  readonly dependencies: D;
  /** As this mechanism exposes them, or empty where it exposes none. */
  readonly hooks: H;
};

/**
 * Everything an executor can know, built fresh for one delivery.
 *
 * Read `entry` before `event`: the two are one discriminated value, so an
 * init payload cannot be read as if it were a response, or the reverse.
 *
 * Members governing what an execution may emit, how long it has left, and
 * how it stops arrive alongside the protocol that fills them.
 */
export type ArvoExecutionContext<
  T extends string,
  M extends ArvoContractVersionMapParam,
  V extends keyof M & ArvoSemanticVersion,
  X extends ArvoServiceMap,
  S extends z.$ZodObject | undefined,
  D extends ArvoDependencies,
  H extends ArvoMechanismHooks,
> =
  | (ArvoContextCore<T, M, V, D, H> &
      ArvoContextState<S> & {
        /** This delivery opened the execution. */
        readonly entry: 'init';
        readonly event: ArvoInitEvent<T, M, V>;
      })
  | (ArvoContextCore<T, M, V, D, H> &
      ArvoContextState<S> & {
        /** This delivery answers something the execution was waiting for. */
        readonly entry: 'followup';
        readonly event: ArvoAnyServiceResponse<X>;
      });
