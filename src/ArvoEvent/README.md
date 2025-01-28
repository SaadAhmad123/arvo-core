---
title: ArvoEvent
group: Guides
---

# ArvoEvent - A Event Design for Evolutionary and Reliable Event-Driven Architecture

In the world of event-driven architecture (EDA), managing communication between services presents a unique set of challenges. As systems grow and evolve, the complexity of maintaining reliable service communication often becomes a significant hurdle. Arvo addresses these challenges by providing a standardised event structure, called `ArvoEvent` that promotes reliability, scalability, and system evolution while remaining flexible enough to adapt to diverse business needs.

## The Challenge of Event Standardisation

Event-driven architectures excel at scalability but face challenges in evolution and reliability due to inconsistent event semantics and formats across teams. While practices like Event Storming help identify event flows and data requirements, the actual implementation often becomes fragmented as teams create incompatible event structures optimised for their specific domains, leading to complex integration challenges and reduced system maintainability as the architecture grows.

To address these challenges, Arvo builds upon the standardised CNCF `CloudEvent` specification rather than creating a new standard. This approach leverages existing industry knowledge and tooling while adding targeted extensions that support enterprise requirements, enabling teams to maintain consistent event semantics and structure across their distributed systems without sacrificing the flexibility needed for diverse business needs.

## Core Architecture: The Event Broker Pattern

Arvo uses a centralised event broker pattern that promotes clean separation between services while maintaining clear communication pathways. Here's how it works:

1. Services register with a central event broker, declaring which event types they can process
2. When events arrive, the broker routes them to appropriate handlers based on registration information
3. Services process events and emit responses back through the broker
4. The cycle continues, maintaining a continuous flow of event-based communication

This broker-centric architecture eliminates direct service-to-service dependencies. Each service can evolve independently within its bounded context, leading to a more maintainable system that can scale effectively.

> **Note:** While a centralised event broker might initially raise concerns about creating a system bottleneck, modern event brokers are specifically engineered to handle massive scale. Moreover, Arvo expects a computationally simple routing mechanism that relies on simple string matching between event destinations `to` and handler registrations `handler.source`, allowing the broker to quickly route events without complex logic or state management.

## The `ArvoEvent` structure

`ArvoEvent` extends the `CloudEvents` specification with additional fields necessary for enterprise-grade event-driven systems. Every event must include standard `CloudEvents` fields and incorporates Arvo-specific `extensions` for enhanced functionality and routing.

The following table provides a comprehensive overview of `ArvoEvent` fields, their classification, and the rationale behind their inclusion in the event structure.

