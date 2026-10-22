import type { SpanContext } from '@opentelemetry/api';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { ArvoEvent } from '../../src/ArvoEvent/index.js';
import { mutateArvoEvent } from '../../src/factories/mutateArvoEvent.js';

/**
 * The type level, run so it compiles where the suite does.
 *
 * Each `@ts-expect-error` is an assertion: if the line stopped being an
 * error, `pnpm typecheck` would fail on the directive itself.
 */

const created = new ArvoEvent<'evt_order_created', { orderId: string }>({
  source: 'com.test.suite',
  subject: 'order-42',
  type: 'evt_order_created',
  dataschema: '#/com/order/create/1.0.0',
  data: { orderId: 'o-1' },
});

const span = {
  traceId: 'a'.repeat(32),
  spanId: 'b'.repeat(16),
  traceFlags: 1,
} as SpanContext;

describe('what the compiler says a mutation is', () => {
  it("keeps the event's type and payload type where neither is replaced", () => {
    const mutated = mutateArvoEvent(created, { span });
    expectTypeOf(mutated).toEqualTypeOf<
      ArvoEvent<'evt_order_created', { orderId: string }>
    >();
    expect(mutated.type).toBe('evt_order_created');
  });

  it('keeps them where another field is replaced', () => {
    const mutated = mutateArvoEvent(created, { to: 'com_audit_log' });
    expectTypeOf(mutated).toEqualTypeOf<
      ArvoEvent<'evt_order_created', { orderId: string }>
    >();
    expect(mutated.to).toBe('com_audit_log');
  });

  it('takes a replacement type as its literal', () => {
    const mutated = mutateArvoEvent(created, { type: 'evt_order_audited' });
    expectTypeOf(mutated.type).toEqualTypeOf<'evt_order_audited'>();
    expect(mutated.type).toBe('evt_order_audited');
  });

  it("takes a replacement payload's type", () => {
    const mutated = mutateArvoEvent(created, {
      data: { orderId: 'o-1', audited: true },
    });
    expectTypeOf(mutated.data).toEqualTypeOf<{
      orderId: string;
      audited: boolean;
    }>();
    expect(mutated.data.audited).toBe(true);
  });

  it('takes the mutation in the shape an event is built from, span included', () => {
    const mutated = mutateArvoEvent(created, { span, to: 'com_audit_log' });
    expectTypeOf(mutated).toEqualTypeOf<
      ArvoEvent<'evt_order_created', { orderId: string }>
    >();
    expect(mutated.traceparent).toBe(
      `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`,
    );
  });
});
