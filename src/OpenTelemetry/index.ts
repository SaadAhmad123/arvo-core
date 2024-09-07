import {
  trace,
  context,
  propagation,
  Context,
  Span,
  SpanOptions,
  Tracer,
  SpanStatusCode,
  ROOT_CONTEXT,
} from '@opentelemetry/api';
import { TelemetryCarrier, TelemetryLogLevel, TelemetryContext } from './types';

/**
 * Retrieves the active context based on the provided trace header.
 * @param traceparent - The trace header string.
 * @returns The active context.
 */
export const getTelemetryContext = (carrier?: TelemetryCarrier): Context => {
  if (carrier && (carrier.traceparent || carrier.tracestate)) {
    return propagation.extract(ROOT_CONTEXT, carrier);
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

/**
 * Logs an exception to a span and sets exception-related attributes.
 * @param span - The span to log the exception to.
 * @param level - The log level for the exception.
 * @param error - The error object to be logged.
 */
export const exceptionToSpan = (
  span: Span,
  level: TelemetryLogLevel,
  error: Error,
) => {
  logToSpan(span, {
    level: level,
    message: error.message,
  });
  span.setAttributes({
    'exception.type': `[${level}] ${error.name}`,
    'exception.message': error.message,
    'exception.stacktrace': error.stack || OTelNull,
  });
};

/**
 * Creates a new OpenTelemetry span and executes the provided function within its context.
 *
 * This function enhances tracing by creating a new span, executing the given function within
 * that span's context, and properly handling any errors that may occur. It also ensures that
 * the wrapped function has access to the current span.
 *
 * @template TArgs - The type of the arguments array for the wrapped function.
 * @template TReturn - The return type of the wrapped function.
 *
 * @param {TelemetryContext | string} telemetryContext - The OpenTelemetry context object or a tracer name.
 *   If a string is provided, it will be used as the tracer name to retrieve the tracer.
 *   If a `TelemetryContext` object is provided, it should contain the span, tracer, and carrier information.
 * @param {string} spanName - The name of the span to be created.
 * @param {SpanOptions} [spanOptions] - Optional configuration for the span, such as attributes, links, and sampling.
 * @param {(telemetryContext: TelemetryContext, ...args: TArgs) => TReturn} wrappedFunction - The function to be executed within the new span.
 *   This function will receive the `TelemetryContext` object as its first argument, containing the current span, tracer, and carrier.
 *   The rest of the arguments will be passed as additional parameters to the wrapped function.
 * @param {ThisParameterType<TFunction>} [thisArg] - The 'this' context to be used when calling the wrapped function.
 * @param {...TArgs} args - The arguments to be passed to the wrapped function.
 *
 * @returns {TReturn} The result of the wrapped function execution.
 *
 * @throws {Error} Rethrows any error that occurs during the execution of the wrapped function.
 *   The error will be logged to the span with an 'ERROR' level, and the span status will be set to `SpanStatusCode.ERROR`.
 *
 * @example
 * // Using with TelemetryContext
 * const telemetryContext: TelemetryContext = {
 *   span: currentSpan,
 *   tracer: currentTracer,
 *   carrier: { traceparent: 'traceparent-value', tracestate: 'tracestate-value' }
 * };
 * const result = createOtelSpan(
 *   telemetryContext,
 *   'ProcessOrder',
 *   { attributes: { orderId: '12345' } },
 *   (telemetryContext, orderId) => {
 *     telemetryContext.span.addEvent('Processing order');
 *     return processOrder(orderId);
 *   },
 *   null,
 *   '12345'
 * );
 *
 * @example
 * // Using with tracer name
 * const result = createOtelSpan(
 *   'OrderService',
 *   'FetchOrderDetails',
 *   undefined,
 *   (telemetryContext, orderId) => {
 *     telemetryContext.span.setAttribute('orderId', orderId);
 *     return fetchOrderDetails(orderId);
 *   },
 *   null,
 *   '12345'
 * );
 */export const createOtelSpan = <TArgs extends unknown[], TReturn>(
  telemetryContext: TelemetryContext | string,
  spanName: string,
  spanOptions: SpanOptions | undefined,
  wrappedFunction: (
    telemetryContext: TelemetryContext,
    ...args: TArgs
  ) => TReturn,
  thisArg?: ThisParameterType<typeof wrappedFunction>,
  ...args: TArgs
): TReturn => {
  let activeContext: Context = ROOT_CONTEXT;
  let activeTracer: Tracer;

  if (typeof telemetryContext === 'string') {
    activeTracer = trace.getTracer(telemetryContext);
  } else {
    activeContext = getTelemetryContext(telemetryContext.carrier);
    activeTracer = telemetryContext.tracer;
  }

  const newSpan: Span = activeTracer.startSpan(
    spanName,
    spanOptions,
    activeContext,
  );

  newSpan.setStatus({
    code: SpanStatusCode.OK,
  });
  
  try {
    const result = context.with(trace.setSpan(activeContext, newSpan), () =>
      wrappedFunction.call(
        thisArg,
        {
          span: newSpan,
          tracer: activeTracer,
          carrier: getTelemetryCarrier(newSpan, activeContext),
        },
        ...args,
      ),
    );
    newSpan.end();
    return result;
  } catch (error) {
    exceptionToSpan(newSpan, 'ERROR', error as Error);
    newSpan.setStatus({
      code: SpanStatusCode.ERROR,
      message: (error as Error).message,
    });
    newSpan.end();
    throw error;
  }
};

/**
 * A constant representing a null or not applicable value in OpenTelemetry context.
 */
export const OTelNull = 'N/A';
