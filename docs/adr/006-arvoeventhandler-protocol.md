# ADR-006: ArvoEventHandler Protocol

- **Status:** Proposed
- **Date:** 2026-09-14
- **Scope:** Arvo ecosystem
- **Amends:** AAM 1 membership (ADR-000)
- **Supplies:** the `executionid` derivation and the incoming-event classification that [ADR-001](./001-arvoevent-structure.md) leaves to "the handler protocol ADR"; the conditions for routing a failure to the workflow root remain deferred (see **Left deferred**)
- **Addresses, in part:** ADR-000 Deferred Decisions — "ArvoEventHandler execution semantics" (settled here); "Handler state serialization, persistence, migration, and recovery" (settled here, migration by prohibiting it); "Handler concurrency and event-waiting patterns" (settled here); "Cancellation, interruption, and compensation semantics" (decided here by splitting it — see **Conformance to ADR-000**). [ADR-005](./005-arvocontract-structure.md) **Left deferred** — "dependency declaration, capability resolution, and binding", "a handler's own runtime decision of which permitted event to emit and when", and "domain resolution, inheritance, and any orchestration-context-dependent routing strategy" (all settled here)
- **Left deferred:** timers, deadlines, and scheduling; the conditions for routing a failure to the workflow root; any bound on fan-out; execution capability profiles as a format; error kinds beyond handler failure. The full list is under **Conformance to ADR-000**

Conformance language is as defined in [ADR-000](./000-arvo-system-identity-and-architectural-principles.md).

## Scope

### What this ADR defines

This ADR defines what an **ArvoEventHandler** is and how one is entered, resumed, and completed. It settles how a handler declares the contracts it implements and depends on, how an execution is identified, what an execution durably remembers, how an incoming event is classified and checked before any business code runs, how outstanding responses are collected, how deep a handler will go before it stops calling out, how failure is categorized and retried, how an executor's dependencies reach it, how an execution stops itself, and what a handler requires of whatever runs it.

It defines the handler as a **pure function of a delivered event, a prior execution record, its resolved dependencies, and which attempt this delivery is**, returning emitted events and the next execution record. The handler holds nothing between deliveries and reaches no store.

Two parties appear throughout, and the ADR keeps them apart. The **handler** is the protocol layer this ADR specifies: it validates, classifies, addresses, records, and constructs every event. The **executor** is the business code a handler runs for one version of its contract: it reads what the handler gives it, asks for events to be emitted, and may fail. Everything between one delivery and the next belongs to a third party, the **mechanism** that runs the handler, and this ADR states what the handler requires of it without saying how it is built.

### What this ADR deliberately does not define

- **Any particular durable mechanism.** This ADR states obligations a mechanism must meet. It names no broker, database, transaction, outbox, lock implementation, or scheduler, and requires no specific one.
- **Native API shape.** Per [ADR-004](./004-multi-language-implementation-governance.md), how a language exposes handler declaration, the execution context, or emission is that language's own choice. This ADR fixes semantics and the field names of the two objects that leave the process — the execution record and the fault — not method names or type names.
- **Migration of an execution record.** Not deferred — decided against. An execution record belongs to one contract version for its whole life and MUST NOT be moved to another (see **Version authority**).
- **Timers, deadlines, and scheduling.** ADR-000 defers these, and this ADR invents no semantics for them. It does assign the responsibility: following up on an execution that is waiting on something that never arrives belongs to whatever runs the handler (**Retry**, **Collection**).
- **Cancellation as something one node does to another.** Decided against rather than deferred. Arvo defines no cancel event and no interruption mechanism: nothing can stop an execution that does not stop itself. What the model does provide is the means to cancel *cooperatively* — a hook for reading an application's own signal (**Dependencies**), and a terminal `cancelled` lifecycle so a record says why an execution ended (**Cancellation**). Compensation stays entirely an application's own concern, expressed through events its contracts already permit. This amends ADR-000's Deferred Decision by explicit reference.
- **Execution capability profiles.** ADR-000 defers their model. This ADR states the concrete requirements a handler places on a mechanism (**Required of infrastructure adapters**) without proposing the profile format that would carry them.
- **Error taxonomy beyond handler failure.** As in ADR-005, exactly one standardized emit is in play — the handler error event. This ADR adds the non-event failure category an execution can be in, and no further error kinds.
- **A bound on fan-out.** The record grows with the number of responses an execution awaits, and this ADR names the cost without capping it (see **Hydration**).

