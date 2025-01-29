---
title: ArvoEventFactory
group: Guides
---


# ArvoEventFactory: Streamlined Contract-Compliant Event Creation

In the heart of Arvo's event-driven architecture lies the relationship between `ArvoEvent` and `ArvoContract`. While these structures form the foundation of the system, creating events that precisely align with contract specifications can be a complex endeavor. The `arvo-core` package addresses this challenge by introducing the ArvoEventFactory, a sophisticated utility that transforms event creation into an intuitive and reliable process.

## Understanding ArvoEventFactory

ArvoEventFactory serves as an intelligent configuration interface that elevates event construction beyond traditional methods. By providing a powerful abstraction layer, it enables developers to build `ArvoEvent` instances that automatically conform to any `ArvoContract` specification. The factory handles the intricate details of event creation, including default value population, allowing developers to concentrate solely on the essential data requirements of their application.

Here's an example demonstrating the factory's capabilities:

```typescript
import { createArvoContract, createArvoEventFactory, ArvoOrchestrationSubject } from 'arvo-core'
import z from 'zod';

// Define a contract with multiple versions
const userEnquiryContract = createArvoContract({
    uri: "#/services/user/enquiry",
    type: "com.user.enquiry",
    versions: {
        "1.0.0": {
            accepts: z.object({
                user_id: z.string(),
            }),
            emits: {
                "evt.user.enquiry.success": z.object({
                    user_id: z.string(),
                    name: z.string(),
                    dob: z.string(),
                    age: z.number()
                })
            }
        },
        "2.0.0": {
            accepts: z.object({
                user_id: z.string(),
                region: z.enum(["US", "UK", "AUD"]),
            }),
            emits: {
                "evt.user.enquiry.success": z.object({
                    user_id: z.string(),
                    name: z.string(),
                    dob: z.string(),
                    age: z.number(),
                })
            }
        }
    }
})

// Create a factory instance for version 1.0.0
const eventFactoryV100 = createArvoEventFactory(userEnquiryContract.version('1.0.0'))
```

## Working with Events

The factory provides intuitive methods for creating both input and output events. For input events, the factory automatically determines the event type, streamlining the creation process:

```typescript
const serviceInputEventV100 = eventFactoryV100.accepts({
    source: "com.test.test",
    data: {
        uuid: "some-user-id"    
    }
})

// The factory can automatically figure our the appropriate subject. You can provide it by yourself as well if you want
```

For output events, where multiple event types might be defined in the contract, you'll need to specify the type:

```typescript
const serviceOutputEventV100 = eventFactoryV100.emits({
    type: "evt.user.enquiry.success",
    subject: subject,
    data: {
        uuid: "some-user-id",
        name: "John Doe",
        dob: "Feb 31, 1900",
        age: 125
    },
    executionunits: 1.3
})
```

## Advanced Features and Validation

ArvoEventFactory implements a sophisticated multi-layered validation approach. At compile-time, it leverages TypeScript's type system to provide robust type checking and intelligent code completion. This static validation works in conjunction with runtime contract validation to ensure event structures remain compliant throughout their lifecycle.

The factory also seamlessly integrates with OpenTelemetry for distributed tracing. When enabled, it automatically populates tracing headers while still allowing manual configuration for cases requiring fine-grained control.

## Error Handling and Debugging

The factory implements comprehensive error handling to help developers identify and resolve issues quickly. When validation fails, it provides detailed error messages that pinpoint the exact cause of the problem:

```typescript
try {
    const invalidEvent = eventFactoryV100.accepts({
        source: "com.test.test",
        subject: "some-unique-subject",
        data: {
            invalidField: "unexpected value"  // This will trigger a validation error
        }
    });
} catch (error) {
    console.error('Validation failed:', error.message);
}
```

## Best Practices

When working with ArvoEventFactory, consider these key practices:

For initial events, the factory can automatically generate the subject using the `ArvoOrchestrationSubject.new()` method. However, for subsequent events in an orchestration flow, you must provide the subject string explicitly, except when using `ArvoOrchestratorEventFactory.init` because it automatically maintains the subject chain via the `data.parentSubject$$` field.

Keep your contract versions semantically meaningful. As shown in the example above, new required fields warrant a new contract version to maintain backward compatibility.

Leverage the factory's TypeScript integration by allowing your IDE to guide you through event creation. The intelligent code completion can help prevent errors before they occur.

## Deep Dive: Orchestration Events

In the realm of Arvo's event-driven architecture, orchestration events serve as the conductors of complex distributed workflows. These specialised events, which either initiate an orchestrator or signal the completion of orchestration, carry unique attributes that enable sophisticated workflow choreography. At their core, they utilise the `event.data.parentSubject$$` field to establish and maintain relationships between different orchestration processes, creating a web of interconnected workflows that can span multiple services and contexts. Within the Arvo framework, orchestrator events are created by `ArvoOrchestratorEventFactory` which manages the complexity of these events.

The backbone of orchestration events lies in their sophisticated parent-child relationship management system, implemented through a combination of `event.subject` field and `event.data.parentSubject$$` field. 

- When a workflow begins with a root orchestration, it establishes its identity through a subject created by `ArvoOrchestrationSubject.new`. This initial subject becomes the anchor point for the entire workflow chain. This initial event can be created by with `ArvoEventFactory` (recommended) or `ArvoOrchestratorEventFactory`.
- As the workflow progresses and spawns child orchestrations, each new orchestration event maintains its lineage through the `event.data.parentSubject$$` field, with its own subject derived using `ArvoOrchestrationSubject.from()`. This careful tracking of relationships ensures that even in complex, nested workflows, each orchestration event maintains clear connections to its ancestors.
- When an orchestration concludes, its completion event must maintain context continuity by referencing either the `parentSubject$$` from its initiation event or matching the subject of the initial event that started the workflow (signalling that the root workflow has finished). This systematic approach to subject handling ensures that the orchestration system can effectively track execution flow across distributed processes while maintaining clear boundaries between different workflow contexts.

What makes this system particularly elegant is how it balances power with usability. While the underlying mechanism of `subject` management and relationship tracking is sophisticated, developers rarely need to interact with these complexities directly. The `ArvoOrchestrator` event handler, from `arvo-xstate`, automatically manages these relationships, abstracting away the intricacies of `subject` chaining and context management. This abstraction allows developers to focus on defining their workflow logic while the system handles the complexities of maintaining execution context and relationships. However, understanding these underlying mechanisms remains valuable, particularly when designing custom orchestration patterns or troubleshooting complex workflows, as it provides insights into how Arvo maintains order and consistency in distributed orchestration scenarios.