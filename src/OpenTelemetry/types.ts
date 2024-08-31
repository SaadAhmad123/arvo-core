import { Span, Tracer } from '@opentelemetry/api';

/**
 * Represents the available log levels for telemetry.
 * - DEBUG: Used for detailed information, typically of interest only when diagnosing problems.
 * - INFO: Used for general information about program execution.
 * - WARNING: Indicates an unexpected event or a potential problem that doesn't prevent the program from working.
 * - ERROR: Used for more serious problems that prevent a specific function or feature from working correctly.
 * - CRITICAL: Used for very serious errors that might prevent the entire program from running.
 */
export type TelemetryLogLevel =
  | 'DEBUG'
  | 'INFO'
  | 'WARNING'
  | 'ERROR'
  | 'CRITICAL';

/**
 * Represents the context for telemetry.
 * See reference standard documentation [here](https://www.w3.org/TR/trace-context/#design-overview)
 */
export type TelemetryCarrier = {
  /** The traceparent header value */
  traceparent: string | null;
  /** The tracestate header value */
  tracestate: string | null;
};

/**
 * Represents the OpenTelemetry context for a handler.
 * See reference documentation [here](https://opentelemetry.io/docs/languages/js/instrumentation/#traces)
 */
export type TelemetryContext = {
  /**
   * The current OpenTelemetry Span. If passed to a function,
   * then for that function, this is the parent span object
   */
  span: Span;

  /**
   * The current OpenTelemetry tracer object being
   * used.
   */
  tracer: Tracer;

  /**
   * The telemetry headers
   */
  context: TelemetryCarrier;
};
