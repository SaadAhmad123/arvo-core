import { trace, context, Span, TextMapSetter } from '@opentelemetry/api';
import { TelemetryLogLevel, OpenTelemetryHeaders } from './types';
import { getPackageInfo } from './utils';
import { W3CTraceContextPropagator } from '@opentelemetry/core';



/**
 * A tracer instance for the ArvoCore package.
 */
export const fetchOpenTelemetryTracer = () => {
  const pkg = getPackageInfo('arvo-core');
  return trace.getTracer(pkg.name, pkg.version)
}

/**
 * Logs a message to a span with additional parameters.
 * @param params - The parameters for the log message.
 * @param span - The span to log the message to. If not provided, the active span is used.
 *               If no active span is available, the message is logged to the console.
 */
export const logToSpan = (
  params: {
    /** The log level */
    level: TelemetryLogLevel;
    /** The log message */
    message: string;
    /** Other log parameters */
    [key: string]: string;
  },
  span: Span | undefined = trace.getActiveSpan(),
): void => {
  const toLog = {
    ...params,
    timestamp: performance.now(),
  };
  if (span) {
    span.addEvent('log_message', toLog);
  } else {
    console.log(JSON.stringify(toLog, null, 2));
  }
};

/**
 * Logs an exception to a span and sets exception-related attributes.
 * @param error - The error object to be logged.
 * @param span - The span to log the exception to. If not provided, the active span is used.
 *               If no active span is available, the error is logged to the console.
 */
export const exceptionToSpan = (
  error: Error,
  span: Span | undefined = trace.getActiveSpan(),
) => {
  if (span) {
    span.setAttributes({
      'exception.type': error.name,
      'exception.message': error.message,
    });
    span.recordException(error);
  } else {
    console.error(error);
  }
};

/**
 * A constant representing a null or not applicable value in OpenTelemetry context.
 */
export const OTelNull = 'N/A';

/**
 * Retrieves the current OpenTelemetry headers from the active context.
 * @returns An object containing the traceparent and tracestate headers.
 */
export function currentOpenTelemetryHeaders(): OpenTelemetryHeaders {
  const propagator = new W3CTraceContextPropagator();
  const carrier: OpenTelemetryHeaders = {
    traceparent: null,
    tracestate: null,
  };

  const setter: TextMapSetter = {
    set: (carrier, key, value) => {
      if (carrier && typeof carrier === 'object') {
        carrier[key] = value;
      }
    },
  };

  propagator.inject(context.active(), carrier, setter);

  return {
    traceparent: carrier.traceparent,
    tracestate: carrier.tracestate,
  };
}
