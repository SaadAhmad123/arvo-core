# ADR-000: Arvo System Identity and Architectural Invariants

- **Status:** Proposed
- **Date:** 2026-07-31
- **Scope:** Arvo ecosystem
- **Defines:** Arvo Application Model (AAM) 1

**must** is a requirement for Arvo conformance. **should** is a recommendation departable with documented justification. **may** is a permitted choice. Sections marked non-normative bind nothing.

## Context

Application logic has stopped being one kind of thing. A single business process now routinely spans deterministic code, a nondeterministic agent, a human who answers in three days, and an external system nobody controls. Operationally these have almost nothing in common — different latencies, different failure modes, different notions of correctness.

Every available model makes one of them the first-class citizen and the rest exceptions. Durable execution platforms model deterministic workflows well and treat agents and humans as escapes from the model. Agent frameworks invert it. Plain choreography treats all participants equally and then offers no way to see or manage the process once it passes a few dozen nodes. So teams compose across paradigms — an engine here, a queue there, a task table for the humans — and the seams are where these systems actually fail.

Boundaries also harden. Where a service boundary lands early is where it stays, because the service boundary is also the deployment boundary and the codebase boundary. Domain understanding arrives late, and by then moving a boundary costs a rewrite.

And whichever engine is adopted to solve the first problem, the application's composition semantics become that engine's semantics.

Arvo needs a composition model that treats all of these participants as the same kind of thing, lets boundaries move as understanding improves, and encodes no single engine's execution model.

The motivating thesis and the conditions under which it fails are set out in [the vision document](../vision.md). This ADR records the commitments that follow from it.

## Decision

Arvo is a portable, language-independent application model for event-driven systems. This ADR defines its first version, **AAM 1**. Arvo does not execute the model; infrastructure adapters do. Implementations of it, such as `arvo-core`, are lightweight and opinionated.

An Arvo application is a dynamic graph of independently participating nodes. Nodes compose only through ArvoEvents governed by declared ArvoContracts. The graph emerges from contracts, participants, and emitted events; no participant needs to know it in full.

Three claims answer the three problems above, and the rest of this ADR exists to support them.

**Choreography is the universal composition model.** A node may be a handler, a deterministic workflow, an imperative or nondeterministic process, an AI agent, a human, or an external system reached through a declared contract boundary. None of them is an exception to the model. Orchestration is supported as *orchestrated choreography*: a coordinating node may direct or combine the work of others, but it remains an ordinary participant with no privileged, out-of-band control path.

**Composition is closed.** Any set of composed nodes can itself be presented as a single node behind one ArvoContract. Composition and decomposition are both first-class and reversible — several nodes converge into one, one node bifurcates into several, as domain understanding, ownership, scaling, or reuse requires. Closure needs no additional primitive: a sealed subgraph is an ArvoEventHandler implementing the outer contract and declaring the inner contracts as dependencies, indistinguishable from any other node from outside. This is what allows choreography semantics to hold at any scale, and it makes node granularity a reversible design decision rather than an architectural commitment.

Two limits follow. Declared event capabilities are boundary-local — one hop, not the transitive effects behind a sealed node. And reversibility is bounded: decomposition behind a boundary is invisible to callers, while convergence is invisible only where the absorbed contracts had no external consumers.

**The model is portable.** Composition and handler lifecycle semantics must not depend on the broker, database, platform, scheduler, or engine an adapter selects. Portability of a handler's *internal* logic is not claimed; that depends on its runtime and its own dependencies.

## Terminology

- **Node** — a participant that exposes or consumes capabilities through Arvo contracts. A node may be implemented by an ArvoEventHandler, a human participant, an external system, or a composition of nodes presented behind a single contract.
- **Handler** — an application-layer implementation of a node. An ArvoEventHandler implements one ArvoContract, declares its contract dependencies, and may continue its logical execution across multiple event deliveries and infrastructure executions.
- **Implementation dependency** — a database, API, library, model provider, or other resource used internally by a node without participating in the model.
- **Infrastructure adapter** — an integration binding the model to execution, delivery, persistence, scheduling, or discovery.
- **Execution slice** — one active period of handler execution, from receiving or resuming on an event until the handler completes, fails, or suspends awaiting another.
- **Execution capability profile** — the runtime capabilities a handler declares it requires. Its model is deferred.

### Arvo Application Model (AAM)

Arvo's versioned, language-independent portable application model, defined by this ADR and its descendants. AAM versions are distinct from the versions of any package implementing them; `arvo-core` v4 is the first TypeScript implementation of AAM 1. *Portable application model* is used descriptively for the same thing.

Inside the model — meaning must remain consistent across supporting adapters:

