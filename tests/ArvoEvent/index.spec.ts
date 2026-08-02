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
  });

  describe('trace fields are deliberately unvalidated', () => {
    it('accepts any string for traceparent and tracestate, including an empty one', () => {
      const param = { ...baseParam(), traceparent: 'anything', tracestate: '' };
      expect(() => new ArvoEvent(param)).not.toThrow();
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

    it('rejects a Date', () => {
      const data = { a: new Date() };
      expect(pathsOf(() => new ArvoEvent({ ...baseParam(), data }))).toContain(
        'data.a',
      );
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

describe('ArvoEvent.safeParse', () => {
  it('returns a genuine ArvoEvent instance on success', () => {
    const result = ArvoEvent.safeParse(baseParam());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.event).toBeInstanceOf(ArvoEvent);
      expect(result.event.executionid).toBe(result.event.subject);
    }
  });

  it('reports issues rather than throwing on invalid input', () => {
    const result = ArvoEvent.safeParse({ source: 'a' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.some((i) => i.path === 'subject')).toBe(true);
    }
  });

  it('fails cleanly on input that is not even an object', () => {
    const result = ArvoEvent.safeParse('not an object');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]?.path).toBe('event');
    }
  });

  it('still enforces structural rules, not bypassing them', () => {
    const result = ArvoEvent.safeParse({
      ...baseParam(),
      data: { a: Number.POSITIVE_INFINITY },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.some((i) => i.path === 'data.a')).toBe(true);
    }
  });
});
