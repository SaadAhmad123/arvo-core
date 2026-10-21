import type { SpanContext } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import { ArvoEvent } from '../../src/ArvoEvent/index.js';
import {
  cloneArvoEvent,
  tryCloneArvoEvent,
} from '../../src/factories/cloneArvoEvent.js';

const requiredFields = {
  source: 'com.test.suite',
  subject: 'order-42',
  type: 'com_order_created',
  dataschema: '#/com/order/create/1.0.0',
  data: { order_id: 'o-1' },
};

/** An event carrying a value in every field a clone must not invent. */
const fullEvent = new ArvoEvent({
  ...requiredFields,
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

const bareEvent = new ArvoEvent(requiredFields);

const spanWithoutState = {
  traceId: 'a'.repeat(32),
  spanId: 'b'.repeat(16),
  traceFlags: 1,
} as SpanContext;

const spanWithState = {
  ...spanWithoutState,
  traceState: { serialize: () => 'vendor=fromspan' },
} as unknown as SpanContext;

describe('a clone of an event', () => {
  it('carries every field across, identity and time included', () => {
    const clonedEvent = cloneArvoEvent(fullEvent);
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
      expect(clonedEvent[field]).toEqual(fullEvent[field]);
    }
    expect(clonedEvent.data).toEqual(fullEvent.data);
    expect(clonedEvent.baggage).toEqual(fullEvent.baggage);
  });

  it('applies a replacement and leaves the rest', () => {
    const clonedEvent = cloneArvoEvent(fullEvent, { to: 'com.audit.log' });
    expect(clonedEvent.to).toBe('com.audit.log');
    expect(clonedEvent.id).toBe(fullEvent.id);
    expect(clonedEvent.subject).toBe(fullEvent.subject);
    expect(clonedEvent.data).toEqual(fullEvent.data);
  });

  it('carries causal fields rather than deriving them', () => {
    const clonedEvent = cloneArvoEvent(fullEvent);
    expect(clonedEvent.parentid).toBe('parent-1');
    expect(clonedEvent.initid).toBe('init-1');
    expect(clonedEvent.depth).toBe(3);
  });

  it('carries null across as null', () => {
    const clonedEvent = cloneArvoEvent(bareEvent);
    expect(clonedEvent.parentid).toBeNull();
    expect(clonedEvent.to).toBeNull();
    expect(clonedEvent.domain).toBeNull();
    expect(clonedEvent.executionunits).toBeNull();
  });

  describe('a replacement given as undefined', () => {
    // A caller assembling the overrides from computed values produces keys
    // that are present and undefined. Each of these wiped the field before.
    it('keeps the address', () => {
      expect(cloneArvoEvent(fullEvent, { to: undefined }).to).toBe(
        fullEvent.to,
      );
    });

    it('keeps the identity', () => {
      expect(cloneArvoEvent(fullEvent, { id: undefined }).id).toBe(
        fullEvent.id,
      );
    });

    it('keeps the subject, so the clone stays valid', () => {
      expect(cloneArvoEvent(fullEvent, { subject: undefined }).subject).toBe(
        fullEvent.subject,
      );
    });

    it('replaces nothing at all where every key is undefined', () => {
      const clonedEvent = cloneArvoEvent(fullEvent, {
        to: undefined,
        id: undefined,
        subject: undefined,
        domain: undefined,
      });
      expect(clonedEvent.toString()).toBe(cloneArvoEvent(fullEvent).toString());
    });

    it('still clears a field given as null', () => {
      // `undefined` means "no replacement"; clearing is what null is for.
      // The param type spells optional inputs as `T | undefined`, so this
      // documented runtime behaviour is not expressible without a cast.
      expect(cloneArvoEvent(fullEvent, { to: null as never }).to).toBeNull();
    });
  });

  it('leaves the event it cloned unchanged', () => {
    const originalJson = fullEvent.toString();
    cloneArvoEvent(fullEvent, { to: 'com.audit.log' });
    expect(fullEvent.toString()).toBe(originalJson);
  });

  it('reports a replacement that breaks a rule', () => {
    const cloneResult = tryCloneArvoEvent(fullEvent, { to: '' });
    expect(cloneResult.ok).toBe(false);
    if (cloneResult.ok) return;
    expect(cloneResult.error.issues[0]?.path).toBe('to');
  });
});

describe("a clone's trace context", () => {
  it('takes a replacement span over the source headers', () => {
    const clonedEvent = cloneArvoEvent(fullEvent, { span: spanWithoutState });
    expect(clonedEvent.traceparent).toBe(
      `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`,
    );
  });

  it('takes a span whole, discarding the source trace state', () => {
    // A traceparent from one trace beside a tracestate from another would
    // describe a trace that never happened.
    expect(
      cloneArvoEvent(fullEvent, { span: spanWithoutState }).tracestate,
    ).toBeNull();
  });

  it("takes a span's own trace state where it has one", () => {
    expect(cloneArvoEvent(fullEvent, { span: spanWithState }).tracestate).toBe(
      'vendor=fromspan',
    );
  });

  it('takes both replacement headers', () => {
    const clonedEvent = cloneArvoEvent(fullEvent, {
      traceparent: `00-${'9'.repeat(32)}-${'8'.repeat(16)}-01`,
      tracestate: 'vendor=override',
    });
    expect(clonedEvent.traceparent).toBe(
      `00-${'9'.repeat(32)}-${'8'.repeat(16)}-01`,
    );
    expect(clonedEvent.tracestate).toBe('vendor=override');
  });

  it('replaces one header and carries the other across', () => {
    // The asymmetry with a span, which replaces both: a header replaces only
    // itself.
    const clonedEvent = cloneArvoEvent(fullEvent, {
      traceparent: `00-${'9'.repeat(32)}-${'8'.repeat(16)}-01`,
    });
    expect(clonedEvent.traceparent).toBe(
      `00-${'9'.repeat(32)}-${'8'.repeat(16)}-01`,
    );
    expect(clonedEvent.tracestate).toBe('vendor=original');
  });

  it("carries the source's where nothing trace-related is replaced", () => {
    const clonedEvent = cloneArvoEvent(fullEvent, { to: 'com.audit.log' });
    expect(clonedEvent.traceparent).toBe(fullEvent.traceparent);
    expect(clonedEvent.tracestate).toBe(fullEvent.tracestate);
  });

  it('takes a span where the source carried nothing', () => {
    expect(
      cloneArvoEvent(bareEvent, { span: spanWithoutState }).traceparent,
    ).toBe(`00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`);
  });

  it('carries none where there is nothing either side', () => {
    const clonedEvent = cloneArvoEvent(bareEvent);
    expect(clonedEvent.traceparent).toBeNull();
    expect(clonedEvent.tracestate).toBeNull();
  });
});
