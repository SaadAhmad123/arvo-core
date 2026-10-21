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
const spySpan = (overrides: Partial<SpanContext> = {}) => {
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
    setAttributes: (attributeSet: Attributes) => attributes.push(attributeSet),
    addEvent: (eventName: string, eventAttributes?: Attributes) =>
      events.push({ name: eventName, attributes: eventAttributes }),
    recordException: (exception: unknown) => exceptions.push(exception),
    setStatus: (status: { code: SpanStatusCode; message?: string }) =>
      statuses.push(status),
  } as unknown as Span;
  return { span, attributes, events, exceptions, statuses };
};

/** Everything a meter and a logger were asked to record. */
const spyTelemetry = (span: Span) => {
  const counterCalls: { name: string; attributes?: unknown }[] = [];
  const logRecords: ArvoLogRecord[] = [];
  const telemetry = new ArvoExecutionContextTelemetry({
    span,
    meter: {
      createCounter: (counterName: string) => ({
        add: (_increment: number, attributes?: unknown) =>
          counterCalls.push({ name: counterName, attributes }),
      }),
      createHistogram: () => ({ record: () => undefined }),
    } as unknown as Meter,
    logger: { emit: (record) => logRecords.push(record) },
  });
  return { telemetry, counterCalls, logRecords };
};

const contextTelemetry = (span: Span) =>
  new ArvoExecutionContextTelemetry({
    span,
    meter: metrics.getMeter('test'),
    logger: { emit: () => undefined },
  });