| Field Name        | Classification      | Rationale                                                                                                                                                                                                                                                                                                                                         |
| ----------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`              | CloudEvent Core     | Provides a unique identifier for each event in the system. Generated as a UUID by default to ensure global uniqueness across distributed systems. Essential for event tracking, deduplication, and correlation.                                                                                                                                   |
| `source`          | CloudEvent Core     | Identifies the origin of the event (e.g., "order-service", "payment-processor"). Critical for debugging, auditing, and maintaining system transparency. Helps in understanding event flow and troubleshooting issues.                                                                                                                             |
| `type`            | CloudEvent Core     | Describes the nature of the event using reverse-DNS format (e.g., "com.company.order.created"). This structured format ensures global uniqueness of event types and enables clear categorisation of events. Essential for event routing and processing decisions.                                                                                 |
| `subject`         | CloudEvent Core     | Acts as a process identifier, linking related events together. Crucial for tracking business processes that span multiple events and services. Enables correlation of events within a single business transaction or workflow. In Arvo, the `ArvoOrchestrator` uses this field to keep track of the state across the entire workflow execution    |
| `data`            | CloudEvent Core     | Contains the actual payload of the event. This is where the business-specific information resides. The structure is defined by the event type and validated against the dataschema.                                                                                                                                                               |
| `time`            | CloudEvent Core     | Records when the event occurred in ISO 8601 format. Auto-generated if not specified. Essential for event ordering, debugging, and audit trails. Helps maintain temporal relationships between events.                                                                                                                                             |
| `datacontenttype` | CloudEvent Core     | Specifies the format of the data field (e.g., application/json). Ensures correct parsing and processing of event payload. Supports content negotiation between services.                                                                                                                                                                          |
| `dataschema`      | CloudEvent Core     | References the schema that validates the data payload. Ensures data integrity and compatibility across services. Supports contract-based development and system evolution. For event generated in adherence with a `ArvoContract` this contains the contract URI and version.                                                                     |
| `to`              | ArvoEvent Extension | Specifies the intended event consumer. Essential for direct routing in a mesh-like architecture. Enables targeted event delivery without creating tight coupling between services.                                                                                                                                                                |
| `redirectto`      | ArvoEvent Extension | Enables dynamic routing for complex workflows. Allows events to be redirected based on runtime conditions or business rules. Supports sophisticated orchestration patterns while maintaining service independence.                                                                                                                                |
| `accesscontrol`   | ArvoEvent Extension | Supports various access control mechanisms from simple user IDs to role-based access. Enables fine-grained security controls at the event level. Critical for maintaining security in distributed systems where events may contain sensitive information or where event originator user need to have specific permission to use an event handler. |
| `executionunits`  | ArvoEvent Extension | Tracks computational cost of event processing. Valuable for system optimisation, capacity planning, and resource utilisation analysis.                                                                                                                                                                                                            |
| `traceparent`     | ArvoEvent Extension | Part of OpenTelemetry integration. Carries distributed tracing context across service boundaries. Essential for understanding event flow and diagnosing issues in complex distributed systems.                                                                                                                                                    |
| `tracestate`      | ArvoEvent Extension | Supports vendor-specific tracing information as part of OpenTelemetry integration. Enables detailed tracing and monitoring capabilities while maintaining compatibility with various monitoring tools.                                                                                                                                            |

The combination of CloudEvent core fields and Arvo extensions creates a robust event structure. The core fields provide essential event identification and payload management, while the extensions enable sophisticated routing, security, monitoring, and cost tracking capabilities.

Here's the updated version of the "Event Creation" section with the provided examples:

## Creating ArvoEvents

The `arvo-core` package provides two primary methods for creating an `ArvoEvent`. The first method is the `createArvoEvent` function, which constructs the event from the provided parameters. This function ensures that the data supplied to it adheres to the requirements of the event structure. However, it does not validate the contents of the `data` field.

```typescript
const event = createArvoEvent<OrderData, {}, "order.created">({
  source: "com.test.test",
  type: "com.order.create",
  subject: "order/123",
  data: {
    orderId: "ord-123",
    amount: 99.99
  }
});
```

The second method involves the `createArvoEventFactory` and `createArvoOrchestratorEventFactory` functions. These factory functions accept an `ArvoContract`, which defines the data structure of the `data` field, as well as the version and event type. The factory functions create the event by performing specific data validations based on the provided contract. Under the hood, the factory functions utilize the `createArvoEvent` function to construct the event after validating the data.

```typescript
import { createArvoContract, type ArvoEvent } from 'arvo-core';
import { createArvoEventHandler } from 'arvo-event-handler';
import z from 'zod';

// Our contract defines the service interface
const userCreateContract = createArvoContract({
    uri: "#/sample/user/create",
    type: "com.create.user",
    versions: {
        "1.0.0": {
            accepts: z.object({
                name: z.string(),
                age: z.number(),
            }),
            emits: {
                "evt.create.user.success": z.object({
                    created: z.boolean()
                })
            }
        },
    }
});