### How this ADR changes

Once accepted, this protocol changes only by a superseding ADR. Two parts of it are pinned more tightly than the rest and are named here so a reader knows what a supersession would have to touch: the derivation of `execution_id`, where any change alters every identifier every implementation derives; and the field names of the execution record and the fault, where any change reinterprets data already in a store.

## Context

### What ADR-000 named and deferred

ADR-000 names **ArvoEventHandler** a first-class AAM concept — "a resumable component that implements one contract, declares the contracts it depends on, emits permitted events, awaits results, and later continues" — and places "handler interfaces and lifecycle semantics" inside the model. It then defers almost everything about how that works: execution semantics, state persistence and recovery, concurrency and event-waiting, cancellation, timers, and capability profiles each appear on its Deferred Decisions list as a separate item requiring its own ADR.

Two of its invariants bear directly on the shape any answer can take. *Event-Only Communication* forbids a node from relying on a control mechanism absent from the model, so whatever a handler does must be expressible as events governed by contracts. And its statement on suspension is exact: "no live implementation dependency may be relied upon to survive one", and a handler "must not require a continuously running process while awaiting events".

### What ADR-001 through ADR-005 settled

The five ADRs before this one have settled the things a handler operates on: what an event is and which field carries which role (ADR-001), the format each field must satisfy (ADR-002), how an event transforms to a CloudEvent and back (ADR-003), how a contract crosses a language boundary and what conformance means there (ADR-004), and what a contract is, how it is versioned, and the one standardized error event every version carries (ADR-005).

Nothing has yet said what happens when an event arrives. Every implementation has answered that privately, and the answers have not been the same twice — identity encoded into a structured subject in one generation, correlation left to an adapter in another. ADR-004 exists to prevent that kind of divergence across languages, and it cannot do so for behaviour no ADR has defined.

### Why resumability forces this decision

The pressure that makes this urgent is resumability. A handler that emits an event and later continues cannot be a running process holding a stack, because ADR-000 forbids relying on an implementation dependency across a suspension and forbids requiring a continuously running process while awaiting events. So continuation has to be reconstructed from durable data. That means the data has a shape, the shape has to be the same everywhere, and something has to guarantee it survives between one delivery and the next. Those are model concerns, not adapter concerns, and they are what this ADR settles.

The same pressure decides where the boundary sits. A handler that holds nothing between deliveries cannot know how much time has passed, whether a response is late, or whether this delivery is a retry — so everything that depends on time passing or on nothing happening has to be owned by whatever runs the handler. This ADR draws that line explicitly rather than leaving each mechanism to find it.

### What ADR-001 left to this ADR

ADR-001 anticipated this ADR in three places and left work for it explicitly: the derivation of `executionid` ("leaves the derivation itself to the handler protocol ADR", with the standing requirement that it be deterministic "so a redelivered trigger resolves to the existing execution rather than forking a new one"); how a handler classifies an incoming event and performs the `category` check ("How a receiver performs that check is the handler protocol ADR's"); and when it routes a failure to the workflow root. The first two are settled here. The third is not, for the reason given under **Failure protocol**. No assignment ADR-001 already made is disturbed.

ADR-005 likewise left "dependency declaration, event capabilities, resolution" — "how a handler declares, binds to, and is permitted to use a contract" — to this ADR, and left the meaning of a contract's `domain` at the point of use to "domain resolution, inheritance, and any orchestration-context-dependent routing strategy". Both are settled here, under **Definition and declaration** and **Addressing an emitted event**.

## Decision

### Definition and declaration

#### The self contract and the service contracts

An **ArvoEventHandler** implements exactly one ArvoContract — its **self contract** — and declares the set of contract versions it may send events to, its **service contracts**. Both are declared as part of the handler's definition, before any execution begins. This satisfies ADR-000's requirement that "a handler must declare its complete contract capability set as part of its definition, before any execution instance begins", and settles the "dependency declaration" ADR-005 left to this ADR: a dependency is a service contract at one declared version, and declaring it is the whole of binding to it.

The self contract is declared as a contract, not as a version. A handler implements every version of its self contract for which it declares an executor (see below), and an incoming event selects among them. A service contract is declared as **one contract at one version**, for the reason given under **No two versions of one service contract**.

#### One executor per version

