import type { ArvoContract } from '../../ArvoContract/index.js';
import { ErrorIssue } from '../../utils/error-issue.js';
import { pathSegmentForKey } from '../../utils/issue-path.js';

/**
 * Judges a handler's executors against the versions its contract declares.
 *
 * Three rules, all about the same correspondence. Every version the
 * contract declares needs an executor, because a version without one would
 * accept events it cannot run. No executor may name a version the contract
 * does not declare, because nothing would ever reach it. And no version may
 * be declared twice, because only one of the two could ever run.
 *
 * @param contract - The contract being implemented.
 * @param declaredVersions - Each version an executor was declared for, in
 * the order they were declared, so a repeat is visible.
 * @returns One issue per version in the wrong, in the order found.
 *
 * @example
 * ```typescript
 * checkVersions(orderContract, ['1.0.0', '1.1.0']);
 * ```
 */
export const checkVersions = (
  contract: ArvoContract,
  declaredVersions: readonly string[],
): ErrorIssue[] => {
  const issues: ErrorIssue[] = [];
  const declaredTimes = new Map<string, number>();
  for (const version of declaredVersions) {
    declaredTimes.set(version, (declaredTimes.get(version) ?? 0) + 1);
  }

  // keyed, so every repeat of one version is one issue rather than one
  // issue per repeat under the same path; insertion order is declaration
  // order
  for (const [version, times] of declaredTimes) {
    const path = `versions${pathSegmentForKey(version)}`;

    if (times > 1) {
      issues.push(
        new ErrorIssue({
          path,
          message: `is declared ${times} times — a version runs under exactly one executor, and nothing would choose among them`,
        }),
      );
      continue;
    }

    if (!(version in contract.versions)) {
      issues.push(
        new ErrorIssue({
          path,
          message: `is not a version ${contract.type} declares, so nothing would ever be delivered to this executor. Declared versions are ${Object.keys(contract.versions).join(', ')}`,
        }),
      );
    }
  }

  for (const version of Object.keys(contract.versions)) {
    if (declaredTimes.has(version)) continue;
    issues.push(
      new ErrorIssue({
        path: `versions${pathSegmentForKey(version)}`,
        message: `has no executor — ${contract.type} declares this version, and a handler implements every version its contract declares`,
      }),
    );
  }

  return issues;
};
