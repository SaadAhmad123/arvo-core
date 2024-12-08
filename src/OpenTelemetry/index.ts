import {
  trace,
  context,
  Span,
  TextMapSetter,
  Tracer,
  Context,
  SpanOptions,
  propagation,
  SpanStatusCode,
} from '@opentelemetry/api';
import { TelemetryLogLevel, OpenTelemetryHeaders } from './types';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import ArvoExecution from './ArvoExecution';
import { ArvoExecutionSpanKind } from './ArvoExecution/types';

/**
 * Singleton class for managing OpenTelemetry instrumentation across libraries
 */
export class ArvoOpenTelemetry {
  /** OpenTelemetry tracer instance for creating spans */
  public readonly tracer: Tracer;

  private static instance: ArvoOpenTelemetry | null = null;

  private constructor() {
    this.tracer = trace.getTracer('arvo-instrumentation', '1.0.0');
  }

  /**
   * Gets the instance of ArvoOpenTelemetry
   * @returns {ArvoOpenTelemetry} The singleton instance
   */
  public static getInstance(): ArvoOpenTelemetry {
    if (ArvoOpenTelemetry.instance === null) {
      ArvoOpenTelemetry.instance = new ArvoOpenTelemetry();
    }
    return ArvoOpenTelemetry.instance;
  }

  /**
   * Creates and manages an active span for a given operation. This function provides two modes of operation:
   * 1. Automatic span management (default): Handles span lifecycle, status, and error recording
   * 2. Manual span management: Gives full control to the user when disableSpanManagement is true
   *
   * @template F - Function type that accepts a Span parameter and returns a value
   * @param {Object} param - Configuration object for the span
   * @param {string} param.name - Name of the span to be created
   * @param {F} param.fn - Function to execute within the span context. Receives the span as a parameter
   * @param {SpanOptions} [param.spanOptions] - Optional configuration for the span creation
   * @param {boolean} [param.disableSpanManagement] - When true, disables automatic span lifecycle management
   * @param {Object} [param.context] - Optional context configuration for span inheritance
   * @param {string} param.context.inheritFrom - Specifies the type of context inheritance ('TRACE_HEADERS' | 'CONTEXT')
   * @param {OpenTelemetryHeaders} param.context.traceHeaders - Required when inheritFrom is 'TRACE_HEADERS'
   * @param {Context} param.context.context - Required when inheritFrom is 'CONTEXT'
   * @returns {ReturnType<F>} The return value of the executed function
   */
  public startActiveSpan<F extends (span: Span) => unknown>(param: {
    name: string;
    fn: F;
    spanOptions?: SpanOptions;
    context?:
      | {
          inheritFrom: 'TRACE_HEADERS';
          traceHeaders: OpenTelemetryHeaders;
        }
      | {
          inheritFrom: 'CONTEXT';
          context: Context;
        };
    disableSpanManagement?: boolean;
  }): ReturnType<F> {
    let parentContext: Context | undefined;
    if (param.context) {
      if (
        param.context.inheritFrom === 'TRACE_HEADERS' &&
        param.context.traceHeaders.traceparent
      ) {
        parentContext = makeOpenTelemetryContextContext(
          param.context.traceHeaders.traceparent,
          param.context.traceHeaders.tracestate,
        );
      } else if (param.context.inheritFrom === 'CONTEXT') {
        parentContext = param.context.context;
      }
    }
    const span = this.tracer.startSpan(
      param.name,
      {
        ...(param.spanOptions ?? {}),
        attributes: {
          [ArvoExecution.ATTR_SPAN_KIND]: ArvoExecutionSpanKind.INTERNAL,
          ...(param.spanOptions?.attributes ?? {}),
        },
      },
      parentContext,
    );
    return context.with(trace.setSpan(context.active(), span), () => {
      if (param.disableSpanManagement) {
        return param.fn(span) as ReturnType<F>;
      }
      span.setStatus({ code: SpanStatusCode.OK });
      try {
        return param.fn(span) as ReturnType<F>;
      } catch (e) {
        exceptionToSpan(e as Error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: (e as Error).message,
        });
        throw e;
      } finally {
        span.end();
      }
    });
  }
}

/**
 * Logs a message to a span with additional parameters.
 * @param params - The parameters for the log message.
 * @param span - The span to log the message to. If not provided, the active span is used.
 *               If no active span is available, the message is logged to the console.
 */
export const logToSpan = (
  params: {
    level: TelemetryLogLevel;
    message: string;
    [key: string]: string;
  },
  span: Span | undefined = trace.getActiveSpan(),
): void => {
  const toLog = {
    ...params,
    'log.severity': params.level,
    'log.message': params.message,
    'log.timestamp': performance.now(),
  };
  if (span) {
    span.addEvent('log', toLog);
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

// Helper function to extract context from traceparent and tracestate
export const makeOpenTelemetryContextContext = (
  traceparent: string,
  tracestate: string | null,
): Context => {
  const extractedContext = propagation.extract(context.active(), {
    traceparent,
    tracestate: tracestate ?? undefined,
  });
  return extractedContext;
};