const inputEvent: ArvoEvent = createArvoEventFactory(
    userCreateContract.version('1.0.0')
).accepts({
    subject: "some-subject",
    source: "com.test.test",
    data: {
        name: "John Doe",
        age: 65
    }
});
```

In summary, `createArvoEvent` performs basic event validations, while the factory functions provide a higher level of data validation based on the specified `ArvoContract`. For more detailed information on `ArvoContract` and event factories, please refer to their respective documentation.

## Data Serialisation and Immutability

`ArvoEvent` handles JSON serialisation and ensures event immutability, providing a reliable foundation for event-driven communication.

It requires that all event data must be JSON-serialisable. This requirement ensures that events can be easily stored, transmitted, and consumed by different systems and services. Moreover, it emphasizes event immutability. Once an event is created, it is frozen to prevent accidental modifications during event propagation while it is being handled by the event handler.

Here's an example that demonstrates the serialisation and deserialisation of `ArvoEvent`:

```typescript
const event = createArvoEvent<OrderData, {}, "order.created">({
  source: "com.test.test",
  type: "com.order.create",
  subject: "order/123",
  data: {
    orderId: "ord-123",
    amount: 99.99
  }
});

// Serialize the event to a JSON
string const jsonString = JSON.stringify(event.toJSON()); 
// Reconstruct the event from the JSON
string const reconstructedEvent = createArvoEvent(JSON.parse(jsonString));
```
  
## Working with Event Metadata

`ArvoEvent` provides a rich set of methods and properties for accessing and working with event metadata, enabling developers to easily retrieve and manipulate various aspects of an event for flexible event processing and decision-making. Furthermore, OpenTelemetry attributes can be accessed through the `otelAttributes` property for advanced tracing and monitoring scenarios.

```typescript
// Accessing event metadata
const eventId = event.id;
const eventTime = event.time;
const eventData = event.data;
const eventTo = event.to;
const eventRedirectTo = event.redirectto;

// Accessing event extensions
const cloudEvent = event.cloudevent;      // Complete CloudEvents format
const customExtensions = event.extensions; // Custom extensions only
const attributes = event.otelAttributes;   // OpenTelemetry attributes
```

## The `subject` Field in Arvo's Event-Driven Orchestration Model

The `subject` field in Arvo plays a crucial role by remaining consistent across all events related to a single workflow execution. This unique identifier ties together every event in the workflow, making it essential for the `ArvoOrchestrator`to manage the state and progression of the workflow.

At its core, the `ArvoOrchestrator` is a specialized event handler designed to coordinate complex workflows that span multiple services. It achieves this by maintaining a state machine (typically using a variant of `xstate`) that defines the steps and transitions within the workflow.

When an event related to a workflow arrives, the `ArvoOrchestrator` uses the `subject` field to fetch the current state of that specific workflow instance from a key-value store. It then processes the event according to the state machine's logic, determines the next state and any events that need to be emitted, and stores the updated state back in the key-value store, using the `subject` as the key. This cycle repeats for each incoming event, with the orchestrator consistently using the `subject` to retrieve and update the correct workflow state.

In this way, the `ArvoOrchestrator` can reliably manage multiple concurrent instances of the same workflow. Even if different instances are at different stages the orchestrator can accurately retrieve and update each instance's state independently.

Moreover, having a consistent `subject` across all events enables powerful auditing and event sourcing capabilities. By storing events with the same `subject` together, ordered by their `time` field, it becomes possible to replay the entire history of a workflow to the `ArvoOrchestrator`. This allows for detailed auditing, as the orchestrator can reconstruct the state at any point in the workflow's lifecycle. Event sourcing also provides a robust foundation for debugging, as issues can be reproduced by replaying the relevant events.
## Deep Dive: System Observability 

System observability in distributed event-driven architectures presents unique challenges, particularly in tracing events as they flow between multiple services. Arvo addresses this challenge through native integration with OpenTelemetry, implementing distributed tracing through two critical event extensions: `traceparent` and `tracestate`. The `traceparent` field carries the core OpenTelemetry context, including trace ID, span ID, and trace flags, maintaining the connection between different spans as events traverse service boundaries. Meanwhile, the `tracestate` field supports vendor-specific tracing information, allowing organisations to include additional context while remaining compatible with the OpenTelemetry specification. This implementation ensures that when an event leaves one handler and moves to another, the tracing context seamlessly transfers, maintaining an unbroken chain of observability across the entire system.

In Arvo event handlers and related components leverage these trace contexts automatically, creating new spans for each event processing operation while preserving the broader trace context. When a handler receives an event, it extracts the `traceparent` and `tracestate` information to create a child span, executing its business logic within this context. Upon completion, any emitted events inherit this tracing context, ensuring that the entire event chain remains observable and debuggable.

```typescript
const event = createArvoEvent(
  {
    source: "com.inventory.builder",
    type: "com.stock.updated",
    subject: "product/456",
    data: {
	    name: "apple macbook"
    }
  },
);