- ArvoEvent identities, data, and CloudEvent transformability
- ArvoContract identities, versions, and declared event capabilities
- inter-node interactions
- causation, lineage, and trace context
- handler interfaces and lifecycle semantics
- execution capability requirements
- validation and compatibility semantics
- failure categories

Outside the model:

- physical transport and protocol bindings
- persistence technology and scheduling implementation
- retry counts, batching, and other adapter-internal behaviour
- telemetry collection, retention, and export
- handler implementation dependencies

## Core Concepts

**ArvoEvent** — a JSON-serializable event exchanged between nodes. Every ArvoEvent must be transformable into a CloudEvent; transformability binds AAM 1, while whether the transformation is lossless and bidirectional is settled by the ArvoEvent ADR.

**ArvoContract** — a versioned capability and interface declaration describing the events a node accepts and emits. It is the boundary through which independently implemented participants compose. It is not a registry, deployment descriptor, routing configuration, or implementation; discovery and routing belong to infrastructure.

**ArvoEventHandler** — a resumable component that implements one contract, declares the contracts it depends on, emits permitted events, awaits results, and later continues.

A handler must declare its complete contract capability set as part of its definition, before any execution instance begins. Every event type it may emit must be permitted by its own contract or a declared dependency, and an active execution cannot add undeclared capabilities. This static boundary makes a handler's possible event-driven effects explicit without making its behaviour deterministic — Arvo does not prescribe which permitted events it emits, in what order, how often, or on what reasoning.

Within an execution slice, Arvo does not constrain internal computation or use of implementation dependencies. Across a suspension boundary it does: no live implementation dependency may be relied upon to survive one. A handler's logical execution may span many deliveries and infrastructure executions, and must not require a continuously running process while awaiting events.

The presence of a contract does not guarantee an available implementation. Non-delivery may occur, and detecting it requires an explicit expectation, deadline, or adapter capability.

## Invariants

Normative. Changing one is an architectural change requiring a superseding ADR.

**Infrastructure Independence.** The model must not depend on a particular broker, persistence implementation, hosting platform, scheduler, engine, or delivery mechanism. The meaning of events, contracts, validation outcomes, compatibility rules, and protocol transitions must not vary by adapter. Handler-declared implementation dependencies remain permitted and may impose their own deployment requirements. An adapter may impose additional constraints, but those constraints are not requirements of the model.

**Event-Only Communication.** Inter-node interactions must be represented in the model as ArvoEvents governed by ArvoContracts. No node, coordinating or otherwise, may rely on a control mechanism absent from the model. Direct calls to implementation dependencies are permitted but sit outside the model and cannot serve as resumable inter-node interactions. Transports need not be event-native provided they preserve the corresponding Arvo event semantics.

**Open Composition.** Arvo imposes no architectural limit on composition depth, topology, participant implementation, or infrastructure boundaries, and no participant is required to know the complete graph. Practical limits belong to the selected infrastructure.

**Explicit Contracts and Runtime Validation.** Nodes compose through explicit, versioned contracts, and the model requires runtime validation at defined trust boundaries. Compile-time types cannot establish validity across independently deployed, external, or cross-language participants, must not replace runtime validation, and must not preclude cross-language participation.

**Nondeterminism Is Permitted.** Arvo does not impose deterministic execution on application logic. Deterministic, imperative, nondeterministic, human-driven, and agentic handlers are all valid participants.

**Observability by Default.** The model must preserve sufficient correlation, causation, lineage, and trace context to make distributed composition observable. Collection, retention, and export are infrastructure responsibilities; adapters may add telemetry provided it does not change the model.

**Explicit Failure Boundaries.** Arvo distinguishes event and protocol failures, handler and application failures, and infrastructure and delivery failures. Representations and recovery semantics are deferred.

## Delivery Assumptions

Applications must be designed for environments producing duplicate, delayed, reordered, replayed, concurrent, or undelivered events. Arvo provides identifiers, metadata, protocol semantics, and extension points through which applications and adapters can detect and respond to these conditions where detection is possible; it prescribes no single handling policy and requires no single delivery guarantee from every adapter.

## What Arvo Is Not

Arvo is not a workflow or orchestration engine, a message broker or transport, a database or state store, a scheduler, a hosting platform, a service discovery system, a complete representation or controller of an application's graph, or a prescription of where node boundaries belong.

It defines resumable handler lifecycle semantics; adapters implement durable execution, persistence, scheduling, and recovery. Defining those semantics does not make Arvo an execution engine.

It does not guarantee that a contract has an implementation, that an event will be delivered, or that adapters offer identical operational guarantees.

