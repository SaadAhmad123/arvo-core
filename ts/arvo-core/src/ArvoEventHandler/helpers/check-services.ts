import { ErrorIssue } from '../../utils/error-issue.js';
import { pathSegmentForKey } from '../../utils/issue-path.js';
import type { ArvoServiceMap } from '../types/services.js';

/**
 * Judges whether a handler declared one contract as two dependencies.
 *
 * A service is one contract at one version. Declaring the same contract
 * twice gives the handler two dependencies it cannot tell apart: a
 * response names its service's version in `dataschema`, which is checked
 * against the one version declared for that contract, and with two
 * declared there is nothing to check against.
 *
 * The contract is identified by `uri`, which names it independently of
 * which version was declared, so the same contract at two versions is
 * caught as readily as the same contract twice over.
 *
 * Declaring the handler's own contract as a service is not this rule's
 * concern — that is how a handler recurses, and it is permitted.
 *
 * @param services - The contracts this handler may send to, under the
 * local names it gave them.
 * @returns One issue per repeat, naming what it repeats.
 *
 * @example
 * ```typescript
 * checkServices({ payments, shipping });
 * ```
 */
export const checkServices = (services: ArvoServiceMap): ErrorIssue[] => {
  const issues: ErrorIssue[] = [];
  const firstDeclaredAs = new Map<string, string>();

  for (const [localName, service] of Object.entries(services)) {
    const already = firstDeclaredAs.get(service.uri);
    if (already === undefined) {
      firstDeclaredAs.set(service.uri, localName);
      continue;
    }

    issues.push(
      new ErrorIssue({
        path: `services${pathSegmentForKey(localName)}`,
        message: `declares ${service.uri} a second time, already declared as '${already}'. A service is one contract at one version, and a response names only its own version, so two declarations of one contract leave nothing to check it against`,
      }),
    );
  }

  return issues;
};