A handler MUST declare one **executor** per version of its self contract that it implements. An executor is the business code that runs when an execution of that version is entered or resumed. Versions are fully isolated under ADR-005 — "no two versions are ever compatible by construction" — so an executor written against one version's declared shapes has no defined behaviour against another's, and a handler MUST NOT run a version's executor over an execution that belongs to another version (see **Version authority**).

A handler need not implement every version its self contract declares. It MUST reject at declaration time an executor for a version the self contract does not declare.

#### The closed set of emittable events

The set of events a handler may emit is exactly:

- the input event type of each declared service contract, at its declared version;
- every key of its self contract version's `outputs`, for the version whose executor is running;
- its self contract version's handler error event.

An execution MUST NOT emit anything else, and MUST NOT acquire a capability not present in the declaration. This is the "static boundary" ADR-000 asks for, and it is what lets a mechanism determine what a handler may do before running it, and lets an implementation with a type system reject an impermissible emission before it is deployed.

The set is closed per version, not per handler. A handler with two versions has two such sets, sharing the service inputs and differing in the `outputs` keys and the handler error type.

#### What an executor may ask for

Of the three kinds of emittable event, **an executor may ask for the first two only.** It may request an event to a declared service, and it may request one of its own version's `outputs`. The handler error event is not something an executor constructs: the handler produces it, and only in response to the executor failing or to a condition the handler itself detects. An executor that could construct it could claim to have failed while continuing to run, and an executor that wants to say "I cannot do this" says so by failing. The causes are closed and listed under **Failure protocol**.

#### No two capabilities may share an event type

**No two capabilities in a handler's declared set may share an event type**, and a handler MUST be rejected at declaration time if any two do: a service input against another service's input, a service input against a key of its own `outputs`, or either against its handler error type.

ADR-005 forbids only the within-contract case — a version's `outputs` may not reuse the contract's own `type` or its handler error type — and is explicit that `type` is not unique across contracts: "no ADR claims `type` is unique across contracts — two unrelated contracts can already declare the identical ordinary `type`". Nothing prevents two capabilities a handler declares from colliding until this rule does.

The rule exists to make an emitted event's type sufficient to determine its destination. Under **Addressing an emitted event**, `to` is derived from the type an executor supplies; if two declared capabilities shared a type, the handler could not tell which contract the executor meant. It is checked once, at declaration, where the entire capability set is visible — the only place it can be checked, since no declaration site knows every contract in existence, and ADR-005 rejected a cross-contract naming rule for exactly that reason.

#### No two versions of one service contract

**A handler MUST NOT declare two versions of the same service contract.** Doing so is a declaration error and the handler MUST be rejected. Where a deployment nonetheless reaches a delivery with such a declaration, the delivery is a non-retryable fault (`service_version_conflict`, see **The `fault_kind` vocabulary**).

Two versions of one contract share a `type` — ADR-005 makes `type` a property of the contract, not of a version — so their input types collide and the rule above already rejects them. It is stated separately because the collision rule reads as being about unrelated contracts, and this is the case an author is most likely to reach for deliberately: wanting to call an old and a new version of the same service from one handler. That is two dependencies on one contract, and the model has no way to tell their responses apart. A response's `dataschema` names the service's version, and **Entry validation** checks it against the one version the handler declared; with two declared there would be nothing to check against.

#### Optional business state schema

An executor MAY declare a schema for business state it wishes to remember between deliveries. Where declared, it governs the `data` field of the execution record (see **The execution record**) and is composed into the record's validation at every entry (see **Hydration**).

An executor that declares none is still resumable — it may emit to a service and be re-entered on the response — and still has an execution record. It simply has nothing of its own in it. Resumability is a property of the protocol, carried by the record's own fields; business state is what an executor adds to that, and it is optional.

### Execution identity

#### The three identifying values

#### The derivation of `execution_id`

#### Why every part of the derivation is pinned

#### Properties that follow

#### The residual case: two handlers on one contract version

#### The root case

#### Depth of this execution

### Addressing an emitted event

#### The handler constructs every event

#### The two destination roles

#### The complete field defaults

#### `initid`

#### `source` and `to`

#### Domain

#### A root event must carry `to`

#### Record keys and grouping

#### `init_event_id` and `init_event_source`

#### What an executor may set: safe, unsafe, required

#### What "unsafe" means

### Observability

