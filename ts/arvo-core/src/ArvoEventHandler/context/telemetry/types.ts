import type { Meter, Span } from '@opentelemetry/api';

/**
 * How bad a log record is, on OpenTelemetry's own numeric scale so a
 * record this package emits means the same as one from anywhere else.
 */
export const ARVO_LOG_SEVERITY = Object.freeze({
  trace: 1,
  debug: 5,
  info: 9,
  warn: 13,
  error: 17,
  fatal: 21,
} as const);

/** See {@link ARVO_LOG_SEVERITY}. */
export type ArvoLogSeverity =
  (typeof ARVO_LOG_SEVERITY)[keyof typeof ARVO_LOG_SEVERITY];

/** One log record, shaped as the OpenTelemetry logs API shapes one. */
export type ArvoLogRecord = {
  /** How bad it is. */
  severityNumber: ArvoLogSeverity;
  /** What happened, readable on its own. */
  body: string;
  /** Whatever else is worth knowing about it. */
  attributes?: Record<string, unknown>;
};

/**
 * Whatever a mechanism emits log records through.
 *
 * Structural rather than imported, so this package depends on no logging
 * API. OpenTelemetry's own `Logger` satisfies it, so a mechanism that has
 * one passes it straight in.
 */
export type ArvoLogger = {
  /** Emits one record. */
  emit(record: ArvoLogRecord): void;
};

/** What an execution's metering is built from. */
export type ArvoExecutionContextMeterParam = {
  /**
   * The meter instruments are created on, or `null` where nothing is
   * metering. Every instrument is then a no-op, so an executor recording
   * measurements needs no guard.
   */
  meter: Meter | null;
};

/** What an execution's logging is built from. */
export type ArvoExecutionContextLoggerParam = {
  /**
   * What records are emitted through, or `null` where nothing is
   * collecting them. Emitting is then a no-op, so an executor logging
   * needs no guard.
   */
  logger: ArvoLogger | null;
  /** The span records are correlated to. */
  span: Span;
};

/** What an execution's telemetry is built from. */
export type ArvoExecutionContextTelemetryParam = {
  /**
   * This execution's span, started and ended outside the handler. Carried,
   * never created here: this package uses the OpenTelemetry API and
   * configures no backend.
   */
  span: Span;
  /**
   * The meter this handler's instruments are created on, or `null` where
   * nothing is metering. Every instrument is then a no-op.
   */
  meter: Meter | null;
  /**
   * What this execution's log records are emitted through, or `null`
   * where nothing is collecting them. Emitting is then a no-op.
   */
  logger: ArvoLogger | null;
};
