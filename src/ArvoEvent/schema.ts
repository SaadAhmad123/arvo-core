import { z } from 'zod';
import { cleanString, validateURI } from '../utils';
import { isJSONSerializable } from './utils';

export const ArvoDataContentType = "application/cloudevents+json;charset=UTF-8;profile=arvo"

export const CloudEventContextSchema = z
  .object({
    id: z
      .string()
      .min(1, 'ID must be a non-empty string')
      .describe('Unique identifier of the event.'),
    time: z
      .string()
      .datetime({ offset: true })
      .describe(
        'Timestamp of when the occurrence happened. If the time of the occurrence cannot be determined then this attribute MAY be set to some other time (such as the current time) by the CloudEvents producer, however all producers for the same source MUST be consistent in this respect. In other words, either they all use the actual time of the occurrence or they all use the same algorithm to determine the value used.',
      ),
    source: z
      .string()
      .min(
        1,
        'Source must be a non-empty reference of the producer of the event',
      )
      .refine(validateURI, 'The source must be a properly encoded URI')
      .describe(
        cleanString(`
      Identifies the context in which an event happened.
      It must be a valid URI that represents the event producer.
    `),
      ),
    specversion: z
      .string()
      .min(1, 'Spec version must be a non-empty string')
      .refine(
        (val) => val === '1.0',
        "Spec version must be '1.0' for this version of the specification",
      )
      .describe(
        cleanString(`
      The version of the CloudEvents specification which the event uses.
      Must be '1.0' for this version of the specification.
    `),
      ),
    type: z
      .string()
      .min(1, 'Type must be a non-empty string')
      .regex(
        /^[a-z0-9]+(\.[a-z0-9]+)+\.[a-z0-9]+$/,
        'Type should be prefixed with a reverse-DNS name',
      )
      .describe(
        cleanString(`
      Describes the type of event related to the originating occurrence.
      Should be prefixed with a reverse-DNS name.
    `),
      ),
    subject: z
      .string()
      .min(1)
      .describe(
        cleanString(`
      Identifies the subject of the event in the context of the event producer. 
      In case of Arvo, this MUST be Process Id.
    `),
      )
      .refine(validateURI, 'The subject must be a properly encoded URI'),
    datacontenttype: z
      .string()
      .min(1, 'Data content type must be a non-empty string')
      .refine(
        (val) =>
          Boolean(val?.includes('application/cloudevents+json')) ||
          Boolean(val?.includes('application/json')),
        cleanString(`
          The content type must be a valid JSON e.g. it must contain 
          'application/cloudevents+json' or 'application/json'. 
          Arvo recommends using '${ArvoDataContentType}'
        `),
      )
      .default(ArvoDataContentType)
      .describe(
        'Content type of the data value. Must adhere to RFC 2046 format if present.',
      ),
    dataschema: z
      .string()
      .min(1, 'Must be a non-empty string if present.')
      .refine(validateURI, 'The dataschema must be a properly encoded URI')
      .nullable()
      .describe('Identifies the schema that data adheres to'),
  })
  .describe(
    cleanString(`
    Defines the structure and validation rules 
    for the core properties of a CloudEvent.
  `),
  );

export const CloudEventExtensionSchema = z
  .record(
    z.string().regex(
      /^[a-z0-9]+$/,
      cleanString(`
          In compliance with CloudEvent specs, the extension keys must contain only 
          lowercase letters and numbers, with no spaces or other characters  
        `),
    ),
    z
      .union([z.string(), z.boolean(), z.number(), z.null()])
      .describe(
        'The CloudEvent extension can only contain a number, boolean, string or null',
      ),
  )
  .describe(
    'Schema for custom CloudEvent extensions. Allows for additional custom fields in the CloudEvent.',
  );



export const ArvoDataSchema = z
  .record(z.string(), z.any())
  .refine(isJSONSerializable, "The Arvo data object must be a JSON serializable object")
  .describe('A JSON serialisable object as ArvoEvent payload data');

export const ArvoExtensionSchema = z
  .object({
    to: z
      .string()
      .min(1, 'Must be a non empty string')
      .refine(validateURI, "The 'to' must be a properly encoded URI")
      .nullable()
      .describe(
        cleanString(`
      This field defined the consumer machine of the event. It's value can
      be the same as the type field or can be different. This is a metadata 
      field in event routing specifies initial recipients or topics. 

      For successful events, it should be determined 
      by handler definition, redirectto, or source. For errors, it should be 
      set to the error destination or event's source.
    `),
      ),
    accesscontrol: z
      .string()
      .min(1, 'Must be a non empty string, if defined')
      .nullable()
      .describe(
        cleanString(`
      Defines the access controls for the event. This field may contain one of the following:
      1. A UserID: A valid UUID representing a user who has access to the event.
      2. An encrypted string: A base64-encoded encrypted string containing access control information.
      3. Key-value pairs: A semicolon-separated list of key-value pairs, where each pair is separated by a colon.
        Example: "role:admin;department:finance;clearance:top-secret"

      This field is used to determine who or what can perform actions on or read the event.
      It can be used for fine-grained access control, allowing different levels of access
      based on user roles, departments, or other custom criteria.

      If no access controls are needed, this field can be set to null.

      Examples:
      - "123e4567-e89b-12d3-a456-426614174000" (UserID)
      - "ZW5jcnlwdGVkX2FjY2Vzc19jb250cm9sX2RhdGE=" (Encrypted string)
      - "role:editor;project:alpha;team:backend" (Key-value pairs)
    `),
      ),
    redirectto: z
      .string()
      .min(1, 'Must be a non empty string, if defined')
      .refine(validateURI, "The 'redirectto' must be a properly encoded URI")
      .nullable()
      .describe(
        cleanString(`
      This is a metadata field for events, indicating alternative recipients 
      or destinations. It enables dynamic routing and complex workflows. 

      For successful events, it's set by handlers; for errors, it's 
      null to prevent automatic redirection.
    `),
      ),
    executionunits: z
      .number()
      .nullable()
      .describe(
        cleanString(`
      This data field represents the cost associated with 
      generating this specific cloudevent. It serves as a metric 
      to track and measure the financial impact of event generation
      within cloud-based systems or applications.
    `),
      ),
  })
  .describe('Schema for Arvo-specific extensions to the CloudEvent.');

export const OpenTelemetryExtensionSchema = z
  .object({
    traceparent: z
      .string()
      .min(1, 'Must be a non empty string, if defined')
      .nullable()
      .describe(
        cleanString(`
      The traceparent header is part of the OpenTelemetry specification. 
      It contains trace context information, including trace ID, parent 
      span ID, and trace flags, enabling distributed tracing across 
      services and systems.  
    `),
      ),
    tracestate: z
      .string()
      .min(1, 'Must be a non empty string, if defined')
      .nullable()
      .describe(
        cleanString(`
      The tracestate header in OpenTelemetry is used to convey vendor-specific 
      trace information across service boundaries. It allows for custom 
      key-value pairs to be propagated alongside the traceparent header in 
      distributed tracing scenarios.  
    `),
      ),
  })
  .describe(
    cleanString(`
    Distributed tracing extension as per
    https://github.com/cloudevents/spec/blob/main/cloudevents/extensions/distributed-tracing.md  
  `),
  );
