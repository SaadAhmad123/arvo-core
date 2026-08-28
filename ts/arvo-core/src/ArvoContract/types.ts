import type * as z from 'zod/v4/core';
import type { ArvoEvent } from '../ArvoEvent/index.js';
import type { ArvoSemanticVersion } from '../semver/index.js';
import type { JSONObject } from '../types.js';
import type { HandlerErrorPayload } from './handler-error.js';

/** What one version of a contract accepts, and every event type it may emit. */
export type ArvoContractVersionParam = {
  /** The payload a handler bound to this version receives. */
  accepts: z.$ZodObject;
  /**
   * Every event type this version may produce, keyed by event type. May be
   * empty. The handler error is always available and is not listed here.
   */
  emits: Record<string, z.$ZodObject>;
};

/**
 * Constraint for a `versions` map. Do not annotate a map with this type.
 *
 * Annotating widens the keys and you lose two things: an undeclared version
 * stops being a compile error, and every version's `accepts` collapses to
 * the same type, so `z.infer` no longer differs between versions. Pass the
 * map inline, or hold it in a `const` with no type annotation.
 */
export type ArvoContractVersionMapParam = Record<
  ArvoSemanticVersion,
  ArvoContractVersionParam
>;

/**
 * Input for `new ArvoContract(...)`.
 *
 * @template T - The contract's `type`, as a literal.
 * @template M - The `versions` map, as written, so each version keeps its
 * own schema types.
 */
export type ArvoContractParam<
  T extends string = string,
  M extends ArvoContractVersionMapParam = ArvoContractVersionMapParam,
> = {
  /** The event type a handler bound to this contract accepts. */
  type: T;
  /**
   * Base of every `dataschema` this contract's versions produce. Defaults
   * to `type` with every `_` replaced by `/`, prefixed with `#/`, so
   * `com_payment_process` gives `#/com/payment/process`.
   */
  uri?: string;
  /** Human-readable note. Arvo never reads it. Defaults to `null`. */
  description?: string;
  /** Default domain for events built from this contract. Defaults to `null`. */
  domain?: string;
  /** Free-form JSON for your own tooling. Arvo never reads it. Defaults to `{}`. */
  metadata?: JSONObject;
  /** At least one. Versions are independent -- none inherits from another. */
  versions: M;
};

/**
 * Which of a version's three declared shapes an event belongs to.
 *
 * Not a property of the event: an event carries a `type`, and that type
 * means nothing until a contract is named. This is where the event sits
 * within one version's declaration.
 */
export type ArvoContractEventAssertionScope =
  | 'accepts'
  | 'emits'
  | 'handlerError';

/**
 * What an assertion reports when no type was expected.
 *
 * `event` is unparameterised deliberately. Which shape matched is a runtime
 * fact here, so the payload type stays unknown until a caller says which
 * shape they expect. Read {@link scope} to find out which one it was.
 */
export type AssertedArvoEvent<V extends ArvoSemanticVersion> = {
  /** The version whose declaration the event was checked against. */
  readonly version: V;
  /** Which of that version's three shapes the event belongs to. */
  readonly scope: ArvoContractEventAssertionScope;
  /** The event that was asserted, unchanged. */
  readonly event: ArvoEvent;
};

/**
 * What an assertion reports when a type was expected.
 *
 * The same event as {@link AssertedArvoEvent}, described more precisely:
 * `scope` is the one scope that type belongs to, and the payload is the one
 * its schema declares. Nothing was rebuilt to earn either.
 */
export type NarrowedAssertedArvoEvent<
  V extends ArvoSemanticVersion,
  E extends string,
  S extends ArvoContractEventAssertionScope,
  D extends Record<string, any>,
> = {
  /** The version whose declaration the event was checked against. */
  readonly version: V;
  /** The scope the expected type belongs to. */
  readonly scope: S;
  /** The event that was asserted, unchanged. */
  readonly event: ArvoEvent<E, D>;
};

/**
 * Which scope an expected type belongs to.
 *
 * The contract's `type` can only mean `accepts`, its handler error type can
 * only mean `handlerError`, and an emit key can only mean `emits` — so a
 * caller who named one has already established which, and returning the
 * three-way union would hand back less than they supplied. `never` for a
 * type the version does not declare.
 */
export type ScopeOf<
  E extends string,
  T extends string,
  C extends ArvoContractVersionParam,
> = E extends T
  ? 'accepts'
  : E extends `handler_${T}_error`
    ? 'handlerError'
    : E extends keyof C['emits']
      ? 'emits'
      : never;

/**
 * The payload that goes with an expected type.
 *
 * A schema's input side, not its output side. The event's `data` is returned
 * as it arrived, so a schema carrying a transform or a coercion would have
 * its output type describe a value that was never produced.
 */
export type PayloadFor<
  E extends string,
  T extends string,
  C extends ArvoContractVersionParam,
> = E extends T
  ? z.input<C['accepts']>
  : E extends `handler_${T}_error`
    ? HandlerErrorPayload
    : E extends keyof C['emits']
      ? z.input<C['emits'][E & keyof C['emits']]>
      : never;

/**
 * Every type one version may legitimately carry: its contract's `type`, one
 * of its `emits` keys, or its handler error type.
 *
 * Deliberately not widened with `string`. A union including `string` swallows
 * every literal member and collapses to `string`, giving an expectation that
 * type-checks against anything and narrows nothing — worse than none, because
 * it looks like one.
 */
export type AssertableType<
  T extends string,
  C extends ArvoContractVersionParam,
> = T | (keyof C['emits'] & string) | `handler_${T}_error`;
