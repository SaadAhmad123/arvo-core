import {
  context,
  createTraceState,
  type Span,
  type SpanContext,
  type Tracer,
  trace,
} from '@opentelemetry/api';

export type ArvoEventTraceContext = {
  traceparent: string;
  tracestate: string | null;
};

const isSpanContext = (
  spanOrContext: Span | SpanContext,
): spanOrContext is SpanContext =>
  typeof (spanOrContext as SpanContext).traceId === 'string';

/**
 * Derives W3C `traceparent`/`tracestate` header strings from an OpenTelemetry
 * `Span` or `SpanContext`, so callers don't have to hand-format them.
 */
export const traceContextFromSpan = (
  spanOrContext: Span | SpanContext,
): ArvoEventTraceContext => {
  const spanContext = isSpanContext(spanOrContext)
    ? spanOrContext
    : spanOrContext.spanContext();
  const traceFlags = spanContext.traceFlags.toString(16).padStart(2, '0');
  return {
    traceparent: `00-${spanContext.traceId}-${spanContext.spanId}-${traceFlags}`,
    tracestate: spanContext.traceState?.serialize() ?? null,
  };
};

/** The two ends of a trace joined at an arriving event. */
export type ArvoEventTraceContinuation = {
  /** The span whatever handles this event records against. */
  span: Span;
  /**
   * The producer's span, rebuilt from the event's headers. Non-recording —
   * it happened elsewhere — and here so a caller can set it active, pass
   * it on, or link against it rather than trust it is buried in the child.
   */
  parentSpan: Span;
};

/** A W3C `traceparent`: version, trace id, span id, flags. */
const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

/**
 * Continues the trace an event arrived on, as a new span parented to the
 * producer's. `null` where the event carried no `traceparent`, there being
 * nothing to continue.
 *
 * Starting a fresh span instead is a decision about tracing policy, so it
 * is left to the caller rather than made here. A malformed `traceparent`
 * is treated as none: the alternative is a span parented to nonsense.
 *
 * @param event - The event that arrived, by its trace headers.
 * @param tracer - What the new span is started on.
 * @param spanName - What to call the new span.
 *
 * @example
 * ```typescript
 * const tracer = trace.getTracer('arvo')
 * const joined = continueTraceFromEvent(event, tracer, 'event handler');
 * const span = joined?.span ?? tracer.startSpan('event handler');
 * ```
 */
export const continueTraceFromEvent = (
  event: { traceparent: string | null; tracestate: string | null },
  tracer: Tracer,
  spanName: string,
): ArvoEventTraceContinuation | null => {
  if (event.traceparent === null) return null;

  const traceparentMatch = TRACEPARENT.exec(event.traceparent);
  if (traceparentMatch === null) return null;

  const [, traceId, spanId, traceFlags] = traceparentMatch as unknown as [
    string,
    string,
    string,
    string,
  ];
  const parentSpan = trace.wrapSpanContext({
    traceId,
    spanId,
    traceFlags: Number.parseInt(traceFlags, 16),
    isRemote: true,
    traceState:
      event.tracestate === null
        ? undefined
        : createTraceState(event.tracestate),
  });

  const parentContext = trace.setSpan(context.active(), parentSpan);
  return {
    span: tracer.startSpan(spanName, undefined, parentContext),
    parentSpan,
  };
};
