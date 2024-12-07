---
title: ArvoContract
group: Guides
---

# ArvoContract

ArvoContract is a foundational component of the Arvo event-driven framework that enables building reliable, type-safe, and maintainable distributed systems. By providing a robust contract mechanism, it ensures consistent communication patterns between services while maintaining strict type safety and validation throughout the event lifecycle.

## Understanding ArvoContract in Event-Driven Systems

In distributed event-driven architectures, services communicate through events, but ensuring consistency and type safety across service boundaries can be challenging. ArvoContract addresses these challenges by creating a trusted interface layer between services. Each service interaction must be defined through a contract, which specifies exactly what events can be accepted and emitted, along with their data structures and validation rules.

The contract mechanism serves as a source of truth for service interactions. When services share contracts through NPM packages or within a monorepo, they establish a formal agreement about their communication patterns. This approach eliminates ambiguity and ensures that all parties involved in the event exchange understand and adhere to the same interface specifications.

### Contract Distribution and Sharing

Contracts in the Arvo framework are designed to be shared as independent packages. This can be accomplished in two primary ways:

1. **NPM Packages**: Contracts can be published as separate NPM packages, allowing different services to depend on specific contract versions. This approach is particularly useful in microservice architectures where services are maintained in separate repositories.

2. **Monorepo Packages**: In monorepo setups, contracts can be maintained as internal packages, making them easily shareable between services while keeping everything version-controlled within the same repository.

### Event Handler Binding

Every event handler in the Arvo framework must be bound to a specific contract version. This binding serves multiple purposes:

```typescript
const userContract = createArvoContract({
  uri: '#/contracts/user-management',
  type: 'user.profile',
  versions: {
    '1.0.0': {
      accepts: z.object({ userId: z.string() }),
      emits: {
        'user.profile.updated': z.object({ 
          userId: z.string(), 
          timestamp: z.date() 
        })
      }
    }
  }
});

// Handler must conform to contract specifications. See 'arvo-event-handler' pacakge 
// for creating the handler
const userProfileHandler = createArvoEventHandler({
  contract: userContract,
  executionunits: 0.1,
  handler: {
    '1.0.0': async ({event}) => {
      return {
        type: 'user.profile.updated',
        data: {
          userId: "user1", 
          timestamp: new Date() 
        }
      }
    }
  }
})
```

The binding mechanism ensures:
- Type safety for incoming and outgoing events
- Runtime validation of event data
- Version-specific handling of events
- Proper error propagation through system error events
- Integration with OpenTelemetry for distributed tracing

### Contract Evolution and Versioning

In evolving systems, service interfaces often need to change. ArvoContract's semantic versioning support provides a structured way to manage these changes while maintaining backward compatibility:

```typescript
const evolvedContract = createArvoContract({
  uri: '#/contracts/user-management',
  type: 'user.profile',
  versions: {
    '1.0.0': {
      // Original version
    },
    '2.0.0': {
      accepts: z.object({ 
        userId: z.string(),
        context: z.object({ tenant: z.string() }) // Breaking change
      }),
      emits: {
        'user.profile.updated': z.object({ 
          userId: z.string(), 
          timestamp: z.date(),
          metadata: z.record(z.string()) // New field
        })
      }
    }
  }
});
```

### Type Inference and Safety

The ArvoContract system provides comprehensive type inference capabilities through utility types like `InferVersionedArvoContract`. This enables development tools to provide accurate autocompletion and type checking:

```typescript
type UserProfileContract = InferVersionedArvoContract<
  VersionedArvoContract<
    typeof userContract,
    '1.0.0'
  >
>;

// Automatically infers all ArvoEvent types
type AcceptedEvent = UserProfileContract['accepts'];
type EmittedEvents = UserProfileContract['emitList'][number];
```

### Building Trust in Distributed Systems

ArvoContract plays a crucial role in building trust between services in several ways:

1. **Schema Validation**: Every event should be validated against its contract schema at both the sending and receiving ends, ensuring data integrity.

2. **Version Compatibility**: Services can specify which contract versions they support, preventing incompatible interactions.

3. **Error Handling**: The contracts automatically define a standard system error event which can be accessed via `contract.systemError`. This standardized error event ensure consistent error propagation and handling across service boundaries.

4. **Traceability**: Integration with OpenTelemetry provides distributed tracing capabilities, making it easier to debug and monitor cross-service interactions.

5. **Documentation**: Contracts serve as living documentation of service interfaces, automatically keeping API specifications in sync with implementation.

### Contract Testing and Verification

The contract mechanism enables powerful testing capabilities:

```typescript
describe('UserProfileHandler', () => {
  const contract = userContract.version('1.0.0');
  
  it('should handle profile updates correctly', async () => {
    // Contract provides type-safe test data generation
    const event = createArvoEventFactory(contract).accepts({
      source: 'test',
      data: { userId: 'user123' }
    });
    
    const results = await userProfileHandler.execute(event);
    // Contract ensures type-safe assertions
    expect(result[0].type).toBe('user.profile.updated');
  });
});
```

## Best Practices for Contract Design

When designing contracts in the Arvo framework:

1. **Single Responsibility**: Each contract should represent a single, well-defined capability or service interface.

2. **Clear Versioning**: Use semantic versioning appropriately to indicate breaking changes versus backward-compatible updates.

