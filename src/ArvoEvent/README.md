---
title: ArvoEvent
group: Guides
---

# ArvoEvent

ArvoEvent serves as the foundational message format in the Arvo event-driven framework, implementing and extending the CloudEvents specification. By providing a standardized event structure with built-in validation, type safety, and distributed tracing capabilities, ArvoEvent ensures consistent and reliable communication across distributed systems.

## Core Purpose

ArvoEvent sits at the heart of the Arvo framework's messaging system. While CloudEvents provides a specification for describing events in a common way, ArvoEvent extends this foundation with additional capabilities specifically designed for robust distributed systems. These enhancements include structured routing information, access control mechanisms, execution metrics, and seamless distributed tracing integration.

## Event Structure and Validation

ArvoEvent enforces a strict structure through comprehensive schema validation. Every event must include required CloudEvents fields and can optionally include Arvo-specific extensions. Here's a detailed look at the key components:

### CloudEvents Standard Fields

```typescript
const event = createArvoEvent({
  id: "unique-identifier",  // Auto-generated UUID if not provided
  source: "order-service",  // Required: Event producer identifier
  type: "order.created",    // Required: Event type with reverse-DNS format
  subject: "order/123",     // Required: Process identifier
  data: orderData,          // Required: Event payload
  time: timestamp,          // Auto-generated ISO 8601 if not provided
  datacontenttype: contentType,  // Defaults to Arvo's content type
  dataschema: schemaUri,    // Optional: URI reference to data schema
});
```

### Arvo-Specific Extensions

ArvoEvent enhances the base CloudEvents format with essential extensions for enterprise event-driven systems:

1. **Routing Information**:
   - `to`: Specifies the intended event consumer
   - `redirectto`: Enables dynamic routing for complex workflows

2. **Access Control**:
   - `accesscontrol`: Supports multiple formats for access control:
     - User IDs
     - Encrypted strings
     - Key-value pairs for role-based access

3. **System Metrics**:
   - `executionunits`: Tracks computational cost of event processing

4. **Distributed Tracing**:
   - `traceparent`: OpenTelemetry trace context
   - `tracestate`: Vendor-specific tracing information

## Type Safety and Validation

ArvoEvent provides comprehensive type safety through TypeScript and runtime validation via Zod schemas. This dual approach ensures both development-time type checking and runtime data validation:

```typescript
// Type-safe event creation
type OrderData = {
  orderId: string;
  amount: number;
};

const event = createArvoEvent<OrderData, {}, "order.created">({
  source: "order-service",
  type: "order.created",
  subject: "order/123",
  data: {
    orderId: "ord-123",
    amount: 99.99
  }
});
```

## Data Serialization and Immutability

ArvoEvent handles JSON serialization and ensures event immutability:

1. **JSON Serialization**:
   - All data must be JSON-serializable
   - Automatic validation during event creation
   - Built-in serialization methods for different use cases

2. **Immutability**:
   - Events are frozen after creation
   - Prevents accidental modifications during event propagation
   - Ensures event integrity across the system

## Integration with OpenTelemetry

ArvoEvent provides native OpenTelemetry support for distributed tracing:

```typescript
// Creating an event with OpenTelemetry context
const event = createArvoEvent(
  {
    source: "inventory-service",
    type: "stock.updated",
    subject: "product/456",
    data: stockData
  },
  undefined,
  { 
    // Optional OpenTelemetry configuration
    disable: false 
  }
);

// Accessing trace information
console.log(event.traceparent);
console.log(event.otelAttributes);
```

## Working with Event Metadata

ArvoEvent provides several methods for accessing and working with event metadata:

```typescript
// Accessing event data
const eventId = event.id;
const eventTime = event.time;
const eventData = event.data;

// Working with extensions
const cloudEvent = event.cloudevent;      // Complete CloudEvents format
const customExtensions = event.extensions; // Custom extensions only
const attributes = event.otelAttributes;   // OpenTelemetry attributes
```

## Error Handling and Validation

ArvoEvent implements comprehensive validation at multiple levels:

1. **Schema Validation**: Every field is validated against its defined schema
2. **URI Validation**: Automatic validation and encoding of URI fields
3. **Content Type Validation**: Ensures proper content type formatting
4. **Data Serialization**: Validates JSON serializability of payload

## Best Practices

When working with ArvoEvents:

1. Use the `createArvoEvent` factory function instead of direct class instantiation
2. Provide explicit type parameters for better type safety
3. Handle OpenTelemetry context appropriately for distributed tracing
4. Use the built-in serialization methods for consistent event handling
5. Leverage the immutability guarantees for reliable event processing

By providing a robust foundation for event representation and handling, ArvoEvent enables reliable and maintainable event-driven architectures. Its combination of type safety, validation, and tracing capabilities makes it an essential component in building distributed systems with the Arvo framework.

[Previous content remains the same...]

## Comparing Event Formats: ArvoEvent vs CloudEvents vs Custom Events

Understanding the differences between event formats helps in choosing the right approach for your distributed system needs. Here's a detailed comparison:

