---
title: ArvoContract
group: Guides
---
# ArvoContract - A pragmatic contract system

# Core concepts

**Arvo** is built on a foundation where all communication occurs through specialised events called `ArvoEvent`, which are basically `CloudEvent` with a few extension fields to facilitate routing and distributed telemetry. These events flow through a system of services, each acting as an event handler that processes incoming events and potentially generates new ones in response. At its heart, Arvo treats every service as a function with a consistent signature: `ArvoEvent => Promise<ArvoEvent[]>`.

The architecture connects all event handlers through a central event broker, creating a service and event mesh where each service maintains its own bounded context and state management. This flat structure enables the broker to route events based on the `to` field in the event body, ensuring efficient communication across the system.

### Event processing and error handling

Arvo implements a sophisticated error handling mechanism where service-level issues are communicated through specialise "system error" events. These events are strictly scoped to handler operations, while infrastructure or environment-related problems are managed through execution errors for appropriate handling.

Following Martin Fowler's tolerant reader pattern, event handlers in Arvo are designed to receive all events but only process those relevant to their bounded context. When handlers encounter events outside their scope, they emit system error events rather than failing. This approach promotes resilience and clear separation of concerns across the system.
### Event Chaining and Orchestration

Arvo's event handlers follow the signature `ArvoEvent => Promise<ArvoEvent[]>`, enabling powerful service coordination through event chaining. Complex business processes can be modelled as sequences of events flowing through multiple services, while each service maintains its independence and bounded context.

To manage these event chains effectively, Arvo introduces the orchestrator, a specialised event handler responsible for coordinating and defining event chains. It follows a simple yet powerful execution pattern. When it receives an event, it:

1. Resolves the current state of the execution from durable storage
2. Uses the received event and current state to calculate the next state and events
3. Persists the new state to durable storage
4. Returns the list of events to be emitted

While Arvo remains implementation-agnostic about orchestration, it provides a robust implementation `ArvoOrchestrator` through the `arvo-xstate` TypeScript package. This package leverages `xstate`'s state machine capabilities to create an `ArvoMachine`, allowing developers to model complex workflows while maintaining loose coupling and independent service evolution.

The state-machine-driven approach ensures event chains remain predictable and manageable as system complexity grows. This makes the `ArvoOrchestrator` particularly effective for implementing business processes that require coordinated actions across multiple services while preserving the event-driven nature of the system.

For more detailed information about orchestration capabilities, refer to the dedicated `ArvoOrchestrator` documentation.

# Reliable Service Communication

In event-driven architectures, reliable communication between services is crucial yet challenging. Arvo tackles this challenge through a thoughtful approach to coupling and contracts.

### Managing Coupling in Event-Driven Systems

