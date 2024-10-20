import { context, SpanStatusCode, trace } from '@opentelemetry/api';
import ArvoEvent from '.';
import {
  ArvoCoreTracer,
  currentOpenTelemetryHeaders,
  exceptionToSpan,
  logToSpan,
} from '../OpenTelemetry';
import { cleanString, createTimestamp } from '../utils';
import { ArvoDataContentType } from './schema';
import { ArvoEventData, CloudEventExtension, CreateArvoEvent } from './types';
import { v4 as uuid4 } from 'uuid';

/**
 * Creates an ArvoEvent with the provided data and extensions.
 *
 * This function creates a new ArvoEvent instance using the provided event data and optional extensions.
 *
 * @template TData - The type of the event data, extending ArvoEventData.
 * @template TExtension - The type of the cloud event extension, extending CloudEventExtension.
 * @template TType - The type name of the event
 *
 * @param {CreateArvoEvent<TData>} event - The event data and metadata to create the ArvoEvent.
 * @param {TExtension} [extensions] - Optional cloud event extensions.
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
 * - If no `to` (null, undefined or empty string) is provided, then the `type` value is used by default
 *
 * @example
 * const event = createArvoEvent(
 *   {
 *     type: 'com.example.event',
 *     source: '/example/source',
 *     subject: 'example-subject',
 *     data: { key: 'value' }
 *   },
 *   { customextension: 'value' },
 * );
 */
export const createArvoEvent = <
  TData extends ArvoEventData,
  TExtension extends CloudEventExtension,
  TType extends string,
>(
  event: CreateArvoEvent<TData, TType>,
  extensions?: TExtension,
): ArvoEvent<TData, TExtension, TType> => {
  const span = ArvoCoreTracer.startSpan(`createArvoEvent<${event.type}>`, {});
  return context.with(trace.setSpan(context.active(), span), () => {
    span.setStatus({ code: SpanStatusCode.OK });
    const otelHeaders = currentOpenTelemetryHeaders();
    try {
      if (
        event.datacontenttype &&
        event.datacontenttype !== ArvoDataContentType
      ) {
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

      return new ArvoEvent<TData, TExtension, TType>(
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
