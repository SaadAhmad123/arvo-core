import { v4 as uuid4 } from 'uuid';
import ArvoEvent from '.';
import { ArvoOpenTelemetry, currentOpenTelemetryHeaders, logToSpan } from '../OpenTelemetry';
import { cleanString, createTimestamp } from '../utils';
import { ArvoDataContentType } from './schema';
import type { ArvoEventData, CloudEventExtension, CreateArvoEvent } from './types';

/**
 * Internal generator function for creating  instances.
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
 * @param event - Event configuration and data
 * @param [extensions] - Optional cloud event extensions
 * @param [opentelemetry] - OpenTelemetry configuration with options:
 *   - disable - Completely disables telemetry if true
 *
 * @throw {Error} In case any validation in {@link ArvoEvent} fails.
 *
 * @returns ArvoEvent with type-safety
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
 * ```
 */
export const createArvoEvent = <
  TData extends ArvoEventData,
  TExtension extends CloudEventExtension,
  TType extends string,
>(
  event: CreateArvoEvent<TData, TType>,
  extensions?: TExtension,
  opentelemetry?: {
    disable?: boolean;
  },
): ArvoEvent<TData, TExtension, TType> => {
  if (opentelemetry?.disable) {
    return generator(event, extensions, {
      traceparent: null,
      tracestate: null,
    });
  }

  return ArvoOpenTelemetry.getInstance().startActiveSpan({
    name: `createArvoEvent<${event.type}>`,
    fn: (span) => {
      const generatedEvent = generator(event, extensions, currentOpenTelemetryHeaders());
      span.setAttributes(generatedEvent.otelAttributes);
      return generatedEvent;
    },
  });
};
