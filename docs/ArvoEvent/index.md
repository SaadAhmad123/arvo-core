# ArvoEvent

ArvoEvent is a powerful and flexible class for creating and managing CloudEvents with Arvo-specific extensions. This event class provides a robust implementation of the CloudEvents specification, with additional features tailored for Arvo event driven system use cases.

## Why Use ArvoEvents?

1. **CloudEvents Compliance**: Fully compliant with the CloudEvents 1.0 specification, ensuring interoperability with other CloudEvents-based systems.
2. **Arvo-Specific Extensions**: Includes custom extensions for Arvo-specific metadata, enhancing event routing and processing capabilities.
3. **Type Safety**: Built with TypeScript, providing strong typing and better developer experience.
4. **OpenTelemetry Integration**: Built-in support for OpenTelemetry, facilitating distributed tracing and monitoring.
5. **Flexible and Extensible**: Easily extendable to include custom data and extensions.

## Components

1. `ArvoEvent`: The main class representing an Arvo-enhanced CloudEvent.
2. `createArvoEvent`: A function to create ArvoEvents with error handling and warnings.
3. Various schemas and types for data validation and type checking.

## Assumptions

1. The library assumes that you're working in a TypeScript/JavaScript environment.
2. It expects the `zod` library for schema validation.
3. OpenTelemetry integration is optional but supported.

## Usage

### Creating an ArvoEvent

```typescript
import { createArvoEvent, ArvoEventData, CloudEventExtension } from '@arvo/core';

// Define your event data type
interface MyEventData extends ArvoEventData {
  message: string;
}

// Define any custom extensions
interface MyExtensions extends CloudEventExtension {
  customfield: string;
}

// Create the event
const { event, errors, warnings } = createArvoEvent<MyEventData, MyExtensions>({
  source: 'event.producer',
  type: 'com.example.event',
  subject: 'event/subject',
  data: { message: 'Hello, Arvo!' },
  to: 'event.consumer',
}, {
  customfield: 'Custom Value'
});

if (event) {
  console.log('Event created:', event.toString());
} else {
  console.error('Failed to create event:', errors);
}

if (warnings.length > 0) {
  console.warn('Warnings:', warnings);
}
```

### Using an ArvoEvent

Once you have created an ArvoEvent, you can access its properties and methods:

```typescript
if (event) {
  console.log('Event ID:', event.id);
  console.log('Event Type:', event.type);
  console.log('Event Data:', event.data);
  console.log('Event Extensions:', event.extensions);

  // Get the basic/ default CloudEvent representation
  const cloudEvent = event.cloudevent.default;

  // Get the extension fields as per the cloudevent spec.
  // These include Arvo-specific extensions as well as
  // your own defined extensions
  const cloudEventExtensions = event.cloudevent.extensions

  // Converts the event into on object. Note, in 
  // this object the default cloudevent data and 
  // the extensions are at the same level
  const data = event.toJSON()

  // Convert to JSON-string. This JSON contains
  // the default cloudevent data as well the
  // extensions at the same level.
  const jsonString = event.toString();

  // Get OpenTelemetry attributes.
  // These attributes contain CloudEvent specific
  // attributes as defined by the OpenTelemetry
  // spec as well as some Arvo specific event attributes.
  // If an 
  const otelAttributes = event.otelAttributes;
}
```

## ArvoEvent fields

Following are all the fields used by the ArvoEvent and their descriptions

| Field | Schema | Description |
|-------|--------|-------------|
| id | String | Unique identifier of the event. Must be a non-empty string. |
| time | String (DateTime) | Timestamp of when the occurrence happened. Must be in ISO 8601 format with timezone offset. |
| source | String (URI) | Identifies the context in which an event happened. Must be a valid URI representing the event producer. |
| specversion | String | The version of the CloudEvents specification used. Must be '1.0' for this version. |
| type | String | Describes the type of event. Should be prefixed with a reverse-DNS name. |
| subject | String (URI) | Identifies the subject of the event. For Arvo, this must be the Process Id. |
| datacontenttype | String | Content type of the data value. Must include 'application/cloudevents+json' or 'application/json'. For an ArvoEvent, it is set automatically to 'application/cloudevents+json;charset=UTF-8;profile=arvo' |
| dataschema | String (URI) or null | Identifies the schema that data adheres to. Must be a valid URI if present. |
| data | JSON serializable object | The event payload. This payload must be JSON serializable |
| to | String (URI) or null | Defines the consumer machine of the event. Used for event routing. |
| accesscontrol | String or null | Defines access controls for the event. Can be a UserID, encrypted string, or key-value pairs. |
| redirectto | String (URI) or null | Indicates alternative recipients or destinations for events. |
| executionunits | Number or null | Represents the cost associated with generating the cloudevent. |
| traceparent | String or null | Contains trace context information for distributed tracing (OpenTelemetry). |
| tracestate | String or null | Conveys vendor-specific trace information across service boundaries (OpenTelemetry). |

## Best Practices

1. Always check for errors and warnings when creating an ArvoEvent.
2. Use type parameters with `createArvoEvent` for better type safety.
3. Utilize the `otelAttributes` for integrating with OpenTelemetry.
4. When extending ArvoEvents with custom data or extensions, create interfaces that extend `ArvoEventData` and `CloudEventExtension` respectively.












