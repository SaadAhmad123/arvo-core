import { describe, expect, it } from 'vitest';
import { ArvoEventValidationError } from '../../src/ArvoEvent/errors.js';
import { ArvoEvent } from '../../src/ArvoEvent/index.js';
import type { ArvoEventParam } from '../../src/ArvoEvent/types.js';

const baseParam = (): ArvoEventParam<'test.event', { hello: string }> => ({
  source: 'test/source',
  subject: 'test-subject',
  type: 'test.event',
  dataschema: 'test://schema/v1',
  data: { hello: 'world' },
});

const issuesOf = (fn: () => unknown): ArvoEventValidationError['issues'] => {
  try {
    fn();
    throw new Error('expected construction to throw');
  } catch (err) {
    if (err instanceof ArvoEventValidationError) return err.issues;
    throw err;
  }
};

const pathsOf = (fn: () => unknown): string[] =>
  issuesOf(fn).map((i) => i.path);

describe('ArvoEvent', () => {
  describe('defaults', () => {
    it('generates a non-empty id when omitted', () => {
      const event = new ArvoEvent(baseParam());
      expect(typeof event.id).toBe('string');
      expect(event.id.length).toBeGreaterThan(0);
    });

    it('generates a different id for each instance', () => {
      const a = new ArvoEvent(baseParam());
      const b = new ArvoEvent(baseParam());
      expect(a.id).not.toBe(b.id);
    });

    it('generates ids matching the UUID shape produced by crypto.randomUUID', () => {
      const event = new ArvoEvent(baseParam());
      expect(event.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });

    it('defaults parentid to null', () => {
      expect(new ArvoEvent(baseParam()).parentid).toBeNull();
    });

    it('defaults initid to null', () => {
      expect(new ArvoEvent(baseParam()).initid).toBeNull();
    });

    it('defaults category to null', () => {
      expect(new ArvoEvent(baseParam()).category).toBeNull();
    });

    it('defaults executionid to subject', () => {
      const event = new ArvoEvent(baseParam());
      expect(event.executionid).toBe(event.subject);
    });

    it('defaults depth to 0', () => {
      expect(new ArvoEvent(baseParam()).depth).toBe(0);
    });

    it('defaults to to null', () => {
      expect(new ArvoEvent(baseParam()).to).toBeNull();
    });

    it('defaults domain to null', () => {
      expect(new ArvoEvent(baseParam()).domain).toBeNull();
    });

    it('defaults baggage to an empty object', () => {
      expect(new ArvoEvent(baseParam()).baggage).toEqual({});
    });

    it('defaults time to a generated ISO timestamp with offset', () => {
      const event = new ArvoEvent(baseParam());
      expect(event.time).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/,
      );
    });

    it('defaults executionunits to null', () => {
      expect(new ArvoEvent(baseParam()).executionunits).toBeNull();
    });

    it('defaults traceparent and tracestate to null', () => {
      const event = new ArvoEvent(baseParam());
      expect(event.traceparent).toBeNull();
      expect(event.tracestate).toBeNull();
    });
  });

  describe('required fields', () => {
    it.each(['subject', 'source', 'type', 'dataschema'] as const)(
      'reports %s as required when omitted',
      (field) => {
        const param = baseParam();
        delete (param as Record<string, unknown>)[field];
        expect(pathsOf(() => new ArvoEvent(param))).toContain(field);
      },
    );

    it('reports data as required when omitted', () => {
      const param = baseParam() as Record<string, unknown>;
      delete param.data;
      expect(pathsOf(() => new ArvoEvent(param as never))).toContain('data');
    });
  });

  describe('non-empty string fields', () => {
    it.each([
      'id',
      'subject',
      'executionid',
      'source',
      'type',
      'dataschema',
    ] as const)('rejects an empty string for %s', (field) => {
      const param = { ...baseParam(), [field]: '' };
      expect(pathsOf(() => new ArvoEvent(param))).toContain(field);
    });
  });

  describe('URI-reference format', () => {
    it.each(['source', 'dataschema'] as const)(
      'accepts a hierarchical path for %s',
      (field) => {
        const param = { ...baseParam(), [field]: 'api/users' };
        expect(() => new ArvoEvent(param)).not.toThrow();
      },
    );

    it.each(['source', 'dataschema'] as const)(
      'rejects whitespace in %s, naming the URI-reference rule',
      (field) => {
        const param = { ...baseParam(), [field]: 'not a uri reference' };
        const issue = issuesOf(() => new ArvoEvent(param)).find(
          (i) => i.path === field,
        );
        expect(issue?.message).toContain('URI-reference');
      },
    );
  });

  describe('character domain', () => {
    it('rejects a control character in a required field, naming the offending code point', () => {
      const param = { ...baseParam(), subject: 'order\u00071' };
      const issue = issuesOf(() => new ArvoEvent(param)).find(
        (i) => i.path === 'subject',
      );
      expect(issue?.message).toContain('U+0007');
    });

    it('rejects a control character in a nullable field', () => {
      const param = { ...baseParam(), category: 'cat\u0007egory' };
      expect(pathsOf(() => new ArvoEvent(param))).toContain('category');
    });

    it('does not apply to strings nested inside data', () => {
      const param = { ...baseParam(), data: { note: 'x\u0007y' } };
      expect(() => new ArvoEvent(param)).not.toThrow();
    });
  });

  describe('nullable string fields', () => {
    it.each(['parentid', 'initid', 'category', 'to', 'domain'] as const)(
      'accepts null for %s',
      (field) => {
        const param = {
          ...baseParam(),
          [field]: null,
        } as unknown as ArvoEventParam;
        expect(() => new ArvoEvent(param)).not.toThrow();
      },
    );

    it.each(['parentid', 'initid', 'category', 'to', 'domain'] as const)(
      'rejects an empty string for %s, distinguishing it from null',
      (field) => {
        const param = { ...baseParam(), [field]: '' };
        expect(pathsOf(() => new ArvoEvent(param))).toContain(field);
      },
    );
  });

  describe('depth', () => {
    it('accepts 0 and positive integers', () => {
      expect(
        () => new ArvoEvent({ ...baseParam(), parentid: 'p', depth: 0 }),
      ).not.toThrow();
      expect(
        () => new ArvoEvent({ ...baseParam(), parentid: 'p', depth: 5 }),
      ).not.toThrow();
    });

    it.each([-1, 1.5, Number.NaN])('rejects %s', (depth) => {
      expect(pathsOf(() => new ArvoEvent({ ...baseParam(), depth }))).toContain(
        'depth',
      );
    });

    it('rejects a non-number', () => {
      const param = {
        ...baseParam(),
        depth: 'three',
      } as unknown as ArvoEventParam;
      expect(pathsOf(() => new ArvoEvent(param))).toContain('depth');
    });
  });

  describe('time', () => {
    it('accepts a timestamp with a UTC offset', () => {
      const param = { ...baseParam(), time: '2024-01-01T00:00:00+05:30' };
      expect(() => new ArvoEvent(param)).not.toThrow();
    });

    it('accepts Z as an offset', () => {
      const param = { ...baseParam(), time: '2024-01-01T00:00:00Z' };
      expect(() => new ArvoEvent(param)).not.toThrow();
    });

    it('rejects a timestamp without an offset', () => {
      const param = { ...baseParam(), time: '2024-01-01T00:00:00' };
      expect(pathsOf(() => new ArvoEvent(param))).toContain('time');
    });

    it('rejects a non-date string', () => {
      const param = { ...baseParam(), time: 'not-a-date' };
      expect(pathsOf(() => new ArvoEvent(param))).toContain('time');
    });
  });

  describe('executionunits', () => {
    it('accepts a negative value — no constraint on sign', () => {
      expect(
        () => new ArvoEvent({ ...baseParam(), executionunits: -50 }),
      ).not.toThrow();
    });

    it('accepts null', () => {
      expect(
        () => new ArvoEvent({ ...baseParam(), executionunits: undefined }),
      ).not.toThrow();
    });

    it.each([Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN])(
      'rejects %s',
      (value) => {
        const param = { ...baseParam(), executionunits: value };
        expect(pathsOf(() => new ArvoEvent(param))).toContain('executionunits');
      },
    );

    it('normalizes negative zero to zero', () => {
      const event = new ArvoEvent({ ...baseParam(), executionunits: -0 });
      expect(event.executionunits).toBe(0);
      expect(Object.is(event.executionunits, -0)).toBe(false);
    });
  });

  describe('trace fields are unvalidated beyond the character domain', () => {
    it('accepts any string for traceparent and tracestate, including an empty one', () => {
      const param = { ...baseParam(), traceparent: 'anything', tracestate: '' };
      expect(() => new ArvoEvent(param)).not.toThrow();
    });

    it('still rejects a forbidden code point in traceparent', () => {
      const param = { ...baseParam(), traceparent: 'bad\u0007value' };
      expect(pathsOf(() => new ArvoEvent(param))).toContain('traceparent');
    });
  });

  describe('category', () => {
    it('accepts a domain-defined value outside the io.arvo. namespace', () => {
      const event = new ArvoEvent({
        ...baseParam(),
        category: 'my-domain.custom',
      });
      expect(event.category).toBe('my-domain.custom');
    });
  });

  describe('strictness', () => {
    it('rejects an unrecognised key', () => {
      const param = { ...baseParam(), notAField: 'x' };
      expect(pathsOf(() => new ArvoEvent(param as never))).toContain(
        'notAField',
      );
    });

    it('rejects a removed field (extensions)', () => {
      const param = { ...baseParam(), extensions: { a: 1 } };
      expect(pathsOf(() => new ArvoEvent(param as never))).toContain(
        'extensions',
      );
    });

    it('rejects a removed field (rootsubject)', () => {
      const param = { ...baseParam(), rootsubject: 'x' };
      expect(pathsOf(() => new ArvoEvent(param as never))).toContain(
        'rootsubject',
      );
    });

    it('rejects a camelCase typo rather than silently treating it as omitted', () => {
      const param = { ...baseParam(), parentId: 'oops' };
      const issues = issuesOf(() => new ArvoEvent(param as never));
      expect(issues.map((i) => i.path)).toContain('parentId');
      // and it must not have silently become a root event with parentid
      // defaulted — i.e. the typo is reported, not swallowed.
    });
  });

  describe('malformed top-level input', () => {
    // Regression: the constructor used to destructure `param` unconditionally
    // before validating it. Destructuring a string or an array spreads its
    // characters/elements as if they were field names (`{...'abc'}` becomes
    // `{0:'a',1:'b',2:'c'}`), producing a flood of spurious "unrecognised
    // key" issues instead of one clean "must be an object" — found when
    // tryParse started routing this kind of input through the real
    // constructor for the first time, rather than pre-filtering it.
    it.each([
      ['a string', 'not an object'],
      ['an array', [1, 2, 3]],
      ['a number', 42],
      ['null', null],
    ] as const)(
      'rejects %s with exactly one clean issue, not one per character or element',
      (_label, input) => {
        const issues = issuesOf(() => new ArvoEvent(input as never));
        expect(issues).toHaveLength(1);
        expect(issues[0]?.path).toBe('event');
      },
    );
  });

  describe('root constraint', () => {
    it('accepts a root event: parentid null, executionid equal to subject, depth 0', () => {
      expect(() => new ArvoEvent(baseParam())).not.toThrow();
    });

    it('rejects a root event whose executionid differs from subject', () => {
      const param = { ...baseParam(), executionid: 'different' };
      expect(pathsOf(() => new ArvoEvent(param))).toContain(
        'parentid + executionid',
      );
    });

    it('rejects a root event with non-zero depth', () => {
      const param = { ...baseParam(), depth: 2 };
      expect(pathsOf(() => new ArvoEvent(param))).toContain('parentid + depth');
    });

    it('PERMITS a caused event (parentid set) at depth 0', () => {
      const param = { ...baseParam(), parentid: 'caused-by-1', depth: 0 };
      expect(() => new ArvoEvent(param)).not.toThrow();
    });

    it('PERMITS a caused event whose executionid equals subject', () => {
      const param = {
        ...baseParam(),
        parentid: 'caused-by-1',
        executionid: baseParam().subject,
        depth: 3,
      };
      expect(() => new ArvoEvent(param)).not.toThrow();
    });
  });

  describe('correlation constraint', () => {
    it('rejects a completion without initid', () => {
      const param = { ...baseParam(), category: 'io.arvo.complete' };
      expect(pathsOf(() => new ArvoEvent(param))).toContain(
        'category + initid',
      );
    });

    it('accepts a completion with initid', () => {
      const param = {
        ...baseParam(),
        category: 'io.arvo.complete',
        initid: 'req-1',
      };
      expect(() => new ArvoEvent(param)).not.toThrow();
    });

    it('PERMITS initid without category set to io.arvo.complete', () => {
      const param = { ...baseParam(), initid: 'req-1' };
      expect(() => new ArvoEvent(param)).not.toThrow();
    });
  });

  describe('payload validity — one case per rejected value class', () => {
    it.each([
      ['top level', { a: Number.NaN }, 'data.a'],
      [
        'nested in an object',
        { a: { b: Number.POSITIVE_INFINITY } },
        'data.a.b',
      ],
      ['nested in an array', { a: [1, Number.NEGATIVE_INFINITY] }, 'data.a[1]'],
    ] as const)(
      'rejects a non-finite number %s',
      (_label, data, expectedPath) => {
        expect(
          pathsOf(() => new ArvoEvent({ ...baseParam(), data })),
        ).toContain(expectedPath);
      },
    );

    it('rejects a bigint as an object property', () => {
      const data = { a: 1n };
      expect(pathsOf(() => new ArvoEvent({ ...baseParam(), data }))).toContain(
        'data.a',
      );
    });

    it('rejects a bigint as an array element', () => {
      const data = { a: [1n] };
      expect(pathsOf(() => new ArvoEvent({ ...baseParam(), data }))).toContain(
        'data.a[0]',
      );
    });

    it('rejects a function', () => {
      const data = { a: () => {} };
      expect(pathsOf(() => new ArvoEvent({ ...baseParam(), data }))).toContain(
        'data.a',
      );
    });

    it('rejects a symbol', () => {
      const data = { a: Symbol('x') };
      expect(pathsOf(() => new ArvoEvent({ ...baseParam(), data }))).toContain(
        'data.a',
      );
    });

    it('accepts a Date, serialized via its own toJSON — see the toJSON() block below', () => {
      const date = new Date('2024-01-01T00:00:00.000Z');
      const event = new ArvoEvent({
        ...baseParam(),
        data: { a: date } as never,
      });
      expect(event.data.a).toBe('2024-01-01T00:00:00.000Z');
    });

    it('rejects a Map', () => {
      const data = { a: new Map() };
      expect(pathsOf(() => new ArvoEvent({ ...baseParam(), data }))).toContain(
        'data.a',
      );
    });

    it('rejects a Set', () => {
      const data = { a: new Set() };
      expect(pathsOf(() => new ArvoEvent({ ...baseParam(), data }))).toContain(
        'data.a',
      );
    });

    it('rejects a RegExp', () => {
      const data = { a: /x/ };
      expect(pathsOf(() => new ArvoEvent({ ...baseParam(), data }))).toContain(
        'data.a',
      );
    });

    it('rejects a class instance', () => {
      class Foo {}
      const data = { a: new Foo() };
      expect(pathsOf(() => new ArvoEvent({ ...baseParam(), data }))).toContain(
        'data.a',
      );
    });

    it.each([
      ['an array', [1, 2, 3]],
      ['a string', 'hello'],
      ['a number', 42],
    ] as const)('rejects %s as the top-level data value', (_label, data) => {
      expect(
        pathsOf(() => new ArvoEvent({ ...baseParam(), data: data as never })),
      ).toContain('data');
    });

    it('rejects a nested value in baggage', () => {
      const param = { ...baseParam(), baggage: { a: { nested: true } } };
      expect(pathsOf(() => new ArvoEvent(param as never))).toContain(
        'baggage.a',
      );
    });

    it('rejects a non-finite number in baggage', () => {
      const param = {
        ...baseParam(),
        baggage: { a: Number.POSITIVE_INFINITY },
      };
      expect(pathsOf(() => new ArvoEvent(param))).toContain('baggage.a');
    });
  });

  describe('toJSON() support', () => {
    it('walks a value with toJSON() in its place, preserving the full return value', () => {
      class Money {
        constructor(public cents: number) {}
        toJSON() {
          return { cents: this.cents, currency: 'USD' };
        }
      }
      const event = new ArvoEvent({
        ...baseParam(),
        data: { price: new Money(500) } as never,
      });
      expect(event.data.price).toEqual({ cents: 500, currency: 'USD' });
    });

    it('finds toJSON inherited through the prototype chain, not only an own property', () => {
      // Date.prototype.toJSON, not an own property on any instance — this is
      // what makes Date accepted a consequence of the rule, not a special case.
      const date = new Date('2024-06-15T10:30:00.000Z');
      const event = new ArvoEvent({
        ...baseParam(),
        data: { when: date } as never,
      });
      expect(event.data.when).toBe('2024-06-15T10:30:00.000Z');
    });

    it('honours toJSON at array position, not only as a map value', () => {
      class Tag {
        constructor(public name: string) {}
        toJSON() {
          return this.name;
        }
      }
      const event = new ArvoEvent({
        ...baseParam(),
        data: { tags: [new Tag('a'), new Tag('b')] } as never,
      });
      expect(event.data.tags).toEqual(['a', 'b']);
    });

    it('rejects a toJSON return value that is still outside the JSON domain, at the same path', () => {
      class Bad {
        toJSON() {
          return { fn: () => {} };
        }
      }
      expect(
        pathsOf(
          () =>
            new ArvoEvent({ ...baseParam(), data: { b: new Bad() } as never }),
        ),
      ).toContain('data.b.fn');
    });

    it('reports a throwing toJSON as a validation issue, not an uncaught exception', () => {
      class Throws {
        toJSON(): never {
          throw new Error('boom');
        }
      }
      const issues = issuesOf(
        () =>
          new ArvoEvent({
            ...baseParam(),
            data: { t: new Throws() } as never,
          }),
      );
      const issue = issues.find((i) => i.path === 'data.t');
      expect(issue?.message).toContain('boom');
    });

    it('still rejects a value with no toJSON at all, exactly as before', () => {
      class PlainClass {}
      expect(
        pathsOf(
          () =>
            new ArvoEvent({
              ...baseParam(),
              data: { a: new PlainClass() } as never,
            }),
        ),
      ).toContain('data.a');
    });

    it('still rejects Map and Set, which have no toJSON', () => {
      expect(
        pathsOf(
          () =>
            new ArvoEvent({ ...baseParam(), data: { a: new Map() } as never }),
        ),
      ).toContain('data.a');
      expect(
        pathsOf(
          () =>
            new ArvoEvent({ ...baseParam(), data: { a: new Set() } as never }),
        ),
      ).toContain('data.a');
    });

    it('catches a cycle created through toJSON, rather than exhausting the stack', () => {
      class Cyclic {
        toJSON(): unknown {
          return { self: this };
        }
      }
      const issues = issuesOf(
        () =>
          new ArvoEvent({
            ...baseParam(),
            data: { c: new Cyclic() } as never,
          }),
      );
      expect(issues.some((i) => i.message.includes('circular'))).toBe(true);
    });

    it('accepts a toJSON-having value legitimately repeated in two branches', () => {
      class Id {
        constructor(public value: string) {}
        toJSON() {
          return this.value;
        }
      }
      const shared = new Id('shared-id');
      const event = new ArvoEvent({
        ...baseParam(),
        data: { a: shared, b: shared } as never,
      });
      expect(event.data.a).toBe('shared-id');
      expect(event.data.b).toBe('shared-id');
    });
  });

  describe('cycle detection', () => {
    it('rejects a self-referential object', () => {
      const data: Record<string, unknown> = { a: 1 };
      data.self = data;
      expect(pathsOf(() => new ArvoEvent({ ...baseParam(), data }))).toContain(
        'data.self',
      );
    });

    it('rejects a self-referential array', () => {
      const arr: unknown[] = [1, 2];
      arr.push(arr);
      const data = { list: arr };
      expect(() => new ArvoEvent({ ...baseParam(), data })).toThrow(
        ArvoEventValidationError,
      );
    });

    it('rejects a mutual reference between two objects', () => {
      const a: Record<string, unknown> = {};
      const b: Record<string, unknown> = { a };
      a.b = b;
      expect(() => new ArvoEvent({ ...baseParam(), data: a })).toThrow(
        ArvoEventValidationError,
      );
    });

    it('ACCEPTS a value legitimately repeated in two branches, which is not a cycle', () => {
      const shared = { x: 1 };
      const data = { a: shared, b: shared };
      expect(() => new ArvoEvent({ ...baseParam(), data })).not.toThrow();
    });
  });

  describe('undefined handling', () => {
    it('omits a map key whose value is undefined', () => {
      const event = new ArvoEvent({
        ...baseParam(),
        data: { a: undefined, b: 1 } as never,
      });
      expect('a' in event.data).toBe(false);
      expect(event.data.b).toBe(1);
    });

    it('replaces an undefined array element with null, preserving positions', () => {
      const event = new ArvoEvent({
        ...baseParam(),
        data: { list: [1, undefined, 3] } as never,
      });
      expect(event.data.list).toEqual([1, null, 3]);
    });

    it('omits an undefined value from baggage', () => {
      const event = new ArvoEvent({
        ...baseParam(),
        baggage: { a: undefined, b: 'x' } as never,
      });
      expect('a' in event.baggage).toBe(false);
      expect(event.baggage.b).toBe('x');
    });

    it('produces a payload equivalent to serializing the original input', () => {
      const input = { a: undefined, b: 1, c: [undefined, 2] };
      const event = new ArvoEvent({ ...baseParam(), data: input as never });
      expect(event.data).toEqual(JSON.parse(JSON.stringify(input)));
    });
  });

  describe('deeply nested valid structures', () => {
    it('accepts several levels of nested objects and arrays without false rejection', () => {
      const data = {
        a: { b: { c: [1, 2, { d: 'deep', e: [true, false, null] }] } },
      };
      expect(() => new ArvoEvent({ ...baseParam(), data })).not.toThrow();
    });
  });

  describe('path reporting', () => {
    it('names the exact path to a failure several levels deep, including array indices', () => {
      const data = { a: { b: [{ c: Number.NaN }] } };
      expect(pathsOf(() => new ArvoEvent({ ...baseParam(), data }))).toContain(
        'data.a.b[0].c',
      );
    });

    it('brackets a non-identifier key', () => {
      const data = { 'weird key': Number.NaN };
      expect(pathsOf(() => new ArvoEvent({ ...baseParam(), data }))).toContain(
        'data["weird key"]',
      );
    });
  });

  describe('immutability', () => {
    it('freezes the constructed instance', () => {
      expect(Object.isFrozen(new ArvoEvent(baseParam()))).toBe(true);
    });

    it('does not change a field when assignment is attempted', () => {
      const event = new ArvoEvent(baseParam());
      try {
        // @ts-expect-error - readonly, deliberate runtime mutation attempt
        event.subject = 'other';
      } catch {
        // strict mode throws on a frozen object; either outcome is fine
      }
      expect(event.subject).toBe('test-subject');
    });

    it('freezes data', () => {
      expect(Object.isFrozen(new ArvoEvent(baseParam()).data)).toBe(true);
    });

    it('freezes nested values within data', () => {
      const event = new ArvoEvent({
        ...baseParam(),
        data: { nested: { a: 1 } },
      });
      expect(Object.isFrozen((event.data as { nested: unknown }).nested)).toBe(
        true,
      );
    });

    it('freezes baggage', () => {
      const event = new ArvoEvent({ ...baseParam(), baggage: { a: 'x' } });
      expect(Object.isFrozen(event.baggage)).toBe(true);
    });

    it('does not change a nested payload value when mutation is attempted', () => {
      const event = new ArvoEvent({
        ...baseParam(),
        data: { nested: { a: 1 } },
      });
      const nested = event.data.nested as { a: number };
      try {
        nested.a = 999;
      } catch {
        // strict mode throws; either outcome is fine
      }
      expect(nested.a).toBe(1);
    });
  });

  describe('trusted input', () => {
    it('skips the payload walk when skipPayloadValidation is set', () => {
      const event = new ArvoEvent(
        { ...baseParam(), data: { a: Number.POSITIVE_INFINITY } },
        { skipPayloadValidation: true },
      );
      expect(event.data.a).toBe(Number.POSITIVE_INFINITY);
      expect(Object.isFrozen(event.data)).toBe(false);
    });

    it('still enforces field rules when skipPayloadValidation is set', () => {
      expect(
        pathsOf(
          () =>
            new ArvoEvent(
              { ...baseParam(), depth: -1 },
              { skipPayloadValidation: true },
            ),
        ),
      ).toContain('depth');
    });

    it('still enforces cross-field rules when skipPayloadValidation is set', () => {
      expect(
        pathsOf(
          () =>
            new ArvoEvent(
              { ...baseParam(), executionid: 'wrong' },
              { skipPayloadValidation: true },
            ),
        ),
      ).toContain('parentid + executionid');
    });

    it('still freezes the instance itself when skipPayloadValidation is set', () => {
      const event = new ArvoEvent(baseParam(), { skipPayloadValidation: true });
      expect(Object.isFrozen(event)).toBe(true);
    });
  });

  describe('diagnostics', () => {
    it('names the field, the rule, and the received value for a field failure', () => {
      const issues = issuesOf(
        () => new ArvoEvent({ ...baseParam(), depth: -1 }),
      );
      const issue = issues.find((i) => i.path === 'depth');
      expect(issue).toBeDefined();
      expect(issue?.message).toContain('non-negative integer');
      expect(issue?.received).toBe(-1);
    });

    it('reports several field failures together rather than only the first', () => {
      const param = { source: '', type: '' } as unknown as ArvoEventParam;
      const issues = issuesOf(() => new ArvoEvent(param));
      expect(issues.length).toBeGreaterThanOrEqual(3);
    });

    it('explains a cross-field failure rather than naming only the fields', () => {
      const issues = issuesOf(
        () => new ArvoEvent({ ...baseParam(), category: 'io.arvo.complete' }),
      );
      const issue = issues.find((i) => i.path === 'category + initid');
      expect(issue?.message).toContain('must carry initid');
    });

    it('preserves every issue on the thrown error, accessible without parsing the message', () => {
      const issues = issuesOf(
        () => new ArvoEvent({ ...baseParam(), depth: -1 }),
      );
      expect(Array.isArray(issues)).toBe(true);
      expect(issues.length).toBeGreaterThan(0);
    });
  });

  describe('span-derived trace context', () => {
    it('derives traceparent and tracestate from a SpanContext', () => {
      const spanContext = {
        traceId: '0af7651916cd43dd8448eb211c80319c',
        spanId: 'b7ad6b7169203331',
        traceFlags: 1,
      };
      const event = new ArvoEvent({
        ...baseParam(),
        span: spanContext,
      } as never);
      expect(event.traceparent).toBe(
        '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      );
    });
  });

  describe('acceptance test', () => {
    it('an event built from only the required fields, taking every default, is a well-formed root event', () => {
      const event = new ArvoEvent({
        subject: 'wf-1',
        source: 'svc.a',
        type: 'order.created',
        dataschema: 'schema://a/v1',
        data: {},
      });

      expect(event.parentid).toBeNull();
      expect(event.executionid).toBe(event.subject);
      expect(event.depth).toBe(0);
      expect(Object.isFrozen(event)).toBe(true);
    });
  });
});

describe('ArvoEvent.parse', () => {
  it('succeeds identically to new ArvoEvent(...), field for field', () => {
    const param = baseParam();
    const viaNew = new ArvoEvent(param);
    const viaParse = ArvoEvent.parse(param);
    expect(viaParse).toBeInstanceOf(ArvoEvent);
    expect(viaParse.subject).toBe(viaNew.subject);
    expect(viaParse.source).toBe(viaNew.source);
    expect(viaParse.dataschema).toBe(viaNew.dataschema);
    expect(viaParse.executionid).toBe(viaParse.subject);
    expect(Object.isFrozen(viaParse)).toBe(true);
  });

  it('throws ArvoEventValidationError on invalid input, with the same issues a direct construction would produce', () => {
    const bad = { source: 'a' };
    let fromParse: ArvoEventValidationError | undefined;
    let fromNew: ArvoEventValidationError | undefined;
    try {
      ArvoEvent.parse(bad as never);
    } catch (e) {
      fromParse = e as ArvoEventValidationError;
    }
    try {
      new ArvoEvent(bad as never);
    } catch (e) {
      fromNew = e as ArvoEventValidationError;
    }
    expect(fromParse).toBeInstanceOf(ArvoEventValidationError);
    expect(fromParse?.message).toBe(fromNew?.message);
  });
});

describe('ArvoEvent.tryParse', () => {
  it('returns a genuine ArvoEvent instance on success', () => {
    const result = ArvoEvent.tryParse(baseParam());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeInstanceOf(ArvoEvent);
      expect(result.value.executionid).toBe(result.value.subject);
    }
  });

  it('reports failure as a value rather than throwing on invalid input', () => {
    const result = ArvoEvent.tryParse({ source: 'a' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ArvoEventValidationError);
      expect(result.error.issues.some((i) => i.path === 'subject')).toBe(true);
    }
  });

  it('fails cleanly on input that is not even an object', () => {
    const result = ArvoEvent.tryParse('not an object');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0]?.path).toBe('event');
    }
  });

  it('still enforces structural rules, not bypassing them', () => {
    const result = ArvoEvent.tryParse({
      ...baseParam(),
      data: { a: Number.POSITIVE_INFINITY },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.issues.some((i) => i.path === 'data.a')).toBe(true);
    }
  });

  it("returns arvo-core's own plain Result shape, not a leaked neverthrow instance", () => {
    const success = ArvoEvent.tryParse(baseParam());
    expect(success.constructor).toBe(Object);
    expect('isOk' in success).toBe(false);
    expect('match' in success).toBe(false);
    expect('_unsafeUnwrap' in success).toBe(false);

    const failure = ArvoEvent.tryParse({ source: 'a' });
    expect(failure.constructor).toBe(Object);
    expect('isOk' in failure).toBe(false);
  });

  it('agrees with parse on the same input, success and failure alike', () => {
    const param = baseParam();
    const viaParse = ArvoEvent.parse(param);
    const tried = ArvoEvent.tryParse(param);
    expect(tried.ok).toBe(true);
    if (tried.ok) {
      expect(tried.value.subject).toBe(viaParse.subject);
      expect(tried.value.dataschema).toBe(viaParse.dataschema);
    }

    const bad = { source: 'a' };
    let thrown: ArvoEventValidationError | undefined;
    try {
      ArvoEvent.parse(bad as never);
    } catch (e) {
      thrown = e as ArvoEventValidationError;
    }
    const failed = ArvoEvent.tryParse(bad);
    expect(thrown).toBeInstanceOf(ArvoEventValidationError);
    expect(!failed.ok && failed.error.message).toBe(thrown?.message);
  });

  it('re-throws a non-ArvoEventValidationError rather than wrapping it in an error result', () => {
    // The constructor spreads `param` before validation ever runs, which
    // invokes a getter if present. A throwing getter produces a genuine
    // non-validation exception straight out of the constructor.
    const pathological = {
      get subject(): string {
        throw new RangeError('boom-from-getter');
      },
      source: 'a',
      type: 't',
      dataschema: 'd',
      data: {},
    };

    expect(() => ArvoEvent.tryParse(pathological)).toThrow(RangeError);
    expect(() => ArvoEvent.tryParse(pathological)).not.toThrow(
      ArvoEventValidationError,
    );
  });
});
