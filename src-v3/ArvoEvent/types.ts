import type { z } from 'zod';
import type {
  ArvoDataSchema,
  ArvoExtensionSchema,
  CloudEventContextSchema,
  CloudEventExtensionSchema,
  OpenTelemetryExtensionSchema,
} from './schema';

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
export type OpenTelemetryExtension = z.infer<typeof OpenTelemetryExtensionSchema>;

/**
 * Represents the input parameters for creating an ArvoEvent.
 * @template TData - The type of the event data, extending ArvoEventData.
 * @template TType - The type name of the event
 */
export type CreateArvoEvent<TData extends ArvoEventData, TType extends string> = {
  /**
   * The event id serves as the primary deduplication key within the Arvo system,
   * ensuring idempotent event processing. If not provided, a UUID v4 will be automatically generated.
   */
  id?: {
    /**
     * Deduplication identifier management strategy.
     *
     * - `DEVELOPER_MANAGED`: You, the developer, guarantee uniqueness of the identifier value.
     *   The provided value is used directly as the deduplication key without modification.
     *
     * - `ARVO_MANAGED`: Arvo manages identifier uniqueness by generating a composite key.
     *   The final identifier follows the format `base64({uuid: uuid4(), value: value})`,
     *   where a UUID v4 prefix ensures global uniqueness while preserving the developer's
     *   value for reference.
     */
    deduplication: 'DEVELOPER_MANAGED' | 'ARVO_MANAGED';
    /**
     * The id value
     */
    value: string;
  };
  /** Timestamp of when the occurrence happened. Must be in ISO 8601 format with timezone offset. */
  time?: string;
  /** Identifies the context in which an event happened. Must be a valid URI representing the event producer. */
  source: string;
  /** The version of the CloudEvents specification used. Must be '1.0' for this version. */
  specversion?: '1.0';
  /** Describes the type of event. Should be prefixed with a reverse-DNS name. */
  type: TType;
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
  /** The unique identifier of the event that directly triggered the creation of this event within the Arvo ecosystem. */
  parentid?: string;
  /** Specifies the processing domain for event routing and workflow orchestration. Must contain only lowercase letters, numbers, and dots. */
  domain?: string;
};
