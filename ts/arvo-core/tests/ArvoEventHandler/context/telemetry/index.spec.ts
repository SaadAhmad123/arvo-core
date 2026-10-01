import {
  type Attributes,
  type Meter,
  metrics,
  type Span,
  type SpanContext,
  SpanStatusCode,
  TraceFlags,
  trace,
} from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import { ArvoExecutionContextTelemetry } from '../../../../src/ArvoEventHandler/context/telemetry/index.js';
import type { ArvoLogRecord } from '../../../../src/ArvoEventHandler/context/telemetry/types.js';
import { ArvoHandlerFault } from '../../../../src/ArvoEventHandler/fault/index.js';
import { initEvent } from '../../fixtures.js';

/** Everything a span was asked to record, for asserting against. */
const spy = (overrides: Partial<SpanContext> = {}) => {
  const attributes: Attributes[] = [];
  const events: { name: string; attributes?: Attributes }[] = [];
  const exceptions: unknown[] = [];
  const statuses: { code: SpanStatusCode; message?: string }[] = [];
  const span = {
    spanContext: () => ({
      traceId: '0af7651916cd43dd8448eb211c80319c',
      spanId: 'b7ad6b7169203331',
      traceFlags: TraceFlags.SAMPLED,
      ...overrides,
    }),
    setAttributes: (given: Attributes) => attributes.push(given),
    addEvent: (name: string, given?: Attributes) =>
      events.push({ name, attributes: given }),
    recordException: (given: unknown) => exceptions.push(given),
    setStatus: (given: { code: SpanStatusCode; message?: string }) =>
      statuses.push(given),
  } as unknown as Span;
  return { span, attributes, events, exceptions, statuses };
};

/** Everything a meter and a logger were asked to record. */
const watching = (span: Span) => {
  const counted: { name: string; attributes?: unknown }[] = [];
  const logged: ArvoLogRecord[] = [];
  const telemetry = new ArvoExecutionContextTelemetry({
    span,
    meter: {
      createCounter: (name: string) => ({
        add: (_value: number, attributes?: unknown) =>
          counted.push({ name, attributes }),
      }),
      createHistogram: () => ({ record: () => undefined }),
    } as unknown as Meter,
    logger: { emit: (record) => logged.push(record) },
  });
  return { telemetry, counted, logged };
};

const built = (span: Span) =>
  new ArvoExecutionContextTelemetry({
    span,
    meter: metrics.getMeter('test'),
    logger: { emit: () => undefined },
  });

const fault = () =>
  new ArvoHandlerFault({
    faultKind: 'run_timeout',
    message: 'the executor did not return in time',
    subject: initEvent.subject,
    executionId: initEvent.executionid,
    eventId: initEvent.id,
    attempt: 0,
    cause: null,
    violations: [],
    timestamp: 1_700_000_000_000,
    retry: { maxRetryAttemptsAllowed: 3, retryInMs: 300, retryAt: 1 },
    abandonmentEvent: null,
    abandonmentState: null,
  });

