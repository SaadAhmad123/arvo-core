import { z } from 'zod';
import {
  CloudEventContextSchema,
  ArvoExtensionSchema,
  CloudEventExtensionSchema,
  ArvoDataSchema,
  OpenTelemetryExtensionSchema,
} from './schema';
import ArvoEvent from '.';

/**
 * Represents the core properties of a CloudEvent.
 */
export type CloudEventContext = z.infer<typeof CloudEventContextSchema>;

/**
 * Represents custom CloudEvent extensions.
 */
export type CloudEventExtension = z.infer<typeof CloudEventExtensionSchema>;

/**
 * Represents the data payload of an ArvoEvent.
 */
export type ArvoEventData = z.infer<typeof ArvoDataSchema>;

/**
 * Represents Arvo-specific extensions to the CloudEvent.
 */
export type ArvoExtension = z.infer<typeof ArvoExtensionSchema>;

/**
 * Represents OpenTelemetry-specific extensions to the CloudEvent.
 */
export type OpenTelemetryExtension = z.infer<
  typeof OpenTelemetryExtensionSchema
>;

/**
 * Represents the input parameters for creating an ArvoEvent.
 * @template TData - The type of the event data, extending ArvoEventData.
 */
export type CreateArvoEvent<TData extends ArvoEventData> = {
  /** Unique identifier of the event. Must be a non-empty string. If not provided, a UUID will be generated. */
  id?: string;
  /** Timestamp of when the occurrence happened. Must be in ISO 8601 format with timezone offset. */
  time?: string;
  /** Identifies the context in which an event happened. Must be a valid URI representing the event producer. */
  source: string;
  /** The version of the CloudEvents specification used. Must be '1.0' for this version. */
  specversion?: '1.0';
  /** Describes the type of event. Should be prefixed with a reverse-DNS name. */
  type: string;
  /** Identifies the subject of the event. For Arvo, this must be the Process Id. */
  subject: string;
  /** Content type of the data value. Must include 'application/cloudevents+json' or
   * 'application/json'. For an ArvoEvent, it is set automatically to
   * 'application/cloudevents+json;charset=UTF-8;profile=arvo'
   */
  datacontenttype?: string;
  /** Identifies the schema that data adheres to. Must be a valid URI if present. */
  dataschema?: string;
  /** The event payload. This payload must be JSON serializable. */
  data: TData;
  /** Defines the consumer machine of the event. Used for event routing. Must be a valid URI if present. */
  to?: string;
  /** Defines access controls for the event. Can be a UserID, encrypted string, or key-value pairs. */
  accesscontrol?: string;
  /** Indicates alternative recipients or destinations for events. Must be a valid URI if present. */
  redirectto?: string;
  /** Represents the cost associated with generating the cloudevent. */
  executionunits?: number;
  /** Contains trace context information for distributed tracing (OpenTelemetry). */
  traceparent?: string;
  /** Conveys vendor-specific trace information across service boundaries (OpenTelemetry). */
  tracestate?: string;
};
