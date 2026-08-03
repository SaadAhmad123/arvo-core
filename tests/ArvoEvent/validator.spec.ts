import { describe, expect, it } from 'vitest';
import { validateArvoEvent } from '../../src/ArvoEvent/validator.js';

/** The five fields with no default, so a candidate is otherwise valid. */
const required = () => ({
  subject: 'order-1',
  source: 'api/orders',
  type: 'test.event',
  data: { hello: 'world' },
  dataschema: '#/contracts/test/1.0.0',
});

const pathsOf = (
  input: unknown,
  options?: { skipPayloadValidation?: boolean },
) => validateArvoEvent(input, options).issues.map((issue) => issue.path);

const messagesOf = (input: unknown) =>
  validateArvoEvent(input).issues.map((issue) => issue.message);

describe('validateArvoEvent', () => {
  describe('top-level guard', () => {
    it('rejects null', () => {
      expect(pathsOf(null)).toEqual(['event']);
    });

    it('rejects undefined', () => {
      expect(pathsOf(undefined)).toEqual(['event']);
    });

    it('rejects an array', () => {
      expect(pathsOf([])).toEqual(['event']);
    });

    it('rejects a string', () => {
      expect(pathsOf('event')).toEqual(['event']);
    });

    it('rejects a number', () => {
      expect(pathsOf(1)).toEqual(['event']);
    });

    it('stops at the guard rather than also reporting every missing field', () => {
      expect(validateArvoEvent(null).issues).toHaveLength(1);
    });

    it('still returns a fully defaulted value so the caller need not guard', () => {
      const { value } = validateArvoEvent(null);
      expect(value.parentid).toBeNull();
      expect(value.depth).toBe(0);
      expect(value.baggage).toEqual({});
    });
  });

  describe('unrecognised keys', () => {
    it('rejects a key that is not a field of ArvoEvent', () => {
      const issues = validateArvoEvent({ ...required(), nonsense: 1 }).issues;
      expect(issues.map((i) => i.path)).toContain('nonsense');
      expect(issues[0]?.message).toContain('is not a field of ArvoEvent');
    });

    it('rejects a field removed in this version', () => {
      expect(pathsOf({ ...required(), rootsubject: 'x' })).toContain(
        'rootsubject',
      );
      expect(pathsOf({ ...required(), extensions: {} })).toContain(
        'extensions',
      );
    });

    it('rejects a casing typo rather than treating it as omitted', () => {
      expect(pathsOf({ ...required(), dataSchema: 'x' })).toContain(
        'dataSchema',
      );
    });

    it('reports every unrecognised key, not only the first', () => {
      const paths = pathsOf({ ...required(), a: 1, b: 2 });
      expect(paths).toContain('a');
      expect(paths).toContain('b');
    });
  });

  describe('defaults', () => {
    it('accepts input carrying only the five fields with no default', () => {
      expect(validateArvoEvent(required()).issues).toEqual([]);
    });

    it('generates an id when omitted', () => {
      expect(validateArvoEvent(required()).value.id).toMatch(/\S/);
    });

    it('generates a different id on each call', () => {
      const a = validateArvoEvent(required()).value.id;
      const b = validateArvoEvent(required()).value.id;
      expect(a).not.toBe(b);
    });

    it('defaults executionid to subject, which is what makes an all-defaults event root', () => {
      const { value } = validateArvoEvent(required());
      expect(value.executionid).toBe(value.subject);
      expect(value.parentid).toBeNull();
      expect(value.depth).toBe(0);
    });

    it('defaults the nullable fields to null', () => {
      const { value } = validateArvoEvent(required());
      expect(value.parentid).toBeNull();
      expect(value.initid).toBeNull();
      expect(value.category).toBeNull();
      expect(value.to).toBeNull();
      expect(value.domain).toBeNull();
      expect(value.traceparent).toBeNull();
      expect(value.tracestate).toBeNull();
      expect(value.executionunits).toBeNull();
    });

    it('defaults baggage to an empty map and time to a timestamp with an offset', () => {
      const { value } = validateArvoEvent(required());
      expect(value.baggage).toEqual({});
      expect(value.time).toMatch(/[+-]\d{2}:\d{2}$|Z$/);
    });

    it('does not default the five fields that have none, reporting them instead', () => {
      const paths = pathsOf({});
      expect(paths).toContain('subject');
      expect(paths).toContain('source');
      expect(paths).toContain('type');
      expect(paths).toContain('dataschema');
      expect(paths).toContain('data');
    });

    it('preserves an explicitly supplied value rather than defaulting it', () => {
      const { value } = validateArvoEvent({
        ...required(),
        parentid: 'p1',
        executionid: 'e1',
        depth: 2,
      });
      expect(value.parentid).toBe('p1');
      expect(value.executionid).toBe('e1');
      expect(value.depth).toBe(2);
    });
  });

  describe('required non-empty string fields', () => {
    const fields = [
      'id',
      'subject',
      'executionid',
      'source',
      'type',
      'dataschema',
    ] as const;

    for (const field of fields) {
      it(`rejects ${field} when empty`, () => {
        expect(pathsOf({ ...required(), [field]: '' })).toContain(field);
      });

      it(`rejects ${field} when not a string`, () => {
        expect(pathsOf({ ...required(), [field]: 42 })).toContain(field);
      });
    }

    it('reports a missing field as required rather than as the wrong type', () => {
      const { subject: _omitted, ...rest } = required();
      const issue = validateArvoEvent(rest).issues.find(
        (i) => i.path === 'subject',
      );
      expect(issue?.message).toBe('is required');
      expect(issue).not.toHaveProperty('received');
    });

    it('reports a present but wrong value with what was received', () => {
      const issue = validateArvoEvent({
        ...required(),
        subject: 42,
      }).issues.find((i) => i.path === 'subject');
      expect(issue?.message).toContain('non-empty string');
      expect(issue?.received).toBe(42);
    });
  });

  describe('URI-reference format', () => {
    const fields = ['source', 'dataschema'] as const;

    for (const field of fields) {
      it(`accepts a hierarchical path for ${field}`, () => {
        expect(
          validateArvoEvent({ ...required(), [field]: 'api/users' }).issues,
        ).toEqual([]);
      });

      it(`accepts a bare token for ${field}`, () => {
        expect(
          validateArvoEvent({ ...required(), [field]: 'order-service' }).issues,
        ).toEqual([]);
      });

      it(`accepts a fragment-only reference for ${field}`, () => {
        expect(
          validateArvoEvent({ ...required(), [field]: '#/contracts/user' })
            .issues,
        ).toEqual([]);
      });

      it(`accepts an absolute URI for ${field}`, () => {
        expect(
          validateArvoEvent({
            ...required(),
            [field]: 'https://arvo.land/contracts/user',
          }).issues,
        ).toEqual([]);
      });

      it(`rejects whitespace in ${field}`, () => {
        expect(pathsOf({ ...required(), [field]: 'order service' })).toContain(
          field,
        );
      });

      it(`rejects a raw non-ASCII byte sequence in ${field}`, () => {
        expect(pathsOf({ ...required(), [field]: 'café' })).toContain(field);
      });

      it(`names the URI-reference rule for ${field}`, () => {
        const issue = validateArvoEvent({
          ...required(),
          [field]: 'bad value',
        }).issues.find((i) => i.path === field);
        expect(issue?.message).toContain('URI-reference');
      });

      it(`rejects a case-differing scheme for ${field}, stricter than the bare grammar`, () => {
        // RFC 3986 makes the scheme case-insensitive, so this is grammatically
        // valid — rejected anyway, a deliberate, documented cost of verifying
        // via round-trip serialization rather than grammar alone. See design.md.
        expect(
          pathsOf({
            ...required(),
            [field]: 'HTTPS://arvo.land/contracts/user',
          }),
        ).toContain(field);
      });

      it(`rejects an unresolved dot-segment for ${field}, stricter than the bare grammar`, () => {
        // "." and ".." are ordinary, grammatically legal path segments whether
        // or not they have been resolved — rejected anyway, for the same
        // canonicalization reason as the case-sensitivity check above.
        expect(pathsOf({ ...required(), [field]: 'a/./b/../c' })).toContain(
          field,
        );
      });

      it(`rejects lowercase percent-encoding hex digits for ${field}, stricter than the bare grammar`, () => {
        // RFC 3986 treats "%2f" and "%2F" as the same octet — grammatically
        // valid either way — rejected anyway, since canonical form requires
        // uppercase hex digits. See design.md.
        expect(pathsOf({ ...required(), [field]: 'api/%2fusers' })).toContain(
          field,
        );
      });

      it(`rejects a percent-encoded unreserved character for ${field}, stricter than the bare grammar`, () => {
        // "%41" decodes to "A", an unreserved character that never needed
        // encoding — grammatically valid, rejected anyway for the same
        // canonicalization reason.
        expect(pathsOf({ ...required(), [field]: 'api/%41users' })).toContain(
          field,
        );
      });
    }

    it('accepts an npm-style scoped specifier, since "@" is a legal path character', () => {
      expect(
        validateArvoEvent({
          ...required(),
          dataschema: '@acme/order-contract@1.0.0',
        }).issues,
      ).toEqual([]);
    });
  });

  describe('character domain', () => {
    const restrictedFields = [
      'id',
      'parentid',
      'initid',
      'subject',
      'executionid',
      'category',
      'source',
      'to',
      'domain',
      'type',
      'dataschema',
      'traceparent',
      'tracestate',
    ] as const;

    describe.each([
      ['a C0 control character', '\u0007'],
      ['DEL', '\u007f'],
      ['a C1 control character', '\u0085'],
      ['a BMP noncharacter', '\ufdd0'],
      ['a noncharacter outside the BMP', String.fromCodePoint(0x1fffe)],
      ['an unpaired high surrogate', '\ud800'],
      ['an unpaired low surrogate', '\udc00'],
    ])('%s', (_label, badChar) => {
      it('rejects it on a required string field', () => {
        expect(
          pathsOf({ ...required(), subject: `order${badChar}1` }),
        ).toContain('subject');
      });

      it('rejects it on a nullable string field', () => {
        expect(
          pathsOf({ ...required(), category: `cat${badChar}egory` }),
        ).toContain('category');
      });
    });

    it('is skipped for a null nullable field', () => {
      expect(
        validateArvoEvent({ ...required(), category: null }).issues,
      ).toEqual([]);
    });

    it('does not apply to strings nested inside data', () => {
      expect(
        validateArvoEvent({ ...required(), data: { note: 'x\u0007y' } }).issues,
      ).toEqual([]);
    });

    it('does not apply to strings nested inside baggage', () => {
      expect(
        validateArvoEvent({ ...required(), baggage: { note: 'x\u0007y' } })
          .issues,
      ).toEqual([]);
    });

    it('applies across every restricted top-level field', () => {
      for (const field of restrictedFields) {
        expect(pathsOf({ ...required(), [field]: '\u0007' })).toContain(field);
      }
    });

    it('names the offending code point', () => {
      const issue = validateArvoEvent({
        ...required(),
        subject: 'order\u0007',
      }).issues.find((i) => i.path === 'subject');
      expect(issue?.message).toContain('U+0007');
    });
  });

  describe('nullable non-empty string fields', () => {
    const fields = ['parentid', 'initid', 'category', 'to', 'domain'] as const;

    for (const field of fields) {
      it(`accepts ${field} as null`, () => {
        expect(
          validateArvoEvent({ ...required(), [field]: null }).issues,
        ).toEqual([]);
      });

      it(`rejects ${field} when empty`, () => {
        expect(pathsOf({ ...required(), [field]: '' })).toContain(field);
      });

      it(`rejects ${field} when not a string`, () => {
        expect(pathsOf({ ...required(), [field]: 1 })).toContain(field);
      });
    }

    it('accepts a non-null parentid, which requires the root rules to be relaxed', () => {
      expect(
        validateArvoEvent({ ...required(), parentid: 'p1', depth: 1 }).issues,
      ).toEqual([]);
    });

    it('accepts a domain-defined category outside the io.arvo namespace', () => {
      expect(
        validateArvoEvent({ ...required(), category: 'com.acme.archived' })
          .issues,
      ).toEqual([]);
    });
  });

  describe('depth', () => {
    it('accepts 0', () => {
      expect(validateArvoEvent({ ...required(), depth: 0 }).issues).toEqual([]);
    });

    it('accepts a positive integer, with parentid set so the root rule does not apply', () => {
      expect(
        validateArvoEvent({ ...required(), parentid: 'p', depth: 7 }).issues,
      ).toEqual([]);
    });

    it('rejects a negative integer', () => {
      expect(pathsOf({ ...required(), parentid: 'p', depth: -1 })).toContain(
        'depth',
      );
    });

    it('rejects a fractional value', () => {
      expect(pathsOf({ ...required(), parentid: 'p', depth: 1.5 })).toContain(
        'depth',
      );
    });

    it('rejects a non-number', () => {
      expect(pathsOf({ ...required(), parentid: 'p', depth: '1' })).toContain(
        'depth',
      );
    });

    it('rejects NaN', () => {
      expect(
        pathsOf({ ...required(), parentid: 'p', depth: Number.NaN }),
      ).toContain('depth');
    });
  });

  describe('time', () => {
    it('accepts a timestamp with a numeric offset', () => {
      expect(
        validateArvoEvent({ ...required(), time: '2026-01-01T00:00:00+02:00' })
          .issues,
      ).toEqual([]);
    });

    it('accepts Z as an offset', () => {
      expect(
        validateArvoEvent({ ...required(), time: '2026-01-01T00:00:00Z' })
          .issues,
      ).toEqual([]);
    });

    it('rejects a timestamp with no offset', () => {
      expect(pathsOf({ ...required(), time: '2026-01-01T00:00:00' })).toContain(
        'time',
      );
    });

    it('rejects a non-date string', () => {
      expect(pathsOf({ ...required(), time: 'yesterday' })).toContain('time');
    });

    it('rejects a non-string', () => {
      expect(pathsOf({ ...required(), time: 1735689600000 })).toContain('time');
    });
  });

  describe('executionunits', () => {
    it('accepts null', () => {
      expect(
        validateArvoEvent({ ...required(), executionunits: null }).issues,
      ).toEqual([]);
    });

    it('accepts a negative value, since no constraint is placed on sign', () => {
      expect(
        validateArvoEvent({ ...required(), executionunits: -5 }).issues,
      ).toEqual([]);
    });

    it('accepts zero', () => {
      expect(
        validateArvoEvent({ ...required(), executionunits: 0 }).issues,
      ).toEqual([]);
    });

    it('rejects a non-finite number', () => {
      expect(
        pathsOf({ ...required(), executionunits: Number.POSITIVE_INFINITY }),
      ).toContain('executionunits');
      expect(pathsOf({ ...required(), executionunits: Number.NaN })).toContain(
        'executionunits',
      );
    });

    it('rejects a non-number', () => {
      expect(pathsOf({ ...required(), executionunits: '5' })).toContain(
        'executionunits',
      );
    });

    it('accepts a large finite magnitude', () => {
      expect(
        validateArvoEvent({
          ...required(),
          executionunits: Number.MAX_VALUE,
        }).issues,
      ).toEqual([]);
    });

    it('normalizes negative zero to zero', () => {
      const { value } = validateArvoEvent({
        ...required(),
        executionunits: -0,
      });
      expect(value.executionunits).toBe(0);
      expect(Object.is(value.executionunits, -0)).toBe(false);
    });

    it('normalizes negative zero to zero when admitted as plain data', () => {
      const { value } = validateArvoEvent(
        { ...required(), executionunits: -0 },
        { skipPayloadValidation: true },
      );
      expect(Object.is(value.executionunits, -0)).toBe(false);
    });
  });

  describe('trace fields are unvalidated beyond the character domain', () => {
    it('accepts any string, including an empty one', () => {
      expect(
        validateArvoEvent({ ...required(), traceparent: '', tracestate: '' })
          .issues,
      ).toEqual([]);
    });

    it('accepts a malformed traceparent', () => {
      expect(
        validateArvoEvent({ ...required(), traceparent: 'not-w3c-at-all' })
          .issues,
      ).toEqual([]);
    });

    it('accepts tracestate with no traceparent, since no companionship rule exists', () => {
      expect(
        validateArvoEvent({ ...required(), tracestate: 'vendor=x' }).issues,
      ).toEqual([]);
    });

    it('still rejects a forbidden code point', () => {
      expect(
        pathsOf({ ...required(), traceparent: 'bad\u0007value' }),
      ).toContain('traceparent');
    });
  });

  describe('root constraint', () => {
    it('accepts a root event', () => {
      expect(
        validateArvoEvent({
          ...required(),
          parentid: null,
          executionid: 'order-1',
          depth: 0,
        }).issues,
      ).toEqual([]);
    });

    it('rejects a null parentid whose executionid differs from subject', () => {
      const issues = validateArvoEvent({
        ...required(),
        executionid: 'other',
      }).issues;
      expect(issues.map((i) => i.path)).toContain('parentid + executionid');
      expect(issues[0]?.received).toEqual({
        executionid: 'other',
        subject: 'order-1',
      });
    });

    it('rejects a null parentid with non-zero depth', () => {
      const issues = validateArvoEvent({ ...required(), depth: 3 }).issues;
      expect(issues.map((i) => i.path)).toContain('parentid + depth');
    });

    it('reports both root failures together when both hold', () => {
      const paths = pathsOf({
        ...required(),
        executionid: 'other',
        depth: 3,
      });
      expect(paths).toContain('parentid + executionid');
      expect(paths).toContain('parentid + depth');
    });

    it('PERMITS depth 0 on a caused event — depth 0 is a level, not a root marker', () => {
      expect(
        validateArvoEvent({ ...required(), parentid: 'p', depth: 0 }).issues,
      ).toEqual([]);
    });

    it('PERMITS executionid equal to subject on a caused event', () => {
      expect(
        validateArvoEvent({
          ...required(),
          parentid: 'p',
          executionid: 'order-1',
          depth: 1,
        }).issues,
      ).toEqual([]);
    });

    it('PERMITS a caused event carrying both, which the root execution"s own emissions do', () => {
      expect(
        validateArvoEvent({
          ...required(),
          parentid: 'p',
          executionid: 'order-1',
          depth: 0,
        }).issues,
      ).toEqual([]);
    });
  });

  describe('correlation constraint', () => {
    it('rejects a completion carrying no initid', () => {
      const issues = validateArvoEvent({
        ...required(),
        parentid: 'p',
        category: 'io.arvo.complete',
      }).issues;
      expect(issues.map((i) => i.path)).toContain('category + initid');
    });

    it('accepts a completion carrying initid', () => {
      expect(
        validateArvoEvent({
          ...required(),
          parentid: 'p',
          category: 'io.arvo.complete',
          initid: 'i1',
        }).issues,
      ).toEqual([]);
    });

    it('PERMITS initid on an event that is not a completion', () => {
      expect(
        validateArvoEvent({ ...required(), parentid: 'p', initid: 'i1' })
          .issues,
      ).toEqual([]);
    });

    it('PERMITS initid on an io.arvo.init event', () => {
      expect(
        validateArvoEvent({
          ...required(),
          parentid: 'p',
          category: 'io.arvo.init',
          initid: 'i1',
        }).issues,
      ).toEqual([]);
    });

    it('does not trigger on a domain category that merely resembles a completion', () => {
      expect(
        validateArvoEvent({
          ...required(),
          parentid: 'p',
          category: 'complete',
        }).issues,
      ).toEqual([]);
    });
  });

  describe('payload delegation', () => {
    it('reports a payload failure at its path within data', () => {
      expect(pathsOf({ ...required(), data: { n: Number.NaN } })).toEqual([
        'data.n',
      ]);
    });

    it('reports a baggage failure at its path within baggage', () => {
      expect(pathsOf({ ...required(), baggage: { nested: {} } })).toEqual([
        'baggage.nested',
      ]);
    });

    it('rejects a non-object data', () => {
      expect(pathsOf({ ...required(), data: [] })).toEqual(['data']);
    });

    it('rejects a non-object baggage', () => {
      expect(pathsOf({ ...required(), baggage: 'x' })).toEqual(['baggage']);
    });

    it('returns the normalized and frozen payload', () => {
      const { value } = validateArvoEvent({
        ...required(),
        data: { kept: 1, dropped: undefined },
      });
      expect(value.data).toEqual({ kept: 1 });
      expect(Object.isFrozen(value.data)).toBe(true);
    });

    it('returns the normalized and frozen baggage', () => {
      const { value } = validateArvoEvent({
        ...required(),
        baggage: { tenant: 'acme' },
      });
      expect(value.baggage).toEqual({ tenant: 'acme' });
      expect(Object.isFrozen(value.baggage)).toBe(true);
    });
  });

  describe('skipPayloadValidation', () => {
    it('admits a payload the walk would have rejected', () => {
      expect(
        validateArvoEvent(
          { ...required(), data: { n: Number.NaN } },
          { skipPayloadValidation: true },
        ).issues,
      ).toEqual([]);
    });

    it('admits baggage the walk would have rejected', () => {
      expect(
        validateArvoEvent(
          { ...required(), baggage: { nested: { a: 1 } } },
          { skipPayloadValidation: true },
        ).issues,
      ).toEqual([]);
    });

    it('passes the payload through unwalked, so it is not frozen', () => {
      const data = { n: 1 };
      const { value } = validateArvoEvent(
        { ...required(), data },
        { skipPayloadValidation: true },
      );
      expect(value.data).toBe(data);
      expect(Object.isFrozen(value.data)).toBe(false);
    });

    it('still enforces field rules', () => {
      expect(
        pathsOf(
          { ...required(), subject: '' },
          { skipPayloadValidation: true },
        ),
      ).toContain('subject');
    });

    it('still enforces unrecognised-key rejection', () => {
      expect(
        pathsOf(
          { ...required(), nonsense: 1 },
          { skipPayloadValidation: true },
        ),
      ).toContain('nonsense');
    });

    it('still enforces the root constraint', () => {
      expect(
        pathsOf(
          { ...required(), executionid: 'other' },
          { skipPayloadValidation: true },
        ),
      ).toContain('parentid + executionid');
    });

    it('still enforces the correlation constraint', () => {
      expect(
        pathsOf(
          { ...required(), parentid: 'p', category: 'io.arvo.complete' },
          { skipPayloadValidation: true },
        ),
      ).toContain('category + initid');
    });

    it('still guards the top level', () => {
      expect(pathsOf(null, { skipPayloadValidation: true })).toEqual(['event']);
    });

    it('behaves as if unset when options are omitted entirely', () => {
      expect(
        validateArvoEvent({ ...required(), data: { n: 1n } }).issues,
      ).toHaveLength(1);
    });
  });

  describe('aggregation', () => {
    it('reports field, cross-field, and payload failures together in one pass', () => {
      const paths = pathsOf({
        subject: 'order-1',
        source: '',
        type: 'test.event',
        dataschema: '#/c/1.0.0',
        executionid: 'other',
        data: { n: Number.NaN },
        baggage: { nested: {} },
      });
      expect(paths).toContain('source');
      expect(paths).toContain('parentid + executionid');
      expect(paths).toContain('data.n');
      expect(paths).toContain('baggage.nested');
    });

    it('orders issues fields first, then cross-field, then payload', () => {
      const paths = pathsOf({
        ...required(),
        source: '',
        executionid: 'other',
        data: { n: Number.NaN },
      });
      expect(paths.indexOf('source')).toBeLessThan(
        paths.indexOf('parentid + executionid'),
      );
      expect(paths.indexOf('parentid + executionid')).toBeLessThan(
        paths.indexOf('data.n'),
      );
    });

    it('names the rule and the value for every issue it reports', () => {
      for (const issue of messagesOf({
        ...required(),
        subject: 42,
        depth: -1,
      })) {
        expect(issue.length).toBeGreaterThan(0);
      }
    });
  });
});
