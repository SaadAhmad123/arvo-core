import type { ArvoContract } from '../../ArvoContract/index.js';
import type { ArvoSemanticVersion } from '../../semver/index.js';
import { ErrorIssue } from '../../utils/error-issue.js';
import { at } from './at.js';

/**
 * Reports every version the contract declares that has no handler, and every
 * handler declared for a version the contract does not.
 *
 * Both directions, because each is a different mistake: the first leaves an
 * execution nothing can resume, and the second is code that will never run.
 *
 * @param contract - The contract implemented.
 * @param declared - The versions a declaration reached, in the order it
 * reached them.
 */
export const checkVersions = (
  contract: ArvoContract,
  declared: readonly ArvoSemanticVersion[],
): ErrorIssue[] => {
  const expected = Object.keys(contract.versions) as ArvoSemanticVersion[];
  const seen = new Set(declared);

  const missing = expected
    .filter((version) => !seen.has(version))
    .map(
      (version) =>
        new ErrorIssue({
          path: `versions${at(version)}`,
          message: `must be declared, the contract declaring it and every version needing a handler`,
        }),
    );

  const unknown = declared
    .filter((version) => !(version in contract.versions))
    .map(
      (version) =>
        new ErrorIssue({
          path: `versions${at(version)}`,
          message: `must be a version the contract declares, which are ${expected.join(', ')}`,
          received: version,
        }),
    );

  return [...missing, ...unknown];
};

/**
 * Reports a version declared more than once.
 *
 * Reachable only because versions arrive one at a time: a later declaration
 * would silently replace an earlier one, and which of two executors runs is
 * not something to decide by ordering.
 */
export const checkVersionsDeclaredOnce = (
  declared: readonly ArvoSemanticVersion[],
): ErrorIssue[] => {
  const seen = new Set<ArvoSemanticVersion>();
  const repeated = new Set<ArvoSemanticVersion>();
  for (const version of declared) {
    if (seen.has(version)) repeated.add(version);
    seen.add(version);
  }
  return [...repeated].map(
    (version) =>
      new ErrorIssue({
        path: `versions${at(version)}`,
        message: 'must be declared once, and was declared more than once',
        received: version,
      }),
  );
};
