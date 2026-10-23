import type { SpanContext } from '@opentelemetry/api';
import { trace } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import { ArvoEvent } from '../../src/ArvoEvent/index.js';
import {
  mutateArvoEvent,
  tryMutateArvoEvent,
} from '../../src/factories/mutateArvoEvent.js';

const requiredFields = {
  source: 'com.test.suite',
  subject: 'order-42',
  type: 'com_order_created',
  dataschema: '#/com/order/create/1.0.0',
  data: { order_id: 'o-1' },
};

/** An event carrying a value in every field a mutation must carry across. */
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

/** An event holding `null` in every field that may be `null`. */
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

/** A span begun with no SDK and nothing to continue: its context carries no valid trace. */
const spanWithoutTrace = trace
  .getTracer('mutate-event-test')
  .startSpan('nothing');

/** Every field of an event, so a test can say "every other field" and mean it. */
const everyField = [
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
  'data',
  'dataschema',
  'baggage',
  'time',
  'traceparent',
  'tracestate',
  'executionunits',
] as const;

const expectSameExcept = (
  mutated: ArvoEvent,
  source: ArvoEvent,
  except: readonly (typeof everyField)[number][],
): void => {
  for (const field of everyField) {
    if (except.includes(field)) continue;
    expect(mutated[field], field).toEqual(source[field]);
  }
};

describe('mutating an event', () => {
  it('carries every field across where nothing is replaced, identity and time included', () => {
    expectSameExcept(mutateArvoEvent(fullEvent, {}), fullEvent, []);
  });

  it('replaces one field and carries every other', () => {
    const mutated = mutateArvoEvent(fullEvent, { to: 'com.audit.log' });
    expect(mutated.to).toBe('com.audit.log');
    expectSameExcept(mutated, fullEvent, ['to']);
  });

  it('replaces several fields at once and carries every other', () => {
    const mutated = mutateArvoEvent(fullEvent, {
      to: 'com.audit.log',
      domain: 'audit',
      executionunits: 7,
    });
    expect(mutated.to).toBe('com.audit.log');
    expect(mutated.domain).toBe('audit');
    expect(mutated.executionunits).toBe(7);
    expectSameExcept(mutated, fullEvent, ['to', 'domain', 'executionunits']);
  });

  describe('every replaceable field, in turn', () => {
    const replacements = {
      id: 'id-2',
      parentid: 'parent-2',
      initid: 'init-2',
      subject: 'order-43',
      executionid: 'execution-2',
      category: 'io.arvo.init',
      depth: 4,
      source: 'com.other.suite',
      to: 'com.audit.log',
      domain: 'audit',
      type: 'com_order_audited',
      data: { order_id: 'o-2' },
      dataschema: '#/com/order/audit/1.0.0',
      baggage: { tenant: 'globex' },
      time: '2026-01-01T00:00:00.000Z',
      executionunits: 9,
    } as const;

    it.each(Object.entries(replacements))(
      'replaces %s and carries every other field',
      (field, replacement) => {
        const mutated = mutateArvoEvent(fullEvent, { [field]: replacement });
        expect(mutated[field as keyof typeof replacements]).toEqual(
          replacement,
        );
        expectSameExcept(mutated, fullEvent, [
          field as (typeof everyField)[number],
        ]);
      },
    );
  });

  it('replaces the type and the payload together', () => {
    const mutated = mutateArvoEvent(fullEvent, {
      type: 'com_order_audited',
      data: { audited: true },
    });
    expect(mutated.type).toBe('com_order_audited');
    expect(mutated.data).toEqual({ audited: true });
    expectSameExcept(mutated, fullEvent, ['type', 'data']);
  });

  it("carries the event's own type and payload where neither is replaced", () => {
    const mutated = mutateArvoEvent(fullEvent, { to: 'com.audit.log' });
    expect(mutated.type).toBe(fullEvent.type);
    expect(mutated.data).toEqual(fullEvent.data);
  });

  it('keeps a field the event holds as null', () => {
    const mutated = mutateArvoEvent(bareEvent, { executionunits: 2 });
    expect(mutated.parentid).toBeNull();
    expect(mutated.initid).toBeNull();
    expect(mutated.category).toBeNull();
    expect(mutated.to).toBeNull();
    expect(mutated.domain).toBeNull();
    expect(mutated.traceparent).toBeNull();
    expect(mutated.tracestate).toBeNull();
    expect(mutated.executionunits).toBe(2);
  });

  describe('a replacement given as undefined replaces nothing', () => {
    it('keeps the time, rather than taking a new one', () => {
      expect(mutateArvoEvent(fullEvent, { time: undefined }).time).toBe(
        fullEvent.time,
      );
    });

    it('keeps the identity, rather than taking a new one', () => {
      expect(mutateArvoEvent(fullEvent, { id: undefined }).id).toBe(
        fullEvent.id,
      );
    });

    it('keeps the address', () => {
      expect(mutateArvoEvent(fullEvent, { to: undefined }).to).toBe(
        fullEvent.to,
      );
    });

    it('is the same as replacing nothing where every key is undefined', () => {
      const mutated = mutateArvoEvent(fullEvent, {
        to: undefined,
        id: undefined,
        subject: undefined,
        domain: undefined,
      });
      expect(mutated.toString()).toBe(
        mutateArvoEvent(fullEvent, {}).toString(),
      );
    });

    it('still clears a field given as null by an untyped caller', () => {
      // The mutation type spells optional inputs as `T | undefined`, so a
      // null is only reachable by a caller no compiler saw; the validator
      // keeps the documented runtime behaviour, which is to clear.
      expect(mutateArvoEvent(fullEvent, { to: null as never }).to).toBeNull();
    });
  });

  it('carries causal fields rather than deriving them', () => {
    const mutated = mutateArvoEvent(fullEvent, { to: 'com.audit.log' });
    expect(mutated.parentid).toBe('parent-1');
    expect(mutated.initid).toBe('init-1');
    expect(mutated.depth).toBe(3);
    expect(mutated.executionid).toBe(fullEvent.executionid);
  });

  it('leaves the event it mutated unchanged', () => {
    const originalJson = fullEvent.toString();
    mutateArvoEvent(fullEvent, { to: 'com.audit.log', span: spanWithState });
    expect(fullEvent.toString()).toBe(originalJson);
  });

  it('reports a replacement that breaks a rule, naming the field', () => {
    const attempt = tryMutateArvoEvent(fullEvent, { to: '' });
    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.error.issues[0]?.path).toBe('to');
  });
});

