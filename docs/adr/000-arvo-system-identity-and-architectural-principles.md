# ADR-000: Arvo System Identity and Architectural Principles

- **Status:** Proposed
- **Date:** 2026-07-31
- **Scope:** Arvo ecosystem
- **Decision owners:** Arvo maintainers

## Conformance Language

In this ADR, **must** denotes a requirement for Arvo conformance. **Should** denotes a recommendation that may be departed from with documented justification. **May** denotes a permitted choice.

## Context

Modern durable execution and workflow platforms provide valuable operational capabilities, but they commonly require application workflows to conform to platform-specific execution models. These models may impose determinism, functional purity, centralized workflow ownership, or other constraints necessary for a particular platform's operation.

Those constraints are useful within their intended environments, but they make application behaviour dependent on the selected engine. They also become restrictive when an application combines conventional handlers, deterministic workflows, imperative processes, nondeterministic workflows, AI agents, human participation, and external systems.

Arvo needs an application model in which these different participants can compose without requiring one execution engine to own the complete process. Arvo seeks to keep their composition and lifecycle semantics portable while infrastructure adapters and platforms perform execution, persistence, delivery, scheduling, and recovery according to their strengths.

The motivating thesis, its failure conditions, and a worked example are described in [the Arvo vision document](../vision.md). This ADR records the resulting architectural commitments.

This ADR establishes the identity and architectural principles of Arvo. It governs the Arvo ecosystem beyond a single package or major version, and defines the first version of the Arvo Application Model, AAM 1. `arvo-core` v4 is the first implementation expected to conform to it.

## Decision

Arvo is a lightweight, opinionated framework that defines a portable application model for event-driven systems.

Arvo does not execute that model itself and is not an orchestration engine or infrastructure runtime. It provides the protocol semantics, contracts, application primitives, and integration boundaries required to express event-driven application behaviour. Infrastructure adapters execute that behaviour and provide operational capabilities.

An Arvo application is understood conceptually as a dynamic graph of independently participating nodes. Nodes compose exclusively through interactions represented by ArvoEvents and governed by declared ArvoContracts. The graph emerges from contracts, participating nodes, and emitted events; it does not require a complete central declaration or owner.

## Terminology

- **Node:** A conceptual participant in an Arvo application that exposes or consumes capabilities through Arvo contracts. A node may be implemented by an ArvoEventHandler, a human participant, or an external system.
- **Inter-node interaction:** A request, signal, result, failure, or other exchange used to compose application behaviour between Arvo nodes.
- **Implementation dependency:** A database, API, library, model provider, or other resource used internally by a node without participating in the portable application model.
- **Handler:** An application-layer implementation of an Arvo node. An ArvoEventHandler implements one ArvoContract, declares its ArvoContract dependencies, and may continue its logical execution across multiple event deliveries and infrastructure executions.
- **Infrastructure adapter:** An integration that binds Arvo's portable application model to execution, delivery, persistence, scheduling, discovery, or other infrastructure.
- **Arvo Application Model (AAM):** Arvo's versioned, language-independent portable application model, defined by this ADR and its descendants. It comprises the ArvoEvent identities, data, and CloudEvent transformability; ArvoContract identities, versions, and declared event capabilities; inter-node interactions; causation, lineage, and trace context; handler interfaces and lifecycle semantics; execution capability requirements; validation and compatibility semantics; and failure categories whose meaning must remain consistent across supporting infrastructure adapters. It excludes physical transport, persistence technology, scheduling implementation, retry counts, batching, telemetry collection and export, and handler implementation dependencies. AAM versions are distinct from the versions of any package implementing them; `arvo-core` v4 is the first TypeScript implementation of AAM 1.

  *AAM* is the formal name. *Portable application model* is used descriptively throughout this ADR and refers to the same thing.
- **Execution slice:** One active period of handler execution, beginning when the handler receives or resumes from an event and ending when it completes, fails, or suspends while awaiting another event.
- **Execution capability profile:** The declared runtime capabilities and constraints required to execute a handler. Its exact model is defined separately.

