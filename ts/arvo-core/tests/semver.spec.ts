import { describe, expect, it } from 'vitest';
import { ArvoSemanticVersionCheckError } from '../src/semver/errors.js';
import { ArvoSemanticVersion } from '../src/semver/index.js';
import { ErrorIssue } from '../src/utils/error-issue.js';

/** The error of a failed check, or a test failure if it unexpectedly passed. */
const errorOf = (data: unknown): ArvoSemanticVersionCheckError => {
  const result = ArvoSemanticVersion.tryCheck(data);
  if (result.ok) throw new Error(`expected ${String(data)} to be rejected`);
  return result.error;
};

/** The `path: message` lines of a failed check, ignoring `received`. */
const issuesOf = (data: unknown): string[] =>
  errorOf(data).issues.map((issue) => `${issue.path}: ${issue.message}`);

describe('ArvoSemanticVersion.check', () => {
  describe('accepts MAJOR.MINOR.PATCH', () => {
    it('accepts the canonical form', () => {
      expect(ArvoSemanticVersion.check('1.2.3')).toBe(true);
    });

    it('accepts zero segments', () => {
      expect(ArvoSemanticVersion.check('0.0.0')).toBe(true);
      expect(ArvoSemanticVersion.check('1.0.0')).toBe(true);
    });

    it('accepts multi-digit segments', () => {
      expect(ArvoSemanticVersion.check('10.20.30')).toBe(true);
      expect(ArvoSemanticVersion.check('123.456.789')).toBe(true);
    });

    it('accepts segments longer than Number.MAX_SAFE_INTEGER can hold', () => {
      // Shape is the rule, not a numeric reading of it — so this passes even
      // though parsing it would lose precision.
      expect(ArvoSemanticVersion.check('99999999999999999999.0.0')).toBe(true);
      expect(ArvoSemanticVersion.check(`9${'0'.repeat(500)}.0.0`)).toBe(true);
    });
  });

  describe('rejects leading zeros', () => {
    it('rejects a padded segment', () => {
      expect(ArvoSemanticVersion.check('01.2.3')).toBe(false);
      expect(ArvoSemanticVersion.check('1.02.3')).toBe(false);
      expect(ArvoSemanticVersion.check('1.2.003')).toBe(false);
    });

    it('rejects repeated zeros, which are not a way of writing zero', () => {
      expect(ArvoSemanticVersion.check('00.0.0')).toBe(false);
      expect(ArvoSemanticVersion.check('00.00.00')).toBe(false);
    });
  });

  describe('rejects the wrong number of segments', () => {
    it('rejects too few segments', () => {
      expect(ArvoSemanticVersion.check('1')).toBe(false);
      expect(ArvoSemanticVersion.check('1.2')).toBe(false);
    });

    it('rejects too many segments', () => {
      expect(ArvoSemanticVersion.check('1.2.3.4')).toBe(false);
      expect(ArvoSemanticVersion.check('1.2.3.4.5')).toBe(false);
    });

    it('rejects empty segments', () => {
      expect(ArvoSemanticVersion.check('..')).toBe(false);
      expect(ArvoSemanticVersion.check('1..3')).toBe(false);
      expect(ArvoSemanticVersion.check('.2.3')).toBe(false);
      expect(ArvoSemanticVersion.check('1.2.')).toBe(false);
    });
  });

  describe('rejects the wider SemVer 2.0.0 grammar', () => {
    it('rejects a v prefix', () => {
      expect(ArvoSemanticVersion.check('v1.2.3')).toBe(false);
      expect(ArvoSemanticVersion.check('V1.2.3')).toBe(false);
    });

    it('rejects prerelease identifiers', () => {
      expect(ArvoSemanticVersion.check('1.2.3-beta')).toBe(false);
      expect(ArvoSemanticVersion.check('1.2.3-beta.1')).toBe(false);
      expect(ArvoSemanticVersion.check('1.2.3-0')).toBe(false);
    });

    it('rejects build metadata', () => {
      expect(ArvoSemanticVersion.check('1.2.3+2024')).toBe(false);
      expect(ArvoSemanticVersion.check('1.2.3-beta+exp.sha.5114f85')).toBe(
        false,
      );
    });
  });

  describe('rejects numeric forms the type alias admits', () => {
    // These are assignable to ArvoSemanticVersion but are not valid versions.
    // The check, not the alias, is the authority — that gap is why it exists.
    it('rejects signed segments', () => {
      expect(ArvoSemanticVersion.check('-1.2.3')).toBe(false);
      expect(ArvoSemanticVersion.check('1.-2.3')).toBe(false);
      expect(ArvoSemanticVersion.check('+1.2.3')).toBe(false);
    });

    it('rejects exponent notation', () => {
      expect(ArvoSemanticVersion.check('1e3.0.0')).toBe(false);
      expect(ArvoSemanticVersion.check('1.2.3e4')).toBe(false);
    });

    it('rejects a fractional segment, which reads as a fourth segment', () => {
      expect(ArvoSemanticVersion.check('1.5.2.3')).toBe(false);
    });
  });

  describe('rejects anything outside ASCII digits and dots', () => {
    it('rejects non-ASCII decimal digits', () => {
      expect(ArvoSemanticVersion.check('١.٢.٣')).toBe(false); // Arabic-Indic
      expect(ArvoSemanticVersion.check('１.２.３')).toBe(false); // fullwidth
      expect(ArvoSemanticVersion.check('١.2.3')).toBe(false); // mixed
    });

    it('rejects hexadecimal and other letters', () => {
      expect(ArvoSemanticVersion.check('1.2.0x3')).toBe(false);
      expect(ArvoSemanticVersion.check('a.b.c')).toBe(false);
    });

    it('rejects separators other than a dot', () => {
      expect(ArvoSemanticVersion.check('1,2,3')).toBe(false);
      expect(ArvoSemanticVersion.check('1-2-3')).toBe(false);
      expect(ArvoSemanticVersion.check('1_2_3')).toBe(false);
    });
  });

  describe('requires the version to be the whole string', () => {
    it('rejects surrounding whitespace rather than trimming it', () => {
      expect(ArvoSemanticVersion.check(' 1.2.3')).toBe(false);
      expect(ArvoSemanticVersion.check('1.2.3 ')).toBe(false);
      expect(ArvoSemanticVersion.check('\t1.2.3\t')).toBe(false);
    });

    it('rejects a valid version embedded in other text', () => {
      expect(ArvoSemanticVersion.check('version 1.2.3')).toBe(false);
      expect(ArvoSemanticVersion.check('1.2.3 and 4.5.6')).toBe(false);
    });

    it('rejects a newline around an otherwise valid version', () => {
      expect(ArvoSemanticVersion.check('1.2.3\n')).toBe(false);
      expect(ArvoSemanticVersion.check('\n1.2.3')).toBe(false);
    });

    it('rejects the empty string', () => {
      expect(ArvoSemanticVersion.check('')).toBe(false);
    });
  });

  describe('rejects values that are not strings', () => {
    it('rejects nullish values', () => {
      expect(ArvoSemanticVersion.check(null)).toBe(false);
      expect(ArvoSemanticVersion.check(undefined)).toBe(false);
    });

    it('rejects numbers, including ones that stringify to a version', () => {
      expect(ArvoSemanticVersion.check(123)).toBe(false);
      expect(ArvoSemanticVersion.check(1.2)).toBe(false);
      expect(ArvoSemanticVersion.check(Number.NaN)).toBe(false);
    });

    it('rejects objects that stringify to a valid version', () => {
      // No coercion: a String object and an array both render as '1.2.3'.
      expect(ArvoSemanticVersion.check(new String('1.2.3'))).toBe(false);
      expect(ArvoSemanticVersion.check(['1.2.3'])).toBe(false);
      expect(ArvoSemanticVersion.check({ toString: () => '1.2.3' })).toBe(
        false,
      );
    });

    it('rejects other non-string primitives and objects', () => {
      expect(ArvoSemanticVersion.check(true)).toBe(false);
      expect(ArvoSemanticVersion.check(Symbol('1.2.3'))).toBe(false);
      expect(ArvoSemanticVersion.check(123n)).toBe(false);
      expect(ArvoSemanticVersion.check({})).toBe(false);
      expect(ArvoSemanticVersion.check(() => '1.2.3')).toBe(false);
    });
  });

  describe('is a pure predicate', () => {
    it('returns the same answer across repeated calls', () => {
      for (let i = 0; i < 5; i++) {
        expect(ArvoSemanticVersion.check('1.2.3')).toBe(true);
        expect(ArvoSemanticVersion.check('nope')).toBe(false);
      }
    });
  });

  describe('narrows the type at call sites', () => {
    it('narrows unknown to ArvoSemanticVersion inside the guard', () => {
      const value: unknown = '1.2.3';
      if (!ArvoSemanticVersion.check(value))
        throw new Error('expected a version');

      // Compiles only because `value` is now ArvoSemanticVersion, not unknown.
      const [major, minor, patch] = value.split('.');

      expect([major, minor, patch]).toEqual(['1', '2', '3']);
    });
  });
});