describe("a mutation's trace context", () => {
  const replacementHeader = `00-${'9'.repeat(32)}-${'8'.repeat(16)}-01`;

  it("takes a replacement span over the event's headers, replacing both", () => {
    const mutated = mutateArvoEvent(fullEvent, { span: spanWithoutState });
    expect(mutated.traceparent).toBe(
      `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`,
    );
    expect(mutated.tracestate).toBeNull();
    expectSameExcept(mutated, fullEvent, ['traceparent', 'tracestate']);
  });

  it("takes a span's own trace state where it has one", () => {
    expect(mutateArvoEvent(fullEvent, { span: spanWithState }).tracestate).toBe(
      'vendor=fromspan',
    );
  });

  it('takes both replacement headers', () => {
    const mutated = mutateArvoEvent(fullEvent, {
      traceparent: replacementHeader,
      tracestate: 'vendor=override',
    });
    expect(mutated.traceparent).toBe(replacementHeader);
    expect(mutated.tracestate).toBe('vendor=override');
  });

  it('replaces one header and carries the other across', () => {
    const mutated = mutateArvoEvent(fullEvent, {
      traceparent: replacementHeader,
    });
    expect(mutated.traceparent).toBe(replacementHeader);
    expect(mutated.tracestate).toBe('vendor=original');
  });

  it("carries the event's own where nothing trace-related is replaced", () => {
    const mutated = mutateArvoEvent(fullEvent, { to: 'com.audit.log' });
    expect(mutated.traceparent).toBe(fullEvent.traceparent);
    expect(mutated.tracestate).toBe(fullEvent.tracestate);
  });

  it('carries none where the event carried none and nothing is replaced', () => {
    const mutated = mutateArvoEvent(bareEvent, { to: 'com.audit.log' });
    expect(mutated.traceparent).toBeNull();
    expect(mutated.tracestate).toBeNull();
  });

  it('takes a span where the event carried nothing', () => {
    expect(
      mutateArvoEvent(bareEvent, { span: spanWithoutState }).traceparent,
    ).toBe(`00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`);
  });

  it("a span with no valid trace leaves the event's own trace context", () => {
    const mutated = mutateArvoEvent(fullEvent, { span: spanWithoutTrace });
    expect(mutated.traceparent).toBe(fullEvent.traceparent);
    expect(mutated.tracestate).toBe(fullEvent.tracestate);
  });

  it('a span with no valid trace leaves none where there was none', () => {
    const mutated = mutateArvoEvent(bareEvent, { span: spanWithoutTrace });
    expect(mutated.traceparent).toBeNull();
    expect(mutated.tracestate).toBeNull();
  });
});

describe('the package entry', () => {
  it('exports the pair, so code built on arvo-core can reach it', async () => {
    const packageEntry = await import('../../src/index.js');
    expect(packageEntry.mutateArvoEvent).toBe(mutateArvoEvent);
    expect(packageEntry.tryMutateArvoEvent).toBe(tryMutateArvoEvent);
  });
});