## Architectural Thesis

Application-layer choreography is Arvo's universal composition model.

A node may represent a simple handler, a deterministic workflow, an imperative or nondeterministic process, an AI agent, a human participant, or an external system. External participants may act as conceptual nodes through a declared ArvoContract boundary, but Arvo does not model or control their internals.

Orchestration is supported as **orchestrated choreography**. A coordinating node may direct or combine the work of other nodes, but it remains an ordinary participant. It communicates through ArvoEvents governed by declared ArvoContracts and receives no privileged, out-of-band control path.

Every inter-node interaction must be represented within the portable application model as an ArvoEvent. Physical transports and internal execution mechanisms may differ. Infrastructure adapters may use platform-native capabilities internally, including optimizations, provided they do not bypass or change the portable application model.

### Composition Closure

Composition is closed: any set of composed nodes can itself be presented as a single node behind one ArvoContract. Composition and decomposition are both first-class and reversible. Several nodes may converge into one, and one node may bifurcate into several, as domain understanding, ownership, scaling, or reuse requires. Arvo makes every boundary legal and prescribes none; where to place a node boundary is an application design decision.

Closure is what allows choreography semantics to hold at any scale. The same composition model applies to a single handler, a coordinating node, and a sealed subgraph of arbitrary depth, so a growing system does not require a second paradigm at subsystem boundaries.

Two limits follow. A handler's declared event capabilities are boundary-local: they describe one hop, not the transitive effects of everything behind a sealed node. And reversibility is bounded. Decomposition behind a sealed boundary is transparent to callers, while convergence is transparent only where no external participant addressed the inner contracts.

## Core Concepts

Arvo is founded on three primary concepts.

### ArvoEvent

An ArvoEvent is a JSON-serializable event used for communication between Arvo nodes. Every ArvoEvent must be transformable into a CloudEvent for standards-based interoperability. Transformability is a binding capability of AAM 1; whether the transformation is lossless and bidirectional is determined by the ArvoEvent ADR.

The exact ArvoEvent model, self-description semantics, validation rules, lineage fields, observability fields, and CloudEvent transformation semantics are defined in the dedicated ArvoEvent ADR.

### ArvoContract

An ArvoContract is a versioned capability and interface declaration for a node. It describes the events a node may accept and emit, providing the boundary through which independently implemented participants compose.

An ArvoContract is not a participant registry, deployment descriptor, routing configuration, or concrete implementation. A node depends on contracts rather than knowledge of the participants implementing them. Discovery and routing are infrastructure responsibilities.

An ArvoEventHandler must declare its complete ArvoContract capability set as part of its handler definition, before any execution instance begins. Every Arvo event type it may emit must be permitted by its implemented contract or one of its declared contract dependencies. An active execution instance cannot add undeclared Arvo event capabilities.

This static capability boundary makes the handler's possible event-driven effects explicit and predictable without making its behaviour deterministic. Arvo does not prescribe which permitted events a handler emits, their sequence or frequency, or the reasoning that leads to them.

Within an execution slice, Arvo does not constrain a handler's internal computation or its use of implementation dependencies. No live implementation dependency must be relied upon to survive a suspension boundary; resumable state semantics are defined separately. Implementation dependencies do not expand a handler's declared Arvo event capabilities.

The exact contract model and compatibility rules are deferred to dedicated ADRs.

### ArvoEventHandler

An ArvoEventHandler is a resumable application-layer component that implements one ArvoContract and declares the ArvoContract dependencies with which it may interact. It can emit permitted events, await results when required, and later continue its work.

An ArvoEventHandler's logical execution may span multiple event deliveries and infrastructure executions. It must not require one continuously running process while awaiting further events. The mechanism for representing, persisting, restoring, and migrating handler state is defined separately.

The presence of a contract does not guarantee that a participating implementation is currently available. Infrastructure is responsible for routing. Non-delivery may occur, and its detection requires an explicit expectation, deadline, or adapter capability.

