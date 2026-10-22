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

/** An event carrying a value in every field a copy must not invent. */
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

describe('a clone of an event', () => {
  it('carries every field across, identity and time included', () => {
    const clonedEvent = cloneArvoEvent(fullEvent);
    expect(clonedEvent.toString()).toBe(fullEvent.toString());
    expect(clonedEvent.id).toBe(fullEvent.id);
    expect(clonedEvent.time).toBe(fullEvent.time);
  });

  it('is another value, not the same one', () => {
    expect(cloneArvoEvent(fullEvent)).not.toBe(fullEvent);
  });

  it('carries causal fields rather than deriving them', () => {
    const clonedEvent = cloneArvoEvent(fullEvent);
    expect(clonedEvent.parentid).toBe('parent-1');
    expect(clonedEvent.initid).toBe('init-1');
    expect(clonedEvent.depth).toBe(3);
    expect(clonedEvent.executionid).toBe(fullEvent.executionid);
  });

  it('carries null across as null', () => {
    const clonedEvent = cloneArvoEvent(bareEvent);
    expect(clonedEvent.parentid).toBeNull();
    expect(clonedEvent.to).toBeNull();
    expect(clonedEvent.domain).toBeNull();
    expect(clonedEvent.traceparent).toBeNull();
    expect(clonedEvent.executionunits).toBeNull();
  });

  it('carries the trace context as it stands', () => {
    const clonedEvent = cloneArvoEvent(fullEvent);
    expect(clonedEvent.traceparent).toBe(fullEvent.traceparent);
    expect(clonedEvent.tracestate).toBe(fullEvent.tracestate);
  });

  it('leaves the event it cloned unchanged', () => {
    const originalJson = fullEvent.toString();
    cloneArvoEvent(fullEvent);
    expect(fullEvent.toString()).toBe(originalJson);
  });

  it('keeps the type and payload types of its source', () => {
    const typedEvent = new ArvoEvent({
      ...requiredFields,
      type: 'com_order_created' as const,
    });
    const clonedEvent: ArvoEvent<'com_order_created', { order_id: string }> =
      cloneArvoEvent(typedEvent);
    expect(clonedEvent.data.order_id).toBe('o-1');
  });
});

describe('cloning, as a pair', () => {
  it('reports a copy as a value from the primitive', () => {
    const attempt = tryCloneArvoEvent(fullEvent);
    expect(attempt.ok).toBe(true);
    if (!attempt.ok) return;
    expect(attempt.value.toString()).toBe(fullEvent.toString());
  });

  it('agrees between the two forms', () => {
    const attempt = tryCloneArvoEvent(fullEvent);
    if (!attempt.ok) throw attempt.error;
    expect(cloneArvoEvent(fullEvent).toString()).toBe(attempt.value.toString());
  });

  describe('something that is not a well-formed event', () => {
    // deliberately invalid: an event-shaped value whose recipient breaks a
    // structural rule, which no real event can carry
    const malformedEvent = { ...fullEvent, to: '' } as ArvoEvent;

    it('is reported by the primitive, naming the field', () => {
      const attempt = tryCloneArvoEvent(malformedEvent);
      expect(attempt.ok).toBe(false);
      if (attempt.ok) return;
      expect(attempt.error.issues[0]?.path).toBe('to');
    });

    it('is thrown by the throwing form as the primitive reported it', () => {
      const attempt = tryCloneArvoEvent(malformedEvent);
      if (attempt.ok) throw new Error('expected a failure');
      expect(() => cloneArvoEvent(malformedEvent)).toThrow(
        attempt.error.message,
      );
    });
  });
});
