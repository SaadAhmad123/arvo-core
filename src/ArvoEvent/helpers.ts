import ArvoEvent from '.';
import { createOtelSpan, logToSpan } from '../OpenTelemetry';
import { TelemetryContext } from '../OpenTelemetry/types';
import { cleanString, createTimestamp } from '../utils';
import { ArvoDataContentType } from './schema';
import { ArvoEventData, CloudEventExtension, CreateArvoEvent } from './types';
import { v4 as uuid4 } from 'uuid';

/**
 * Creates an ArvoEvent with the provided data and extensions.
 *
 * This function creates a new ArvoEvent instance using the provided event data and optional extensions.
 * It also supports OpenTelemetry tracing if a telemetry context is provided.
 *
 * @template TData - The type of the event data, extending ArvoEventData.
 * @template TExtension - The type of the cloud event extension, extending CloudEventExtension.
 * @template TType - The type name of the event
 *
 * @param {CreateArvoEvent<TData>} event - The event data and metadata to create the ArvoEvent.
 * @param {TExtension} [extensions] - Optional cloud event extensions.
 * @param {TelemetryContext} [telemetry] - Optional telemetry context for tracing.
 *
 * @returns {ArvoEvent<TData, TExtension>} The created ArvoEvent instance.
 *
 * @throws {Error} If there's an error during the creation process.
 *
 * @remarks
 * - If no `id` is provided in the event object, a UUID v4 will be generated.
 * - If no `time` is provided, the current timestamp will be used.
 * - If no `datacontenttype` is provided, it defaults to `application/cloudevents+json;charset=UTF-8;profile=arvo`.
 * - If a non-compatible `datacontenttype` is provided, a warning will be logged to the span.
 * - The `source`, `subject`, `to`, `redirectto`, and `dataschema` fields are URI-encoded.
 *
 * @example
 * const event = createArvoEvent(
 *   {
 *     type: 'com.example.event',
 *     source: '/example/source',
 *     subject: 'example-subject',
 *     data: { key: 'value' }
 *   },
 *   { customExtension: 'value' },
 *   telemetryContext
 * );
 */
export const createArvoEvent = <
  TData extends ArvoEventData,
  TExtension extends CloudEventExtension,
  TType extends string,
>(
  event: CreateArvoEvent<TData, TType>,
  extensions?: TExtension,
  telemetry?: TelemetryContext,
): ArvoEvent<TData, TExtension> =>
  createOtelSpan(
    telemetry || 'ArvoEvent Creation Tracer',
    'createArvoEvent',
    {},
    (telemetryContext) => {
      if (
        event.datacontenttype &&
        event.datacontenttype !== ArvoDataContentType
      ) {
        const warning = cleanString(`
        Warning! The provided datacontenttype(=${event.datacontenttype})
        is not ArvoEvent compatible (=${ArvoDataContentType}). There may 
        be some limited functionality.
      `);
        logToSpan(telemetryContext.span, {
          level: 'WARNING',
          message: warning,
        });
      }

      return new ArvoEvent<TData, TExtension>(
        {
          id: event.id || uuid4(),
          type: event.type,
          accesscontrol: event.accesscontrol || null,
          executionunits: event.executionunits || null,
          traceparent: event.traceparent || null,
          tracestate: event.tracestate || null,
          datacontenttype: event.datacontenttype || ArvoDataContentType,
          specversion: event.specversion || '1.0',
          time: event.time || createTimestamp(),
          source: encodeURI(event.source),
          subject: encodeURI(event.subject),
          to: event.to ? encodeURI(event.to) : null,
          redirectto: event.redirectto ? encodeURI(event.redirectto) : null,
          dataschema: event.dataschema ? encodeURI(event.dataschema) : null,
        },
        event.data,
        extensions,
      );
    },
  );
