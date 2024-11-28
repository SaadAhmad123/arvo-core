import { context, SpanStatusCode, trace } from '@opentelemetry/api';
import ArvoEvent from '.';
import {
  fetchOpenTelemetryTracer,
  currentOpenTelemetryHeaders,
  exceptionToSpan,
  logToSpan,
} from '../OpenTelemetry';
import { cleanString, createTimestamp } from '../utils';
import { ArvoDataContentType } from './schema';
import { ArvoEventData, CloudEventExtension, CreateArvoEvent } from './types';
import { v4 as uuid4 } from 'uuid';
import { ExecutionOpenTelemetryConfiguration } from '../OpenTelemetry/types';

/**
 * Internal generator function for creating ArvoEvent instances.
 *
 * @template TData - Type of the event data
 * @template TExtension - Type of cloud event extensions
 * @param {CreateArvoEvent<any, any>} event - The event configuration and data
 * @param {any} extensions - Cloud event extensions
 * @param {ReturnType<typeof currentOpenTelemetryHeaders>} otelHeaders - OpenTelemetry headers
 * @returns {ArvoEvent<any, any, any>} A new ArvoEvent instance
 *
 * @remarks
 * This function handles the actual creation of the ArvoEvent instance, including:
 * - Generation of default values for optional fields
 * - URI encoding of relevant fields
 * - Validation of data content type
 * - Integration with OpenTelemetry headers
 * ```
 */
const generator = (
  event: CreateArvoEvent<any, any>,
  extensions: any,
  otelHeaders: ReturnType<typeof currentOpenTelemetryHeaders>,
) => {
  if (event.datacontenttype && event.datacontenttype !== ArvoDataContentType) {
    const warning = cleanString(`
    Warning! The provided datacontenttype(=${event.datacontenttype})
    is not ArvoEvent compatible (=${ArvoDataContentType}). There may 
    be some limited functionality.
  `);
    logToSpan({
      level: 'WARNING',
      message: warning,
    });
  }

  return new ArvoEvent<any, any, any>(
    {
      id: event.id ?? uuid4(),
      type: event.type,
      accesscontrol: event.accesscontrol ?? null,
      executionunits: event.executionunits ?? null,
      traceparent: event.traceparent ?? otelHeaders.traceparent ?? null,
      tracestate: event.tracestate ?? otelHeaders.tracestate ?? null,
      datacontenttype: event.datacontenttype ?? ArvoDataContentType,
      specversion: event.specversion ?? '1.0',
      time: event.time ?? createTimestamp(),
      source: encodeURI(event.source),
      subject: encodeURI(event.subject),
      to: event.to ? encodeURI(event.to) : encodeURI(event.type),
      redirectto: event.redirectto ? encodeURI(event.redirectto) : null,
      dataschema: event.dataschema ? encodeURI(event.dataschema) : null,
    },
    event.data,
    extensions,
  );
};

/**
 * Creates a strongly-typed ArvoEvent with configurable telemetry options.
 *
 * @template TData - Event data type extending ArvoEventData
 * @template TExtension - Cloud event extension type
 * @template TType - String literal type for event type
 *
 * @param event - Event configuration and data
 * @param [extensions] - Optional cloud event extensions
 * @param [opentelemetry] - OpenTelemetry configuration with options:
 *   - disable - Completely disables telemetry if true
 *   - tracer - Custom OpenTelemetry tracer instance
 *
 * @returns ArvoEvent instance
 *
 * @example
 * ```typescript
 * // With default telemetry
 * const event = createArvoEvent({
 *   type: 'order.created',
 *   source: '/orders',
 *   subject: 'order-123',
 *   data: orderData
 * });
 *
 * // With disabled telemetry
 * const event = createArvoEvent(
 *   {
 *     type: 'order.created',
 *     source: '/orders',
 *     subject: 'order-123',
 *     data: orderData
 *   },
 *   undefined,
 *   { disable: true }
 * );
 *
 * // With custom tracer
 * const event = createArvoEvent(
 *   {
 *     type: 'order.created',
 *     source: '/orders',
 *     subject: 'order-123',
 *     data: orderData
 *   },
 *   undefined,
 *   { tracer: customTracer }
 * );
 * ```
 *
 * @remarks
 * This function provides several key features:
 *
 * 1. **Type Safety**:
 *    - Ensures event data matches specified type
 *    - Validates extension structure
 *    - Provides type-safe event type strings
 *
 * 2. **Default Handling**:
 *    - Generates UUID if no ID provided
 *    - Sets current timestamp if no time provided
 *    - Uses default ArvoDataContentType if none specified
 *
 * 3. **URI Handling**:
 *    - Automatically encodes URI components (source, subject, to, redirectto, dataschema)
 *    - Validates URI format
 *
 * 4. **OpenTelemetry Integration**:
 *    - Creates spans for event creation
 *    - Tracks errors and warnings
 *    - Propagates trace context
 *
 * 5. **Validation**:
 *    - Checks data content type compatibility
 *    - Validates required fields
 *    - Ensures URI format correctness
 *
 * @see {@link ArvoEvent} For the structure of the created event
 * @see {@link ArvoDataContentType} For supported content types
 * @see {@link CloudEventExtension} For extension structure
 */
export const createArvoEvent = <
  TData extends ArvoEventData,
  TExtension extends CloudEventExtension,
  TType extends string,
>(
  event: CreateArvoEvent<TData, TType>,
  extensions?: TExtension,
  opentelemetry?: Partial<
    ExecutionOpenTelemetryConfiguration & { disable: boolean }
  >,
): ArvoEvent<TData, TExtension, TType> => {
  if (opentelemetry?.disable) {
    return generator(event, extensions, {
      traceparent: null,
      tracestate: null,
    });
  }

  const tracer = opentelemetry?.tracer ?? fetchOpenTelemetryTracer();
  const span = tracer.startSpan(`createArvoEvent<${event.type}>`, {});
  return context.with(trace.setSpan(context.active(), span), () => {
    span.setStatus({ code: SpanStatusCode.OK });
    try {
      return generator(event, extensions, currentOpenTelemetryHeaders());
    } catch (error) {
      exceptionToSpan(error as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (error as Error).message,
      });
      throw error;
    } finally {
      span.end();
    }
  });
};
