import {
  trace,
  context,
  propagation,
  Context,
  Span,
  SpanOptions,
} from '@opentelemetry/api';
import { TelemetryCarrier, TelemetryLogLevel, TelemetryContext } from './types';

/**
 * Retrieves the active context based on the provided trace header.
 * @param traceparent - The trace header string.
 * @returns The active context.
 */
export const getTelemetryContext = (traceparent?: string | null): Context => {
  if (traceparent) {
    return propagation.extract(context.active(), { traceparent: traceparent });
  }
  return context.active();
};

/**
 * Parses the context from a span and active context.
 * @param span - The span to parse the context from.
 * @param activeContext - The active context (optional, defaults to the current active context).
 * @returns The parsed telemetry context.
 */
export const getTelemetryCarrier = (
  span: Span,
  activeContext: Context = context.active(),
): TelemetryCarrier => {
  let carrier: TelemetryCarrier = {
    traceparent: null,
    tracestate: null,
  };
  propagation.inject(activeContext, carrier);
  if (!carrier.traceparent) {
    carrier.traceparent = `00-${span.spanContext().traceId}-${span.spanContext().spanId}-0${span.spanContext().traceFlags}`;
  }
  return carrier;
};

/**
 * Logs a message to a span with additional parameters.
 * @param span - The span to log the message to.
 * @param params - The parameters for the log message.
 * @param params.level - The log level.
 * @param params.message - The log message.
 * @param params[key] - Additional key-value pairs to include in the log.
 */
export const logToSpan = (
  span: Span,
  params: {
    level: TelemetryLogLevel;
    message: string;
  },
): void => {
  span.addEvent('log_message', {
    ...params,
    timestamp: performance.now(),
  });
};

export const exceptionToSpan = (
  span: Span,
  level: TelemetryLogLevel,
  error: Error  
) => {
  logToSpan(span, {
    level: level,
    message: error.message
  })
  span.setAttributes({
    'exception.type': `[${level}] ${error.name}`,
    'exception.message': error.message,
    'exception.stacktrace': error.stack || OTelNull
  })
}

/**
 * A higher-order function that wraps the provided function with OpenTelemetry tracing.
 *
 * @template A - The type of the arguments array for the wrapped function.
 * @template F - The type of the function to be wrapped.
 *
 * @param {HandlerOpenTelemetryContext} openTelemetry - The OpenTelemetry context object.
 * @param {string} spanTitle - The title of the span to be created.
 * @param {SpanOptions | undefined} spanOptions - Optional configuration for the span.
 * @param {F} fn - The function to be wrapped with OpenTelemetry tracing.
 * @param {ThisParameterType<F>} [thisArg] - The 'this' context to be used when calling the wrapped function.
 * @param {...A} args - The arguments to be passed to the wrapped function.
 *
 * @returns {ReturnType<F>} The result of the wrapped function execution.
 *
 * @description
 * This function creates a new span using the provided OpenTelemetry context and wraps the execution
 * of the given function within this span. It ensures that the function is executed within the
 * correct tracing context.
 */
export const newOtelSpan = <
  A extends unknown[],
  F extends (...args: A) => ReturnType<F>,
>(
  openTelemetry: TelemetryContext,
  spanTitle: string,
  spanOptions: SpanOptions | undefined,
  fn: F,
  thisArg?: ThisParameterType<F>,
  ...args: A
): ReturnType<F> => {
  const activeContext = getTelemetryContext(openTelemetry.context.traceparent);
  const activeSpan = openTelemetry.tracer.startSpan(
    spanTitle,
    spanOptions,
    activeContext,
  );
  try {
    const result = context.with(
      trace.setSpan(activeContext, activeSpan),
      fn,
      thisArg,
      ...args,
    );
    activeSpan.end()
    return result
  } catch (e) { 
    exceptionToSpan(activeSpan, "ERROR", e as Error)
    activeSpan.end()
    throw e
  }
};

export const OTelNull = 'N/A'