const timeoutFault = () =>
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
    const { span } = spySpan();
    expect(contextTelemetry(span).span).toBe(span);
  });

  it('holds metering and logging of its own', () => {
    const telemetry = contextTelemetry(spySpan().span);
    expect(telemetry.metric).toBeDefined();
    expect(telemetry.logger).toBeDefined();
  });

  describe('the headers it derives', () => {
    it('names the trace and the span, in W3C form', () => {
      expect(contextTelemetry(spySpan().span).traceparent).toBe(
        '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      );
    });

    it('carries no trace state where the span has none', () => {
      expect(contextTelemetry(spySpan().span).tracestate).toBeNull();
    });

    it('carries the trace state where it has one', () => {
      const { span } = spySpan({
        traceState: {
          serialize: () => 'vendor=value',
        } as SpanContext['traceState'],
      });
      expect(contextTelemetry(span).tracestate).toBe('vendor=value');
    });

    it('says the flags the span carries', () => {
      const { span } = spySpan({ traceFlags: TraceFlags.NONE });
      expect(contextTelemetry(span).traceparent).toMatch(/-00$/);
    });

    it('says it records something where the span does', () => {
      expect(contextTelemetry(spySpan().span).isRecording).toBe(true);
    });
  });

  describe('a span that records nothing', () => {
    // With no SDK configured the API returns a span whose context is empty.
    const nonRecordingTelemetry = () =>
      contextTelemetry(trace.getTracer('test').startSpan('execution'));

    it('says so', () => {
      expect(nonRecordingTelemetry().isRecording).toBe(false);
    });

    it('offers no traceparent', () => {
      expect(nonRecordingTelemetry().traceparent).toBeNull();
    });

    it('offers no tracestate', () => {
      expect(nonRecordingTelemetry().tracestate).toBeNull();
    });

    it('still carries the span, so an executor may record against it', () => {
      expect(nonRecordingTelemetry().span).toBeDefined();
    });
  });

  describe('attributes an executor records', () => {
    it('reach the span', () => {
      const spanCalls = spySpan();
      contextTelemetry(spanCalls.span).setAttributes({ 'order.items': 3 });
      expect(spanCalls.attributes[0]).toEqual({ 'arvo.order.items': 3 });
    });

    it('are prefixed, so this package signals stay together', () => {
      const spanCalls = spySpan();
      contextTelemetry(spanCalls.span).setAttributes({ a: 1, b: 2 });
      expect(Object.keys(spanCalls.attributes[0] ?? {})).toEqual([
        'arvo.a',
        'arvo.b',
      ]);
    });
  });

  describe('something that happened during the execution', () => {
    it('reaches the span as an event', () => {
      const spanCalls = spySpan();
      contextTelemetry(spanCalls.span).addEvent('charged', { receipt: 'r-1' });
      expect(spanCalls.events[0]).toEqual({
        name: 'arvo.charged',
        attributes: { receipt: 'r-1' },
      });
    });

    it('needs no attributes', () => {
      const spanCalls = spySpan();
      contextTelemetry(spanCalls.span).addEvent('charged');
      expect(spanCalls.events[0]?.attributes).toBeUndefined();
    });
  });

  describe('marking how the execution went', () => {
    it('says it succeeded', () => {
      const spanCalls = spySpan();
      contextTelemetry(spanCalls.span).setSpanOk();
      expect(spanCalls.statuses[0]).toEqual({ code: SpanStatusCode.OK });
    });

    it('says it failed, with the reason given', () => {
      const spanCalls = spySpan();
      contextTelemetry(spanCalls.span).setSpanError('the gateway refused');
      expect(spanCalls.statuses[0]).toEqual({
        code: SpanStatusCode.ERROR,
        message: 'the gateway refused',
      });
    });

    it('says it failed with something generic where nothing said why', () => {
      const spanCalls = spySpan();
      contextTelemetry(spanCalls.span).setSpanError();
      expect(spanCalls.statuses[0]).toEqual({
        code: SpanStatusCode.ERROR,
        message: 'the execution did not succeed',
      });
    });
  });

  describe('a fault recorded before it is raised', () => {
    it('reaches the span as an exception', () => {
      const spanCalls = spySpan();
      const recordedFault = timeoutFault();
      contextTelemetry(spanCalls.span).recordFault(recordedFault);
      expect(spanCalls.exceptions[0]).toBe(recordedFault);
    });

    it('says which fault it was, and whether another attempt is due', () => {
      const spanCalls = spySpan();
      contextTelemetry(spanCalls.span).recordFault(timeoutFault());
      expect(spanCalls.attributes[0]).toEqual({
        'arvo.fault.kind': 'run_timeout',
        'arvo.fault.retryable': true,
      });
    });

    it('says no attempt is due where none is', () => {
      const spanCalls = spySpan();
      const exhaustedFault = new ArvoHandlerFault({
        ...timeoutFault(),
        message: timeoutFault().message,
        violations: [],
        retry: null,
      } as never);
      contextTelemetry(spanCalls.span).recordFault(exhaustedFault);
      expect(spanCalls.attributes[0]).toMatchObject({
        'arvo.fault.retryable': false,
      });
    });

    it('marks the span failed, with the reason', () => {
      const spanCalls = spySpan();
      contextTelemetry(spanCalls.span).recordFault(timeoutFault());
      expect(spanCalls.statuses[0]).toEqual({
        code: SpanStatusCode.ERROR,
        message: 'the executor did not return in time',
      });
    });

    it('counts it by kind, so faults can be charted and alerted on', () => {
      const telemetryCalls = spyTelemetry(spySpan().span);
      telemetryCalls.telemetry.recordFault(timeoutFault());
      expect(telemetryCalls.counterCalls).toEqual([
        {
          name: 'arvo.faults',
          attributes: { 'fault.kind': 'run_timeout', 'fault.retryable': true },
        },
      ]);
    });

    it('puts nothing identifying on the counter, cardinality costing there', () => {
      const telemetryCalls = spyTelemetry(spySpan().span);
      telemetryCalls.telemetry.recordFault(timeoutFault());
      expect(
        Object.keys(
          telemetryCalls.counterCalls[0]?.attributes as object,
        ).sort(),
      ).toEqual(['fault.kind', 'fault.retryable']);
    });

    it('logs it, that being the one signal sampling cannot drop', () => {
      const telemetryCalls = spyTelemetry(spySpan().span);
      telemetryCalls.telemetry.recordFault(timeoutFault());
      expect(telemetryCalls.logRecords[0]?.severityNumber).toBe(17);
      expect(telemetryCalls.logRecords[0]?.body).toBe(
        'the executor did not return in time',
      );
    });

    it('names the execution in that log, where cardinality costs nothing', () => {
      const telemetryCalls = spyTelemetry(spySpan().span);
      telemetryCalls.telemetry.recordFault(timeoutFault());
      expect(telemetryCalls.logRecords[0]?.attributes).toEqual({
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

describe('an execution nothing is collecting from', () => {
  const uncollectedTelemetry = () =>
    new ArvoExecutionContextTelemetry({
      span: trace.getTracer('test').startSpan('execution'),
      meter: null,
      logger: null,
    });

  it('is built, rather than refusing for want of a backend', () => {
    expect(uncollectedTelemetry()).toBeInstanceOf(
      ArvoExecutionContextTelemetry,
    );
  });

  it('counts and measures to nothing, without an executor asking first', () => {
    const telemetry = uncollectedTelemetry();
    expect(() => telemetry.metric.count('charges')).not.toThrow();
    expect(() => telemetry.metric.record('latency', 12)).not.toThrow();
    expect(telemetry.metric.meter).toBeNull();
  });

  it('logs to nothing, without an executor asking first', () => {
    const telemetry = uncollectedTelemetry();
    expect(() => telemetry.logger.info('charging')).not.toThrow();
    expect(telemetry.logger.logger).toBeNull();
  });

  it('still records a fault, there being a span whatever else is absent', () => {
    const telemetry = uncollectedTelemetry();
    expect(() =>
      telemetry.recordFault(
        new ArvoHandlerFault({
          faultKind: 'executor_raised',
          message: 'the gateway refused',
          violations: [],
          cause: null,
          subject: 'order-42',
          executionId: null,
          eventId: 'e-1',
          attempt: 0,
          timestamp: 0,
          retry: null,
          abandonmentEvent: null,
          abandonmentState: null,
        }),
      ),
    ).not.toThrow();
  });
});