// Accessing trace information
console.log(event.traceparent);
// Accessing the open telemetry attributes
console.log(event.otelAttributes);
```
## Deep Dive: Event Routing Architecture

Arvo implements an elegant and powerful event routing system that ensures reliable message delivery while maintaining service independence. At its core, the routing mechanism revolves around three fundamental fields: `to`, `source`, and `redirectto`. These fields work in concert to create a flexible yet predictable event routing system that supports both simple point-to-point communication and complex workflows.

> **Good to consider**: Before diving into the technical details, it's worth noting that most developers won't need to implement this routing logic directly. Arvo provides high-level handlers, orchestrators, and utility factories that handle these mechanics automatically. For complex event chains, Arvo recommends using the `ArvoOrchestrator` from `arvo-xstate` rather than implementing service-to-service choreography manually. The `ArvoOrchestrator` leverages state machines to manage complex workflows while abstracting away the routing complexity.

### The Event Broker: The Heart of Routing

At the centre of Arvo's architecture sits the event broker, which serves as the central nervous system for all event routing. The broker should follow a strict contract with handlers that ensures consistent and predictable event delivery. When an event arrives, the broker should performs a critical matching operation:

1. Examine the event's `to` field to determine the intended destination
2. Compare this destination against the `source` field of all registered handlers
3. Only when it finds an exact match will it forward the event to the corresponding handler

This matching process is fundamental to Arvo's routing system. It ensures that events always reach their intended destinations while maintaining loose coupling between services.

> **Note:** All event handlers defined in Arvo have a `source` field and can be accessed via `handler.source`. This is because all event handlers and event routers provided by Arvo inherit from `AbstractArvoEventHandler`.  Every event handler object computes it based on its configuration parameters. You can read more about it in the `arvo-event-handler` documentation

### Core Routing Fields

Let's examine each routing field in detail:
#### The `to` Field: Primary Destination Address
The `to` field serves as the primary addressing mechanism in Arvo's routing system. It uses a reverse-DNS format (e.g., `com.company.service`) to identify destination services. While the `to` field should often match an event's `type`, they can differ to support more sophisticated routing scenarios. For example:

```typescript
const event = { 
	to: "com.finance.service",  // Routing destination 
	type: "com.orders.payment.init",  // Event type for handler selection 
	// ... other fields 
};
```

In this case, while the event represents an order payment initialisation, it's routed to a central financial service that handles various payment-related operations.

> **Good to consider**: It is always a better idea to not use this kind of routing unless absolutely necessary. This is because it adds another layer of routing not handled by the event broker and less monitoring may be available. Moreover the producer of the event will then have to explicitly specify the event `type` as well as the `to` field (in which case this will end up being not governed by the `ArvoContract`)

#### The `source` Field: Event Origin and Default Return Path

The `source` field identifies where an event originated and typically serves as the return address for responses. Every handler in Arvo has a unique `source` identifier that serves two purposes:

1. As a receiving address when matching against incoming events' `to` fields
2. As the default `to` field for any events the handler emits (taken from the event consumed by the handler - logic is explain below in the documentation)

This dual role creates clear event trails and enables automatic response routing. You can access a handler's source through the `handler.source` property, as all Arvo handlers inherit from `AbstractArvoEventHandler`.

> The `ArvoEventHandler` will automatically populate the event `source` it field for all the events it emits from the `this<handler>.source`.

#### The `redirectto` Field: Alternative Response Routing

The `redirectto` field enables more sophisticated routing patterns by specifying an alternative destination for responses. This is particularly valuable in multi-step workflows where responses should flow to a different service than the original sender. Consider this order processing example:

```typescript
const paymentEvent = {
    to: "com.payment.service",
    redirectto: "com.shipping.service",  // Next step in the workflow
    type: "com.orders.payment.process",
    data: { orderId: "123", amount: 99.99 }
};
```


When the payment service processes this event, its response will automatically route to the shipping service rather than returning to the original sender.

### Routing Logic in Action

The event handlers in Arvo are responsible to executing the logic for setting the field appropriately in the event, this way the event broker does not have to implement and complex logic and the event handler get more flexibility.

For newly created events:
```typescript
// When creating an initial event, the destination is determined by:
// 1. Explicitly provided 'to' address if available
// 2. Otherwise, defaults to the event type
const destination = initParams.to ?? initParams.type;
```

For response events, the routing follows a priority-based decision tree:
```typescript
// Response routing priority:
// 1. Handler-specified destination
// 2. Original event's redirect address
// 3. Original event's source
const responseDestination = 
    handlerResponse.to ?? 
    sourceEvent.redirectto ?? 
    sourceEvent.source;