As [Kent Beck](https://www.youtube.com/watch?v=Saaz6D1azlU&t=2124s) observes, most software issues arise from coupling, and the cost of software maintenance is primarily driven by the cost of change. Changes typically fall into two categories:

1. Business logic changes
2. Communication interface changes

Both types of changes can cause issues due to unmanaged coupling. Following Larry Constantine and Ed Yourdon's definition from [Structured Design](https://vtda.org/books/Computing/Programming/StructuredDesign_EdwardYourdonLarryConstantine.pdf), coupling occurs when a change in one component necessitates changes in other components that depend on it.

Arvo takes a nuanced view of coupling: rather than treating it as inherently negative, it believes coupling should be managed strategically. Even in event-driven architectures, coupling naturally emerges when:

- Service A emits an event that Service B must handle
- Service B changes its interface, requiring Service A to adapt its event emission

### The Contract-First Approach

To manage coupling effectively, Arvo introduces a contract-first approach inspired by Meyer's Design by Contract. Instead of services coupling directly to each other, they couple to contracts - simple data structures without business logic. This approach offers several advantages:

1. **Clear Boundaries**: Services declare upfront which contracts they implement and depend on
2. **Validation Guarantees**: All communication is validated through contracts
3. **Trackable coupling**: Contract definitions become the primary shared artefact across domain.
4. **Predictable Updates**: When changes are needed, contracts provide a clear path for updates

### Contract Implementation

In Arvo, every `ArvoEvent` contains three essential fields for reliable communication and can be validated by contracts:

- `type`: The event type (e.g., `com.increment.number`)
- `data`: The payload object
- `dataschema`: Reference to the schema version (e.g., `#/service/number/increment/1.0.0`)

Services must declare their contracts upfront and validate all communication through them. Following Martin Fowler's Tolerant Reader pattern and Postel's Law, services should:

- Be liberal in what they accept
- Be conservative in what they emit
- Validate all events against their contracts
- Emit only contract-compliant events

### Benefits of Contract-Based Communication

This structured approach to service communication provides several key benefits:

1. **Type Safety**: Contracts define clear data structures that can be type-checked
2. **Evolution Path**: Contracts provide a structured way to evolve service interfaces
3. **Documentation**: Contracts serve as living documentation of service capabilities
4. **Testing**: Contracts enable automated testing of service communication
5. **Dependency Management**: Clear contract dependencies make system evolution more predictable

By treating contracts as first-class citizens in the system, Arvo provides a robust foundation for reliable service communication while managing the inevitable coupling that exists in distributed systems.

# The `ArvoContract`

The TypeScript implementation of `ArvoContract` in `arvo-core` builds upon established software engineering principles and modern technologies. Its design is influenced by seminal works in software engineering:

- Bertrand Meyer's [Contract by Design](https://se.inf.ethz.ch/~meyer/publications/old/dbc_chapter.pdf)
- Contracts in [Racket language](https://docs.racket-lang.org/reference/contracts.html#:~:text=Contracts%20in%20The%20Racket%20Guide,contract%20system%20enforces%20those%20constraints.)
- Martin Fowler's articles on [Event sourcing](https://martinfowler.com/eaaDev/EventSourcing.html)

The implementation also incorporates practical lessons from existing contract and specification technologies:

- WSDL for service definitions
- Protocol Buffers for schema evolution
- OpenAPI (Swagger) for REST APIs
- AsyncAPI for event-driven architectures
- PactIO for [contract testing](https://docs.pact.io/getting_started/how_pact_works)

## First-Class Contract System

In Arvo's TypeScript implementation, contracts are elevated to first-class citizens in service development. This makes the contract-first design more approachable and easy to manage. Unlike traditional approaches that separate specifications from implementation, Arvo implements contracts directly in TypeScript using Zod. This integration provides several key benefits:

1. Natural contract definition within the development environment
2. Elimination of separate specification maintenance
3. Native TypeScript type inference with IDE integration
4. Robust compile-time type checking
5. Simplified testing through Zod-based fake data generation
6. The scope description can be defined as part of code via Zod `.describe` method for all the fields in the schema.

## Practical Advantages

This approach solves several common challenges in contract-driven development:

- Eliminates the disconnect between specifications and implementation
- Reduces development time by avoiding duplicate effort in writing specs and code
- Enables good software development principles in schema definitions (e.g. DRY)
- Provides JSON schema export for documentation via `toJSON` method
- Supports real-time contract enforcement rather than just documentation

## Contract Distribution

Arvo recommends distributing contracts as separate packages, either published independently or as part of a monorepo. This approach ensures contracts serve as a single source of truth, fostering genuine collaboration between services rather than becoming producer-centric documentation like traditional OpenAPI specifications.

## ArvoContract Implementation Example

Consider a service that interfaces with OpenAI's ChatGPT model. The contract definition would look like this:

```typescript
import { createArvoContract, InferVersionedArvoContract } from 'arvo-core'
import z from 'zod'

export const openaiCompletions = createArvoContract({
    uri: "#/services/openai/completions",
    type: "com.openai.completions",
    versions: {
        '1.0.0': {
            accepts: z.object({
                model: z.enum(['gpt-4', 'gpt-4o']),
                messages: z.object({
                    role: z.enum(['user', 'assistant']),
                    content: z.string()
                }).array(),
                system_command: z.string()
            }),
            emits: {
                'evt.openai.completions.success': z.object({
                    response: z.string()
                }),
                'evt.openai.completions.error': z.object({
                    error: z.string()
                })
            }
        }
    }
})
```

The contract system provides comprehensive type inference capabilities. You can select specific versions using the `.version()` method, which offers IDE-assisted version selection. The system allows for inference of both accept and emit data types, providing a robust type-safe development experience.

> The `createArvoContact` is a factory function which creates the `ArvoContract`.

## Type Inference and Contract Versioning

ArvoContract provides sophisticated type inference capabilities that "just works" and make working with contracts intuitive and type-safe. The system offers multiple ways to work with contract types, each suited to different use cases.

### Basic Version Selection and Type Inference

When working with contracts, developers can select specific versions using the `.version()` method:

```typescript
const version1 = openaiCompletions.version('1.0.0');
```

This method leverages TypeScript's type inference to provide IDE-assisted version selection, making it impossible to select non-existent versions. Once a version is selected, you can access its schema and infer types directly:

```typescript
const version1Accept = version1.accepts.schema;
type DirectAcceptType = z.infer<typeof version1Accept>;
```

This approach yields fully typed interfaces representing the contract's accept types:

```typescript
type DirectAcceptType = {
    model: 'gpt-4' | 'gpt-4o'
    messages: { role: 'user' | 'assistant', content: string }[] 
    system_command: string 
}
```

### Advanced Type Inference with InferVersionedArvoContract

For more comprehensive type information, ArvoContract provides the `InferVersionedArvoContract` utility type:

```typescript
type ContractType = InferVersionedArvoContract<typeof version1>;
type AcceptType = ContractType['accepts']['data'];
```

This utility provides access to all contract-related types, including emitted event types and system error types:

```typescript
// Access emit types for specific events
type EmitType = ContractType['emits']['evt.openai.completions.success']['data']

// Access system error types
// The default system error type can be resolved via
type SystemErrorType = ContractType['systemError']['type'];
// = sys.${contract.type}.error = sys.com.openai.completions.error
type SystemErrorType = ContractType['systemError']['data'];
// = ArvoErrorType
```

## Understanding ArvoEvent `dataschema` Construction

The `dataschema` field in `ArvoEvent` plays a crucial role in version management and event validation within the Arvo system. This field is constructed by combining two essential pieces of information: the contract's URI and its version number. Let's explore how this works and why it matters.

### Construction Pattern

The `dataschema` field follows a simple yet powerful construction pattern:
```
${ArvoContract.uri}/${version}
```

For example, if we have a contract with:
- URI: `"#/services/openai/completions"`
- Version: `"1.0.0"`

The resulting `dataschema` would be:
```
#/services/openai/completions/1.0.0
```

### Why This Matters

This construction pattern serves several important purposes in the Arvo ecosystem:

1. **Unique Identification**: By combining the contract URI with the version, each schema gets a unique identifier. This prevents any ambiguity about which version of a contract an event is using.

2. **Version Validation**: Event handlers can easily extract the version information from the `dataschema` field to ensure they're capable of processing that specific version of the event.

3. **Contract Evolution**: As contracts evolve, new versions can be added while maintaining backward compatibility. The `dataschema` field makes it clear which version of the contract an event adheres to.

### Real-World Example

Consider a payment processing system:

```typescript
const paymentContract = createArvoContract({
    uri: "#/services/payments/transaction",
    versions: {
        '1.0.0': {
            accepts: z.object({
                amount: z.number(),
                currency: z.string(),
                
            }),
            emits: {},
        },
        '2.0.0': {
            accepts: z.object({
                amount: z.number(),
                currency: z.string(),
                metadata: z.record(z.string(), z.string()) 
                /**
                 * Adding new non-optional field makes the contract 
                 * more restricted and hence adds a breaking change
                 * and warrents a new contract version.
                 */
            }),
            emits: {}
        }
    }
});
```

When events are created using this contract:
- A v1 event will have `dataschema`: `"#/services/payments/transaction/1.0.0"`
- A v2 event will have `dataschema`: `"#/services/payments/transaction/2.0.0"`

This clear identification helps services understand exactly which version of the contract they're dealing with, enabling proper handling and validation of the event data structure.

## Additional Contract Factories

While `createArvoContract` provides complete flexibility for contract creation, many services follow simpler patterns. The `arvo-core` package includes specialized factory functions to streamline contract creation for common use cases.

### Simple Contracts with `createSimpleArvoContract`

For services that follow a basic request-response pattern, `createSimpleArvoContract` offers a more concise way to define contracts. This factory:

1. Automatically prefixes event types with standard namespaces:
   - Input events: `com.{type}`
   - Success events: `evt.{type}.success`
   - Error events: `sys.com.{type}.error`
2. Enforces a single input schema and single output schema
3. Manages system event type generation automatically

#### Schema Reuse and Contract Evolution

One powerful aspect of Arvo's TypeScript-first approach is the ability to reuse schema definitions. This is particularly valuable when multiple services share similar interfaces within the same bounded context.

#### When to Reuse Schemas

Schema reuse should be approached carefully to avoid creating unintended coupling between services. Consider reusing schemas when:

1. Services share the same bounded context
2. The shared schema represents a stable, well-understood domain concept
3. The services are maintained by the same team
4. Changes to the schema should/ must naturally affect all services using it
5. A common understanding that once established changing the common schema will be extremely costly and will have cascading effects

#### Example: GenAI Services

Let's look at a practical example where schema reuse makes sense - Generative AI services that share common parameters and response structures.

First, we define our base schemas in `commons/schema.base.genai.ts`:

```typescript
import { z } from 'zod';

/**
 * Base input schema for GenAI operations.
 * Defines common parameters used across different AI service providers.
 */
export const accept = z.object({
    max_tokens: z.number()
        .min(10, 'The minimum number of completion tokens must be 10')
        .max(4096, 'The maximum number of completion tokens must be 4096')
        .describe('The maximum output tokens.')
        .default(4096),
    
    system_command: z.string()
        .describe('The persona the language model should assume')
        .default('You are a helpful assistant'),
    
    temperature: z.number()
        .min(0)
        .max(1)
        .describe('Controls output randomness')
        .default(0.5),
    
    json_response: z.boolean()
        .describe('Request JSON formatted response')
        .default(false),
    
    messages: z.array(
        z.object({
            role: z.enum(['user', 'assistant']),
            content: z.string()
        })
    ).min(1)
});

/**
 * Base output schema for GenAI operations.
 * Defines common response structure and metadata.
 */
export const emit = z.object({
    json_valid: z.boolean().nullable()
        .describe('Indicates if output is valid JSON when requested'),
    
    message: z.object({
        role: z.literal('assistant'),
        content: z.string()
    }),
    
    usage: z.object({
        tokens: z.object({
            prompt: z.number(),
            completion: z.number(),
            total: z.number()
        }),
        time_ms: z.object({
            to_first_token: z.number(),
            average_token: z.number(),
            total: z.number()
        })
    }),
    
    stop_reason: z.enum(['stop', 'length', 'content_filter'])
});
```

Then, we can create specific service contracts that extend these base schemas:

```typescript
import { createSimpleArvoContract, type InferVersionedArvoContract } from 'arvo-core';
import { z } from 'zod';
import * as BaseGenAISchema from '../commons/schema.base.genai';


// Defining Anthropic service contract
export const anthropic = z.enum([
	'claude-3-5-sonnet-20240620',
	'claude-3-sonnet-20240229',
	'claude-3-opus-20240229',
	'claude-3-haiku-20240307',
]);
  
export const anthropicCompletions = createSimpleArvoContract({
	uri: '#/services/anthropic/completions',
	type: 'anthropic.completions', // = 'com.anthropic.completions'
	versions: {
		'1.0.0': {
			accepts: BaseGenAISchema.accept.merge(
				z.object({
					model: anthropic.default('claude-3-haiku-20240307'),
				}),
			),
			emits: BaseGenAISchema.emit,
			// type = 'evt.anthropic.completions.success'
		},
	},
});
// system error type = 'sys.com.anthropic.completions.error'

// Defining OpenAI service contract
export const openai = z.enum(['gpt-4o', 'gpt-4-turbo', 'gpt-4o-mini']);

export const openaiCompletions = createSimpleArvoContract({
	uri: '#/services/openai/completions',
	type: 'openai.completions', // = 'com.openai.completions'
	versions: {
		'1.0.0': {
			accepts: BaseGenAISchema.accept.merge(
				z.object({
					model: openai.default('gpt-4o-mini'),
				}),
			),
			emits: BaseGenAISchema.emit,
			// type = 'evt.openai.completions.success'
		},
	},
});
// system error type = 'sys.com.openai.completions.success'
```

This approach provides several benefits:

1. **DRY Code**: Common schemas are defined once and reused
2. **Consistent Interfaces**: All AI services share the same base interface
3. **Type Safety**: TypeScript provides full type inference for the shared schemas
4. **Evolution Path**: Base schemas can be versioned independently
5. **Clear Documentation**: Schema descriptions are centralised

The resulting contracts maintain individual service boundaries while sharing common structures where appropriate. Service-specific additions (like model selection) are cleanly merged with the base schema.

### Orchestrator Contracts

An orchestrator in Arvo is a special type of event handler that coordinates complex workflows across multiple services. Rather than performing tasks directly, it emits command events to other services and manages their responses. For example, in a document processing system, an orchestrator might coordinate between a text extraction service, a translation service, and a storage service.

What makes orchestrators unique is their ability to maintain state and make decisions based on the responses they receive. They follow Arvo's event handler pattern (`ArvoEvent => Promise<ArvoEvent[]>`), but they're designed specifically for coordination rather than direct task execution.

#### Parent Subject in Orchestration

Each orchestrator execution is uniquely identified by an event subject. When orchestrators need to coordinate, they use the `parentSubject$$` field to establish execution context relationships. The root orchestrator sets `parentSubject$$` to `null`, while child orchestrators receive the parent's subject as their `parentSubject$$`.

> **Note**: An orchestrator defines a workflow, while an orchestration execution is a specific instance of that workflow. Each execution is identified by a unique subject string that's included in all related ArvoEvents. The orchestrator uses this subject to track execution state in storage (memory or database). When processing events, the orchestrator optimistically locks the execution state to handle parallel events or multiple service responses safely.

#### Execution Context Flow

When an orchestrator completes its execution, it determines its completion event's subject based on the `parentSubject$$` received during initialization. For root executions (`parentSubject$$ = null`), it uses its own subject. For child executions, it uses the `parentSubject$$` value, effectively returning control to the parent orchestrator.

The `parentSubject$$` field is strictly for orchestrator coordination and should never be used in communication with regular services. This separation maintains clean boundaries between orchestration logic and service implementation.


#### Creating Orchestrator Contracts

The `createArvoOrchestratorContract` factory simplifies creating contracts for orchestration services. It automatically handles common orchestration patterns and establishes consistent event naming:

```typescript
import { createArvoOrchestratorContract, ArvoErrorSchema } from 'arvo-core';
import { z } from 'zod';
import * as LLMs from '../commons/genai.llms';
import * as BaseGenAISchema from '../commons/schema.base.genai';

export const createOrchestratorCompletionSchema = <T extends z.AnyZodObject>(schema: T) => {
	return z.object({
		status: z.enum(['success', 'error']),
		errors: ArvoErrorSchema.array().nullable(),
		result: schema.nullable(),
	});
}

// Define which AI models are supported
export const llmModelSchema = z.union([
    // Anthropic models
    z.object({
        provider: z.literal('anthropic'),
        model: LLMs.anthropic.default('claude-3-haiku-20240307'),
    }),
    // OpenAI models
    z.object({
        provider: z.literal('openai'),
        model: LLMs.openai.default('gpt-4o-mini'),
    }),
]);

// Create the orchestrator contract
export const llmOrchestrator = createArvoOrchestratorContract({
    uri: '#/orchestrators/llm',
    name: 'llm',
    versions: {
        '1.0.0': {
            // Initial event schema
            init: BaseGenAISchema.accept.merge(
                z.object({
                    model: llmModelSchema,
                })
            ),

            // Completion event schema
            complete: createOrchestratorCompletionSchema(
                BaseGenAISchema.emit.merge(
                    z.object({
                        model: llmModelSchema,
                    })
                )
            ),
        },
    },
});
```

The factory automatically generates consistent event types:
- Initialization events: `arvo.orc.{name}` (e.g., `arvo.orc.llm`)
- Completion events: `arvo.orc.{name}.done` (e.g., `arvo.orc.llm.done`)
- System errors: `sys.arvo.orc.{name}.error` (e.g., `sys.arvo.orc.llm.error`)

#### Type Safety and Contract Usage

The orchestrator contract provides full TypeScript type inference. You can access the contract's types for both initialization and completion events:

```typescript
const version1 = llmOrchestrator.version('1.0.0');
type ContractType = InferVersionedArvoContract<typeof version1>;

// Get the initialization event type and data structure
type InitType = ContractType['accepts']['type'];        // "arvo.orc.llm"
type InitDataType = ContractType['accepts']['data'];    // Full data structure

// Get the completion event type and data structure
type CompleteType = ContractType['emits'][ContractType['metadata']['completeEventType']]['type'];
type CompleteDataType = ContractType['emits'][ContractType['metadata']['completeEventType']]['data'];

// The metadata are additional data inserted via the factory
```

This type safety ensures that orchestration events are properly structured throughout your system, making it easier to maintain and evolve complex workflows over time.

Let me help improve the Event Creation section by restructuring it to be clearer and more comprehensive. I'll organize it to build understanding from fundamental concepts to practical implementation.

# Event Creation

Event creation is a core feature of the Arvo system that ensures type safety and validation through the `ArvoContract`. Let's understand how event creation works and explore the tools provided by `arvo-core` to make this process robust and developer-friendly.

## Core Concepts 

The event creation system in Arvo is built around three key elements:

1. `ArvoEvent` - The base event type that represents all events in the system
2. `ArvoContract` - A validation layer that ensures events conform to specified schemas
3. Event Factories - Helper functions that create properly structured and validated events

## The ArvoEventFactory

The primary tool for creating events is the `ArvoEventFactory`, which provides two main methods for event creation:

- `.accepts()` - Creates events that a service can receive
- `.emits()` - Creates events that a service can send
- `.systemError()` - Creates the system error event

Let's explore each usage pattern in detail.

### Creating Receivable Events

When creating events that your service will receive, use the `accepts()` method. Here's a complete example:

```typescript
import { createArvoEventFactory } from 'arvo-core';

// Initialize the factory with a specific contract version
const factory = createArvoEventFactory(anthropicCompletions.version('1.0.0'));

// Create an event the service can accept
const receivableEvent = factory.accepts({
    source: 'com.test.test',
    subject: 'test-subject',
    data: {
        messages: [
            {
                role: 'user' as const,
                content: 'Hello World',
            },
        ],
    },
});

// dataschema = '#/services/anthropic/completions/1.0.0'
```

The factory automatically handles several important aspects:
- Validates the event structure against the contract
- Provides TypeScript intellisense for better developer experience
- Adds default values for optional fields
- Ensures version compatibility by automatically adding `dataschema` field

### Creating Emittable Events

For events that your service will emit, use the `emits()` method. This requires additional configuration since services can emit multiple event types:

```typescript
import { createArvoEventFactory } from 'arvo-core';

// Initialize the factory with a specific contract version
const factory = createArvoEventFactory(anthropicCompletions.version('1.0.0'));

// Create an event the service can emit
const emittableEvent = factory.emits({
    source: 'com.test.test',
    subject: 'test-subject',
    type: 'evt.anthropic.completions.success',  // Specify the event type
    data: {
        json_valid: null,
        message: {
            role: 'assistant' as const,
            content: 'Hello World',
        },
        stop_reason: 'stop',
        usage: {
            time_ms: {
                to_first_token: 0,
                average_token: 0,
                total: 0
            },
            tokens: {
                prompt: 0,
                completion: 0,
                total: 0
            }
        }
    },
});

// dataschema = '#/services/anthropic/completions/1.0.0'
```

### Creating System Error

The `ArvoEventFactory` provides a specialized `.systemError()` method for handling system-level errors in a standardized way. This method creates error events that follow Arvo's system-wide error handling conventions.

```typescript
import { createArvoEventFactory } from 'arvo-core';

// Initialize the factory with a specific contract version
const factory = createArvoEventFactory(anthropicCompletions.version('1.0.0'));

const errorEvent = factory.systemError({
	source: 'com.test.test',
	subject: 'test-subject',
	error: new Error("Some Error")
});

// dataschema = '#/services/anthropic/completions/0.0.0'
```

Key features of system error events:

1. **Standardized Type**: The event type is automatically set to the system error type - no need to specify it manually
2. **Version Independence**: Always uses the wildcard version `0.0.0` in the `dataschema` regardless of the contract version
3. **Error Field**: Uses an `error` field instead of `data` to properly capture error information

Let me rewrite the ArvoOrchestratorEventFactory section to make it clearer and more comprehensive.

## The `ArvoOrchestratorEventFactory`

While regular events can be created using the standard `ArvoEventFactory`, orchestrator events have unique characteristics that warrant their own specialized factory. The `ArvoOrchestratorEventFactory` is designed specifically for creating events that coordinate complex workflows across multiple services.

### Initialization Events with `.init()`

The `.init()` method creates events that start new orchestration workflows. These events are particularly special because they can establish parent-child relationships between different orchestration processes. Here's how it works:

```typescript
import { createArvoOrchestratorEventFactory } from 'arvo-core';

// Create a factory for a specific version of our LLM orchestrator
const factory = createArvoOrchestratorEventFactory(llmOrchestrator.version('1.0.0'))

// Create an initialization event
const initEvent = factory.init({
    source: 'com.test.test',
    data: {
        // null parentSubject$$ indicates this is starting a new workflow
        parentSubject$$: null,
        model: {
            provider: 'openai'
        },
        messages: [
            {
                role: 'user',
                content: "Hello world"
            }
        ],
    }
})
```

The initialization event sets up the initial state and parameters for the workflow. The `parentSubject$$` field is particularly important:

- When `null`, it starts a new independent workflow
- When set to another orchestrator's subject, it creates a sub-workflow

This enables building complex, nested orchestration patterns while maintaining clear relationships between workflows.

### Completion Events with `.complete()`

The `.complete()` method creates events that signal the completion of orchestrated workflows. These events carry the final results or any error information:

```typescript
import { createArvoOrchestratorEventFactory } from 'arvo-core';

const factory = createArvoOrchestratorEventFactory(llmOrchestrator.version('1.0.0'))

// Create a completion event with successful results
const completionEvent = factory.complete({
    subject: 'test-subject',
    source: 'com.test.test',
    data: {
        status: 'success',
        errors: null,  // No errors in this case
        result: {
            model: {
                provider: 'openai',
                model: 'gpt-4-turbo',
            },
            json_valid: null,
            message: {
                role: 'assistant',
                content: 'Hello World',
            },
            stop_reason: 'stop',
            usage: {
                time_ms: {
                    to_first_token: 0,
                    average_token: 0,
                    total: 0,
                },
                tokens: {
                    prompt: 0,
                    completion: 0,
                    total: 0,
                },
            },
        },
    },
});
```

Completion events are structured to provide comprehensive information about the workflow's outcome:

- The status field indicates success or failure
- The errors array captures any problems that occurred
- The result field contains the workflow's output

This structure ensures that orchestrators can make informed decisions about workflow progression.

### Error Handling with `.systemError()`

The `.systemError()` method creates standardized error events for orchestration-specific failures:

```typescript
import { createArvoOrchestratorEventFactory } from 'arvo-core';

const factory = createArvoOrchestratorEventFactory(llmOrchestrator.version('1.0.0'));

// Create an error event for orchestration failures
const errorEvent = factory.systemError({
    source: 'com.test.test',
    subject: 'test-subject',
    error: new Error("Orchestration timeout exceeded")
})
```

System error events in orchestration contexts are particularly important because they can affect multiple services and workflows. The factory ensures these errors are properly structured and can be handled appropriately by the orchestration system.

### Understanding Event Flow

These three event types work together to create a complete orchestration lifecycle:

1. An init event starts the workflow
2. The orchestrator processes various service events
3. Eventually, either a complete event indicates successful completion, or
4. A `systemError` event indicates a workflow failure

This structured approach to event creation helps maintain clear and predictable orchestration patterns, even in complex distributed systems.

# Contract Evolution

Contract evolution in Arvo follows a simple but powerful principle: services remain independent by evolving behind stable contracts, while the contracts themselves evolve through semantic versioning. While `ArvoContract` provides the technical mechanism for versioning, successful contract evolution requires thoughtful strategy beyond just code.

Drawing from Meyer's Design by Contract and Fowler's Event Sourcing work, Arvo adopts a clear rule for contract versioning: create a new version for any breaking change that makes the contract more restrictive or changes its restrictions, while non-breaking changes that maintain or reduce restrictions can be handled within the existing version. This approach ensures predictable system evolution while maintaining backward compatibility where possible.

Let's explore how different components of `ArvoContract` evolve:

## Contract Fields Evolution

- **URI**: Changes to the contract `uri` introduce breaking changes, but since `ArvoEventFactory` handles URI updates automatically, developers rarely need to manage this directly.
- **Type**: Modifying the event `type` creates a breaking change requiring service updates.
- **Accepts/Emits**: These fields drive most system evolution and require careful consideration during changes.

> **Note**: When creating a new `ArvoContract`, begin by modeling your contracts after your existing working code, API endpoints, or the general idea of your service's inputs and outputs. Once you have this working foundation, you can gradually refine the contract to be more precise. Remember - a good contract evolves from practical use rather than perfect upfront design. You are required to follow the following evolution patterns only when your first version goes to production after all.


## Evolution of `accepts` data schema

The evolution of `accepts` schemas must be managed carefully to maintain system reliability. Here's a comprehensive breakdown of different schema changes and their implications:

| Change Type           | Breaking Change? | Least effort version update | Explanation                                                             |
| --------------------- | ---------------- | --------------- | ----------------------------------------------------------------------- |
| Adding Required Field | Yes              | New Version     | Makes contract more restrictive by requiring additional data            |
| Adding Optional Field | No               | Same Version    | Maintains existing contract restrictions while allowing additional data |
| Adding Union Type     | No               | Same Version    | Increases permissiveness while preserving existing functionality        |
| Removing Union Type   | Yes              | New Version     | Makes contract more restrictive by limiting allowed types               |
| Changing Field Type   | Yes              | New Version     | Changes nature of contract restrictions                                 |
| Removing Any Field    | Limited Breaking   | Same Version     | Following the tolerant reader pattern, removing fields from 'accepts' schema is not a breaking change. Clients can continue sending removed fields, while handlers simply ignore them. TypeScript's type safety ensures handlers don't accidentally reference removed fields during compilation.            |
## Evolution of `emits` data schema

The `emits` field in Arvo contracts defines the event schemas a service can produce. Each contract version can specify multiple emit event types, and their evolution follows specific patterns to maintain system reliability:

| Change Type | Example | Impact | Least effort version update | Rationale |
|------------|----------|---------|----------------|-----------|
| Adding New Event Type | Adding `evt.payment.refunded` | Non-Breaking | Same Version | The new event type doesn't affect existing event handlers since they'll ignore events they don't recognize. Consumers and producers can add support gradually. |
| Adding New Event Type (High Throughput) | Adding `evt.payment.refunded` | Breaking (Tradeoff) | New Version | If a service might be used by an orchestrator, multiple event types in the same version will cause locking in that orchestrator, regardless of service statelessness. Only put high-throughput events (like your 100K/sec) in the same version if you're absolutely certain no orchestrator will ever use this service. Otherwise, create a new version to avoid orchestrator bottlenecks. While this duplicates code, it enables independent optimization. |
| Removing Event Type | Removing `evt.payment.failed` | Breaking | New Version | Existing consumers rely on this event for their business logic. Removal breaks their functionality and requires rewrite. |
| Adding Required Field | Adding `transaction_id: string` | Limited Breaking | Special Case | Only producer needs changes to provide new field. Consumers following tolerant reader pattern continue working. |
| Adding Optional Field | Adding `metadata?: object` | Non-Breaking | Same Version | Optional fields don't break existing consumers since they can ignore unknown fields. Allows gradual adoption of new capabilities. |
| Expanding Union Type | `status: 'success' \| 'fail'` → adds 'pending' | Non-Breaking | Same Version | Existing code handles known values and ignores new ones by design. Maintains backward compatibility. |
| Changing Field Type | `amount: number` → `amount: string` | Breaking | New Version | Fundamental change in data representation. Existing parsing, validation, and business logic would fail. |
| Removing Union Value | `status: 'success' \| 'fail' \| 'pending'` → removes 'pending' | Breaking | New Version | Consumers using 'pending' in business logic or state machines would break. Cannot safely remove without coordination. |
| Removing Field | Removing `timestamp` | Breaking | New Version | Any consumer logic depending on this field would fail. Cannot assume field is unused without breaking consumer contract. |

## Anti-Patterns in Schema Design

Creating robust contracts requires careful consideration of field requirements. Two common anti-patterns to avoid:

1. **Universal Optionality**: Making all fields optional undermines the contract's purpose by removing meaningful constraints. A contract should clearly define its required shape and expectations.
2. **Excessive Nullability**: Using too many optional or nullable fields creates uncertainty and complicates validation. Instead, provide meaningful default values that reflect the field's intended use and maintain contract clarity.

#  Versioning Nuances

`ArvoContract` takes a distinct approach to versioning that differs from traditional semantic versioning systems. Each version in ArvoContract exists as a completely isolated, standalone definition. When version 1.0.0 exists and a version 1.1.0 is created, these are treated as entirely separate contracts with no implicit relationship or compatibility between them.

This isolation has important implications for how we should approach contract evolution:

**When to Stay in Current Version**: If you're adding capabilities that don't break existing consumers - like optional fields, new event types, or expanded enum values - these can be added to the current version. The key test is: will existing consumers continue working without any changes? If yes, enhance the current version.

**When to Create New Version**: Any breaking change requires a new version. This includes adding required fields, changing field types, removing fields, or altering how existing fields work. The new version is treated as completely separate from previous versions.

This approach provides absolute clarity about contract behavior. Each version is self-contained, making it impossible to have subtle compatibility issues. While this might seem overly simple, it actually handles the complexity of distributed systems better than elaborate versioning schemes.

Key Implementation Strategy:

- Start with minimal contracts
- Add optional capabilities within versions when possible
- Create new versions only for genuine breaking changes
- Treat each version as its own contract
- Use semantic versioning to signal magnitude of changes, not compatibility

This versioning philosophy acknowledges that in distributed systems, clear boundaries and explicit contracts are more valuable than complex compatibility promises.

# Conclusion

Arvo represents a thoughtful evolution in event-driven system design, addressing the fundamental challenges of building reliable and maintainable distributed systems. At its core, Arvo's contract-first approach transforms how services communicate by making contracts first-class citizens in the development process. This isn't just a technical choice – it's a strategic decision that brings clarity to service boundaries, ensures type safety, and provides a clear path for system evolution.

What makes Arvo particularly powerful is its pragmatic approach to managing change. Rather than treating coupling as inherently negative, it acknowledges that some coupling is inevitable and provides tools to manage it effectively. The combination of TypeScript-based contracts, semantic versioning, and clear evolution patterns creates a framework where services can evolve independently while maintaining system-wide reliability. The framework's sophisticated event creation and validation mechanisms, paired with its orchestration capabilities, enable developers to build complex distributed systems that remain maintainable as they grow.

Perhaps most importantly, Arvo's design reflects a deep understanding of real-world challenges in distributed systems. By drawing inspiration from established patterns like Design by Contract and Event Sourcing, while incorporating modern tools like TypeScript and Zod, it provides a practical solution that balances theoretical correctness with developer experience. The result is a framework that not only helps build reliable distributed systems today but also provides a clear path for evolving them tomorrow.

# Appendix

## A Brief History of Service Contracts

Historically, service contracts have played a crucial role in distributed systems development. As systems grew more complex and distributed, the need for formal service contracts became increasingly apparent, leading to several significant developments in contract definition and management.

### WSDL (Web Service Description Language)

WSDL emerged in the early 2000s as part of the SOAP/XML web services ecosystem, representing one of the first comprehensive approaches to formal service contracts. At its core, WSDL provided a standardized way to describe network services as collections of endpoints operating on messages. The XML-based WSDL documents served as formal contracts between service providers and consumers, defining everything from data types to operation signatures.

A typical WSDL contract included:

- Interface definitions specifying available operations
- Data type definitions through XML Schema (XSD)
- Binding information describing how to access the service
- Service location information

The WSDL approach introduced several important concepts that influenced future contract systems:

- Explicit contract definitions
- Strong type checking through XML Schema
- Tool-based code generation
- Platform-independent service descriptions

However, WSDL faced significant challenges in practice. The XML-based specifications were verbose and difficult to maintain. The code generation approach, while ensuring type safety, created a rigid development workflow that struggled to adapt to changing requirements. Development teams found themselves managing complex build processes to regenerate code whenever contracts changed, leading to deployment coordination challenges across services.

The separation between contract specification (WSDL) and implementation code also created friction in the development process. Developers had to context-switch between XML specifications and implementation code, making it harder to understand and evolve services. The tooling-dependent workflow often led to version mismatches and integration problems.

### Protobuffers

Protocol Buffers, developed at Google, emerged as a transformative approach to service contracts and data serialization. Unlike its predecessors, Protocol Buffers introduced a simple Interface Definition Language (IDL) that struck a balance between human readability and machine efficiency. The system's core innovation was its approach to contract definition through `.proto` files, which serve as the single source of truth for data structures and service interfaces. These definitions could then be compiled into type-safe code for multiple programming languages, ensuring consistency across different parts of a distributed system. 

What truly set Protocol Buffers apart was its approach to versioning and compatibility. By assigning unique numbers to each field in a message definition, Protocol Buffers created a robust system for schema evolution. These field numbers, once assigned, become a permanent part of the contract, ensuring that older clients can still read newer messages and newer clients can process older messages. This backward and forward compatibility was achieved without requiring complex transformation layers or version negotiation protocols. The system also introduced clear rules about what changes were safe to make: fields could be added if they were optional, required fields couldn't be removed, and field numbers could never be reused. 

The binary serialization format of Protocol Buffers provided significant performance advantages over text-based formats like XML or JSON. Messages were smaller, faster to serialize and deserialize, and type-safe by design. This efficiency made Protocol Buffers particularly well-suited for high-performance systems and internal service communication. The combination of clear contract definitions, efficient serialization, and strong compatibility guarantees made Protocol Buffers a standard tool in distributed system development, influencing how future contract systems would approach these challenges.
#### Challenges

Protocol Buffers, developed at Google, emerged as a transformative approach to service contracts and data serialisation. They introduced a simple Interface Definition Language (IDL) that struck a balance between human readability and machine efficiency. Consider this typical **proto** definition:

```protobuf
syntax = "proto3";

package payment;

message PaymentRequest {
    string payment_id = 1;
    double amount = 2;
    string currency = 3;
    PaymentType type = 4;
    map<string, string> metadata = 5;
}

enum PaymentType {
    CREDIT_CARD = 0;
    BANK_TRANSFER = 1;
    CRYPTO = 2;
}

service PaymentService {
    rpc ProcessPayment (PaymentRequest) returns (PaymentResponse);
}
```

While this looks straightforward, the development workflow becomes complex. Teams need to:
- Maintain separate `.proto` files
- Run `protoc` to generate code
- Manage generated code in version control
- Coordinate **proto** updates across services
- Deal with language-specific protobuf runtime dependencies

What truly set Protocol Buffers apart was its sophisticated approach to versioning and compatibility through field numbers. However, this created its own challenges:

```protobuf
// Version 1
message User {
    string name = 1;
    string email = 2;
}

// Version 2 - Can't remove email or reuse field 2
message User {
    string name = 1;
    // email removed but number 2 is forever reserved
    string phone = 3;    // Must use new number
    Address address = 4; // New field
}

// This creates "holes" in field numbers over time
message User {
    string name = 1;
    // 2 reserved forever
    string phone = 3;
    Address address = 4;
    string preferred_name = 8; // Added later
    // 5,6,7 used in abandoned features
}
```

The binary serialisation format provided significant performance advantages but introduced practical challenges:
- Messages aren't human-readable for debugging
- Need special tools to inspect traffic
- Debugging production issues becomes harder
- Integration testing is more complex

I'll help improve the practicality section to be more balanced and better structured. Here's a revised version:

###### Practicality
While Protocol Buffers offer robust service contracts and efficient serialization, several practical considerations affect their adoption in modern microservices architectures:

- Development Complexity
	- Teams need to invest time in learning the Protocol Buffer ecosystem, including the IDL syntax, code generation workflow, and versioning rules
	- Build systems require additional configuration to handle .proto files and generated code
	- Developers must understand and maintain two layers: the contract definitions and the implementation code
- Integration Challenges
	- JSON remains the de facto standard for web APIs, making Protocol Buffers less suitable for public-facing services
	- Interoperability with external systems often requires translation layers between Protobuf and JSON
	- Tools and debugging workflows common in REST/JSON ecosystems may not work with Protocol Buffer services
- Developer Experience
	- The strict versioning system, while powerful, adds cognitive overhead to schema evolution
	- Field numbering rules and compatibility constraints require careful planning and documentation
	- Binary format makes debugging more difficult without specialized tools
	- Generated code can be verbose and less intuitive than hand-written alternatives

These practical challenges often lead teams to carefully evaluate whether Protocol Buffers' benefits outweigh their complexity, particularly in smaller microservices architectures or when interoperability with external systems is a priority. However, for large-scale distributed systems with strong consistency requirements, the investment in Protocol Buffers can pay off through improved type safety and performance.
I'll write a comprehensive section on OpenAPI that covers all our discussion points.

### OpenAPI (Formerly Swagger)

OpenAPI Specification has emerged as a dominant standard for describing RESTful APIs, evolving from its origins as Swagger. It provides a language-agnostic approach to API documentation and contract definition using YAML or JSON format. 

#### Key Features and Benefits

```yaml
openapi: 3.0.0
info:
  title: Payment API
  version: 1.0.0
paths:
  /payments:
    post:
      summary: Process a payment
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                payment_id:
                  type: string
                amount:
                  type: number
                  minimum: 0
                currency:
                  type: string
                  enum: [USD, EUR, GBP]
      responses:
        '200':
          description: Payment processed successfully
```

The specification offers several advantages:
- Human-readable format that's easy to understand and modify
- Rich ecosystem of tools for documentation, testing, and code generation
- Comprehensive support for HTTP-specific features
- Interactive documentation through Swagger UI
- Wide industry adoption and tooling support
- Strong integration with modern frameworks

#### Modern Framework Integration

Modern frameworks have significantly improved OpenAPI's developer experience:

```python
# FastAPI example of automatic spec generation
from fastapi import FastAPI

app = FastAPI()

@app.post("/payments")
async def create_payment(payment: Payment):
    # OpenAPI spec automatically generated
    # Validation included
    return {"transaction_id": "123"}
```

This integration provides:
- Automatic spec generation from code
- Type safety and validation out of the box
- Live documentation that stays in sync with code
- Reduced boilerplate
- Strong IDE support
- Extensive middleware ecosystem

#### Challenges and Limitations

- **Versioning** remains one of OpenAPI's most significant challenges, stemming from its lack of built-in version management mechanisms. Unlike Protocol Buffers with its explicit field numbering system, OpenAPI leaves versioning strategies up to implementation teams, leading to inconsistent approaches across the industry. Teams often struggle between URL-based versioning (/v1/resource) and header-based versioning, each bringing its own complications. This absence of standardised versioning makes it particularly challenging to maintain multiple API versions simultaneously or to implement automated compatibility checking. Without clear guidelines for breaking versus non-breaking changes, teams often find themselves maintaining complex documentation to track version differences and struggling to ensure backward compatibility.

- The **producer-centric** nature of modern OpenAPI implementations presents another significant limitation, particularly with contemporary frameworks and tools. While frameworks like FastAPI and HonoJS have made OpenAPI more developer-friendly, they've inadvertently shifted the specification away from its contract-first origins. The contract now typically emerges as a byproduct of implementation code, with data models (like Pydantic or Zod) serving double duty as both application models and contract definitions. This coupling of application data with contracts creates a one-sided dynamic where producers unilaterally define and modify contracts without meaningful input from consumers. The result is a less collaborative contract environment where consumers have limited guarantees about contract stability and often discover changes only after they're implemented.

- **Technical limitations** further constrain OpenAPI's effectiveness as a complete contract solution. Being exclusively focused on REST/HTTP APIs, it lacks the versatility of protocol-agnostic solutions like Protocol Buffers. The specification's runtime validation approach, while flexible, doesn't provide the same level of safety as compile-time checks. Teams must also grapple with the perpetual challenge of keeping specifications and implementation code synchronised, or in the case of modern tooling, accept that OpenAPI becomes more of a documentation tool than a true contracting mechanism. This documentation-first approach, while valuable for API understanding, falls short of providing the robust contract enforcement and evolution capabilities needed in complex distributed systems.

Despite its limitations, OpenAPI is a powerful tool for API documentation and contract definition, especially when combined with modern frameworks. Its success in the REST API space demonstrates the value of standardised API descriptions, even with the challenges of maintaining true contract-first development practices.

### AsyncAPI

AsyncAPI emerged as a response to the growing adoption of event-driven architectures and the limitations of OpenAPI in describing asynchronous APIs. While OpenAPI excelled at documenting RESTful endpoints, it couldn't adequately capture the complexities of message-based systems, WebSocket connections, or pub/sub patterns. AsyncAPI filled this gap by providing a specification designed specifically for asynchronous APIs while maintaining familiar concepts from OpenAPI.

#### Key Features and Benefits

```yaml
asyncapi: 2.5.0
info:
  title: Payment Events API
  version: 1.0.0
channels:
  payment/processed:
    publish:
      message:
        payload:
          type: object
          properties:
            payment_id:
              type: string
            status:
              type: string
              enum: [SUCCESS, FAILED]
            timestamp:
              type: string
              format: date-time
    subscribe:
      message:
        payload:
          type: object
          properties:
            payment_id:
              type: string
            amount:
              type: number
            currency:
              type: string
```

AsyncAPI brings several unique advantages to asynchronous service contracts:
- Native support for multiple messaging protocols (MQTT, AMQP, Kafka, WebSocket)
- Clear distinction between publish and subscribe operations
- Built-in schema validation for message payloads
- Support for message headers and correlation patterns
- Runtime documentation through AsyncAPI Studio
- Code generation capabilities for multiple languages
#### Challenges and Limitations

- **Message Flow and Correlation**: AsyncAPI provides basic support for message correlation through the Correlation ID Object (as defined in the specification), which allows for message tracing and correlation using runtime expressions. However, the specification focuses primarily on describing individual message structures and channels rather than complex message flows. While correlation IDs provide a way to link related messages, the specification itself does not provide explicit constructs for documenting complex event chains or choreography patterns. This is actually a fair limitation of the AsyncAPI. There has been discussion on this front [in Github Issue](https://github.com/asyncapi/spec/issues/94)

- **Protocol-Specific Features**: The AsyncAPI specification aims to be protocol-agnostic, but this creates challenges in representing protocol-specific features. As documented in the AsyncAPI [bindings section](https://www.asyncapi.com/docs/reference/specification/v2.5.0#bindingsObject), while the specification provides binding objects for different protocols, these don't fully capture all protocol-specific behaviours. Again from a contracts stand point that does not seem to be a very problematic issue.

- **Tooling Ecosystem**: The AsyncAPI tooling ecosystem, while growing, is still maturing. The official [AsyncAPI Generator](https://github.com/asyncapi/generator) and AsyncAPI Studio provide basic functionality, but as noted in the AsyncAPI community [discussions](https://github.com/asyncapi/community), there are gaps in areas like:
	- Code generation quality for certain languages
	- Runtime validation tools
	- Integration testing frameworks
	- IDE support

- **Contract Implementation Model**: The AsyncAPI specification's current trajectory seems mirrors OpenAPI's evolution in the REST space, focusing primarily on documentation capabilities. While this approach excels at API documentation and discovery, it can lead to a producer-centric implementation model where contracts become descriptive rather than prescriptive. This challenges the original contract-first design philosophy, potentially impacting the specification's effectiveness as a strict contract enforcement mechanism in event-driven architectures.

Despite these challenges, AsyncAPI represents a crucial evolution in service contract specifications, particularly as systems increasingly adopt event-driven architectures. Its ability to document asynchronous interactions in a standardised way provides valuable insights into system behaviour and helps teams maintain consistency across distributed systems. As the specification and its ecosystem continue to mature, it's likely to become an essential tool in the modern API landscape, complementing existing specifications like OpenAPI and Protocol Buffers.