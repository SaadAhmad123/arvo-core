import type * as z from 'zod/v4/core';
import type { ArvoContract } from '../../ArvoContract/index.js';
import type { ErrorIssue } from '../../utils/error-issue.js';

/**
 * Zod's own conversion parameters, as far as this serializer exposes them.
 *
 * `target` is absent deliberately: the canonical form is JSON Schema 2020-12,
 * and a form emitted against another dialect is not a canonical form.
 *
 * `metadata` is absent too. Contracts carry `.meta()` annotations straight
 * through, and what an author annotates their own schemas with is theirs to
 * decide.
 *
 * `override` is available, and is how this serializer finds what a crossing
 * cost. Supplying your own replaces that inspection, so nothing is reported
 * for that conversion. Substituting a stand-in for a construct JSON Schema
 * cannot express also implies a check the form does not actually make, which
 * the canonical form must never do — either way, a caller who reaches for
 * this option owns the consequence.
 */
export type ArvoContractSerializeOptions = Pick<
  Parameters<typeof z.toJSONSchema>[1] & object,
  'unrepresentable' | 'io' | 'cycles' | 'reused' | 'uri' | 'override'
>;

/**
 * Options for {@link ArvoContractSerializer}, keyed by direction.
 *
 * Nested rather than flat so that reading a form can gain its own options
 * later without changing the shape of this one. Nothing about reading is
 * configurable today, so there is no `deserialize` key yet.
 */
export type ArvoContractSerializerOptions = {
  /** How a contract is converted on its way out. */
  serialize?: ArvoContractSerializeOptions;
};

/**
 * What a crossing cost, reported the same way in either direction.
 *
 * A constraint JSON Schema 2020-12 cannot carry is omitted rather than
 * approximated, so a loss is the expected outcome of some crossings rather
 * than a failure. Both fields describe the same losses; neither is a summary
 * of a subset.
 */
export type ArvoContractSerializerWarnings = {
  /** Every constraint dropped or demoted. Empty when nothing was lost. */
  readonly warnings: readonly ErrorIssue[];
  /**
   * The same losses as one message, or `null` when there were none — so the
   * usual case is one falsy check rather than a length comparison.
   */
  readonly warningString: string | null;
};

/** A contract's canonical form, and what producing it cost. */
export type SerializedArvoContract = ArvoContractSerializerWarnings & {
  /** The canonical form, as JSON. */
  readonly schema: string;
};

/** A contract read from a canonical form, and what reading it cost. */
export type DeserializedArvoContract = ArvoContractSerializerWarnings & {
  /**
   * The reconstructed contract.
   *
   * Its literal types are not those of the contract that produced the form —
   * a canonical form carries no TypeScript, so version keys and payload
   * shapes arrive as their widened types.
   */
  readonly contract: ArvoContract;
};
