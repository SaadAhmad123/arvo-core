---
title: ArvoContractLibrary
group: Guides
---

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
import { createArvoContractLibrary, createArvoContract } from 'arvo-core';
import { z } from 'zod';

const contract1 = createArvoContract({
  uri: '#/contracts/contract1',
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
  uri: '#/contracts/contract2',
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

const library = new createArvoContractLibrary([contract1, contract2]);
```

### Retrieving Contracts

```typescript
// Get a contract by its URI
const retrievedContract1 = library.get('#/contracts/contract1');

// Check if a contract exists
const hasContract = library.has('#/contracts/contract2');

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
2. **Early Initialization**: Initialize the ArvoContractLibrary early in your application's lifecycle to ensure all contracts are available when needed.
3. **Error Handling**: Always handle potential errors when retrieving contracts, especially when using the `get` method, which can throw an error if the contract is not found.

By incorporating ArvoContractLibrary into your project, you can streamline the management and usage of ArvoContracts, leading to more maintainable and robust code.
