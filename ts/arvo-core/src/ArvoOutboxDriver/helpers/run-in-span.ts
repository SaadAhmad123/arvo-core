import { context, type Span, trace } from '@opentelemetry/api';
import { ArvoExecutionContextTelemetry } from '../../ArvoEventHandler/context/telemetry/index.js';
import { recording } from '../../ArvoEventHandler/context/telemetry/recording.js';
import {
  type ArvoTelemetryParam,
  resolveTelemetry,
} from '../../ArvoEventHandler/context/telemetry/resolve.js';
import type { AsyncResult } from '../../types.js';
import { textOfThrown } from '../../utils/thrown-text.js';
import type { ArvoOutboxDriverError } from '../errors.js';

/** What every driver span's name starts with, the operation after it. */
const ARVO_OUTBOX_DRIVER_SPAN_PREFIX = 'arvo.outbox_driver';

/** The context making `parentSpan` the parent; none where none is given, so the tracer takes the active one. */
const parentContextForSpan = (parentSpan: Span | undefined) =>
  parentSpan === undefined
    ? undefined
    : trace.setSpan(context.active(), parentSpan);

/**
 * Runs one driver operation in its own span, a child of the span given, or
 * of whatever span is active where none is, and handed to the operation so
 * it can record on it: ok where it answers success, an error naming the
 * message where it answers a failure or throws, and ended however it
 * finishes.
 */
export const runInSpan = async <Answer>(param: {
  readonly operationName: string;
  readonly telemetry: ArvoTelemetryParam | undefined;
  readonly parentSpan: Span | undefined;
  readonly run: (span: Span) => AsyncResult<Answer, ArvoOutboxDriverError>;
}): AsyncResult<Answer, ArvoOutboxDriverError> => {
  const resolvedTelemetry = resolveTelemetry(param.telemetry);
  const span = resolvedTelemetry.tracer.startSpan(
    `${ARVO_OUTBOX_DRIVER_SPAN_PREFIX}.${param.operationName}`,
    undefined,
    parentContextForSpan(param.parentSpan),
  );
  const telemetry = new ArvoExecutionContextTelemetry({
    span,
    meter: resolvedTelemetry.meter ?? null,
    logger: resolvedTelemetry.logger ?? null,
  });
  try {
    const operationResult = await param.run(span);
    if (operationResult.ok) telemetry.setSpanOk();
    else telemetry.setSpanError(operationResult.error.message);
    return operationResult;
  } catch (error_) {
    // a defect in the caller, not the outbox: seen on the trace and rethrown as it came
    recording(() =>
      span.recordException(
        error_ instanceof Error ? error_ : textOfThrown(error_),
      ),
    );
    telemetry.setSpanError(textOfThrown(error_));
    throw error_;
  } finally {
    span.end();
  }
};