describe("one execution's telemetry", () => {
  it('carries the span it was given, unchanged', () => {
    const { span } = spy();
    expect(built(span).span).toBe(span);
  });

  it('holds metering and logging of its own', () => {
    const telemetry = built(spy().span);
    expect(telemetry.metric).toBeDefined();
    expect(telemetry.logger).toBeDefined();
  });

  describe('the headers it derives', () => {
    it('names the trace and the span, in W3C form', () => {
      expect(built(spy().span).traceparent).toBe(
        '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      );
    });

    it('carries no trace state where the span has none', () => {
      expect(built(spy().span).tracestate).toBeNull();
    });

    it('carries the trace state where it has one', () => {
      const { span } = spy({
        traceState: {
          serialize: () => 'vendor=value',
        } as SpanContext['traceState'],
      });
      expect(built(span).tracestate).toBe('vendor=value');
    });

    it('says the flags the span carries', () => {
      const { span } = spy({ traceFlags: TraceFlags.NONE });
      expect(built(span).traceparent).toMatch(/-00$/);
    });

    it('says it records something where the span does', () => {
      expect(built(spy().span).isRecording).toBe(true);
    });
  });

  describe('a span that records nothing', () => {
    // With no SDK configured the API returns a span whose context is empty.
    const telemetry = () =>
      built(trace.getTracer('test').startSpan('execution'));

    it('says so', () => {
      expect(telemetry().isRecording).toBe(false);
    });

    it('offers no traceparent', () => {
      expect(telemetry().traceparent).toBeNull();
    });

    it('offers no tracestate', () => {
      expect(telemetry().tracestate).toBeNull();
    });

    it('still carries the span, so an executor may record against it', () => {
      expect(telemetry().span).toBeDefined();
    });
  });

  describe('attributes an executor records', () => {
    it('reach the span', () => {
      const watched = spy();
      built(watched.span).setAttributes({ 'order.items': 3 });
      expect(watched.attributes[0]).toEqual({ 'arvo.order.items': 3 });
    });

    it('are prefixed, so this package signals stay together', () => {
      const watched = spy();
      built(watched.span).setAttributes({ a: 1, b: 2 });
      expect(Object.keys(watched.attributes[0] ?? {})).toEqual([
        'arvo.a',
        'arvo.b',
      ]);
    });
  });

  describe('something that happened during the execution', () => {
    it('reaches the span as an event', () => {
      const watched = spy();
      built(watched.span).addEvent('charged', { receipt: 'r-1' });
      expect(watched.events[0]).toEqual({
        name: 'arvo.charged',
        attributes: { receipt: 'r-1' },
      });
    });

    it('needs no attributes', () => {
      const watched = spy();
      built(watched.span).addEvent('charged');
      expect(watched.events[0]?.attributes).toBeUndefined();
    });
  });

  describe('marking how the execution went', () => {
    it('says it succeeded', () => {
      const watched = spy();
      built(watched.span).setSpanOk();
      expect(watched.statuses[0]).toEqual({ code: SpanStatusCode.OK });
    });

    it('says it failed, with the reason given', () => {
      const watched = spy();
      built(watched.span).setSpanError('the gateway refused');
      expect(watched.statuses[0]).toEqual({
        code: SpanStatusCode.ERROR,
        message: 'the gateway refused',
      });
    });

    it('says it failed with something generic where nothing said why', () => {
      const watched = spy();
      built(watched.span).setSpanError();
      expect(watched.statuses[0]).toEqual({
        code: SpanStatusCode.ERROR,
        message: 'the execution did not succeed',
      });
    });
  });

  describe('a fault recorded before it is raised', () => {
    it('reaches the span as an exception', () => {
      const watched = spy();
      const raised = fault();
      built(watched.span).recordFault(raised);
      expect(watched.exceptions[0]).toBe(raised);
    });

    it('says which fault it was, and whether another attempt is due', () => {
      const watched = spy();
      built(watched.span).recordFault(fault());
      expect(watched.attributes[0]).toEqual({
        'arvo.fault.kind': 'run_timeout',
        'arvo.fault.retryable': true,
      });
    });

    it('says no attempt is due where none is', () => {
      const watched = spy();
      const spent = new ArvoHandlerFault({
        ...fault(),
        message: fault().message,
        violations: [],
        retry: null,
      } as never);
      built(watched.span).recordFault(spent);
      expect(watched.attributes[0]).toMatchObject({
        'arvo.fault.retryable': false,
      });
    });

    it('marks the span failed, with the reason', () => {
      const watched = spy();
      built(watched.span).recordFault(fault());
      expect(watched.statuses[0]).toEqual({
        code: SpanStatusCode.ERROR,
        message: 'the executor did not return in time',
      });
    });

    it('counts it by kind, so faults can be charted and alerted on', () => {
      const watched = watching(spy().span);
      watched.telemetry.recordFault(fault());
      expect(watched.counted).toEqual([
        {
          name: 'arvo.faults',
          attributes: { 'fault.kind': 'run_timeout', 'fault.retryable': true },
        },
      ]);
    });

    it('puts nothing identifying on the counter, cardinality costing there', () => {
      const watched = watching(spy().span);
      watched.telemetry.recordFault(fault());
      expect(
        Object.keys(watched.counted[0]?.attributes as object).sort(),
      ).toEqual(['fault.kind', 'fault.retryable']);
    });

    it('logs it, that being the one signal sampling cannot drop', () => {
      const watched = watching(spy().span);
      watched.telemetry.recordFault(fault());
      expect(watched.logged[0]?.severityNumber).toBe(17);
      expect(watched.logged[0]?.body).toBe(
        'the executor did not return in time',
      );
    });

    it('names the execution in that log, where cardinality costs nothing', () => {
      const watched = watching(spy().span);
      watched.telemetry.recordFault(fault());
      expect(watched.logged[0]?.attributes).toEqual({
        'fault.kind': 'run_timeout',
        'fault.retryable': true,
        subject: initEvent.subject,
        'execution.id': initEvent.executionid,
        'event.id': initEvent.id,
        attempt: 0,
      });
    });
  });
});
