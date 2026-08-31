import type { SpanContext } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import { ArvoEvent } from '../../src/ArvoEvent/index.js';
import {
  cloneArvoEvent,
  tryCloneArvoEvent,
} from '../../src/factories/cloneArvoEvent.js';

const fields = {
  source: 'com.test.suite',
  subject: 'order-42',
  type: 'com_order_created',
  dataschema: '#/com/order/create/1.0.0',
  data: { order_id: 'o-1' },
};

/** An event carrying a value in every field a clone must not invent. */
const source = new ArvoEvent({
  ...fields,
  parentid: 'parent-1',
  initid: 'init-1',
  category: 'io.arvo.transit',
  depth: 3,
  to: 'com.next',
  domain: 'orders',
  baggage: { tenant: 'acme' },
  executionunits: 1.5,
  traceparent: `00-${'1'.repeat(32)}-${'2'.repeat(16)}-01`,
  tracestate: 'vendor=original',
});

const bare = new ArvoEvent(fields);

const spanWithout = {
  traceId: 'a'.repeat(32),
  spanId: 'b'.repeat(16),
  traceFlags: 1,
} as SpanContext;

const spanWith = {
  ...spanWithout,
  traceState: { serialize: () => 'vendor=fromspan' },
} as unknown as SpanContext;

describe('a clone of an event', () => {
  it('carries every field across, identity and time included', () => {
    const clone = cloneArvoEvent(source);
    for (const field of [
      'id',
      'parentid',
      'initid',
      'subject',
      'executionid',
      'category',
      'depth',
      'source',
      'to',
      'domain',
      'type',
      'dataschema',
      'time',
      'executionunits',
    ] as const) {
      expect(clone[field]).toEqual(source[field]);
    }
    expect(clone.data).toEqual(source.data);
    expect(clone.baggage).toEqual(source.baggage);
  });

  it('applies a replacement and leaves the rest', () => {
    const clone = cloneArvoEvent(source, { to: 'com.audit.log' });
    expect(clone.to).toBe('com.audit.log');
    expect(clone.id).toBe(source.id);
    expect(clone.subject).toBe(source.subject);
    expect(clone.data).toEqual(source.data);
  });

  it('carries causal fields rather than deriving them', () => {
    const clone = cloneArvoEvent(source);
    expect(clone.parentid).toBe('parent-1');
    expect(clone.initid).toBe('init-1');
    expect(clone.depth).toBe(3);
  });

  it('carries null across as null', () => {
    const clone = cloneArvoEvent(bare);
    expect(clone.parentid).toBeNull();
    expect(clone.to).toBeNull();
    expect(clone.domain).toBeNull();
    expect(clone.executionunits).toBeNull();
  });

  describe('a replacement given as undefined', () => {
    // A caller assembling the overrides from computed values produces keys
    // that are present and undefined. Each of these wiped the field before.
    it('keeps the address', () => {
      expect(cloneArvoEvent(source, { to: undefined }).to).toBe(source.to);
    });

    it('keeps the identity', () => {
      expect(cloneArvoEvent(source, { id: undefined }).id).toBe(source.id);
    });

    it('keeps the subject, so the clone stays valid', () => {
      expect(cloneArvoEvent(source, { subject: undefined }).subject).toBe(
        source.subject,
      );
    });

    it('replaces nothing at all where every key is undefined', () => {
      const clone = cloneArvoEvent(source, {
        to: undefined,
        id: undefined,
        subject: undefined,
        domain: undefined,
      });
      expect(clone.toString()).toBe(cloneArvoEvent(source).toString());
    });

    it('still clears a field given as null', () => {
      // `undefined` means "no replacement"; clearing is what null is for.
      expect(cloneArvoEvent(source, { to: null }).to).toBeNull();
    });
  });

  it('leaves the event it cloned unchanged', () => {
    const before = source.toString();
    cloneArvoEvent(source, { to: 'com.audit.log' });
    expect(source.toString()).toBe(before);
  });

  it('reports a replacement that breaks a rule', () => {
    const attempt = tryCloneArvoEvent(source, { to: '' });
    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.error.issues[0]?.path).toBe('to');
  });
});

describe("a clone's trace context", () => {
  it('takes a replacement span over the source headers', () => {
    const clone = cloneArvoEvent(source, { span: spanWithout });
    expect(clone.traceparent).toBe(`00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`);
  });

  it('takes a span whole, discarding the source trace state', () => {
    // A traceparent from one trace beside a tracestate from another would
    // describe a trace that never happened.
    expect(cloneArvoEvent(source, { span: spanWithout }).tracestate).toBeNull();
  });

  it("takes a span's own trace state where it has one", () => {
    expect(cloneArvoEvent(source, { span: spanWith }).tracestate).toBe(
      'vendor=fromspan',
    );
  });

  it('takes both replacement headers', () => {
    const clone = cloneArvoEvent(source, {
      traceparent: `00-${'9'.repeat(32)}-${'8'.repeat(16)}-01`,
      tracestate: 'vendor=override',
    });
    expect(clone.traceparent).toBe(`00-${'9'.repeat(32)}-${'8'.repeat(16)}-01`);
    expect(clone.tracestate).toBe('vendor=override');
  });

  it('replaces one header and carries the other across', () => {
    // The asymmetry with a span, which replaces both: a header replaces only
    // itself.
    const clone = cloneArvoEvent(source, {
      traceparent: `00-${'9'.repeat(32)}-${'8'.repeat(16)}-01`,
    });
    expect(clone.traceparent).toBe(`00-${'9'.repeat(32)}-${'8'.repeat(16)}-01`);
    expect(clone.tracestate).toBe('vendor=original');
  });

  it("carries the source's where nothing trace-related is replaced", () => {
    const clone = cloneArvoEvent(source, { to: 'com.audit.log' });
    expect(clone.traceparent).toBe(source.traceparent);
    expect(clone.tracestate).toBe(source.tracestate);
  });

  it('takes a span where the source carried nothing', () => {
    expect(cloneArvoEvent(bare, { span: spanWithout }).traceparent).toBe(
      `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`,
    );
  });

  it('carries none where there is nothing either side', () => {
    const clone = cloneArvoEvent(bare);
    expect(clone.traceparent).toBeNull();
    expect(clone.tracestate).toBeNull();
  });
});
