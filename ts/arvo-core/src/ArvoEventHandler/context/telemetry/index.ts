import {
  type Attributes,
  isSpanContextValid,
  type Span,
  SpanStatusCode,
} from '@opentelemetry/api';
import { traceContextFromSpan } from '../../../ArvoEvent/opentelemetry.js';
import type { ArvoHandlerFault } from '../../fault/index.js';
import { ArvoExecutionContextLogger } from './logger.js';
import { ArvoExecutionContextMeter } from './metric.js';
import { ARVO_DEFAULT_SPAN_ERROR, ARVO_TELEMETRY_PREFIX } from './prefix.js';
import type { ArvoExecutionContextTelemetryParam } from './types.js';

/**
 * One execution's telemetry: its span, its metering, and its logging.
 *
 * The span's own helpers are here; counters and histograms are on
 * {@link metric}, and log records on {@link logger}. Every event the
 * context builds descends from this span.
 *
 * @example
 * ```typescript
 * const telemetry = new ArvoExecutionContextTelemetry({
 *   span,
 *   meter: metrics.getMeter('com_order_create', '1.0.0'),
 *   logger,
 * });
 *
 * telemetry.setAttributes({ 'order.items': items.length });
 * telemetry.metric.count('charges', { outcome: 'ok' });
 * telemetry.logger.info('charging', { amount });
 * ```
 */
export class ArvoExecutionContextTelemetry {
  /** This execution's span. Started and ended outside, so do neither here. */
  readonly span: Span;

  /** Counters and histograms for this handler. */
  readonly metric: ArvoExecutionContextMeter;

  /** Log records correlated to this execution. */
  readonly logger: ArvoExecutionContextLogger;

  /** @param param - The span, the meter, and what to log through. */
  constructor(param: ArvoExecutionContextTelemetryParam) {
    this.span = param.span;
    this.metric = new ArvoExecutionContextMeter({ meter: param.meter });
    this.logger = new ArvoExecutionContextLogger({
      logger: param.logger,
      span: param.span,
    });
  }

  /**
   * Whether the span carries a context worth putting on an event. `false`
   * with no OpenTelemetry SDK configured, the API returning an empty one.
   */
  get isRecording(): boolean {
    return isSpanContextValid(this.span.spanContext());
  }

  /** The span's W3C `traceparent`, or `null` where it records nothing. */
  get traceparent(): string | null {
    return this.isRecording
      ? traceContextFromSpan(this.span).traceparent
      : null;
  }

  /** The span's W3C `tracestate`, or `null` where it has none. */
  get tracestate(): string | null {
    return this.isRecording ? traceContextFromSpan(this.span).tracestate : null;
  }

  /**
   * Attributes on this execution's span, every name prefixed.
   *
   * @param attributes - What to record, by name.
   */
  setAttributes(attributes: Attributes): void {
    this.span.setAttributes(
      Object.fromEntries(
        Object.entries(attributes).map(([name, value]) => [
          `${ARVO_TELEMETRY_PREFIX}${name}`,
          value,
        ]),
      ),
    );
  }

  /**
   * Something that happened during this execution, on its span.
   *
   * @param name - What happened, prefixed for you.
   * @param attributes - Whatever else is worth knowing.
   */
  addEvent(name: string, attributes?: Attributes): void {
    this.span.addEvent(`${ARVO_TELEMETRY_PREFIX}${name}`, attributes);
  }

  /**
   * Marks this execution's span succeeded.
   *
   * Set it where the execution is carried through. A span left unset reads
   * as neither, which a backend cannot tell from one nobody judged.
   */
  setSpanOk(): void {
    this.span.setStatus({ code: SpanStatusCode.OK });
  }

  /**
   * Marks this execution's span failed, with a reason.
   *
   * @param message - Why it failed. Defaults to something generic, which
   * is worth replacing: the status is often all a reader has.
   */
  setSpanError(message: string = ARVO_DEFAULT_SPAN_ERROR): void {
    this.span.setStatus({ code: SpanStatusCode.ERROR, message });
  }

  /**
   * A fault across all three signals, each for a different reader.
   *
   * On the span, for whoever has the trace open. On a counter, so faults
   * by kind can be charted and alerted on. And as a log record, which is
   * the only one of the three that survives a sampling decision — a fault
   * retried away leaves nothing else behind.
   *
   * Only the kind and the retry verdict reach the counter, both being
   * closed sets. Everything identifying goes to the log, where cardinality
   * costs nothing.
   *
   * @param fault - The fault about to be raised.
   */
  recordFault(fault: ArvoHandlerFault): void {
    const retryable = fault.retry !== null;

    this.span.recordException(fault);
    this.setAttributes({
      'fault.kind': fault.faultKind,
      'fault.retryable': retryable,
    });
    this.setSpanError(fault.message);

    this.metric.count('faults', {
      'fault.kind': fault.faultKind,
      'fault.retryable': retryable,
    });

    this.logger.error(fault.message, {
      'fault.kind': fault.faultKind,
      'fault.retryable': retryable,
      subject: fault.subject,
      'execution.id': fault.executionId,
      'event.id': fault.eventId,
      attempt: fault.attempt,
    });
  }
}