describe('ArvoSemanticVersionCheckError', () => {
  // tryCheck never builds one of these with no issues, but the class is
  // exported and a caller can, so it still has to render sensibly.
  it('falls back to the bare heading when constructed with no issues', () => {
    expect(new ArvoSemanticVersionCheckError([]).message).toBe(
      'Value is not a valid ArvoSemanticVersion.',
    );
  });

  it('preserves a cause when one is supplied', () => {
    const cause = new Error('underlying');
    const error = new ArvoSemanticVersionCheckError(
      [new ErrorIssue({ path: 'version', message: 'must be a string' })],
      { cause },
    );
    expect(error.cause).toBe(cause);
  });

  it('omits the received clause when an issue carries no value', () => {
    const error = new ArvoSemanticVersionCheckError([
      new ErrorIssue({ path: 'major', message: 'must not be empty' }),
    ]);
    expect(error.message).toBe(
      [
        'Value is not a valid ArvoSemanticVersion.',
        'The following problem was found:',
        '  - major: must not be empty',
      ].join('\n'),
    );
  });
});

describe('ArvoSemanticVersion.tryCheck', () => {
  describe('on success', () => {
    it('reports ok and carries the version unchanged', () => {
      const result = ArvoSemanticVersion.tryCheck('1.2.3');
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.value).toBe('1.2.3');
    });

    it('narrows the carried value to ArvoSemanticVersion', () => {
      const result = ArvoSemanticVersion.tryCheck('10.0.7' as unknown);
      if (!result.ok) throw new Error('expected ok');

      // Compiles only because `value` is ArvoSemanticVersion, not unknown.
      const [major] = result.value.split('.');

      expect(major).toBe('10');
    });
  });

  describe('on failure', () => {
    it('reports an ArvoSemanticVersionCheckError with a discriminant', () => {
      const error = errorOf('nope');
      expect(error).toBeInstanceOf(ArvoSemanticVersionCheckError);
      expect(error._tag).toBe('ArvoSemanticVersionCheckError');
      expect(error.name).toBe('ArvoSemanticVersionCheckError');
    });

    it('does not throw, it returns', () => {
      expect(() => ArvoSemanticVersion.tryCheck(null)).not.toThrow();
    });

    it('freezes issues so a caller cannot mutate the report', () => {
      const { issues } = errorOf('nope');
      expect(Object.isFrozen(issues)).toBe(true);
    });
  });

  describe('names the whole-value faults', () => {
    it('reports a non-string as a single issue and stops there', () => {
      expect(issuesOf(123)).toEqual(['version: must be a string']);
      expect(issuesOf(null)).toEqual(['version: must be a string']);
    });

    it('shows the offending value on a non-string', () => {
      expect(errorOf(123).issues[0]?.received).toBe(123);
    });

    it('reports a wrong segment count as a single issue, with the count', () => {
      expect(issuesOf('1.2')).toEqual([
        "version: must have exactly three '.'-separated segments, found 2",
      ]);
      expect(issuesOf('1.2.3.4')).toEqual([
        "version: must have exactly three '.'-separated segments, found 4",
      ]);
    });

    it('does not add per-segment noise to a segment-count failure', () => {
      // '1.x' is both short and non-numeric; only the shape fault is
      // reportable, because segments cannot be named until there are three.
      expect(issuesOf('1.x')).toHaveLength(1);
    });
  });

  describe('names the faulty segment', () => {
    it('names an empty segment by position', () => {
      expect(issuesOf('.2.3')).toEqual(['major: must not be empty']);
      expect(issuesOf('1..3')).toEqual(['minor: must not be empty']);
      expect(issuesOf('1.2.')).toEqual(['patch: must not be empty']);
    });

    it('names a non-digit segment by position', () => {
      expect(issuesOf('x.2.3')).toEqual([
        'major: must contain only the digits 0-9',
      ]);
      expect(issuesOf('1.2.0x3')).toEqual([
        'patch: must contain only the digits 0-9',
      ]);
    });

    it('names a leading-zero segment by position', () => {
      expect(issuesOf('01.2.3')).toEqual([
        'major: must not have leading zeros',
      ]);
      expect(issuesOf('1.2.007')).toEqual([
        'patch: must not have leading zeros',
      ]);
    });

    it('shows the offending segment, not the whole version', () => {
      expect(errorOf('1.2.0x3').issues[0]?.received).toBe('0x3');
      expect(errorOf('01.2.3').issues[0]?.received).toBe('01');
    });

    it('prefers the wider fault when a segment breaks several rules', () => {
      // '0x3' has a leading zero *and* a non-digit; the character fault is
      // the one a reader would name.
      expect(issuesOf('1.2.0x3')).toEqual([
        'patch: must contain only the digits 0-9',
      ]);
    });
  });

  describe('reports every broken rule, not merely the first', () => {
    it('reports two faulty segments at once', () => {
      expect(issuesOf('1.x.y')).toEqual([
        'minor: must contain only the digits 0-9',
        'patch: must contain only the digits 0-9',
      ]);
    });

    it('reports three faulty segments at once', () => {
      expect(issuesOf('..')).toEqual([
        'major: must not be empty',
        'minor: must not be empty',
        'patch: must not be empty',
      ]);
    });

    it('reports a mix of different faults in one pass', () => {
      expect(issuesOf('01..z')).toEqual([
        'major: must not have leading zeros',
        'minor: must not be empty',
        'patch: must contain only the digits 0-9',
      ]);
    });
  });

  describe('builds a message that can be read without this source', () => {
    it('renders a single issue under a singular preamble', () => {
      expect(errorOf('1.2').message).toBe(
        [
          'Value is not a valid ArvoSemanticVersion.',
          'The following problem was found:',
          '  - version: must have exactly three \'.\'-separated segments, found 2 (received "1.2")',
        ].join('\n'),
      );
    });

    it('renders several issues under a counted preamble', () => {
      expect(errorOf('1.x.y').message).toBe(
        [
          'Value is not a valid ArvoSemanticVersion.',
          'The following 2 problems were found:',
          '  - minor: must contain only the digits 0-9 (received "x")',
          '  - patch: must contain only the digits 0-9 (received "y")',
        ].join('\n'),
      );
    });
  });

  describe('agrees with check', () => {
    it('is ok exactly when check is true', () => {
      const corpus: unknown[] = [
        '1.2.3',
        '0.0.0',
        '10.20.30',
        '01.2.3',
        '1.2',
        '1.2.3.4',
        'v1.2.3',
        '1.2.3-beta',
        '-1.2.3',
        '',
        '..',
        123,
        null,
        undefined,
        {},
      ];
      for (const value of corpus) {
        expect(ArvoSemanticVersion.tryCheck(value).ok).toBe(
          ArvoSemanticVersion.check(value),
        );
      }
    });
  });
});