It validates structure and protocol semantics, but successful validation establishes no identity, authenticity, authorization, confidentiality, tenant isolation, or trust. Those are supplied by applications and adapters; later ADRs may define interoperable security interfaces without making one security infrastructure part of the model.

## Project Values

Non-normative. Current policy, revisable without superseding this ADR.

Arvo prefers established standards to invented ones; commitments that bind the model, such as CloudEvent transformability, are recorded as part of AAM rather than here. Arvo is TypeScript-first with future support for other languages, and avoids letting TypeScript details become model requirements. It prioritizes an approachable development experience — strong opinions, validation, diagnostics, and type inference as strong as practical. Minimal dependencies are preferred, though not at the expense of correctness, standards compliance, observability, or developer experience. `arvo-core` v4 is a deliberate rebuild unconstrained by earlier majors; compatibility guarantees for stable APIs, event representations, contracts, persisted state, and adapter interfaces will be defined before it is declared stable.

## Considered Alternatives

**A conventional orchestration engine** — rejected; owning execution, persistence, scheduling, and the whole graph duplicates established platforms and couples application behaviour to an Arvo runtime.

**A workflow-engine abstraction layer** — rejected; reducing engines to one common API produces a lowest-common-denominator abstraction. Capability profiles are not that: they declare what a handler requires so an adapter can determine whether it can run it, without normalizing infrastructure APIs or guarantees.

**A pure event protocol** — rejected; an envelope alone provides no contracts, no resumable composition, no validation, and no coherent programming model.

**A broker-centric framework** — rejected; brokers are delivery infrastructure, and making broker concepts part of the model would undermine independence.

**A collection of utilities** — rejected; disconnected event, validation, and telemetry helpers establish none of the invariants portable composition requires.

## Consequences

Gained:

- A subgraph can be sealed behind one contract, so domain and team boundaries can be drawn and redrawn without rearchitecting, and getting them wrong early is cheap in both directions.
- Reuse is of contract-addressed running capabilities rather than packages, which makes cross-team and cross-language reuse possible without bindings or a shared runtime.
- Deterministic components, nondeterministic agents, humans, and external systems participate in one composition model with no second paradigm and no seams between paradigms.
- Declared boundaries make a handler's possible event effects explicit while leaving its internals free.
- New execution technologies integrate without redefining the model.

Paid for:

- Fewer engine-specific conveniences than writing directly against a platform, and no exposure of every proprietary guarantee or optimization.
- Boundary placement is unguided; granularity can be wrong in either direction.
- Effect visibility is boundary-local, so system-wide effect analysis means traversing the graph rather than reading one contract.
- Convergence across a boundary whose inner contracts have external consumers breaks those consumers.
- Merging nodes unions their capability profiles and coarsens failure, retry, and lineage granularity.
- Contract-addressed reuse presumes discoverable participants, and discovery is an infrastructure concern Arvo does not provide.
- Changing a handler's capability set means changing its definition, possibly versioning its contract, and redeploying.
- Adapters carry heavy responsibility for mapping infrastructure behaviour to Arvo semantics correctly.
- Runtime validation and observability cost throughput, and a decentralized graph is harder to reason about operationally, which makes lineage and telemetry quality essential rather than optional.

These are accepted. Arvo prioritizes portable, composable application semantics over maximum exploitation of any single platform.

## Deferred Decisions

Each requires a dedicated ADR:

- ArvoEvent structure, self-description, and CloudEvent transformation, including whether it is lossless and bidirectional
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

Every downstream ADR must state what it adds to, refines, or excludes from the model; which invariants it depends on or strains; what it requires of infrastructure adapters; and what it leaves deferred.

The AAM membership lists are exhaustive as of this ADR. A downstream ADR placing a new concern inside or outside the model amends them by explicit reference. Concerns under Deferred Decisions have undetermined membership until decided — their absence from the lists is not exclusion.

Three constraints bind those decisions:

- Durable records may carry node identity but must not depend on it for continued correctness where a boundary refactor would invalidate it. Contract identity and execution identity must survive composition and decomposition, so that lineage, persisted state, and external correlation survive a boundary change. Reversible composition depends on this.
- Execution capability profiles must compose, because a sealed node's profile derives from its members'.
- Contract compatibility rules determine how much internal change a sealed boundary can absorb, and therefore whether reversible composition holds in practice.

## Governance

Accepted ADRs and specifications must conform to this decision. A later decision that conflicts with it must name the conflict explicitly and supersede the affected invariant, or this ADR as a whole.

This repository is the canonical source of Arvo ecosystem ADRs until a dedicated architecture repository supersedes it; other repositories reference these records rather than copying them.

This ADR must be marked **Accepted** only after review confirms it describes the Arvo Application Model rather than the incidental details of any one implementation.
