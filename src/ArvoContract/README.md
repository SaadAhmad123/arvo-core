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
- `export()`: Exports the contract as a plain object conforming to the IArvoContract interface.
- `toJsonSchema()`: Converts the contract to a JSON Schema representation.

### createArvoContract

A utility function to create an ArvoContract instance from a contract specification.

### ResolveArvoContractRecord

A utility type that resolves the inferred type of an ArvoContractRecord's schema.

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

### Converting to JSON Schema

```typescript
const jsonSchema = userContract.toJsonSchema();
console.log(JSON.stringify(jsonSchema, null, 2));
```

This will output a JSON Schema representation of the contract, which can be used for documentation or integration with other tools that support JSON Schema.

# ArvoContractLibrary

The ArvoContractLibrary is a utility class designed to manage and access multiple ArvoContract instances efficiently. It provides a centralized way to store, retrieve, and query contracts within your application.

## Why Use ArvoContractLibrary

1. **Centralized Management**: Keeps all your contracts in one place, making it easier to manage and maintain them.
2. **Type Safety**: Provides type-safe access to contracts, ensuring you're always working with the correct contract types.
3. **Efficient Retrieval**: Allows quick and easy access to contracts by their URIs.
4. **Immutability**: Ensures contracts cannot be modified after being added to the library, maintaining the integrity of your contract definitions.
5. **Flexibility**: Supports working with multiple contracts of different types within the same library.

## How to Use ArvoContractLibrary

### Creating an ArvoContractLibrary

```typescript
import { ArvoContractLibrary, createArvoContract } from '@arvo/core';
import { z } from 'zod';

const contract1 = createArvoContract({
  uri: 'https://example.com/contracts/contract1',
  accepts: {
    type: 'com.example.input1',
    schema: z.object({ data: z.string() }),
  },
  emits: [
    {
      type: 'com.example.output1',
      schema: z.object({ result: z.number() }),
    },
  ],
});

const contract2 = createArvoContract({
  uri: 'https://example.com/contracts/contract2',
  accepts: {
    type: 'com.example.input2',
    schema: z.object({ value: z.number() }),
  },
  emits: [
    {
      type: 'com.example.output2',
      schema: z.object({ success: z.boolean() }),
    },
  ],
});

const library = new ArvoContractLibrary([contract1, contract2]);
```

### Retrieving Contracts

```typescript
// Get a contract by its URI
const retrievedContract1 = library.get(
  'https://example.com/contracts/contract1',
);

// Check if a contract exists
const hasContract = library.has('https://example.com/contracts/contract2');

// Get all contracts
const allContracts = library.list();

// Get the number of contracts in the library
const contractCount = library.size;
```

## Benefits of Using ArvoContractLibrary

1. **Organized Code**: Keeps all your contracts in one place, improving code organization and maintainability.
2. **Reduced Duplication**: Avoids the need to create and manage multiple instances of the same contract across your application.
3. **Consistent Access**: Provides a standardized way to access contracts throughout your codebase.
4. **Runtime Safety**: Helps prevent runtime errors by ensuring contracts exist before attempting to use them.
5. **Scalability**: Easily manages a large number of contracts as your application grows.

## Best Practices

1. **Single Instance**: Create a single instance of ArvoContractLibrary for your entire application to ensure consistency.
2. **Dependency Injection**: Consider using dependency injection to provide the ArvoContractLibrary to components that need it.
3. **Early Initialization**: Initialize the ArvoContractLibrary early in your application's lifecycle to ensure all contracts are available when needed.
4. **Error Handling**: Always handle potential errors when retrieving contracts, especially when using the `get` method, which can throw an error if the contract is not found.

By incorporating ArvoContractLibrary into your project, you can streamline the management and usage of ArvoContracts, leading to more maintainable and robust code.
