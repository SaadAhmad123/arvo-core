import ArvoEvent from "../ArvoEvent";
import { ArvoDataContentType } from "../ArvoEvent/schema";
import { createTimestamp } from "../utils";
import { ArvoEventHttpConfig } from "./types";
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
      ...Object
        .entries(event.toJSON())
        .filter(([key]) => key !== 'data')
        .map(([key, value]) => ({
          [`ce-${key}`]: value
        }))
    )
    return {
      headers: {
        ...headers,
        'content-type': 'application/json'
      },
      data: {...event.data}
    }
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
      data: event.toJSON()
    }
  }

  /**
   * Imports an ArvoEvent from a binary-mode HTTP representation.
   * @param config - The ArvoEventHttpConfig object to import from.
   * @returns A new ArvoEvent instance.
   * @throws {Error} If required fields are missing or if there's an error parsing the input.
   */
  static importFromBinary(config: ArvoEventHttpConfig): ArvoEvent {
    try {

      if (config.headers['content-type'] !== 'application/json') {
        throw new Error(`Invalid content-type: ${config.headers['content-type']}. Expected: application/json`);
      }

      const eventFields = [
        "id",
        "type",
        "accesscontrol",
        "executionunits",
        "traceparent",
        "tracestate",
        "datacontenttype",
        "specversion",
        "time",
        "source",
        "subject",
        "to",
        "redirectto",
        "dataschema",
      ];

      const event: Record<string, any> = {};
      
      // Extract event fields from headers
      for (const field of eventFields) {
        const headerKey = `ce-${field}`;
        if (headerKey in config.headers) {
          event[field] = config.headers[headerKey];
        }
      }

      // Validate required fields
      if (!event.type || !event.source || !event.subject) {
        throw new Error("Missing required header fields: ce-type, ce-source, or ce-subject");
      }

      // Extract extensions
      const prefixedEventFields = eventFields.map(item => `ce-${item}`);
      const extensions = Object.entries(config.headers)
        .filter(([key]) => key.startsWith('ce-') && !prefixedEventFields.includes(key))
        .reduce((acc, [key, value]) => {
          acc[key.slice(3)] = value;
          return acc;
        }, {} as Record<string, any>);

      // Create and return ArvoEvent
      return new ArvoEvent(
        {
          id: event.id ?? uuid4(),
          type: event.type,
          accesscontrol: event.accesscontrol ?? null,
          executionunits: event.executionunits ? Number(event.executionunits) : null,
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
        config.data,
        extensions,
      );
    } catch (error) {
      throw new Error(`Failed to import ArvoEvent from binary: ${(error as Error).message}`);
    }
  }

  /**
   * Imports an ArvoEvent from a structured-mode HTTP representation.
   * @param config - The ArvoEventHttpConfig object to import from.
   * @returns A new ArvoEvent instance.
   * @throws {Error} If required fields are missing or if there's an error parsing the input.
   */
  static importFromStructured(config: ArvoEventHttpConfig): ArvoEvent {
    try {
      if (config.headers['content-type'] !== ArvoDataContentType) {
        throw new Error(`Invalid content-type: ${config.headers['content-type']}. Expected: ${ArvoDataContentType}`);
      }

      const eventData = config.data;

      if (!eventData.type || !eventData.source || !eventData.subject) {
        throw new Error("Missing required fields: type, source, or subject");
      }

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

      return new ArvoEvent(
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
        extensions
      );
    } catch (error) {
      throw new Error(`Failed to import ArvoEvent from structured: ${(error as Error).message}`);
    }
  }

}