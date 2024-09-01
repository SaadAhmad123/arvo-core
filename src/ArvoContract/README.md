---
title: ArvoContract
group: Guides
---

# ArvoContract

The ArvoContract is a class that provides a structured way to define, validate, and work with event-driven contracts in a decoupled micro-event system. It enhances transparency and trust by enforcing type safety and data validation.

## Why Use ArvoContract

ArvoContract offers several benefits:

1. **Type Safety**: Ensures that events and their data conform to predefined schemas.
2. **Validation**: Provides built-in validation for inputs and outputs using Zod schemas.
3. **Decoupling**: Facilitates the creation of loosely coupled, event-driven systems.
4. **Transparency**: Makes the contract between different parts of your system explicit and easy to understand.
5. **Extensibility**: Allows for easy extension and customization of contracts.
6. **JSON Schema Support**: Enables conversion of contracts to JSON Schema format for interoperability.

### Usage

To use ArvoContract, you need to define your contract specification and then create an instance of the contract.

```typescript
import { createArvoContract, ArvoContract } from 'arvo-core';
import { z } from 'zod';

// @type ArvoContract
const myContract = createArvoContract({
  uri: 'https://example.com/contracts/myContract',
  accepts: {
    type: 'com.example.input',
    schema: z.object({ name: z.string() }),
  },
  emits: {
    'com.example.output': z.object({ result: z.number() }),
  },
});
```

## Creating Contractual Events

The `createArvoEventFactory` function is a utility that creates ArvoEvent factories based on a given ArvoContract. It provides a type-safe and contract-compliant way to create events that adhere to the contract's specifications.

### Why use it?

1. **Type Safety**: Ensures that created ArvoEvent conforms to the contract's schema.
2. **Validation**: Automatically validates event data against the contract's schema.
3. **Consistency**: Guarantees that events are created in accordance with the contract.
4. **Error Prevention**: Catches schema violations early in the development process.
5. **Simplification**: Reduces boilerplate code for event creation and validation.
6. **Automatic Validation**: The function automatically validates the event data against the contract's schema.
7. **Type Inference**: TypeScript can infer the correct types for event data based on the contract.
8. **Centralized Contract Management**: By using a single contract definition, you ensure consistency across all event creation points.
9. **Extensibility**: The function supports adding custom extensions to events.
10. **OpenTelemetry Integration**: Supports adding telemetry context for tracing.



### How to Use it?

First, create an ArvoContract:

```typescript
import { createArvoContract } from 'arvo-core';
import { z } from 'zod';

const myContract = createArvoContract({
  uri: 'https://example.com/contracts/myContract',
  accepts: {
    type: 'com.example.input',
    schema: z.object({ name: z.string() }),
  },
  emits: {
    'com.example.output': z.object({ result: z.number() }),
  },
});
```

Then, use `createArvoEventFactory` to create event factories:

```typescript
import { createArvoEventFactory } from 'arvo-core';

const eventFactory = createArvoEventFactory(myContract);
```

Now you can use the factory to create events:

```typescript
// Create an "accepts" event
const inputEvent = eventFactory.accepts({
  type: 'com.example.input',
  data: { name: 'John Doe' },
  source: '/example/source',
  subject: 'example-subject',
});

// Create an "emits" event
const outputEvent = eventFactory.emits({
  type: 'com.example.output',
  data: { result: 42 },
  source: '/example/source',
  subject: 'example-subject',
});
```

Combine this with `ArvoContractLibrary` for efficient contract management across your application.

By incorporating `createArvoEventFactory` into your code, you can ensure that all created events are compliant with your defined contracts, leading to more robust and maintainable event-driven systems.
