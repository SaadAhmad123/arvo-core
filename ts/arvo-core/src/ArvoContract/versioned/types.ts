import type { ArvoSemanticVersion } from '../../semver/index.js';
import type { JSONObject } from '../../types.js';
import type { ArvoContractVersionParam } from '../types.js';

/**
 * Input for `new VersionedArvoContract(...)`.
 *
 * Usually you do not build one of these: declare an `ArvoContract` and read
 * `contract.versions['1.0.0']`. Everything here is already resolved, so
 * constructing one directly means supplying the defaults yourself.
 *
 * @template T - The contract's `type`, as a literal.
 * @template V - This contract's version, as a literal.
 * @template C - This version's `accepts`/`emits` types.
 */
export type VersionedArvoContractParam<
  T extends string = string,
  V extends ArvoSemanticVersion = ArvoSemanticVersion,
  C extends ArvoContractVersionParam = ArvoContractVersionParam,
> = {
  type: T;
  version: V;
  uri: string;
  description: string | null;
  domain: string | null;
  metadata: JSONObject;
  accepts: C['accepts'];
  emits: C['emits'];
};
