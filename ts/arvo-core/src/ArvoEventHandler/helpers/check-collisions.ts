import type { ArvoContract } from '../../ArvoContract/index.js';
import type { ArvoSemanticVersion } from '../../semver/index.js';
import { ErrorIssue } from '../../utils/error-issue.js';
import type { ArvoServiceMap } from '../types/services.js';
import { at } from './at.js';

/** Where a type came from, so a collision can name both sides. */
type Source = { where: string; label: string };

const sourcesFor = (
  contract: ArvoContract,
  services: ArvoServiceMap,
  version: ArvoSemanticVersion,
): Map<string, Source[]> => {
  const found = new Map<string, Source[]>();
  const add = (type: string, source: Source): void => {
    found.set(type, [...(found.get(type) ?? []), source]);
  };

  for (const [name, service] of Object.entries(services)) {
    add(service.type, {
      where: `services${at(name)}`,
      label: `the input of service ${name}`,
    });
  }

  const declared = contract.versions[version];
  if (declared !== undefined) {
    for (const type of Object.keys(declared.outputs)) {
      add(type, {
        where: `versions${at(version)}`,
        label: 'an output of this version',
      });
    }
    add(declared.error.type, {
      where: `versions${at(version)}`,
      label: "this version's handler error",
    });
  }

  return found;
};

/**
 * Reports two capabilities of one version sharing an event type.
 *
 * An emitted event's destination is decided by its type, so two capabilities
 * answering to one type leave the handler unable to say which was meant.
 * Checked per version, the emittable set being a version's and not a
 * handler's.
 *
 * Naming the implemented contract among the services is not a collision.
 * A contract's own type, its outputs keys and its handler error type are
 * disjoint by ADR-005, so a handler declaring itself as a service collides
 * with nothing, which is what lets one recurse.
 *
 * @param contract - The contract implemented.
 * @param services - The services declared.
 * @param versions - The versions to check, each judged on its own.
 */
export const checkCollisions = (
  contract: ArvoContract,
  services: ArvoServiceMap,
  versions: readonly ArvoSemanticVersion[],
): ErrorIssue[] =>
  versions.flatMap((version) =>
    [...sourcesFor(contract, services, version).entries()]
      .filter(([, sources]) => sources.length > 1)
      .map(([type, sources]) => {
        const last = sources[sources.length - 1] as Source;
        const earlier = sources.slice(0, -1).map((s) => s.label);
        return new ErrorIssue({
          path: last.where,
          message: `must not share the event type '${type}' with ${earlier.join(
            ' and ',
          )}, an emitted event's destination being decided by its type`,
          received: type,
        });
      }),
  );
