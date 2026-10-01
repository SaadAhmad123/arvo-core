import { context as otelContext, type Span, trace } from '@opentelemetry/api';
import {
  ARVO_LOG_SEVERITY,
  type ArvoExecutionContextLoggerParam,
  type ArvoLogger,
  type ArvoLogSeverity,
} from './types.js';

/**
 * One delivery's logging, bound to that delivery's span.
 *
 * Every record is emitted inside the span's context, so it correlates to
 * the delivery without a caller passing context by hand. Bound at
 * construction rather than per call, which is what makes it a bound
 * logger rather than a logger and a span.
 *
 * Emitting does nothing where no logger was given, so an executor logging
 * never has to ask whether anything is collecting.
 *
 * @example
 * ```typescript
 * const logging = new ArvoExecutionContextLogger({ logger, span });
 *
 * logging.info('charging', { amount });
 * logging.warn('gateway refused', { reason });
 * ```
 */
export class ArvoExecutionContextLogger {
  /** What records are emitted through, or `null` where none collects. */
  readonly logger: ArvoLogger | null;

  /** The span records are correlated to. */
  readonly span: Span;

  /** @param param - What to emit through, and what to correlate to. */
  constructor(param: ArvoExecutionContextLoggerParam) {
    this.logger = param.logger;
    this.span = param.span;
  }

  /**
   * One record, at the severity given.
   *
   * @param severity - How bad it is.
   * @param body - What happened, readable on its own.
   * @param attributes - Whatever else is worth knowing.
   */
  emit(
    severity: ArvoLogSeverity,
    body: string,
    attributes?: Record<string, unknown>,
  ): void {
    const logger = this.logger;
    if (logger === null) return;

    const bound = trace.setSpan(otelContext.active(), this.span);
    otelContext.with(bound, () => {
      logger.emit({ severityNumber: severity, body, attributes });
    });
  }

  /** Something happened that is worth a line. */
  info(body: string, attributes?: Record<string, unknown>): void {
    this.emit(ARVO_LOG_SEVERITY.info, body, attributes);
  }

  /** Something detailed, for when a delivery is being examined. */
  debug(body: string, attributes?: Record<string, unknown>): void {
    this.emit(ARVO_LOG_SEVERITY.debug, body, attributes);
  }

  /** Something that did not stop the delivery but ought to be seen. */
  warn(body: string, attributes?: Record<string, unknown>): void {
    this.emit(ARVO_LOG_SEVERITY.warn, body, attributes);
  }

  /** Something that failed. */
  error(body: string, attributes?: Record<string, unknown>): void {
    this.emit(ARVO_LOG_SEVERITY.error, body, attributes);
  }
}
