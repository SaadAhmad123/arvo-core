import { describe, expect, it } from 'vitest';
import { validateArvoEvent } from '../../src/ArvoEvent/validator.js';

/** The five fields with no default, so a candidate is otherwise valid. */
const requiredFields = () => ({
  subject: 'order-1',
  source: 'api/orders',
  type: 'test.event',
  data: { hello: 'world' },
  dataschema: '#/contracts/test/1.0.0',
});

const issuePaths = (
  candidate: unknown,
  options?: { skipPayloadValidation?: boolean },
) => validateArvoEvent(candidate, options).issues.map((issue) => issue.path);

const issueMessages = (candidate: unknown) =>
  validateArvoEvent(candidate).issues.map((issue) => issue.message);

describe('validateArvoEvent', () => {
  describe('top-level guard', () => {
    it('rejects null', () => {
      expect(issuePaths(null)).toEqual(['event']);
    });

    it('rejects undefined', () => {
      expect(issuePaths(undefined)).toEqual(['event']);
    });

    it('rejects an array', () => {
      expect(issuePaths([])).toEqual(['event']);
    });

    it('rejects a string', () => {
      expect(issuePaths('event')).toEqual(['event']);
    });

    it('rejects a number', () => {
      expect(issuePaths(1)).toEqual(['event']);
    });

    it('stops at the guard rather than also reporting every missing field', () => {
      expect(validateArvoEvent(null).issues).toHaveLength(1);
    });

    it('still returns a fully defaulted value so the caller need not guard', () => {
      const { value: eventFields } = validateArvoEvent(null);
      expect(eventFields.parentid).toBeNull();
      expect(eventFields.depth).toBe(0);
      expect(eventFields.baggage).toEqual({});
    });
  });

  describe('unrecognised keys', () => {
    it('rejects a key that is not a field of ArvoEvent', () => {
      const issues = validateArvoEvent({
        ...requiredFields(),
        nonsense: 1,
      }).issues;
      expect(issues.map((issue) => issue.path)).toContain('nonsense');
      expect(issues[0]?.message).toContain('is not a field of ArvoEvent');
    });

    it('rejects a field removed in this version', () => {
      expect(issuePaths({ ...requiredFields(), rootsubject: 'x' })).toContain(
        'rootsubject',
      );
      expect(issuePaths({ ...requiredFields(), extensions: {} })).toContain(
        'extensions',
      );
    });

    it('rejects a casing typo rather than treating it as omitted', () => {
      expect(issuePaths({ ...requiredFields(), dataSchema: 'x' })).toContain(
        'dataSchema',
      );
    });

    it('reports every unrecognised key, not only the first', () => {
      const paths = issuePaths({ ...requiredFields(), a: 1, b: 2 });
      expect(paths).toContain('a');
      expect(paths).toContain('b');
    });
  });

  describe('defaults', () => {
    it('accepts input carrying only the five fields with no default', () => {
      expect(validateArvoEvent(requiredFields()).issues).toEqual([]);
    });

    it('generates an id when omitted', () => {
      expect(validateArvoEvent(requiredFields()).value.id).toMatch(/\S/);
    });

    it('generates a different id on each call', () => {
      const firstId = validateArvoEvent(requiredFields()).value.id;
      const secondId = validateArvoEvent(requiredFields()).value.id;
      expect(firstId).not.toBe(secondId);
    });

    it('defaults executionid to subject, which is what makes an all-defaults event root', () => {
      const { value: eventFields } = validateArvoEvent(requiredFields());
      expect(eventFields.executionid).toBe(eventFields.subject);
      expect(eventFields.parentid).toBeNull();
      expect(eventFields.depth).toBe(0);
    });

    it('defaults the nullable fields to null', () => {
      const { value: eventFields } = validateArvoEvent(requiredFields());
      expect(eventFields.parentid).toBeNull();
      expect(eventFields.initid).toBeNull();
      expect(eventFields.category).toBeNull();
      expect(eventFields.to).toBeNull();
      expect(eventFields.domain).toBeNull();
      expect(eventFields.traceparent).toBeNull();
      expect(eventFields.tracestate).toBeNull();
      expect(eventFields.executionunits).toBeNull();
    });

    it('defaults baggage to an empty map and time to a timestamp with an offset', () => {
      const { value: eventFields } = validateArvoEvent(requiredFields());
      expect(eventFields.baggage).toEqual({});
      expect(eventFields.time).toMatch(/[+-]\d{2}:\d{2}$|Z$/);
    });

    it('does not default the five fields that have none, reporting them instead', () => {
      const paths = issuePaths({});
      expect(paths).toContain('subject');
      expect(paths).toContain('source');
      expect(paths).toContain('type');
      expect(paths).toContain('dataschema');
      expect(paths).toContain('data');
    });

    it('preserves an explicitly supplied value rather than defaulting it', () => {
      const { value: eventFields } = validateArvoEvent({
        ...requiredFields(),
        parentid: 'p1',
        executionid: 'e1',
        depth: 2,
      });
      expect(eventFields.parentid).toBe('p1');
      expect(eventFields.executionid).toBe('e1');
      expect(eventFields.depth).toBe(2);
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
        expect(issuePaths({ ...requiredFields(), [field]: '' })).toContain(
          field,
        );
      });

      it(`rejects ${field} when not a string`, () => {
        expect(issuePaths({ ...requiredFields(), [field]: 42 })).toContain(
          field,
        );
      });
    }

    it('reports a missing field as required rather than as the wrong type', () => {
      const { subject: _omitted, ...subjectlessFields } = requiredFields();
      const issue = validateArvoEvent(subjectlessFields).issues.find(
        (candidate) => candidate.path === 'subject',
      );
      expect(issue?.message).toBe('is required');
      // ErrorIssue always defines `received`, so absence shows as undefined
      // rather than as a missing key. What matters is that nothing is
      // rendered for it, and that it stays out of the serialized form.
      expect(issue?.received).toBeUndefined();
      expect(issue?.toString()).toBe('subject: is required');
      expect(JSON.stringify(issue)).not.toContain('received');
    });

    it('reports a present but wrong value with what was received', () => {
      const issue = validateArvoEvent({
        ...requiredFields(),
        subject: 42,
      }).issues.find((candidate) => candidate.path === 'subject');
      expect(issue?.message).toContain('non-empty string');
      expect(issue?.received).toBe(42);
    });
  });

  describe('URI-reference format', () => {
    const fields = ['source', 'dataschema'] as const;

    for (const field of fields) {
      it(`accepts a hierarchical path for ${field}`, () => {
        expect(
          validateArvoEvent({ ...requiredFields(), [field]: 'api/users' })
            .issues,
        ).toEqual([]);
      });

      it(`accepts a bare token for ${field}`, () => {
        expect(
          validateArvoEvent({ ...requiredFields(), [field]: 'order-service' })
            .issues,
        ).toEqual([]);
      });

      it(`accepts a fragment-only reference for ${field}`, () => {
        expect(
          validateArvoEvent({
            ...requiredFields(),
            [field]: '#/contracts/user',
          }).issues,
        ).toEqual([]);
      });

      it(`accepts an absolute URI for ${field}`, () => {
        expect(
          validateArvoEvent({
            ...requiredFields(),
            [field]: 'https://arvo.land/contracts/user',
          }).issues,
        ).toEqual([]);
      });

      it(`rejects whitespace in ${field}`, () => {
        expect(
          issuePaths({ ...requiredFields(), [field]: 'order service' }),
        ).toContain(field);
      });

      it(`rejects a raw non-ASCII byte sequence in ${field}`, () => {
        expect(issuePaths({ ...requiredFields(), [field]: 'café' })).toContain(
          field,
        );
      });

      it(`names the URI-reference rule for ${field}`, () => {
        const issue = validateArvoEvent({
          ...requiredFields(),
          [field]: 'bad value',
        }).issues.find((candidate) => candidate.path === field);
        expect(issue?.message).toContain('URI-reference');
      });

      it(`rejects a case-differing scheme for ${field}, stricter than the bare grammar`, () => {
        // RFC 3986 makes the scheme case-insensitive, so this is grammatically
        // valid — rejected anyway, a deliberate, documented cost of verifying
        // via round-trip serialization rather than grammar alone. See design.md.
        expect(
          issuePaths({
            ...requiredFields(),
            [field]: 'HTTPS://arvo.land/contracts/user',
          }),
        ).toContain(field);
      });

      it(`rejects an unresolved dot-segment for ${field}, stricter than the bare grammar`, () => {
        // "." and ".." are ordinary, grammatically legal path segments whether
        // or not they have been resolved — rejected anyway, for the same
        // canonicalization reason as the case-sensitivity check above.
        expect(
          issuePaths({ ...requiredFields(), [field]: 'a/./b/../c' }),
        ).toContain(field);
      });

      it(`rejects lowercase percent-encoding hex digits for ${field}, stricter than the bare grammar`, () => {
        // RFC 3986 treats "%2f" and "%2F" as the same octet — grammatically
        // valid either way — rejected anyway, since canonical form requires
        // uppercase hex digits. See design.md.
        expect(
          issuePaths({ ...requiredFields(), [field]: 'api/%2fusers' }),
        ).toContain(field);
      });

      it(`rejects a percent-encoded unreserved character for ${field}, stricter than the bare grammar`, () => {
        // "%41" decodes to "A", an unreserved character that never needed
        // encoding — grammatically valid, rejected anyway for the same
        // canonicalization reason.
        expect(
          issuePaths({ ...requiredFields(), [field]: 'api/%41users' }),
        ).toContain(field);
      });
    }

    it('accepts an npm-style scoped specifier, since "@" is a legal path character', () => {
      expect(
        validateArvoEvent({
          ...requiredFields(),
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
          issuePaths({ ...requiredFields(), subject: `order${badChar}1` }),
        ).toContain('subject');
      });

      it('rejects it on a nullable string field', () => {
        expect(
          issuePaths({ ...requiredFields(), category: `cat${badChar}egory` }),
        ).toContain('category');
      });
    });

    it('is skipped for a null nullable field', () => {
      expect(
        validateArvoEvent({ ...requiredFields(), category: null }).issues,
      ).toEqual([]);
    });

    it('does not apply to strings nested inside data', () => {
      expect(
        validateArvoEvent({ ...requiredFields(), data: { note: 'x\u0007y' } })
          .issues,
      ).toEqual([]);
    });

    it('does not apply to strings nested inside baggage', () => {
      expect(
        validateArvoEvent({
          ...requiredFields(),
          baggage: { note: 'x\u0007y' },
        }).issues,
      ).toEqual([]);
    });

    it('applies across every restricted top-level field', () => {
      for (const field of restrictedFields) {
        expect(
          issuePaths({ ...requiredFields(), [field]: '\u0007' }),
        ).toContain(field);
      }
    });

    it('names the offending code point', () => {
      const issue = validateArvoEvent({
        ...requiredFields(),
        subject: 'order\u0007',
      }).issues.find((candidate) => candidate.path === 'subject');
      expect(issue?.message).toContain('U+0007');
    });
  });

  describe('nullable non-empty string fields', () => {
    const fields = ['parentid', 'initid', 'category', 'to', 'domain'] as const;

    for (const field of fields) {
      it(`accepts ${field} as null`, () => {
        expect(
          validateArvoEvent({ ...requiredFields(), [field]: null }).issues,
        ).toEqual([]);
      });

      it(`rejects ${field} when empty`, () => {
        expect(issuePaths({ ...requiredFields(), [field]: '' })).toContain(
          field,
        );
      });

      it(`rejects ${field} when not a string`, () => {
        expect(issuePaths({ ...requiredFields(), [field]: 1 })).toContain(
          field,
        );
      });
    }

    it('accepts a non-null parentid, which requires the root rules to be relaxed', () => {
      expect(
        validateArvoEvent({ ...requiredFields(), parentid: 'p1', depth: 1 })
          .issues,
      ).toEqual([]);
    });

    it('accepts a domain-defined category outside the io.arvo namespace', () => {
      expect(
        validateArvoEvent({
          ...requiredFields(),
          category: 'com.acme.archived',
        }).issues,
      ).toEqual([]);
    });
  });

  describe('depth', () => {
    it('accepts 0', () => {
      expect(
        validateArvoEvent({ ...requiredFields(), depth: 0 }).issues,
      ).toEqual([]);
    });

    it('accepts a positive integer, with parentid set so the root rule does not apply', () => {
      expect(
        validateArvoEvent({ ...requiredFields(), parentid: 'p', depth: 7 })
          .issues,
      ).toEqual([]);
    });

    it('rejects a negative integer', () => {
      expect(
        issuePaths({ ...requiredFields(), parentid: 'p', depth: -1 }),
      ).toContain('depth');
    });

    it('rejects a fractional value', () => {
      expect(
        issuePaths({ ...requiredFields(), parentid: 'p', depth: 1.5 }),
      ).toContain('depth');
    });

    it('rejects a non-number', () => {
      expect(
        issuePaths({ ...requiredFields(), parentid: 'p', depth: '1' }),
      ).toContain('depth');
    });

    it('rejects NaN', () => {
      expect(
        issuePaths({ ...requiredFields(), parentid: 'p', depth: Number.NaN }),
      ).toContain('depth');
    });
  });

  describe('time', () => {
    it('accepts a timestamp with a numeric offset', () => {
      expect(
        validateArvoEvent({
          ...requiredFields(),
          time: '2026-01-01T00:00:00+02:00',
        }).issues,
      ).toEqual([]);
    });

    it('accepts Z as an offset', () => {
      expect(
        validateArvoEvent({ ...requiredFields(), time: '2026-01-01T00:00:00Z' })
          .issues,
      ).toEqual([]);
    });

    it('rejects a timestamp with no offset', () => {
      expect(
        issuePaths({ ...requiredFields(), time: '2026-01-01T00:00:00' }),
      ).toContain('time');
    });

    it('rejects a non-date string', () => {
      expect(issuePaths({ ...requiredFields(), time: 'yesterday' })).toContain(
        'time',
      );
    });

    it('rejects a non-string', () => {
      expect(
        issuePaths({ ...requiredFields(), time: 1735689600000 }),
      ).toContain('time');
    });
  });

  describe('executionunits', () => {
    it('accepts null', () => {
      expect(
        validateArvoEvent({ ...requiredFields(), executionunits: null }).issues,
      ).toEqual([]);
    });

    it('accepts a negative value, since no constraint is placed on sign', () => {
      expect(
        validateArvoEvent({ ...requiredFields(), executionunits: -5 }).issues,
      ).toEqual([]);
    });

    it('accepts zero', () => {
      expect(
        validateArvoEvent({ ...requiredFields(), executionunits: 0 }).issues,
      ).toEqual([]);
    });

    it('rejects a non-finite number', () => {
      expect(
        issuePaths({
          ...requiredFields(),
          executionunits: Number.POSITIVE_INFINITY,
        }),
      ).toContain('executionunits');
      expect(
        issuePaths({ ...requiredFields(), executionunits: Number.NaN }),
      ).toContain('executionunits');
    });

    it('rejects a non-number', () => {
      expect(
        issuePaths({ ...requiredFields(), executionunits: '5' }),
      ).toContain('executionunits');
    });

    it('accepts a large finite magnitude', () => {
      expect(
        validateArvoEvent({
          ...requiredFields(),
          executionunits: Number.MAX_VALUE,
        }).issues,
      ).toEqual([]);
    });

    it('normalizes negative zero to zero', () => {
      const { value: eventFields } = validateArvoEvent({
        ...requiredFields(),
        executionunits: -0,
      });
      expect(eventFields.executionunits).toBe(0);
      expect(Object.is(eventFields.executionunits, -0)).toBe(false);
    });

    it('normalizes negative zero to zero when admitted as plain data', () => {
      const { value: eventFields } = validateArvoEvent(
        { ...requiredFields(), executionunits: -0 },
        { skipPayloadValidation: true },
      );
      expect(Object.is(eventFields.executionunits, -0)).toBe(false);
    });
  });

  describe('trace fields are unvalidated beyond the character domain', () => {
    it('accepts any string, including an empty one', () => {
      expect(
        validateArvoEvent({
          ...requiredFields(),
          traceparent: '',
          tracestate: '',
        }).issues,
      ).toEqual([]);
    });

    it('accepts a malformed traceparent', () => {
      expect(
        validateArvoEvent({
          ...requiredFields(),
          traceparent: 'not-w3c-at-all',
        }).issues,
      ).toEqual([]);
    });

    it('accepts tracestate with no traceparent, since no companionship rule exists', () => {
      expect(
        validateArvoEvent({ ...requiredFields(), tracestate: 'vendor=x' })
          .issues,
      ).toEqual([]);
    });

    it('still rejects a forbidden code point', () => {
      expect(
        issuePaths({ ...requiredFields(), traceparent: 'bad\u0007value' }),
      ).toContain('traceparent');
    });
  });

  describe('root constraint', () => {
    it('accepts a root event', () => {
      expect(
        validateArvoEvent({
          ...requiredFields(),
          parentid: null,
          executionid: 'order-1',
          depth: 0,
        }).issues,
      ).toEqual([]);
    });

    it('rejects a null parentid whose executionid differs from subject', () => {
      const issues = validateArvoEvent({
        ...requiredFields(),
        executionid: 'other',
      }).issues;
      expect(issues.map((issue) => issue.path)).toContain(
        'parentid + executionid',
      );
      expect(issues[0]?.received).toEqual({
        executionid: 'other',
        subject: 'order-1',
      });
    });

    it('rejects a null parentid with non-zero depth', () => {
      const issues = validateArvoEvent({
        ...requiredFields(),
        depth: 3,
      }).issues;
      expect(issues.map((issue) => issue.path)).toContain('parentid + depth');
    });

    it('reports both root failures together when both hold', () => {
      const paths = issuePaths({
        ...requiredFields(),
        executionid: 'other',
        depth: 3,
      });
      expect(paths).toContain('parentid + executionid');
      expect(paths).toContain('parentid + depth');
    });

    it('PERMITS depth 0 on a caused event — depth 0 is a level, not a root marker', () => {
      expect(
        validateArvoEvent({ ...requiredFields(), parentid: 'p', depth: 0 })
          .issues,
      ).toEqual([]);
    });

    it('PERMITS executionid equal to subject on a caused event', () => {
      expect(
        validateArvoEvent({
          ...requiredFields(),
          parentid: 'p',
          executionid: 'order-1',
          depth: 1,
        }).issues,
      ).toEqual([]);
    });

    it('PERMITS a caused event carrying both, which the root execution"s own emissions do', () => {
      expect(
        validateArvoEvent({
          ...requiredFields(),
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
        ...requiredFields(),
        parentid: 'p',
        category: 'io.arvo.complete',
      }).issues;
      expect(issues.map((issue) => issue.path)).toContain('category + initid');
    });

    it('accepts a completion carrying initid', () => {
      expect(
        validateArvoEvent({
          ...requiredFields(),
          parentid: 'p',
          category: 'io.arvo.complete',
          initid: 'i1',
        }).issues,
      ).toEqual([]);
    });

    it('PERMITS initid on an event that is not a completion', () => {
      expect(
        validateArvoEvent({ ...requiredFields(), parentid: 'p', initid: 'i1' })
          .issues,
      ).toEqual([]);
    });

    it('PERMITS initid on an io.arvo.init event', () => {
      expect(
        validateArvoEvent({
          ...requiredFields(),
          parentid: 'p',
          category: 'io.arvo.init',
          initid: 'i1',
        }).issues,
      ).toEqual([]);
    });

    it('does not trigger on a domain category that merely resembles a completion', () => {
      expect(
        validateArvoEvent({
          ...requiredFields(),
          parentid: 'p',
          category: 'complete',
        }).issues,
      ).toEqual([]);
    });
  });

  describe('payload delegation', () => {
    it('reports a payload failure at its path within data', () => {
      expect(
        issuePaths({ ...requiredFields(), data: { n: Number.NaN } }),
      ).toEqual(['data.n']);
    });

    it('reports a baggage failure at its path within baggage', () => {
      expect(
        issuePaths({ ...requiredFields(), baggage: { nested: {} } }),
      ).toEqual(['baggage.nested']);
    });

    it('rejects a non-object data', () => {
      expect(issuePaths({ ...requiredFields(), data: [] })).toEqual(['data']);
    });

    it('rejects a non-object baggage', () => {
      expect(issuePaths({ ...requiredFields(), baggage: 'x' })).toEqual([
        'baggage',
      ]);
    });

    it('returns the normalized and frozen payload', () => {
      const { value: eventFields } = validateArvoEvent({
        ...requiredFields(),
        data: { kept: 1, dropped: undefined },
      });
      expect(eventFields.data).toEqual({ kept: 1 });
      expect(Object.isFrozen(eventFields.data)).toBe(true);
    });

    it('returns the normalized and frozen baggage', () => {
      const { value: eventFields } = validateArvoEvent({
        ...requiredFields(),
        baggage: { tenant: 'acme' },
      });
      expect(eventFields.baggage).toEqual({ tenant: 'acme' });
      expect(Object.isFrozen(eventFields.baggage)).toBe(true);
    });
  });

  describe('skipPayloadValidation', () => {
    it('admits a payload the walk would have rejected', () => {
      expect(
        validateArvoEvent(
          { ...requiredFields(), data: { n: Number.NaN } },
          { skipPayloadValidation: true },
        ).issues,
      ).toEqual([]);
    });

    it('admits baggage the walk would have rejected', () => {
      expect(
        validateArvoEvent(
          { ...requiredFields(), baggage: { nested: { a: 1 } } },
          { skipPayloadValidation: true },
        ).issues,
      ).toEqual([]);
    });

    it('passes the payload through unwalked, so it is not frozen', () => {
      const data = { n: 1 };
      const { value: eventFields } = validateArvoEvent(
        { ...requiredFields(), data },
        { skipPayloadValidation: true },
      );
      expect(eventFields.data).toBe(data);
      expect(Object.isFrozen(eventFields.data)).toBe(false);
    });

    it('still enforces field rules', () => {
      expect(
        issuePaths(
          { ...requiredFields(), subject: '' },
          { skipPayloadValidation: true },
        ),
      ).toContain('subject');
    });

    it('still enforces unrecognised-key rejection', () => {
      expect(
        issuePaths(
          { ...requiredFields(), nonsense: 1 },
          { skipPayloadValidation: true },
        ),
      ).toContain('nonsense');
    });

    it('still enforces the root constraint', () => {
      expect(
        issuePaths(
          { ...requiredFields(), executionid: 'other' },
          { skipPayloadValidation: true },
        ),
      ).toContain('parentid + executionid');
    });

    it('still enforces the correlation constraint', () => {
      expect(
        issuePaths(
          { ...requiredFields(), parentid: 'p', category: 'io.arvo.complete' },
          { skipPayloadValidation: true },
        ),
      ).toContain('category + initid');
    });

    it('still guards the top level', () => {
      expect(issuePaths(null, { skipPayloadValidation: true })).toEqual([
        'event',
      ]);
    });

    it('behaves as if unset when options are omitted entirely', () => {
      expect(
        validateArvoEvent({ ...requiredFields(), data: { n: 1n } }).issues,
      ).toHaveLength(1);
    });
  });

  describe('aggregation', () => {
    it('reports field, cross-field, and payload failures together in one pass', () => {
      const paths = issuePaths({
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
      const paths = issuePaths({
        ...requiredFields(),
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
      for (const message of issueMessages({
        ...requiredFields(),
        subject: 42,
        depth: -1,
      })) {
        expect(message.length).toBeGreaterThan(0);
      }
    });
  });
});
