import {
  type Context,
  type Span,
  type SpanOptions,
  SpanStatusCode,
  type TextMapSetter,
  type Tracer,
  context,
  propagation,
  trace,
} from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import ArvoExecution from './ArvoExecution';
import { ArvoExecutionSpanKind } from './ArvoExecution/types';
import type { OpenTelemetryHeaders, TelemetryLogLevel } from './types';

/**
 * Singleton class for managing OpenTelemetry instrumentation across libraries
 */
export class ArvoOpenTelemetry {
  /** OpenTelemetry tracer instance for creating spans */
  public tracer: Tracer;

  private static instance: ArvoOpenTelemetry | null = null;

  private constructor(tracer?: Tracer) {
    this.tracer = tracer ?? trace.getTracer('arvo-instrumentation', '1.0.0');
  }

  /**
   * Gets or creates the singleton instance of ArvoOpenTelemetry.
   * This method ensures only one instance of ArvoOpenTelemetry exists throughout the application.
   *
   * @param {Object} [config] - Optional configuration object for initializing the instance
   * @param {Tracer} [config.tracer] - Optional custom OpenTelemetry tracer instance.
   *                                   If not provided, defaults to a tracer with name 'arvo-instrumentation'
   *
   * @returns {ArvoOpenTelemetry} The singleton instance of ArvoOpenTelemetry
   *
   * @example
   * // Get instance with default tracer
   * const telemetry = ArvoOpenTelemetry.getInstance();
   *
   * @example
   * // Get instance with custom tracer
   * const customTracer = trace.getTracer('custom-tracer', '2.0.0');
   * const telemetry = ArvoOpenTelemetry.getInstance({ tracer: customTracer });
   *
   * @remarks
   * The tracer configuration is only applied when creating a new instance.
   * Subsequent calls with different tracer configurations will not modify the existing instance.
   */
  public static getInstance(config?: { tracer?: Tracer }): ArvoOpenTelemetry {
    if (ArvoOpenTelemetry.instance === null) {
      ArvoOpenTelemetry.instance = new ArvoOpenTelemetry(config?.tracer);
    }
    return ArvoOpenTelemetry.instance;
  }

  /**
   * Forces a reinitialization of the ArvoOpenTelemetry instance.
   * Use this method with caution as it will affect all existing traces and spans.
   *
   * @param {Object} config - Configuration object for reinitializing the instance
   * @param {Tracer} [config.tracer] - Optional custom OpenTelemetry tracer instance
   * @param {boolean} [config.force=false] - If true, skips active span checks
   *
   * @throws {Error} If there are active spans and force is not set to true
   * @throws {Error} If called before instance initialization
   *
   * @example
   * // Safe reinitialization
   * const customTracer = trace.getTracer('new-tracer', '2.0.0');
   * ArvoOpenTelemetry.reinitialize({ tracer: customTracer });
   */
  public static reinitialize(config: {
    tracer?: Tracer;
    force?: boolean;
  }): void {
    if (!ArvoOpenTelemetry.instance) {
      throw new Error('Cannot reinitialize before initialization. Call getInstance first.');
    }

    // Check for active spans unless force is true
    if (!config.force) {
      const activeSpan = trace.getActiveSpan();
      if (activeSpan) {
        throw new Error(
          'Cannot reinitialize while spans are active. ' + 'Either end all spans or use force: true (not recommended)',
        );
      }
    }

    // Create new instance
    ArvoOpenTelemetry.instance = new ArvoOpenTelemetry(config.tracer);
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
      if (param.context.inheritFrom === 'TRACE_HEADERS' && param.context.traceHeaders.traceparent) {
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
  const { level, message, ...restParams } = params;
  const toLog = {
    'log.severity': level,
    'log.message': message,
    'log.timestamp': performance.now(),
    ...restParams,
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
export const exceptionToSpan = (error: Error, span: Span | undefined = trace.getActiveSpan()) => {
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
export const makeOpenTelemetryContextContext = (traceparent: string, tracestate: string | null): Context => {
  const extractedContext = propagation.extract(context.active(), {
    traceparent,
    tracestate: tracestate ?? undefined,
  });
  return extractedContext;
};
