import type * as z from 'zod/v4/core';
import type { ArvoSemanticVersion } from '../semver/index.js';
import type { JSONObject } from '../types.js';

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