The exact execution, state, suspension, resumption, concurrency, and recovery semantics are defined in dedicated ArvoEventHandler ADRs.

## Invariants

These are normative. Changing one is an architectural change and requires a superseding ADR.

### Infrastructure Independence

The portable application model must not depend on a particular broker, persistence implementation, hosting platform, scheduler, workflow engine, or delivery mechanism selected by an infrastructure adapter. Handler-declared implementation dependencies remain permitted and may impose their own deployment requirements.

The handler interfaces and lifecycle semantics defined by the portable application model must remain portable across infrastructure adapters that support the required execution capability profile. Arvo does not guarantee portability of a handler's internal implementation logic; that depends on its runtime and declared implementation dependencies. The capability-profile model and adapter conformance requirements are defined separately.

### Event-Only Communication

Inter-node interactions must be represented within the portable application model as ArvoEvents governed by ArvoContracts. No node, including a coordinating node, may rely on a privileged communication or control mechanism that is absent from the portable application model.

Direct calls to databases, APIs, libraries, and other implementation dependencies are permitted, but they remain outside the portable application model and cannot be used as resumable inter-node interactions. If an external system participates as an Arvo node, its interactions with other nodes remain subject to the portable application model.

Physical transports and infrastructure execution mechanisms need not themselves be event-native if they preserve the corresponding Arvo event semantics.

### Dynamic, Decentralized Composition

Arvo imposes no architectural limit on composition depth, graph topology, participant implementation, or infrastructure boundaries. Practical resource and operational limits remain the responsibility of the selected infrastructure.

The complete application graph does not need to be known or represented by any participant.

### Infrastructure-Independent Protocol Semantics

Arvo does not impose deterministic execution on application logic. However, the meaning of ArvoEvents, ArvoContracts, validation outcomes, compatibility rules, and protocol transitions within the portable application model must not change according to the selected infrastructure adapter.

Deterministic, imperative, nondeterministic, human-driven, and agentic handlers are valid participants. An infrastructure adapter may impose additional constraints, but those constraints are not requirements of the portable application model.

### Explicit Contracts and Runtime Validation

Nodes compose through explicit, versioned contracts. The portable application model requires runtime validation at defined trust boundaries. Compile-time types improve developer experience but cannot establish validity across independently deployed, external, or cross-language participants.

Dedicated ADRs define the validation boundaries and failure representations. Compile-time type safety does not replace runtime validation and must not prevent future cross-language participation.

### Observability by Default

The portable application model must preserve sufficient correlation, causation, lineage, and trace context to make distributed composition observable.

Collection, retention, and export remain infrastructure responsibilities. The exact observability model is deferred to a dedicated ADR. Adapters may attach additional telemetry as long as it does not change the portable application model.

### Explicit Failure Boundaries

Arvo distinguishes among:

- Event and protocol failures
- Handler and application failures
- Infrastructure and delivery failures

Detailed failure representations and recovery semantics are deferred to dedicated ADRs.

## Project Values

These describe current project policy. They may evolve without superseding this ADR and are not requirements for Arvo conformance.

### Standards-Based Interoperability

Arvo uses established standards where they provide suitable semantics rather than defining new ones. Standards commitments that bind the model, such as the CloudEvent transformability required of every ArvoEvent, are recorded as part of AAM rather than as project policy.

Arvo is TypeScript-first, with future support for other languages. The project avoids letting TypeScript implementation details become requirements of the portable application model; cross-language compatibility is addressed in a dedicated ADR.

### Developer Experience

Arvo prioritizes an approachable application-development experience. Strong opinions, validation, diagnostics, and type inference are used to reduce the effort required to build robust distributed and agentic systems, and compile-time type safety is provided as strongly as practical.

Minimal dependencies are preferred, but not at the expense of correctness, standards compliance, observability, or developer experience.

### Stable Evolution

`arvo-core` v4 is a deliberate architectural rebuild and is not constrained by compatibility with earlier major versions.

