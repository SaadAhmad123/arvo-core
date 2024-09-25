import ArvoEvent from '../ArvoEvent';
import { ArvoDataContentType } from '../ArvoEvent/schema';
import { createTimestamp } from '../utils';
import { ArvoEventHttpConfig } from './types';
import { v4 as uuid4 } from 'uuid';

/**
 * A utility class for converting ArvoEvents to and from HTTP configurations.
 */
export default class ArvoEventHttp {
  /**
   * Exports an ArvoEvent to a cloudevent binary-mode HTTP configuration.
   * @param event - The ArvoEvent to export.
   * @returns An ArvoEventHttpConfig object with headers and data.
   */
  static exportToBinary(event: ArvoEvent): ArvoEventHttpConfig {
    const headers = Object.assign(
      {},
      ...Object.entries(event.toJSON())
        .filter(([key]) => key !== 'data')
        .map(([key, value]) => ({
          [`ce-${key}`]: value,
        })),
    );
    return {
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      data: { ...event.data },
    };
  }

  /**
   * Exports an ArvoEvent to a cloudevent structured-mode HTTP representation.
   * @param event - The ArvoEvent to export.
   * @returns An ArvoEventHttpConfig object with headers and data.
   */
  static exportToStructured(event: ArvoEvent): ArvoEventHttpConfig {
    return {
      headers: {
        'content-type': event.datacontenttype,
      },
      data: event.toJSON(),
    };
  }

  /**
   * Imports an ArvoEvent from a binary-mode HTTP representation.
   * @param config - The ArvoEventHttpConfig object to import from.
   * @returns A new ArvoEvent instance.
   * @throws {Error} If required fields are missing or if there's an error parsing the input.
   */
  static importFromBinary(config: ArvoEventHttpConfig): ArvoEvent {
    this.validateContentType(
      config.headers['content-type']?.toString() ?? '',
      'application/json',
    );
    const event = this.extractEventFieldsFromHeaders(config.headers);
    this.validateRequiredFields(event, true);
    const extensions = this.extractExtensions(config.headers);
    return this.createArvoEvent(event, config.data, extensions);
  }

  /**
   * Imports an ArvoEvent from a structured-mode HTTP representation.
   * @param config - The ArvoEventHttpConfig object to import from.
   * @returns A new ArvoEvent instance.
   * @throws {Error} If required fields are missing or if there's an error parsing the input.
   */
  static importFromStructured(config: ArvoEventHttpConfig): ArvoEvent {
    this.validateContentType(
      config.headers['content-type']?.toString() ?? '',
      ArvoDataContentType,
    );
    const eventData = config.data;
    this.validateRequiredFields(eventData, false);
    return this.createArvoEventFromStructured(eventData);
  }

  /**
   * Validates the content type of the HTTP request.
   * @param actual - The actual content type from the request.
   * @param expected - The expected content type.
   * @throws {Error} If the actual content type doesn't match the expected one.
   */
  private static validateContentType(actual: string, expected: string): void {
    if (actual !== expected) {
      throw new Error(`Invalid content-type: ${actual}. Expected: ${expected}`);
    }
  }

