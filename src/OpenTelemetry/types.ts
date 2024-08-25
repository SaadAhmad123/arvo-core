import { Span, Tracer } from '@opentelemetry/api';

/**
 * Represents the available log levels for telemetry.
 */
export type TelemetryLogLevel =
  | 'DEBUG' // Used for detailed information, typically of interest only when diagnosing problems.
  | 'INFO' // Used for general information about program execution.
  | 'WARNING' // Indicates an unexpected event or a potential problem that doesn't prevent the program from working.
  | 'ERROR' // Used for more serious problems that prevent a specific function or feature from working correctly.
  | 'CRITICAL'; // Used for very serious errors that might prevent the entire program from running.

/**
 * Represents the context for telemetry.
 * @property traceparent - The traceparent header value.
 * @property tracestate - The tracestate header value.
 */
export type TelemetryCarrier = {
  traceparent: string | null;
  tracestate: string | null;
};

/**
 * Represents the OpenTelemetry context for a handler.
 * @property {Span} span - The current span.
 * @property {Tracer} tracer - The tracer instance.
 * @property {TelemetryCarrier} context - The telemetry context.
 */
export type TelemetryContext = {
  span: Span;
  tracer: Tracer;
  context: TelemetryCarrier;
};