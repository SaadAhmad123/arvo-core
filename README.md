[![SonarCloud](https://sonarcloud.io/images/project_badges/sonarcloud-white.svg)](https://sonarcloud.io/summary/new_code?id=SaadAhmad123_arvo-core)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=SaadAhmad123_arvo-core&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=SaadAhmad123_arvo-core)


# Arvo
In the landscape of event-driven systems, Arvo attempts to stand apart through its unique approach to complexity. Rather than prescribing rigid solutions, Arvo provides a thoughtful pattern language and methodology for building distributed systems. It achieves this by striking a careful balance between structure and freedom, offering strong conventions while remaining deliberately unopinionated about implementation details.

## Core Philosophy
Arvo's fundamental principle is that distributed systems thrive on trust and clear contracts, yet must remain flexible in their technical implementation. While the framework ensures reliability and type safety across service boundaries through these contracts, it consciously avoids dictating how you should implement core functionalities like security, event brokerage, event handling, telemetry, or workflow orchestration. This approach enables seamless integration with your existing infrastructure and tools, whether you're using cloud providers like AWS and Azure or your own on-premise solutions.
Understanding that teams shouldn't need to reinvent common patterns, Arvo provides thoughtfully designed tools to reduce implementation complexity. The Arvo suite includes libraries like arvo-xstate for workflow orchestration using state machines and arvo-event-handler for implementing contract-based event handlers. However, these tools remain entirely optional – they exist to accelerate development when they align with your needs, but Arvo fully supports teams who choose different approaches that better suit their specific requirements.
This philosophy particularly benefits teams focusing on business logic who want to avoid rebuilding fundamental event-driven patterns. By providing essential building blocks for event creation, contract validation, state management, and telemetry, while maintaining cloud agnosticism and extensibility, Arvo reduces the complexity of distributed system development without constraining technical choices.

## Design Goals
Arvo addresses the inherent complexity of distributed systems by establishing clear patterns for event handling, state management, and service communication. Instead of enforcing a rigid framework, it provides a flexible foundation that helps teams reduce cognitive load while preserving their ability to innovate and adapt. This approach ensures that whether you're building a small microservice or orchestrating a large-scale distributed system, Arvo's lightweight core and extensible architecture can grow alongside your needs, allowing you to progressively adopt more sophisticated patterns as your system evolves.


## The Arvo Framework: Build at Your Own Pace
The Arvo framework provides a cohesive set of libraries for building event-driven systems. While designed to work together seamlessly, each component remains independent - adopt what serves your needs and integrate at your own pace.

| Scope       | NPM                                                                | Github                                                                | Documentation                                                                |
| ------------ | ------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------- |
| Orchestration      | https://www.npmjs.com/package/arvo-xstate?activeTab=readme | https://github.com/SaadAhmad123/arvo-xstate | https://saadahmad123.github.io/arvo-xstate/index.html |
| Core       | https://www.npmjs.com/package/arvo-core?activeTab=readme                | https://github.com/SaadAhmad123/arvo-core | https://saadahmad123.github.io/arvo-core/index.html |
| Event Handling | https://www.npmjs.com/package/arvo-event-handler?activeTab=readme      | https://github.com/SaadAhmad123/arvo-event-handler | https://saadahmad123.github.io/arvo-event-handler/index.html |


# Arvo - Core

Arvo Core provides the foundational building blocks for creating robust event-driven systems. It implements industry standards while adding enterprise-grade features, enabling developers to build reliable distributed systems without sacrificing flexibility or introducing vendor lock-in.

## Core Concepts

Understanding Arvo Core begins with its three fundamental components that work together to create a robust event-driven architecture:

### 1. Events (ArvoEvent)

ArvoEvent extends the CloudEvents specification to provide a standardized way to describe events in your system. Every event is an immutable, validated instance that includes:

```typescript
import { createArvoEvent } from 'arvo-core';

const event = createArvoEvent({
  source: 'user-service',
  type: 'user.created',
  subject: 'user/123',
  data: {
    userId: 'usr_123',
    email: 'user@example.com'
  }
});
```

### 2. Contracts (ArvoContract)

ArvoContract defines and enforces agreements between services, ensuring type safety and validation across your distributed system:

```typescript
import { createArvoContract, z } from 'arvo-core';

const userContract = createArvoContract({
  uri: '#/contracts/user',
  type: 'user.created',
  versions: {
    '1.0.0': {
      accepts: z.object({
        userId: z.string(),
        email: z.string().email()
      }),
      emits: {
        'user.notification.sent': z.object({
          userId: z.string(),
          timestamp: z.date()
        })
      }
    }
  }
});
```

### 3. Event Factory (ArvoEventFactory)

ArvoEventFactory provides a type-safe way to create events that conform to your contracts. It handles validation, OpenTelemetry integration, and ensures events meet their contract specifications:

```typescript
import { createArvoEventFactory } from 'arvo-core';

// Create a factory for a specific contract version
const factory = createArvoEventFactory(userContract.version('1.0.0'));

// Create an event that accepts input
const inputEvent = factory.accepts({
  source: 'api/users',
  subject: 'user/creation',
  data: {
    userId: 'usr_123',
    email: 'user@example.com'
  }
});

// Create an event that emits output
const outputEvent = factory.emits({
  type: 'user.notification.sent',
  source: 'notification-service',
  subject: 'notification/sent',
  data: {
    userId: 'usr_123',
    timestamp: new Date()
  }
});

// Create a system error event
const errorEvent = factory.systemError({
  error: new Error('Validation failed'),
  source: 'validation-service',
  subject: 'validation/error'
});
```

## Installation

```bash
# Using npm
npm install arvo-core

# Using yarn
yarn add arvo-core
```

## Advanced Usage

### Working with Contract Versions

The versioning system in ArvoContract allows you to evolve your APIs while maintaining compatibility:

```typescript
const versionedContract = createArvoContract({
  uri: '#/contracts/order',
  type: 'order.process',
  versions: {
    '1.0.0': {
      accepts: z.object({ orderId: z.string() }),
      emits: { 
        'order.processed': z.object({ status: z.string() }) 
      }
    },
    '2.0.0': {
      accepts: z.object({ 
        orderId: z.string(),
        metadata: z.record(z.string()) 
      }),
      emits: { 
        'order.processed': z.object({ 
          status: z.string(),
          metrics: z.object({ duration: z.number() })
        }) 
      }
    }
  }
});

// Create version-specific factories
const v1Factory = createArvoEventFactory(versionedContract.version('1.0.0'));
const v2Factory = createArvoEventFactory(versionedContract.version('2.0.0'));
```

## Integration with Other Arvo Components

Arvo Core works seamlessly with:
- arvo-event-handler: For processing events
- arvo-xstate: For orchestration and workflow management

Each component builds upon these core primitives while maintaining the same principles of flexibility and reliability.

## Best Practices

1. Use factories for event creation to ensure contract compliance
2. Implement proper error handling using the standard error schema
3. Enable distributed tracing in production systems
4. Share contracts as separate packages or monorepo internals
5. Utilize version-specific factories for different API versions

## Resources

| Resource      | Link                                                       |
|--------------|-------------------------------------------------------------|
| Documentation | https://saadahmad123.github.io/arvo-core/index.html        |
| GitHub        | https://github.com/SaadAhmad123/arvo-core                  |
| NPM Package   | https://www.npmjs.com/package/arvo-core                    |

## License

This package is available under the MIT License. For more details, refer to the [LICENSE.md](LICENSE.md) file in the project repository.

## Change Logs

For a detailed list of changes and updates, please refer to the [document](CHANGELOG.md) file.

### SonarCloud Metrics

[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=SaadAhmad123_arvo-core&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=SaadAhmad123_arvo-core)
[![Bugs](https://sonarcloud.io/api/project_badges/measure?project=SaadAhmad123_arvo-core&metric=bugs)](https://sonarcloud.io/summary/new_code?id=SaadAhmad123_arvo-core)
[![Code Smells](https://sonarcloud.io/api/project_badges/measure?project=SaadAhmad123_arvo-core&metric=code_smells)](https://sonarcloud.io/summary/new_code?id=SaadAhmad123_arvo-core)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=SaadAhmad123_arvo-core&metric=coverage)](https://sonarcloud.io/summary/new_code?id=SaadAhmad123_arvo-core)
[![Duplicated Lines (%)](https://sonarcloud.io/api/project_badges/measure?project=SaadAhmad123_arvo-core&metric=duplicated_lines_density)](https://sonarcloud.io/summary/new_code?id=SaadAhmad123_arvo-core)
[![Lines of Code](https://sonarcloud.io/api/project_badges/measure?project=SaadAhmad123_arvo-core&metric=ncloc)](https://sonarcloud.io/summary/new_code?id=SaadAhmad123_arvo-core)
[![Reliability Rating](https://sonarcloud.io/api/project_badges/measure?project=SaadAhmad123_arvo-core&metric=reliability_rating)](https://sonarcloud.io/summary/new_code?id=SaadAhmad123_arvo-core)
[![Security Rating](https://sonarcloud.io/api/project_badges/measure?project=SaadAhmad123_arvo-core&metric=security_rating)](https://sonarcloud.io/summary/new_code?id=SaadAhmad123_arvo-core)
[![Technical Debt](https://sonarcloud.io/api/project_badges/measure?project=SaadAhmad123_arvo-core&metric=sqale_index)](https://sonarcloud.io/summary/new_code?id=SaadAhmad123_arvo-core)
[![Maintainability Rating](https://sonarcloud.io/api/project_badges/measure?project=SaadAhmad123_arvo-core&metric=sqale_rating)](https://sonarcloud.io/summary/new_code?id=SaadAhmad123_arvo-core)
[![Vulnerabilities](https://sonarcloud.io/api/project_badges/measure?project=SaadAhmad123_arvo-core&metric=vulnerabilities)](https://sonarcloud.io/summary/new_code?id=SaadAhmad123_arvo-core)