  /**
   * Extracts event fields from the HTTP headers.
   * @param headers - The HTTP headers containing event information.
   * @returns An object with extracted event fields.
   */
  private static extractEventFieldsFromHeaders(
    headers: Record<string, any>,
  ): Record<string, any> {
    const eventFields = [
      'id',
      'type',
      'accesscontrol',
      'executionunits',
      'traceparent',
      'tracestate',
      'datacontenttype',
      'specversion',
      'time',
      'source',
      'subject',
      'to',
      'redirectto',
      'dataschema',
    ];
    return Object.fromEntries(
      eventFields
        .map((field) => [`ce-${field}`, headers[`ce-${field}`]])
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key.slice(3), value]),
    );
  }

  /**
   * Creates an error message for a missing required field.
   * @param type - The type of the missing field.
   * @param isHeader - A flag to distinguish between headers and structured payload
   * @returns A formatted error message string.
   */
  private static createErrorMessageForMissingField(
    type: string,
    isHeader: boolean,
  ) {
    if (isHeader) {
      return `Missing required header field(s): ${type}`;
    }
    return `Missing required field(s): ${type}`;
  }

  /**
   * Validates that all required fields are present in the event data.
   * @param event - The event data to validate.
   * @param isHeader - A flag to distinguish between headers and structured payload
   * @throws {Error} If any required field is missing.
   */
  private static validateRequiredFields(
    event: Record<string, any>,
    isHeader: boolean,
  ): void {
    ['type', 'source', 'subject'].forEach((field) => {
      if (!event[field]) {
        throw new Error(
          ArvoEventHttp.createErrorMessageForMissingField(
            isHeader ? `ce-${field}` : field,
            isHeader,
          ),
        );
      }
    });
  }

  /**
   * Extracts extension fields from the HTTP headers.
   * @param headers - The HTTP headers containing event information.
   * @returns An object with extracted extension fields.
   */
  private static extractExtensions(
    headers: Record<string, any>,
  ): Record<string, any> {
    const eventFields = [
      'id',
      'type',
      'accesscontrol',
      'executionunits',
      'traceparent',
      'tracestate',
      'datacontenttype',
      'specversion',
      'time',
      'source',
      'subject',
      'to',
      'redirectto',
      'dataschema',
    ];
    return Object.fromEntries(
      Object.entries(headers)
        .filter(
          ([key]) =>
            key.startsWith('ce-') && !eventFields.includes(key.slice(3)),
        )
        .map(([key, value]) => [key.slice(3), value]),
    );
  }

  /**
   * Creates an ArvoEvent instance from extracted event data, payload, and extensions.
   * @param event - The extracted event data.
   * @param data - The event payload.
   * @param extensions - The extracted extension fields.
   * @returns A new ArvoEvent instance.
   */
  private static createArvoEvent(
    event: Record<string, any>,
    data: any,
    extensions: Record<string, any>,
  ): ArvoEvent {
    return new ArvoEvent(
      {
        id: event.id ?? uuid4(),
        type: event.type,
        accesscontrol: event.accesscontrol ?? null,
        executionunits: event.executionunits
          ? Number(event.executionunits)
          : null,
        traceparent: event.traceparent ?? null,
        tracestate: event.tracestate ?? null,
        datacontenttype: event.datacontenttype ?? ArvoDataContentType,
        specversion: event.specversion ?? '1.0',
        time: event.time ?? createTimestamp(),
        source: event.source,
        subject: event.subject,
        to: event.to ?? null,
        redirectto: event.redirectto ?? null,
        dataschema: event.dataschema ?? null,
      },
      data,
      extensions,
    );
  }

  /**
   * Creates an ArvoEvent instance from structured event data.
   * @param eventData - The structured event data.
   * @returns A new ArvoEvent instance.
   */
  private static createArvoEventFromStructured(
    eventData: Record<string, any>,
  ): ArvoEvent {
    const {
      id,
      type,
      source,
      subject,
      time,
      datacontenttype,
      specversion,
      dataschema,
      data,
      to,
      accesscontrol,
      redirectto,
      executionunits,
      traceparent,
      tracestate,
      ...extensions
    } = eventData;

    return ArvoEventHttp.createArvoEvent(
      {
        id: id ?? uuid4(),
        type,
        source,
        subject,
        time: time ?? createTimestamp(),
        datacontenttype: datacontenttype ?? ArvoDataContentType,
        specversion: specversion ?? '1.0',
        dataschema: dataschema ?? null,
        to: to ?? null,
        accesscontrol: accesscontrol ?? null,
        redirectto: redirectto ?? null,
        executionunits: executionunits ? Number(executionunits) : null,
        traceparent: traceparent ?? null,
        tracestate: tracestate ?? null,
      },
      data ?? {},
      extensions,
    );
  }
}
