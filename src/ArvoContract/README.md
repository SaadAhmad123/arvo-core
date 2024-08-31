---
title: ArvoContract
group: Guides
---

# ArvoContract

ArvoContract is a TypeScript library that provides a structured way to define, validate, and work with event-driven contracts in a decoupled micro-event system. It enhances transparency and trust by enforcing type safety and data validation.

## Table of Contents

- [Why Use ArvoContract](#why-use-arvocontract)
- [Usage](#usage)
- [API Reference](#api-reference)
- [Examples](#examples)

## Why Use ArvoContract

ArvoContract offers several benefits:

1. **Type Safety**: Ensures that events and their data conform to predefined schemas.
2. **Validation**: Provides built-in validation for inputs and outputs using Zod schemas.
3. **Decoupling**: Facilitates the creation of loosely coupled, event-driven systems.
4. **Transparency**: Makes the contract between different parts of your system explicit and easy to understand.
5. **Extensibility**: Allows for easy extension and customization of contracts.

## Usage

To use ArvoContract, you need to define your contract specification and then create an instance of the contract.

```typescript
import { createArvoContract } from '@arvo/core';
import { z } from 'zod';

const myContract = createArvoContract({
  uri: 'https://example.com/contracts/myContract',
  accepts: {
    type: 'com.example.input',
    schema: z.object({ name: z.string() }),
  },
  emits: [
    {
      type: 'com.example.output',
      schema: z.object({ result: z.number() }),
    },
  ],
});
```

## API Reference

### ArvoContract

The main class representing a contract.

#### Properties

- `uri`: The unique identifier for the contract.
- `accepts`: The record type and schema that the contract accepts.
- `emits`: An object containing all emitted event types and schemas.

#### Methods

- `getEmit(emitType)`: Retrieves a specific emitted event type and schema.
- `validateInput(acceptType, input)`: Validates the input against the contract's accept schema.
- `validateOutput(emitType, output)`: Validates the output against the contract's emit schema.

### createArvoContract

A utility function to create an ArvoContract instance from a contract specification.

### ResolveArvoContractRecord

A utility type that resolves the inferred type of an ArvoContractRecord's schema. This is useful when you need to work with the actual data type defined by the schema.

```typescript
import { ResolveArvoContractRecord, ArvoContractRecord } from '@arvo/core';

const myRecord: ArvoContractRecord = {
  type: 'com.example.user',
  schema: z.object({ name: z.string(), age: z.number() }),
};

type MyRecordData = ResolveArvoContractRecord<typeof myRecord>;
// MyRecordData is now equivalent to { name: string; age: number }
```

## Examples

### Creating a Contract

```typescript
const userContract = createArvoContract({
  uri: 'https://api.example.com/contracts/user',
  accepts: {
    type: 'com.example.user.create',
    schema: z.object({
      username: z.string(),
      email: z.string().email(),
    }),
  },
  emits: [
    {
      type: 'com.example.user.created',
      schema: z.object({
        id: z.number(),
        username: z.string(),
      }),
    },
    {
      type: 'com.example.user.error',
      schema: z.object({
        message: z.string(),
      }),
    },
  ],
});
```

### Validating Input

```typescript
const input = { username: 'john_doe', email: 'john@example.com' };
const validationResult = userContract.validateInput(
  'com.example.user.create',
  input,
);

if (validationResult.success) {
  console.log('Input is valid:', validationResult.data);
} else {
  console.error('Input is invalid:', validationResult.error);
}
```

### Validating Output

```typescript
const output = { id: 1, username: 'john_doe' };
const validationResult = userContract.validateOutput(
  'com.example.user.created',
  output,
);

if (validationResult.success) {
  console.log('Output is valid:', validationResult.data);
} else {
  console.error('Output is invalid:', validationResult.error);
}
```

### Using ResolveArvoContractRecord

```typescript
import { ResolveArvoContractRecord } from '@arvo/core';

type UserCreatedData = ResolveArvoContractRecord<
  typeof userContract.getEmit('com.example.user.created')
>;

// UserCreatedData is now { id: number; username: string }
```