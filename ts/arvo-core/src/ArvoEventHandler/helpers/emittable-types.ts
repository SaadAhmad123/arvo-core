import type { ArvoContract } from '../../ArvoContract/index.js';
import type { ArvoSemanticVersion } from '../../semver/index.js';
import type { ArvoServiceMap } from '../types/services.js';

/**
 * Every event type one version may emit: each declared service's input
 * type, that version's own outputs, and its handler error type.
 *
 * Closed per version and not per handler, because two versions of one
 * contract share the services but differ in what they put out.
 *
 * Built once at declaration. The collision rule reads it, and so does
 * validating what an executor returns.
 */
export const emittableTypes = (
  contract: ArvoContract,
  services: ArvoServiceMap,
  version: ArvoSemanticVersion,
): ReadonlySet<string> => {
  const declared = contract.versions[version];
  return Object.freeze(
    new Set([
      ...Object.values(services).map((service) => service.type),
      ...Object.keys(declared?.outputs ?? {}),
      ...(declared === undefined ? [] : [declared.error.type]),
    ]),
  );
};
