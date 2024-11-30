---
title: ArvoEvent
group: Guides
---

# ArvoEvent

ArvoEvent is a powerful and flexible class for creating and managing CloudEvents with Arvo-specific extensions. This event class provides a robust implementation of the CloudEvents specification, with additional features tailored for Arvo event-driven system use cases.

## Why Use ArvoEvents?

1. **CloudEvents Compliance**: Fully compliant with the CloudEvents 1.0 specification, ensuring interoperability with other CloudEvents-based systems.
2. **Arvo-Specific Extensions**: Includes custom extensions for Arvo-specific metadata, enhancing event routing and processing capabilities.
3. **Type Safety**: Built with TypeScript, providing strong typing and better developer experience.
4. **OpenTelemetry Integration**: Built-in support for OpenTelemetry, facilitating distributed tracing and monitoring.
5. **Flexible and Extensible**: Easily extendable to include custom data and extensions.

## Components

1. `ArvoEvent`: The main class representing an Arvo-enhanced CloudEvent.
2. `createArvoEvent`: A function to create ArvoEvents with OpenTelemetry integration and automatic field generation.
3. Various schemas and types for data validation and type checking.

## Usage

### Creating an ArvoEvent

```typescript
import {
  createArvoEvent,
} from 'arvo-core';

const event = createArvoEvent(
  {
    source: 'event.producer',
    type: 'com.example.event',
    subject: 'event/subject',
    data: { message: 'Hello, Arvo!' },
    to: 'event.consumer',
  },
  { customfield: 'Custom Value' },
  telemetryContext,
);

console.log('Event created:', event.toString());
```

### Using an ArvoEvent

Once you have created an ArvoEvent, you can access its properties and methods:

```typescript
console.log('Event ID:', event.id);
console.log('Event Type:', event.type);
console.log('Event Data:', event.data);
console.log('Event Extensions:', event.extensions);

// Get the basic CloudEvent representation
const cloudEvent = event.cloudevent.default;

// Get the extension fields as per the CloudEvent spec
const cloudEventExtensions = event.cloudevent.extensions;

// Convert the event to an object
const data = event.toJSON();

// Convert to JSON string
const jsonString = event.toString();

// Get OpenTelemetry attributes
const otelAttributes = event.otelAttributes;
```

## ArvoEvent Fields

The following table describes all the fields used by the ArvoEvent:

| Field           | Schema                   | Description                                                                                             |
| --------------- | ------------------------ | ------------------------------------------------------------------------------------------------------- |
| id              | String                   | Unique identifier of the event. If not provided, a UUID v4 will be generated.                           |
| time            | String (DateTime)        | Timestamp of when the occurrence happened. If not provided, the current timestamp will be used.         |
| source          | String (URI)             | Identifies the context in which an event happened. Must be a valid URI representing the event producer. |
| specversion     | String                   | The version of the CloudEvents specification used. Defaults to '1.0'.                                   |
| type            | String                   | Describes the type of event. Should be prefixed with a reverse-DNS name.                                |
| subject         | String (URI)             | Identifies the subject of the event. For Arvo, this must be the Process Id.                             |
| datacontenttype | String                   | Content type of the data value. Defaults to 'application/cloudevents+json;charset=UTF-8;profile=arvo'.  |
| dataschema      | String (URI) or null     | Identifies the schema that data adheres to. Must be a valid URI if present.                             |
| data            | JSON serializable object | The event payload. This payload must be JSON serializable.                                              |
| to              | String (URI) or null     | Defines the consumer machine of the event. Used for event routing.                                      |
| accesscontrol   | String or null           | Defines access controls for the event. Can be a UserID, encrypted string, or key-value pairs.           |
| redirectto      | String (URI) or null     | Indicates alternative recipients or destinations for events.                                            |
| executionunits  | Number or null           | Represents the cost associated with generating the CloudEvent.                                          |
| traceparent     | String or null           | Contains trace context information for distributed tracing (OpenTelemetry).                             |
| tracestate      | String or null           | Conveys vendor-specific trace information across service boundaries (OpenTelemetry).                    |

## Best Practices

1. Use type parameters with `createArvoEvent` for better type safety.
2. Provide a telemetry context when creating events to integrate with existing OpenTelemetry tracing.
3. When extending ArvoEvents with custom data or extensions, create interfaces that extend `ArvoEventData` and `CloudEventExtension` respectively.
4. Be aware that `source`, `subject`, `to`, `redirectto`, and `dataschema` fields are automatically URI-encoded.
5. If you provide a custom `datacontenttype`, ensure it's compatible with ArvoEvent to avoid warnings and limited functionality.

## OpenTelemetry Integration

The `createArvoEvent` function now includes built-in support for OpenTelemetry tracing. When you provide a `TelemetryContext`, it will create a span for the event creation process and log any warnings or errors to this span.
