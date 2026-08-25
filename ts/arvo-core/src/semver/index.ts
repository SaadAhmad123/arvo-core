import { err, ok } from 'neverthrow';
import { fromNeverthrow } from '../result.js';
import type { Result } from '../types.js';
import { ErrorIssue } from '../utils/error-issue.js';
import { ArvoSemanticVersionCheckError } from './errors.js';

/**
 * A semantic version as Arvo uses it: `MAJOR.MINOR.PATCH`, each a
 * non-negative integer without leading zeros.
 *
 * Deliberately narrower than the SemVer 2.0.0 grammar — no prerelease
 * (`-beta.1`), no build metadata (`+2024`), no `v` prefix, no partial
 * `MAJOR.MINOR`. Arvo versions identify a contract, and a contract either
 * is or is not the one a peer expects; there is no channel for the extra
 * grammar to mean anything.
 *
 * This alias is the closest TypeScript can express, and it is looser than
 * the real rule: `${number}` also admits forms like `'-1.0.0'` and
 * `'1e3.0.0'`. {@link ArvoSemanticVersion.check} is the authority on what
 * actually counts — the type documents the shape, the check enforces it.
 */
export type ArvoSemanticVersion = `${number}.${number}.${number}`;

/**
 * A single segment: `0`, or a digit run that does not start with `0`.
 *
 * Matches `DEPTH_GRAMMAR`, so the two numeric grammars in this package agree
 * that `01` is not a way of writing `1`.
 */
const SEGMENT_GRAMMAR = /^(0|[1-9]\d*)$/;

/**
 * Any character that is not an ASCII digit.
 *
 * `\d` is ASCII-only in JavaScript absent an explicit Unicode property,
 * which is what we want: Arabic-Indic and fullwidth digits are not `0`-`9`
 * and do not belong in a version.
 */
const NON_DIGIT = /[^0-9]/;

/** The three segments, in order, named as they are reported. */
const SEGMENT_NAMES = ['major', 'minor', 'patch'] as const;

/**
 * Diagnoses one segment, or returns `null` if it is well-formed.
 *
 * Ordered widest fault first, so the message describes the reason a reader
 * would give: an empty segment is not "a leading zero problem", and `'0x3'`
 * is a character problem rather than a leading-zero one.
 */
const diagnoseSegment = (path: string, segment: string): ErrorIssue | null => {
  if (segment === '')
    return new ErrorIssue({ path, message: 'must not be empty' });
  if (NON_DIGIT.test(segment))
    return new ErrorIssue({
      path,
      message: 'must contain only the digits 0-9',
      received: segment,
    });
  if (!SEGMENT_GRAMMAR.test(segment))
    return new ErrorIssue({
      path,
      message: 'must not have leading zeros',
      received: segment,
    });
  return null;
};

/**
 * Checks `data` against the version grammar, reporting the outcome as a
 * value rather than throwing.
 *
 * Staged, because a single anchored pattern can only answer yes or no: each
 * stage knows something the next one has already thrown away. A non-string
 * has no segments to discuss, and segments cannot be called `major` or
 * `patch` until there are exactly three of them — so those two faults report
 * alone. Once the shape holds, every bad segment is reported together.
 */
const tryCheck = (
  data: unknown,
): Result<ArvoSemanticVersion, ArvoSemanticVersionCheckError> => {
  if (typeof data !== 'string') {
    return fromNeverthrow(
      err(
        new ArvoSemanticVersionCheckError([
          new ErrorIssue({
            path: 'version',
            message: 'must be a string',
            received: data,
          }),
        ]),
      ),
    );
  }

  const segments = data.split('.');
  if (segments.length !== 3) {
    return fromNeverthrow(
      err(
        new ArvoSemanticVersionCheckError([
          new ErrorIssue({
            path: 'version',
            message: `must have exactly three '.'-separated segments, found ${segments.length}`,
            received: data,
          }),
        ]),
      ),
    );
  }

  const issues = SEGMENT_NAMES.map((name, index) =>
    diagnoseSegment(name, segments[index] as string),
  ).filter((issue): issue is ErrorIssue => issue !== null);

  if (issues.length > 0) {
    return fromNeverthrow(err(new ArvoSemanticVersionCheckError(issues)));
  }

  return fromNeverthrow(ok(data as ArvoSemanticVersion));
};

/**
 * Whether `data` is a valid {@link ArvoSemanticVersion}.
 *
 * Narrows at the call site, so a value that passes needs no cast. Answers
 * only yes or no — reach for {@link tryCheck} where the caller has to be
 * told what is wrong.
 *
 * Delegates to `tryCheck` and discards the error rather than keeping a
 * second copy of the grammar, which could not then disagree with the first.
 * The cost is an object allocation per call.
 */
const check = (data: unknown): data is ArvoSemanticVersion => tryCheck(data).ok;

/**
 * The runtime authority on {@link ArvoSemanticVersion}, sharing the type's
 * name: `ArvoSemanticVersion` in a type position is the template literal, in
 * a value position it is this.
 *
 * Versions arrive from event fields, wire payloads, and configuration as
 * `unknown`, where a compile-time alias constrains nothing. These are the
 * boundary checks that earn the type.
 *
 * Segments are unbounded in length, so a version may hold digits well past
 * `Number.MAX_SAFE_INTEGER`. Harmless here, because this only ever inspects
 * the string and never converts it — but a passing value is not, on that
 * basis alone, safe to parse into a `number`.
 *
 * @example
 * ArvoSemanticVersion.check('1.2.3');      // true
 * ArvoSemanticVersion.check('01.2.3');     // false — leading zero
 * ArvoSemanticVersion.check('1.2');        // false — too few segments
 * ArvoSemanticVersion.check('v1.2.3');     // false — prefix
 * ArvoSemanticVersion.check(123);          // false — not a string
 *
 * @example
 * const result = ArvoSemanticVersion.tryCheck('1.x.y');
 * if (!result.ok) {
 *   result.error.issues; // both the minor and patch faults
 * }
 */
export const ArvoSemanticVersion = Object.freeze({ check, tryCheck });
