import {
  trace,
  context,
  Span,
  TextMapSetter,
} from '@opentelemetry/api';
import { TelemetryLogLevel, OpenTelemetryHeaders } from './types';
import { getPackageInfo } from './utils';
import { W3CTraceContextPropagator } from '@opentelemetry/core';

const pkg = getPackageInfo();

/**
 * A tracer instance for the ArvoCore package.
 */
export const ArvoCoreTracer = trace.getTracer(pkg.name, pkg.version);

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
  error: Error,
) => {
  span.setAttributes({
    'exception.type': error.name,
    'exception.message': error.message,
  });
  span.recordException(error);
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
    tracestate: null
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
    tracestate: carrier.tracestate
  };
}