import { ErrorIssue } from '../../utils/error-issue.js';
import type { ArvoServiceMap } from '../types/services.js';
import { at } from './at.js';

/**
 * Reports two services that are versions of the same contract.
 *
 * Identity is the contract's `uri`, not its `type`, because two versions of
 * one contract share a type and would otherwise be reported only as a type
 * collision — a true but unhelpful diagnosis for the case an author is most
 * likely to reach for deliberately.
 *
 * A response's `dataschema` names the service's version, and a handler has
 * exactly one declared version to check it against. With two there is
 * nothing to check against and no way to tell the two services' answers
 * apart.
 */
export const checkServices = (services: ArvoServiceMap): ErrorIssue[] => {
  const byUri = new Map<string, string[]>();
  for (const [name, contract] of Object.entries(services)) {
    byUri.set(contract.uri, [...(byUri.get(contract.uri) ?? []), name]);
  }

  return [...byUri.entries()]
    .filter(([, names]) => names.length > 1)
    .map(
      ([uri, names]) =>
        new ErrorIssue({
          path: `services${at(names[names.length - 1] as string)}`,
          message: `must not be a second version of a contract already declared as ${names
            .slice(0, -1)
            .join(', ')}, a response naming only the service's own version`,
          received: uri,
        }),
    );
};