3. **Schema Evolution**: Use semantic versioning effectively - default values for backward-compatible changes (minor versions) and required fields for breaking changes (major versions). This maintains clear contract boundaries and migration paths.

4. **Documentation**: Utilize contract descriptions and metadata to document the purpose and usage of each contract.

5. **Error Handling**: Leverage the built-in system error events for consistent error handling across services.

## Implementation Details

ArvoContract is implemented using TypeScript's advanced type system features to provide comprehensive type safety and inference. It leverages Zod for runtime schema validation and includes built-in support for OpenTelemetry for distributed tracing.

The implementation focuses on providing a robust foundation for building reliable distributed systems while maintaining flexibility for different architectural patterns and use cases. Through careful design of the type system and validation rules, it helps prevent common distributed systems issues while providing a great developer experience.

By using ArvoContract as part of the Arvo framework, teams can build more reliable and maintainable event-driven systems with confidence in their service interactions and type safety throughout their application.

## Tradeoffs: ArvoContract vs Alternative Approaches

| Aspect | ArvoContract | Plain Zod | TypeScript Types Only |
|--------|--------------|-----------|----------------------|
| Schema Validation | Provides comprehensive runtime validation with built-in versioning support. Validates both incoming and outgoing events against version-specific schemas. Includes standardized error handling patterns and detailed validation error messages with path information. | Offers runtime validation with customizable error messages. Requires manual implementation of version-specific validation logic. Schema composition and transformation are available but need custom setup for versioning. | No runtime validation available. All type checking happens during compilation only, which means runtime type errors can still occur in production. |
| Type Safety | Delivers end-to-end type safety with specialized types for events, handlers, and emitted results. Includes automatic type inference for versioned contracts and comprehensive IDE support. Prevents accidental usage of wrong event types or versions. | Provides type inference for schema definitions and validated data. Requires manual type setup for versioning and event handling patterns. Some advanced typing features may need explicit type annotations. | Offers basic compile-time type checking. Requires manual maintenance of type definitions and doesn't guarantee runtime type safety. Complex event typing needs significant developer effort. |
| Contract Evolution | Implements semantic versioning with explicit support for breaking vs. non-breaking changes. Includes tooling for version compatibility checking and migration paths. Maintains type safety across versions while allowing progressive updates. | No built-in version management. Developers must manually track and manage schema versions and compatibility. Schema evolution requires careful coordination between services. | No version management capabilities. Type changes require manual updates across all consuming services. No built-in way to handle backward compatibility. |
| Distribution | Can be packaged and distributed through typical package management systems (NPM packages, monorepo internal packages). Includes version management and dependency tracking. The key difference is that ArvoContract provides tools and patterns for managing contract versioning and compatibility within the distributed package. | Can be packaged and distributed through the same channels. However, requires additional tooling and conventions for managing schema versions and ensuring consistent usage across services. | Can be packaged and distributed similarly. Lacks tools for version management and compatibility checking, requiring more manual coordination between teams. |
| Error Handling | Features a standardized system error event pattern that works consistently across all contracts. Includes built-in error propagation, detailed stack traces, and integration with monitoring systems. Helps maintain consistent error handling patterns across services. | Provides basic validation error handling. Custom error handling patterns must be implemented manually. No standardized way to handle and propagate errors across service boundaries. | No runtime error handling capabilities. Error patterns must be defined and implemented manually. Lacks standardization across services. |
| Development Overhead | Requires initial investment in setup and learning the contract patterns. However, this investment pays off through reduced maintenance costs, better type safety, and more reliable service interactions. Includes developer tools and testing utilities. | Moderate initial setup with lower learning curve. Requires ongoing effort to maintain consistency and handle versioning. Testing and validation patterns need manual implementation. | Lowest initial setup cost but highest ongoing maintenance burden. Requires significant developer discipline to maintain type safety and consistency across services. |
| System Integration | Offers built-in integration with OpenTelemetry for distributed tracing. Includes support for event sourcing patterns and middleware integration. Provides standardized ways to extend and customize system behavior. | No built-in integration features. Each integration point needs custom implementation. Middleware and extension patterns must be built from scratch. | No integration capabilities. All system integration features must be built and maintained separately. |
| Testing Support | Includes dedicated testing utilities for contract verification. Provides factories for generating valid test events. Enables type-safe mocking and verification of event handlers. Supports contract-based testing patterns. | Basic schema validation available for tests. Test data generation and verification patterns need manual implementation. No built-in support for contract testing. | Limited to type checking in tests. No runtime validation or test data generation capabilities. Contract testing patterns must be built from scratch. |
| Documentation | Generates comprehensive documentation from contracts including JSON Schema export. Maintains single source of truth for interface specifications. Includes support for contract metadata and descriptions. | Documentation must be maintained separately from schemas. No built-in tools for generating interface specifications. Requires manual synchronization of docs and code. | Documentation completely separate from types. No automatic generation capabilities. Higher risk of documentation becoming outdated. |
| Bundle Size | Larger bundle size due to included validation, versioning, and integration capabilities. However, provides significant value through built-in functionality and reduced need for custom code. | Moderate bundle size impact from validation library. Additional size from custom versioning and integration code if implemented. | No direct bundle size impact but may require additional custom code for missing functionality. |