// Redirect handling preserves explicit redirects
// but clears them if not specified by handler
const responseRedirect = handlerResponse.redirectto ?? null;
```

### Implementing Event Routing

While Arvo's handlers implement this routing logic automatically, understanding how to work with it is valuable. Here's an example of creating a payment processing handler that implements explicit routing:

```typescript
import { type EventHandlerFactory, createArvoEventHandler } from 'arvo-event-handler';

const processPaymentHandlerFactory: EventHandlerFactory = () => 
    createArvoEventHandler({
        contract: paymentContract,
        executionunits: 1e-6,
        handler: {
            '1.0.0': async ({event}) => {
                // Process payment logic here
                return {
                    type: 'evt.payment.processed',
                    to: 'com.shipping.service',     // Explicit next destination
                    redirectto: 'com.notification.service', // Future response destination
                    data: { 
                        orderId: event.data.orderId,
                        status: 'paid' 
                    }
                };
            }
        }
    });
```

### Best Practices for Event Routing

The most important principle is knowing when and how to use Arvo's specialized components for complex workflows.

#### Always use the `ArvoOrchestrator`

The `ArvoOrchestrator` stands as Arvo's primary solution for managing complex event flows, but it's crucial to understand that it differs significantly from traditional orchestrators. Unlike conventional orchestrators that actively direct traffic and maintain complex state machines, the ArvoOrchestrator functions as just another event handler within your system - one with a specific focus on coordination. It maintains its own bounded context and follows the same event-handling patterns as any other service, but its specialised purpose is implementing state machines that coordinate complex workflows.

When you use `ArvoOrchestrator`, you're not creating a central point of control that could become a bottleneck. Instead, you're defining a state machine (via `xstate`) that responds to events and emits new events based on its current state. This approach maintains the distributed nature of your system while providing the coordination benefits typically associated with orchestration. The orchestrator becomes just another participant in your event-driven architecture, albeit one focused on managing process flow.

> For more information, see `arvo-xstate` package in NPM

#### Maintain clear service boundaries

Service boundaries play a crucial role in effective event routing. Each service should have clearly defined responsibilities and operate within its bounded context. This clarity makes routing decisions more straightforward and helps prevent the creation of tangled dependencies between services. When designing your services, think carefully about their boundaries and ensure they align with your business domains.

## Conclusion

ArvoEvent represents a sophisticated approach to solving key challenges in event-driven architectures. By extending the CloudEvents specification and introducing targeted enterprise-grade extensions, it provides a robust framework for:

- **Standardisation**: Creating consistent event semantics across distributed systems
- **Flexibility**: Supporting diverse business needs while maintaining architectural integrity
- **Observability**: Enabling comprehensive tracing and monitoring
- **Routing**: Implementing intelligent event delivery mechanisms

The design prioritises service independence, evolutionary architecture, and scalable communication. Developers gain a powerful tool for building complex, responsive, and maintainable event-driven systems that can adapt to changing business requirements.