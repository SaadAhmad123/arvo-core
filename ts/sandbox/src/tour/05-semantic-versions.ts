/**
 * `ArvoSemanticVersion` is one name in two places: a type when you annotate
 * with it, a checker when you call it. One import covers both.
 *
 * The grammar is narrower than SemVer 2.0.0 -- three non-negative integers,
 * no leading zeros, no `-beta.1`, no `+build`, no `v` prefix. A version
 * identifies a contract, and there is nothing for the extra grammar to mean.
 */

import { ArvoSemanticVersion } from 'arvo-core';
import { type Chapter, heading, indent } from '../display.js';

/** Type position: only literals of the right shape are assignable. */
const asAType = (): void => {
  heading('as a type');

  const pinned: ArvoSemanticVersion = '1.4.0';
  // const wrong: ArvoSemanticVersion = "1.4"; // compile error
  console.log('pinned:', pinned);
};

/** Value position: a narrowing guard, for when you just need yes or no. */
const asAGuard = (): void => {
  heading('as a guard');

  const fromConfig: unknown = process.env.CONTRACT_VERSION ?? '2.0.1';
  if (ArvoSemanticVersion.check(fromConfig)) {
    // `fromConfig` is ArvoSemanticVersion here, no cast needed.
    const [major] = fromConfig.split('.');
    console.log('check passed, major:', major);
  }

  for (const candidate of ['1.2.3', '0.0.0', '01.2.3', '1.2', 'v1.2.3']) {
    console.log(
      `  check(${JSON.stringify(candidate)}) ->`,
      ArvoSemanticVersion.check(candidate),
    );
  }
};

/**
 * Result position: when the caller has to be *told* what is wrong. The error
 * names every broken rule, not just the first.
 */
const asAResult = (): void => {
  heading('as a Result');

  const bad = ArvoSemanticVersion.tryCheck('01..z');
  if (!bad.ok) {
    console.log(indent(bad.error.message));
    console.log('\nas data:');
    for (const issue of bad.error.issues) {
      console.log(`  ${issue.path}: ${issue.message}`);
    }
  }

  // A non-string is a single issue -- there are no segments to talk about.
  const notAString = ArvoSemanticVersion.tryCheck(123);
  if (!notAString.ok) {
    console.log(`\nnon-string, ${notAString.error.issues.length} issue:`);
    console.log(indent(notAString.error.message));
  }
};

export const chapter: Chapter = {
  title: '05. Semantic versions',
  run: () => {
    asAType();
    asAGuard();
    asAResult();
  },
};
