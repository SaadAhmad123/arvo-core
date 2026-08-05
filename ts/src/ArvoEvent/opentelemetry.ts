import type { Span, SpanContext } from '@opentelemetry/api';

export type ArvoEventTraceContext = {
  traceparent: string;
  tracestate: string | null;
};

const isSpanContext = (input: Span | SpanContext): input is SpanContext =>
  typeof (input as SpanContext).traceId === 'string';

/**
 * Derives W3C `traceparent`/`tracestate` header strings from an OpenTelemetry
 * `Span` or `SpanContext`, so callers don't have to hand-format them.
 */
export const traceContextFromSpan = (
  input: Span | SpanContext,
): ArvoEventTraceContext => {
  const context = isSpanContext(input) ? input : input.spanContext();
  const flags = context.traceFlags.toString(16).padStart(2, '0');
  return {
    traceparent: `00-${context.traceId}-${context.spanId}-${flags}`,
    tracestate: context.traceState?.serialize() ?? null,
  };
};
