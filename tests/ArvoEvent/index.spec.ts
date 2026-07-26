import type { Span, SpanContext } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import { ArvoEventValidationError } from '../../src/ArvoEvent/errors.js';
import { ArvoEvent } from '../../src/ArvoEvent/index.js';
import type { ArvoEventParam } from '../../src/ArvoEvent/types.js';

const baseParam = (): ArvoEventParam<'test.event', { hello: string }> => ({
  source: 'test/source',
  subject: 'test-subject',
  type: 'test.event',
  data: { hello: 'world' },
});

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

    it('defaults to to null', () => {
      expect(new ArvoEvent(baseParam()).to).toBeNull();
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

    it('defaults domain to null', () => {
      expect(new ArvoEvent(baseParam()).domain).toBeNull();
    });

    it('defaults traceparent and tracestate to null', () => {
      const event = new ArvoEvent(baseParam());
      expect(event.traceparent).toBeNull();
      expect(event.tracestate).toBeNull();
    });

    it('defaults baggage to an empty object', () => {
      expect(new ArvoEvent(baseParam()).baggage).toEqual({});
    });

    it('defaults dataschema to null', () => {
      expect(new ArvoEvent(baseParam()).dataschema).toBeNull();
    });

    it('defaults depth to 0', () => {
      expect(new ArvoEvent(baseParam()).depth).toBe(0);
    });

    it('defaults extensions to an empty object', () => {
      expect(new ArvoEvent(baseParam()).extensions).toEqual({});
    });

    it('defaults rootsubject to subject when omitted (root event)', () => {
      const param = baseParam();
      const event = new ArvoEvent(param);
      expect(event.rootsubject).toBe(param.subject);
    });
  });

  describe('explicit values', () => {
    it('respects an explicitly provided id', () => {
      const event = new ArvoEvent({ ...baseParam(), id: 'my-custom-id' });
      expect(event.id).toBe('my-custom-id');
    });

    it('respects an explicitly provided parentid', () => {
      const event = new ArvoEvent({ ...baseParam(), parentid: 'parent-id' });
      expect(event.parentid).toBe('parent-id');
    });

    it('respects an explicitly provided to', () => {
      const event = new ArvoEvent({ ...baseParam(), to: 'destination' });
      expect(event.to).toBe('destination');
    });

    it('respects an explicitly provided time', () => {
      const time = '2026-01-01T00:00:00.000+00:00';
      const event = new ArvoEvent({ ...baseParam(), time });
      expect(event.time).toBe(time);
    });

    it('respects an explicitly provided executionunits', () => {
      const event = new ArvoEvent({ ...baseParam(), executionunits: 42 });
      expect(event.executionunits).toBe(42);
    });

    it('respects an explicitly provided domain', () => {
      const event = new ArvoEvent({ ...baseParam(), domain: 'my.domain' });
      expect(event.domain).toBe('my.domain');
    });

    it('respects explicitly provided traceparent and tracestate', () => {
      const traceparent =
        '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
      const event = new ArvoEvent({
        ...baseParam(),
        traceparent,
        tracestate: 'vendor=value',
      });
      expect(event.traceparent).toBe(traceparent);
      expect(event.tracestate).toBe('vendor=value');
    });

    it('respects an explicitly provided dataschema', () => {
      const event = new ArvoEvent({ ...baseParam(), dataschema: 'schema/v1' });
      expect(event.dataschema).toBe('schema/v1');
    });

    it('respects explicitly provided baggage', () => {
      const baggage = { tenant: 'acme', retries: 3, active: true, note: null };
      const event = new ArvoEvent({ ...baseParam(), baggage });
      expect(event.baggage).toEqual(baggage);
    });

    it('respects an explicitly provided rootsubject different from subject (non-root event)', () => {
      const event = new ArvoEvent({
        ...baseParam(),
        rootsubject: 'root-subject',
        depth: 1,
      });
      expect(event.rootsubject).toBe('root-subject');
    });

    it('respects an explicitly provided depth', () => {
      const event = new ArvoEvent({
        ...baseParam(),
        rootsubject: 'root-subject',
        depth: 3,
      });
      expect(event.depth).toBe(3);
    });

    it('passes through source, subject, type, and data unchanged', () => {
      const param = baseParam();
      const event = new ArvoEvent(param);
      expect(event.source).toBe(param.source);
      expect(event.subject).toBe(param.subject);
      expect(event.type).toBe(param.type);
      expect(event.data).toEqual(param.data);
    });

    it('respects explicitly provided extensions', () => {
      const extensions = { customKey: 'customValue' };
      const event = new ArvoEvent(baseParam(), extensions);
      expect(event.extensions).toEqual(extensions);
    });
  });

  describe('trace context derivation from span', () => {
    const spanContext = (
      overrides: Partial<SpanContext> = {},
    ): SpanContext => ({
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      traceFlags: 1,
      ...overrides,
    });

    const fakeSpan = (context: SpanContext): Span =>
      ({ spanContext: () => context }) as Span;

    it('derives traceparent from a raw SpanContext', () => {
      const event = new ArvoEvent({ ...baseParam(), span: spanContext() });
      expect(event.traceparent).toBe(
        '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      );
    });

    it('derives traceparent from a Span by calling spanContext()', () => {
      const event = new ArvoEvent({
        ...baseParam(),
        span: fakeSpan(spanContext()),
      });
      expect(event.traceparent).toBe(
        '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      );
    });

    it('encodes traceFlags as a zero-padded two-digit hex value', () => {
      const notSampled = new ArvoEvent({
        ...baseParam(),
        span: spanContext({ traceFlags: 0 }),
      });
      expect(notSampled.traceparent).toBe(
        '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00',
      );
    });

    it('defaults tracestate to null when the SpanContext has no traceState', () => {
      const event = new ArvoEvent({ ...baseParam(), span: spanContext() });
      expect(event.tracestate).toBeNull();
    });

    it('derives tracestate by calling traceState.serialize() when present', () => {
      const event = new ArvoEvent({
        ...baseParam(),
        span: spanContext({
          traceState: {
            serialize: () => 'vendor=value',
          } as SpanContext['traceState'],
        }),
      });
      expect(event.tracestate).toBe('vendor=value');
    });

    it('prefers span over traceparent/tracestate when both are somehow provided', () => {
      const event = new ArvoEvent({
        ...baseParam(),
        traceparent: 'should-be-ignored',
        tracestate: 'should-be-ignored',
        span: spanContext(),
      } as ArvoEventParam<'test.event', { hello: string }>);
      expect(event.traceparent).toBe(
        '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      );
    });
  });

  describe('required field validation', () => {
    it('throws when source is an empty string', () => {
      expect(() => new ArvoEvent({ ...baseParam(), source: '' })).toThrow(
        ArvoEventValidationError,
      );
    });

    it('throws when subject is an empty string', () => {
      expect(() => new ArvoEvent({ ...baseParam(), subject: '' })).toThrow(
        ArvoEventValidationError,
      );
    });

    it('throws when type is an empty string', () => {
      expect(() => new ArvoEvent({ ...baseParam(), type: '' })).toThrow(
        ArvoEventValidationError,
      );
    });

    it('throws when dataschema is explicitly an empty string', () => {
      expect(() => new ArvoEvent({ ...baseParam(), dataschema: '' })).toThrow(
        ArvoEventValidationError,
      );
    });
  });

  describe('time validation', () => {
    it('accepts a valid ISO datetime with a numeric offset', () => {
      expect(
        () =>
          new ArvoEvent({
            ...baseParam(),
            time: '2026-01-01T00:00:00.000+05:00',
          }),
      ).not.toThrow();
    });

    it('accepts a valid ISO datetime with a Z suffix', () => {
      expect(
        () =>
          new ArvoEvent({ ...baseParam(), time: '2026-01-01T00:00:00.000Z' }),
      ).not.toThrow();
    });

    it('throws on a non-ISO time string', () => {
      expect(
        () => new ArvoEvent({ ...baseParam(), time: 'not-a-date' }),
      ).toThrow(ArvoEventValidationError);
    });

    it('throws on a date-only string missing the time component', () => {
      expect(
        () => new ArvoEvent({ ...baseParam(), time: '2026-01-01' }),
      ).toThrow(ArvoEventValidationError);
    });
  });

  describe('executionunits validation', () => {
    it('accepts zero', () => {
      expect(
        () => new ArvoEvent({ ...baseParam(), executionunits: 0 }),
      ).not.toThrow();
    });

    it('accepts a positive number', () => {
      expect(
        () => new ArvoEvent({ ...baseParam(), executionunits: 12.5 }),
      ).not.toThrow();
    });

    it('throws on a negative number', () => {
      expect(
        () => new ArvoEvent({ ...baseParam(), executionunits: -1 }),
      ).toThrow(ArvoEventValidationError);
    });
  });

  describe('depth validation', () => {
    it('throws on a negative depth', () => {
      expect(
        () =>
          new ArvoEvent({
            ...baseParam(),
            rootsubject: baseParam().subject,
            depth: -1,
          }),
      ).toThrow(ArvoEventValidationError);
    });

    it('throws on a non-integer depth', () => {
      expect(
        () =>
          new ArvoEvent({ ...baseParam(), rootsubject: 'root', depth: 1.5 }),
      ).toThrow(ArvoEventValidationError);
    });
  });

  describe('root event consistency (depth vs. rootsubject/subject)', () => {
    it('accepts a root event: rootsubject omitted, depth omitted (both default consistently)', () => {
      expect(() => new ArvoEvent(baseParam())).not.toThrow();
    });

    it('accepts a root event: rootsubject explicitly equal to subject, depth explicitly 0', () => {
      const param = baseParam();
      expect(
        () => new ArvoEvent({ ...param, rootsubject: param.subject, depth: 0 }),
      ).not.toThrow();
    });

    it('accepts a non-root event: rootsubject different from subject, depth >= 1', () => {
      expect(
        () =>
          new ArvoEvent({ ...baseParam(), rootsubject: 'some-root', depth: 1 }),
      ).not.toThrow();
    });

    it('throws when depth is 0 but rootsubject differs from subject', () => {
      expect(
        () =>
          new ArvoEvent({ ...baseParam(), rootsubject: 'some-root', depth: 0 }),
      ).toThrow(ArvoEventValidationError);
    });

    it('throws when depth is >= 1 but rootsubject defaults to (equals) subject', () => {
      expect(() => new ArvoEvent({ ...baseParam(), depth: 1 })).toThrow(
        ArvoEventValidationError,
      );
    });

    it('throws when depth is >= 1 and rootsubject is explicitly set equal to subject', () => {
      const param = baseParam();
      expect(
        () => new ArvoEvent({ ...param, rootsubject: param.subject, depth: 2 }),
      ).toThrow(ArvoEventValidationError);
    });
  });

  describe('baggage validation', () => {
    it('accepts scalar values: string, number, boolean, null', () => {
      const baggage = { a: 'x', b: 1, c: true, d: null };
      expect(() => new ArvoEvent({ ...baseParam(), baggage })).not.toThrow();
    });

    it('throws when a baggage value is a nested object', () => {
      const baggage = { nested: { a: 1 } } as any;
      expect(() => new ArvoEvent({ ...baseParam(), baggage })).toThrow(
        ArvoEventValidationError,
      );
    });

    it('throws when a baggage value is an array', () => {
      const baggage = { list: [1, 2, 3] } as any;
      expect(() => new ArvoEvent({ ...baseParam(), baggage })).toThrow(
        ArvoEventValidationError,
      );
    });
  });

  describe('extensions validation', () => {
    it('accepts scalar extension values', () => {
      expect(
        () => new ArvoEvent(baseParam(), { a: 'x', b: 1, c: true, d: null }),
      ).not.toThrow();
    });

    it('throws when an extension value is a nested object', () => {
      const extensions = { nested: { a: 1 } } as any;
      expect(() => new ArvoEvent(baseParam(), extensions)).toThrow(
        ArvoEventValidationError,
      );
    });

    it('throws at runtime when an extension key collides with a known ArvoEvent field, even if the type system is bypassed', () => {
      const extensions = { subject: 'malicious-override' } as any;
      expect(() => new ArvoEvent(baseParam(), extensions)).toThrow(
        ArvoEventValidationError,
      );
    });

    it('throws at runtime when an extension key collides with "data"', () => {
      const extensions = { data: 'malicious-override' } as any;
      expect(() => new ArvoEvent(baseParam(), extensions)).toThrow(
        ArvoEventValidationError,
      );
    });
  });

  describe('data JSON-serializability validation', () => {
    it('accepts plain JSON-serializable data', () => {
      expect(
        () =>
          new ArvoEvent({
            ...baseParam(),
            data: { a: 1, b: [1, 2, 3], c: { d: null } },
          }),
      ).not.toThrow();
    });

    it('throws with a descriptive, cause-preserving message when data contains a circular reference', () => {
      const circular: any = { a: 1 };
      circular.self = circular;

      try {
        new ArvoEvent({ ...baseParam(), data: circular });
        expect.unreachable('expected constructor to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(ArvoEventValidationError);
        expect((error as ArvoEventValidationError).message).toContain(
          'JSON serializable',
        );
        expect((error as ArvoEventValidationError).cause).toBeDefined();
      }
    });

    it('throws when data contains a BigInt', () => {
      expect(
        () => new ArvoEvent({ ...baseParam(), data: { big: 10n as any } }),
      ).toThrow(ArvoEventValidationError);
    });

    it('stringifies the failure reason when a custom toJSON throws a non-Error value', () => {
      const throwsNonError = {
        toJSON() {
          throw 'not an Error instance';
        },
      };

      try {
        new ArvoEvent({ ...baseParam(), data: throwsNonError as any });
        expect.unreachable('expected constructor to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(ArvoEventValidationError);
        expect((error as ArvoEventValidationError).message).toContain(
          'not an Error instance',
        );
      }
    });
  });

  describe('ArvoEventValidationError shape', () => {
    it('is an instance of Error and ArvoEventValidationError', () => {
      try {
        new ArvoEvent({ ...baseParam(), subject: '' });
        expect.unreachable('expected constructor to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(ArvoEventValidationError);
      }
    });

    it('has the _tag discriminant set', () => {
      try {
        new ArvoEvent({ ...baseParam(), subject: '' });
        expect.unreachable('expected constructor to throw');
      } catch (error) {
        expect((error as ArvoEventValidationError)._tag).toBe(
          'ArvoEventValidationError',
        );
      }
    });

    it('has name set to ArvoEventValidationError', () => {
      try {
        new ArvoEvent({ ...baseParam(), subject: '' });
        expect.unreachable('expected constructor to throw');
      } catch (error) {
        expect((error as ArvoEventValidationError).name).toBe(
          'ArvoEventValidationError',
        );
      }
    });

    it('carries the raw ZodError as cause for schema validation failures', () => {
      try {
        new ArvoEvent({ ...baseParam(), subject: '' });
        expect.unreachable('expected constructor to throw');
      } catch (error) {
        const cause = (error as ArvoEventValidationError).cause as {
          issues?: unknown[];
        };
        expect(cause).toBeDefined();
        expect(Array.isArray(cause.issues)).toBe(true);
      }
    });

    it('includes the failing field path in the message for schema validation failures', () => {
      try {
        new ArvoEvent({ ...baseParam(), subject: '' });
        expect.unreachable('expected constructor to throw');
      } catch (error) {
        expect((error as ArvoEventValidationError).message).toContain(
          'subject',
        );
      }
    });
  });
});