Compatibility guarantees for stable APIs, event representations, contracts, persisted state, and adapter interfaces will be defined separately before v4 is declared stable.

## Delivery Assumptions

Arvo applications must be designed for delivery environments in which the following may occur:

- Duplicate events
- Delayed events
- Reordered events
- Non-delivery
- Concurrent delivery
- Replayed events

Arvo provides common identifiers, metadata, protocol semantics, and extension interfaces through which applications and adapters can detect and respond to these conditions where detection is possible. It does not prescribe one universal handling policy.

Non-delivery can be detected only where an explicit expectation, deadline, or adapter capability makes detection possible. This ADR does not require one universal delivery guarantee from all infrastructure adapters. Adapter conformance levels, idempotency, replay, and delivery semantics are defined separately.

## Responsibility Boundaries

Arvo is strongly opinionated about:

- Event and contract semantics
- Runtime validation
- Communication boundaries
- Composition and lineage
- Resumable application components
- Observability
- Error categorization
- The portable application model

Arvo is deliberately unopinionated about:

- Message brokers and event delivery products
- Databases and persistence technologies
- Hosting and deployment platforms
- Scheduling systems
- Service discovery implementations
- Execution and orchestration engines
- Infrastructure topology

Arvo defines interfaces and primitives through which integrations with current and future infrastructure can be built. It is not limited to any named platform or category of execution engine.

## Security and Trust

Arvo includes structural and protocol validation, but successful validation does not establish identity, authenticity, authorization, confidentiality, tenant isolation, or trust.

Applications and infrastructure adapters are responsible for supplying these properties. Dedicated ADRs may define interoperable security interfaces without making one security infrastructure part of the portable application model.

## Non-Goals

Arvo is not:

- A workflow or orchestration engine
- A message broker or event transport
- A database or state store
- A scheduler
- A hosting or deployment platform
- A service discovery system
- A complete representation or controller of an application's graph
- A prescription of where node boundaries belong within an application

Arvo does not guarantee that a contract implementation exists, that an event will be delivered, or that all infrastructure adapters provide identical operational guarantees.

Arvo defines resumable handler lifecycle semantics, but infrastructure adapters implement durable execution, persistence, scheduling, and recovery. Defining those semantics does not make Arvo an execution engine.

## Considered Alternatives

### Conventional Orchestration Engine

Rejected because Arvo does not seek to own execution, persistence, scheduling, or the complete application graph. Doing so would duplicate established platforms and couple application behaviour to an Arvo runtime.

### Workflow-Engine Abstraction Layer

Rejected because reducing multiple engines to one common API would create a lowest-common-denominator engine abstraction. Arvo instead defines a portable application model and allows adapters to use infrastructure capabilities internally.

Execution capability profiles do not normalize infrastructure APIs or guarantees. They declare handler requirements so that an adapter can determine whether it supports a handler without changing the portable application model.

### Pure Event Protocol

Rejected because an event envelope alone does not provide contracts, resumable component composition, validation, developer tooling, or a coherent application programming model.

### Broker-Centric Framework

Rejected because brokers are delivery infrastructure. Making broker concepts part of the portable application model would undermine infrastructure independence.

### Independent Utility Library

Rejected because disconnected event, validation, and telemetry utilities would not establish the architectural invariants required by the portable application model.

## Consequences

### Benefits

- Composition is closed, so a subgraph can be sealed behind one contract and domain or team boundaries can be drawn and redrawn without rearchitecting.
- Node granularity is a reversible design decision rather than an architectural commitment; getting boundaries wrong early is cheap in both directions.
- Reuse is of contract-addressed running capabilities rather than packages, enabling cross-team and cross-language reuse without bindings or a shared runtime.
- The portable application model remains consistent across infrastructure adapters that support the required execution capability profile.
- Declared contract boundaries make every handler's possible Arvo event effects explicit while allowing its internal behaviour to remain nondeterministic.
- Deterministic and nondeterministic components can participate in one application model.
- Human and external participation does not require a separate composition paradigm.
- Contracts and runtime validation support independently deployed and cross-language participants.
- Event-represented composition preserves infrastructure-independent behaviour within the portable application model.
- New execution technologies can integrate without redefining the portable application model.

