---
title: ArvoContract
group: Guides
---

# ArvoContract

ArvoContract provides a structured way to define, validate, and work with versioned event-driven contracts in a decoupled micro-event system. It enforces type safety and data validation while supporting semantic versioning for API evolution.

## Why Use ArvoContract

ArvoContract offers several key benefits:

1. **Version Management**: Supports semantic versioning for contract evolution and backwards compatibility
2. **Type Safety**: Ensures events and their data conform to version-specific schemas
3. **Validation**: Provides built-in validation using Zod schemas for each version
4. **Decoupling**: Facilitates loosely coupled, event-driven systems
5. **Transparency**: Makes contracts between system components explicit and version-aware
6. **Extensibility**: Allows easy extension and customization of contracts
7. **JSON Schema Support**: Enables conversion to JSON Schema format for interoperability

## Usage

To use ArvoContract, define your contract specification with versions and create an instance:

```typescript
import { createArvoContract } from 'arvo-core';
import { z } from 'zod';

// Define a contract with multiple versions
const userContract = createArvoContract({
  uri: 'example.com/contracts/user',
  type: 'user.create',
  versions: {
    '1.0.0': {
      accepts: z.object({ 
        name: z.string() 
      }),
      emits: {
        'user.created': z.object({ 
          id: z.string() 
        })
      }
    },
    '2.0.0': {
      accepts: z.object({ 
        name: z.string(),
        email: z.string().email() 
      }),
      emits: {
        'user.created': z.object({ 
          id: z.string(),
          timestamp: z.date() 
        })
      }
    }
  }
});
```

## Working with Versioned Contracts

The contract provides version-specific views and operations:

```typescript
// Get the latest version
const latestVersion = userContract.latestVersion;

// Get a version-specific view
const v1Contract = userContract.version('1.0.0');
const v2Contract = userContract.version('2.0.0');

// Access version-specific schemas
const v1AcceptSchema = v1Contract.accepts.schema;
const v2EmitSchemas = v2Contract.emits;
```

## Creating Contractual Events

Use `createArvoEventFactory` to create type-safe, version-specific event factories:

### Benefits

1. **Version Safety**: Ensures events conform to specific contract versions
2. **Type Safety**: Provides version-specific type checking and validation
3. **Validation**: Automatically validates against version-specific schemas
4. **Consistency**: Guarantees version-appropriate event creation
5. **Error Prevention**: Catches schema violations and version mismatches early
6. **OpenTelemetry Integration**: Supports distributed tracing
7. **Extension Support**: Allows custom extensions while maintaining type safety

### Creating Events

First, create a version-specific factory:

```typescript
import { createArvoEventFactory } from 'arvo-core';

// Create a v1 factory
const v1Contract = userContract.version('1.0.0');
const v1Factory = createArvoEventFactory(v1Contract);

// Create a v2 factory
const v2Contract = userContract.version('2.0.0');
const v2Factory = createArvoEventFactory(v2Contract);
```

Then create version-specific events:

```typescript
// Create v1 events
const v1InputEvent = v1Factory.accepts({
  source: 'api/users',
  data: { name: 'John Doe' },
  subject: 'user-creation'
});

const v1OutputEvent = v1Factory.emits({
  type: 'user.created',
  source: 'user-service',
  data: { id: '123' },
  subject: 'user-created'
});

// Create v2 events with additional fields
const v2InputEvent = v2Factory.accepts({
  source: 'api/users',
  data: { 
    name: 'John Doe',
    email: 'john@example.com'  // Required in v2
  },
  subject: 'user-creation'
});

const v2OutputEvent = v2Factory.emits({
  type: 'user.created',
  source: 'user-service',
  data: { 
    id: '123',
    timestamp: new Date()  // Required in v2
  },
  subject: 'user-created'
});

// Create system error events (version-independent)
const errorEvent = v1Factory.systemError({
  error: new Error('Validation failed'),
  source: 'user-service',
  subject: 'error-occurred'
});
```

## Working with Simple Contracts

For simpler use cases, use `createSimpleArvoContract` for standardized type patterns:

```typescript
const simpleContract = createSimpleArvoContract({
  uri: 'example.com/contracts/simple',
  type: 'document.process',
  versions: {
    '1.0.0': {
      accepts: z.object({ id: z.string() }),
      emits: z.object({ status: z.string() })
    }
  }
});

// Automatically creates:
// - Accept type: "com.document.process"
// - Emit type: "evt.document.process.success"
```

By using ArvoContract and its factories, you ensure type-safe, version-aware event handling across your distributed system, making it easier to maintain and evolve your event-driven architecture.

## Orchestration Contracts

ArvoContract provides special support for orchestration workflows through `createArvoOrchestratorContract`. This allows you to define and manage long-running, multi-step processes in a type-safe manner.

### Why Use Orchestration Contracts

1. **Standardized Lifecycle**: Provides consistent init and complete event patterns
2. **Type Safety**: Ensures workflow data consistency across steps
3. **Version Management**: Supports evolution of workflow definitions
4. **Process Tracking**: Built-in support for orchestration metadata
5. **Event Type Generation**: Automatically generates standardized event types

### Creating an Orchestration Contract

```typescript
import { createArvoOrchestratorContract } from 'arvo-core';
import { z } from 'zod';

const orderProcessingContract = createArvoOrchestratorContract({
  uri: '#/orchestrators/order/process',
  type: 'order.process',
  versions: {
    '1.0.0': {
      // Schema for starting the workflow
      init: z.object({
        orderId: z.string(),
        customerId: z.string(),
        items: z.array(z.object({
          productId: z.string(),
          quantity: z.number()
        }))
      }),
      // Schema for workflow completion
      complete: z.object({
        orderId: z.string(),
        status: z.enum(['fulfilled', 'partial', 'failed']),
        processedItems: z.array(z.object({
          productId: z.string(),
          quantity: z.number(),
          status: z.string()
        }))
      })
    },
    // Supporting workflow evolution
    '2.0.0': {
      init: z.object({
        orderId: z.string(),
        customerId: z.string(),
        items: z.array(z.object({
          productId: z.string(),
          quantity: z.number(),
          priority: z.enum(['high', 'medium', 'low']) // New field
        })),
        deadline: z.date() // New field
      }),
      complete: z.object({
        orderId: z.string(),
        status: z.enum(['fulfilled', 'partial', 'failed']),
        processedItems: z.array(z.object({
          productId: z.string(),
          quantity: z.number(),
          status: z.string(),
          processTime: z.number() // New field
        })),
        performanceMetrics: z.object({ // New section
          totalTime: z.number(),
          itemsProcessed: z.number()
        })
      })
    }
  }
});
```

This structure provides a foundation for building complex, distributed processes while maintaining type safety and version control throughout your system.