#### Continuing the trace

#### The executor's access to the trace

#### Instrumenting the protocol itself

### Classification

#### Init or followup, nothing else

#### `dataschema` decides it

#### `category` cross-checks it

#### Resolving the existing execution

#### Matching a response by `initid`

### Entry validation

#### The gate

#### Three ways out: proceed, discard, fault

#### Resolution, and which executor runs

#### Why step 1 is first

#### Why resolution comes second

#### Why the duplicate check precedes the lifecycle check

#### Why an idle record admits a followup

#### Every fault names every failed check

#### One execution is atomic

#### What the gate asks of a mechanism

### Depth

#### An execution-level guard, not an event constraint

#### The two options and their defaults

#### Checked on emission, not on delivery

#### One violating event rejects the whole batch

#### The executor can see it coming

#### On a violation: the three choices

#### The `violation` description

#### What a violation function may return

#### A violation function must not be able to fail

#### Recording the reason

### The execution record

#### One record, representable as JSON

#### The fields

#### `direction`: received or emitted

#### `contracts` is informational only

#### `lifecycle`: where an execution rests

#### The six lifecycle values

#### Marking an execution `cancelled`

#### `lifecycle_description`

#### Emitting nothing: `waiting` or `idle`

#### `idle` is legal and almost always a defect

#### How this record may change later

#### `cas_version`

#### Version authority

#### A record belongs to one version for its whole life

#### Removing a version strands its executions

#### Hydration

#### The cost of eager hydration

#### Serializability of `data`

### Retry

#### A handler cannot retry itself

#### Every delivery carries its attempt number

#### Retry information travels on the fault

#### Attempts count from zero

#### Why the fault is the only place this can live

#### No exhaustion flag, no cross-delivery total

#### Units: milliseconds throughout

#### The two retry options and their defaults

#### `retry delay` must not be able to fail

#### Exhaustion ends retrying

#### An exhausted execution ends at `failure`

#### Every retry re-reads the record

#### What else the runner owns

### Collection

#### Recording emissions as outstanding

#### The default: join on all

#### The per-version override: enter on each

#### The map is rebuilt, not merged

#### A response is processed only if awaited

#### Duplicate versus unawaited

#### A service that never responds

### Failure protocol

#### The two categories

#### Execution fault

#### Handler error

#### The single test: was anything concluded?

#### Handler error: the event and the terminal lifecycle

#### The three causes, and the set is closed

#### An executor never constructs the handler error event

#### The narrow exception: an executor raising a fault

#### The fault object

#### What is normative in the fault object

#### Why the name is fixed

#### `cause` and `violations`

#### `attempt` and `timestamp`

#### The `fault_kind` vocabulary and retry verdicts

#### Abandonment: the contingency a fault carries

#### The pair is what an ordinary delivery returns

#### Acted on only when a mechanism gives up

#### The handler builds both, the mechanism composes neither

#### `abandonment_state`

#### Each attempt builds its own pair

#### When each is present, and why they differ

#### `lifecycle_terminal` yields neither

#### What the abandonment event carries

#### No failure routes to the workflow root

#### Where each category records its cause

#### The cost of an executor raising a fault

#### When to raise a fault and when to fail

#### The two names are kept distinct

### Dependencies

#### Outside the model, supplied per delivery

#### The two forms: a value or a factory

#### Why the factory form matters for resumability

#### A failing factory is a retry-safe fault

### Cancellation

#### Nothing cancels an execution but itself

#### What the model provides

#### The cooperative pattern

#### Scope is the application's choice

#### What cooperative means

## Consequences

### Gained

### Paid for

## Considered Alternatives

### Deriving the per-execution identifier into `subject`

### Letting an executor return events it built itself

### Naming a destination on each emission

### Entering the executor on every response by default

### Merging into `in_flight_event_map` on emission

### Reporting a handler failure as a fault

### Letting a mechanism compose the abandonment event

### Leaving abandonment publication to the mechanism's discretion

### Keeping the revision outside the record

### Defining cancellation as a model primitive

### Defining a migration path for an execution record

### Requiring a specific concurrency mechanism

## Conformance to ADR-000

### Effect on AAM

### Invariants depended on

### Invariants strained

### Required of infrastructure adapters

### Left deferred

## Appendix: An illustrative handler surface

### Declaring a handler

### Inside an executor

### What the mechanism calls
