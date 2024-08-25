import ArvoEvent from '.';
import {
  exceptionToSpan,
  getTelemetryContext,
  logToSpan,
} from '../OpenTelemetry';
import { TelemetryContext } from '../OpenTelemetry/types';
import { cleanString, createTimestamp } from '../utils';
import { ArvoDataContentType } from './schema';
import {
  ArvoEventData,
  CloudEventExtension,
  CreateArvoEvent,
  CreateArvoEventResult,
} from './types';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { v4 as uuid4 } from 'uuid';

/**
 * Creates an ArvoEvent with the provided data and extensions.
 *
 * @template TData - The type of the event data, extending ArvoEventData.
 * @template TExtension - The type of the cloud event extension, extending CloudEventExtension.
 *
 * @param {CreateArvoEvent<TData, TExtension>} event - The event data and metadata to create the ArvoEvent.
 * @param {TelemetryContext} [telemetry] - Optional telemetry context for tracing.
 *
 * @returns {CreateArvoEventResult<TData, TExtension>} An object containing the created ArvoEvent (or null if creation failed),
 * any errors encountered, and any warnings generated during the creation process.
 */
export const createArvoEvent = <
  TData extends ArvoEventData,
  TExtension extends CloudEventExtension,
>(
  event: CreateArvoEvent<TData>,
  extensions?: TExtension,
  telemetry?: TelemetryContext,
): CreateArvoEventResult<TData, TExtension> => {
  const activeContext = getTelemetryContext(
    telemetry?.context.traceparent || null,
  );
  const activeTracer =
    telemetry?.tracer || trace.getTracer('ArvoEvent Creation');
  const activeSpan = activeTracer.startSpan(
    'Create ArvoEvent',
    {},
    activeContext,
  );

  const result: CreateArvoEventResult<TData, TExtension> = {
    event: null,
    errors: [],
    warnings: [],
  };

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
      logToSpan(activeSpan, {
        level: 'WARNING',
        message: warning,
      });
      result.warnings.push(warning);
    }

    result.event = new ArvoEvent<TData, TExtension>(
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

    activeSpan.setStatus({ code: SpanStatusCode.OK });
  } catch (e) {
    exceptionToSpan(activeSpan, 'ERROR', e as Error);
    result.errors.push(e as Error);
    activeSpan.setStatus({
      code: SpanStatusCode.ERROR,
      message: (e as Error).message,
    });
  } finally {
    activeSpan.end();
  }

  return result;
};
