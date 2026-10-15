import type { ArvoContract } from '../../ArvoContract/index.js';
import { ErrorIssue } from '../../utils/error-issue.js';
import { pathSegmentForKey } from '../../utils/issue-path.js';
import type { ArvoServiceMap } from '../types/services.js';

/**
 * Judges whether any two of a handler's capabilities share an event type.
 *
 * An emitted event's destination comes from its type alone, so two
 * capabilities sharing one leave the handler unable to say where an event
 * was meant to go. Three ways it can happen: two services taking in the
 * same type, a service's type matching one of a version's outputs, and a
 * service's type matching a version's handler error type.
 *
 * Judged per version, because the capability set is per version: the
 * services are shared, the outputs and the handler error type are not. A
 * clash between two services is judged once, since it holds whichever
 * version is running.
 *
 * Declaring the handler's own contract as a service collides with nothing
 * by construction, so recursion is left alone.
 *
 * @param contract - The contract being implemented, across every version.
 * @param services - The contracts this handler may send to, under the
 * local names it gave them.
 * @returns One issue per clash, naming the type and both sides of it.
 *
 * @example
 * ```typescript
 * checkCollisions(orderContract, { payments });
 * ```
 */
export const checkCollisions = (
  contract: ArvoContract,
  services: ArvoServiceMap,
): ErrorIssue[] => {
  const issues: ErrorIssue[] = [];

  const serviceNameByType = new Map<string, string>();
  for (const [localName, service] of Object.entries(services)) {
    const already = serviceNameByType.get(service.type);
    if (already === undefined) {
      serviceNameByType.set(service.type, localName);
      continue;
    }
    issues.push(
      new ErrorIssue({
        path: `services${pathSegmentForKey(localName)}`,
        message: `takes in '${service.type}', which '${already}' also takes in. An emitted event is addressed by its type alone, so two services sharing one leave nothing to say which was meant`,
      }),
    );
  }

  for (const [version, declared] of Object.entries(contract.versions)) {
    const path = `versions${pathSegmentForKey(version)}`;

    for (const output of Object.keys(declared.outputs)) {
      const localName = serviceNameByType.get(output);
      if (localName === undefined) continue;
      issues.push(
        new ErrorIssue({
          path,
          message: `answers with '${output}', which the service '${localName}' also takes in. An emitted event is addressed by its type alone, so the handler could not say whether this answers its caller or asks that service`,
        }),
      );
    }

    const errorType = declared.error.type;
    const localName = serviceNameByType.get(errorType);
    if (localName === undefined) continue;
    issues.push(
      new ErrorIssue({
        path,
        message: `reports failure as '${errorType}', which the service '${localName}' also takes in. An emitted event is addressed by its type alone, so the handler could not say whether this reports a failure or asks that service`,
      }),
    );
  }

  return issues;
};