| Aspect | ArvoEvent | CloudEvents | Custom Events |
|--------|-----------|-------------|---------------|
| **Standardization** | Implements CloudEvents spec with additional enterprise features. Enforces consistent patterns across services. | Industry standard specification for describing events. Provides basic interoperability. | No standardization. Each implementation can be different, leading to inconsistency. |
| **Validation** | Complete runtime validation with Zod schemas. Enforces field formats, data types, and URI validation. Prevents invalid events from entering the system. | Basic structural validation possible but not enforced. Implementation-dependent validation rules. | Manual validation required. High risk of inconsistent validation across services. |
| **Type Safety** | Full TypeScript integration with generics. Compile-time type checking for events, data, and extensions. Automatic type inference for handlers. | Basic TypeScript types available. Limited type inference capabilities. | Type safety depends on implementation. Often relies on manual type definitions. |
| **Event Routing** | Built-in support for routing via `to` and `redirectto` fields. Enable complex workflow patterns and event redirection. | No built-in routing mechanics. Routing must be implemented separately. | Custom routing logic required. Often leads to tight coupling between services. |
| **Access Control** | Standardized access control patterns. Supports user IDs, encrypted strings, and role-based access. | No built-in access control. Security must be implemented separately. | Security implementations vary. Risk of inconsistent access control patterns. |
| **Tracing** | Native OpenTelemetry integration. Automatic span creation and context propagation. Built-in attribute mapping. | Basic tracing extension available. Manual integration required. | Custom tracing implementation needed. Risk of incomplete or inconsistent tracing. |
| **Immutability** | Guaranteed immutability through Object.freeze(). Prevents accidental modifications during event propagation. | Immutability not enforced. Depends on implementation. | Immutability must be manually implemented. Risk of event mutation during processing. |
| **Serialization** | Strict JSON serialization rules. Built-in methods for different serialization needs. Validation of serializable content. | Basic JSON serialization possible. No built-in validation. | Custom serialization logic needed. Risk of inconsistent serialization formats. |
| **System Integration** | Part of larger Arvo framework. Works seamlessly with contracts, handlers, and routers. | Requires additional integration work for system features. | Requires significant integration effort. Often leads to tight coupling. |
| **Development Experience** | Rich IDE support with type hints. Clear error messages from schema validation. Built-in debugging tools. | Basic IDE support. Limited development tooling. | Development experience varies. Often lacks comprehensive tooling. |
| **Maintainability** | Standardized patterns reduce maintenance burden. Clear upgrade paths for schema changes. | Moderate maintenance effort. Changes require careful coordination. | High maintenance burden. Changes often require updates across multiple services. |
| **Learning Curve** | Steeper initial learning curve. More concepts to understand upfront. | Moderate learning curve. Basic concepts are straightforward. | Variable learning curve. Depends on implementation complexity. |
| **Performance Impact** | Additional overhead from validation and tracing. Optimized for enterprise use cases. | Minimal overhead. Basic structure validation only. | Performance varies. Can be optimized for specific use cases. |
| **Interoperability** | Compatible with CloudEvents ecosystem. Additional features for enterprise integration. | Broad ecosystem compatibility. Wide tool and platform support. | Limited interoperability. Often tied to specific implementation. |

# Decision Matrix: Choosing the Right Event Format

The following matrix helps evaluate which event format best suits your system's needs. Each criterion is rated using:
✓ : Full support out of the box
⚡: Partial support or requires custom implementation
✗ : Not supported

| Criterion | ArvoEvent | CloudEvents | Custom Events |
|-----------|-----------|-------------|---------------|
| **Enterprise Requirements** |
| Standardized Event Structure | ✓ | ✓ | ✗ |
| Access Control Integration | ✓ | ⚡ | ⚡ |
| Distributed Tracing | ✓ | ⚡ | ⚡ |
| **Development Experience** |
| Type Safety | ✓ | ⚡ | ⚡ |
| IDE Support | ✓ | ⚡ | ✗ |
| Steep Learning Curve | ✓ | ✓ | ✓ |
| **Integration Capabilities** |
| External System Integration | ✓ | ✓ | ✗ |
| Framework Integration | ✓ | ⚡ | ⚡ |
| Custom Extension Support | ✓ | ✓ | ✓ |

## Use Case Based Recommendations

### Choose ArvoEvent When:
You are building enterprise-scale distributed systems that require:
- Strong typing and validation
- Integrated access control and tracing
- Multiple team collaboration
- Long-term maintainability
- Integration with the Arvo framework ecosystem

Example: A large financial institution building a microservices platform for processing transactions across multiple departments.

### Choose CloudEvents When:
Your system needs:
- Broad industry compatibility
- Simple validation requirements
- Standard event formatting without framework lock-in
- Integration with multiple external systems

Example: A SaaS platform that needs to integrate with various third-party services and maintain industry-standard compatibility.

### Choose Custom Events When:
You are working on:
- Simple, standalone applications
- Projects with unique, specific requirements
- Small team projects with specific expertise
- Applications not requiring standardization

Example: An internal tool for a small team where quick implementation and specific customization are more important than standardization.