### Costs and Trade-offs

- Arvo applications may have fewer engine-specific conveniences than applications written directly against a particular platform.
- The portable application model may not expose every proprietary guarantee or optimization.
- Portability of handler implementation logic depends on its runtime and declared implementation dependencies.
- Changing a handler's Arvo event capability set requires changing its handler definition and may require contract versioning and redeployment. Active executions cannot acquire new Arvo event capabilities dynamically.
- Arvo does not prescribe where node boundaries belong. Granularity is an unguided design decision and can be wrong in either direction.
- Declared event capabilities are boundary-local, so system-wide effect analysis requires traversing the graph rather than reading one contract.
- Convergence across a boundary whose inner contracts have external consumers is a breaking change for those consumers.
- Merging nodes unions their execution capability profiles and coarsens failure, retry, and lineage granularity.
- Adapters carry significant responsibility for correctly mapping infrastructure behaviour to Arvo semantics.
- Event-driven distributed applications must account for delivery uncertainty and partial failure.
- Strong runtime validation and observability introduce implementation and execution overhead.
- A decentralized graph can be more difficult to understand operationally, making high-quality lineage and telemetry essential.

These trade-offs are accepted. Arvo prioritizes the portable application model and composability over maximum exploitation of any single infrastructure platform.

## Deferred Decisions

The following require dedicated ADRs or specifications:

- ArvoEvent structure, self-description, and CloudEvent transformation, including whether that transformation is lossless and bidirectional
- ArvoContract structure, dependency declaration, event capabilities, resolution, and version compatibility
- ArvoEventHandler execution semantics
- Handler state serialization, persistence, migration, and recovery
- Handler concurrency and event-waiting patterns
- Cancellation, interruption, and compensation semantics
- Timers, deadlines, scheduling, and time semantics
- Delivery ordering scope and concurrent event handling
- Handler execution capability profiles
- Formal definition and boundaries of an Arvo application
- Observability fields and propagation
- Event, application, and infrastructure failure models
- Delivery guarantees, replay, deduplication, and idempotency
- Infrastructure adapter interfaces and conformance
- Security and trust integration
- Cross-language protocol compatibility

## Applying This ADR

Every downstream ADR must state:

- what it adds to, refines, or excludes from the portable application model;
- which invariants it depends on or strains;
- what it requires of infrastructure adapters;
- what it leaves deferred.

The membership lists in the **Arvo Application Model (AAM)** definition are exhaustive as of this ADR. A downstream ADR that places a new concern inside or outside the model amends those lists by explicit reference. Concerns listed under **Deferred Decisions** have undetermined membership until the relevant ADR decides it; their absence from the lists is not exclusion.

### Standing Constraints

Deferred decisions must preserve the following:

- Durable records may carry node identity, but must not depend on it for continued correctness where a boundary refactor would invalidate that identity. Contract identity and execution identity must remain stable across composition and decomposition, so that lineage, persisted handler state, and external correlation survive a boundary change. Reversible composition depends on this.
- Execution capability profiles must compose, because a sealed node's profile derives from the profiles of its members.
- Contract compatibility rules determine how much internal change a sealed boundary can absorb, and therefore whether reversible composition holds in practice.

## Governance

Accepted ADRs and feature specifications must conform to this decision. A later decision that conflicts with this ADR must identify the conflict explicitly and supersede the affected principle or this ADR as a whole.

This repository is the canonical source of Arvo ecosystem ADRs until a dedicated architecture repository supersedes it. Ecosystem repositories must reference these records rather than maintain independent copies.

This ADR must be marked **Accepted** only after review confirms that it accurately describes the Arvo Application Model rather than the incidental details of any one implementation of it.
