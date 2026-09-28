# ADR-006: ArvoEventHandler Protocol

- **Status:** Proposed
- **Date:** 2026-09-28
- **Scope:** Arvo ecosystem
- **Amends:** AAM 1 membership (ADR-000)
- **Companions:** this ADR is the core of four that together specify the protocol. [ADR-007](./007-execution-record.md) defines the execution record, [ADR-008](./008-execution-faults-and-abandonment.md) the failure categories, the fault object and abandonment, and [ADR-009](./009-execution-bounds.md) depth, retry, timeouts and collection. They were written as one and split for size; where this ADR refers to a heading in one of them, the reference names the ADR
- **Supplies:** the `executionid` derivation and the incoming-event classification that [ADR-001](./001-arvoevent-structure.md) leaves to "the handler protocol ADR"; the conditions for routing a failure to the workflow root remain deferred (see **Left deferred**)
- **Addresses, in part:** ADR-000 Deferred Decisions — "ArvoEventHandler execution semantics" (settled here); "Handler state serialization, persistence, migration, and recovery" (settled in ADR-007); "Handler concurrency and event-waiting patterns" (settled in ADR-009); "Cancellation, interruption, and compensation semantics" (decided here by splitting it — see **Conformance to ADR-000**). [ADR-005](./005-arvocontract-structure.md) **Left deferred** — "dependency declaration, capability resolution, and binding", "a handler's own runtime decision of which permitted event to emit and when", and "domain resolution, inheritance, and any orchestration-context-dependent routing strategy" (all settled here)
- **Left deferred:** execution capability profiles as a format; domain sources beyond the minimum; derived emitted-event identifiers; delivery ordering across executions. The full list is under **Conformance to ADR-000**; each companion carries its own

Conformance language is as defined in [ADR-000](./000-arvo-system-identity-and-architectural-principles.md).

## Scope

### What this ADR defines

This ADR defines what an **ArvoEventHandler** is and how one is entered, resumed, and completed. It settles how a handler declares the contracts it implements and depends on and the options that govern its versions, what an executor sees through its execution context, how an execution is identified, how every emitted event is addressed, how a delivery is traced, how an incoming event is classified and checked before any business code runs, how an executor's dependencies reach it, how an execution stops itself, and what a handler requires of whatever runs it.

Three companions carry the rest, and this ADR is not complete without them. [ADR-007](./007-execution-record.md) defines the execution record — what an execution durably remembers, its lifecycle, and how a stored record is validated and restored. [ADR-008](./008-execution-faults-and-abandonment.md) defines how an execution fails — the two categories, the fault object, and abandonment. [ADR-009](./009-execution-bounds.md) defines the bounds a version places on its executions — depth, retry, timeouts and collection. The four were written as one and split for size; where this ADR refers to a heading in a companion, the reference names the ADR.

It defines the handler as a **stateless operation over a delivered event, a prior execution record, its resolved dependencies, and which attempt this delivery is**, returning emitted events and the next execution record. The handler holds nothing between deliveries and reaches no store. The executor it runs is not pure — it may call a database or a service through its dependencies — and what those calls do outside Arvo is the executor's own to make safe.

Two parties appear throughout, and the ADR keeps them apart. The **handler** is the protocol layer this ADR specifies: it validates, classifies, records, supplies the addressing for every event, and checks every event an executor returns. The **executor** is the business code a handler runs for one version of its contract: it reads what the handler gives it through a context, returns the events it wants emitted, and may fail. Everything between one delivery and the next belongs to a third party, the **mechanism** that runs the handler, and this ADR states what the handler requires of it without saying how it is built.

### What this ADR deliberately does not define

- **Any particular durable mechanism.** This ADR states obligations a mechanism must meet. It names no broker, database, transaction, lock implementation, or scheduler, and requires no specific one. Where it requires a behaviour — the outbox guarantee under **Required of infrastructure adapters**, obligation 1 — it requires the behaviour and not any implementation of it.
- **Native API shape.** Per [ADR-004](./004-multi-language-implementation-governance.md), how a language exposes handler declaration, the execution context, or emission is that language's own choice. This ADR fixes semantics and the field names of the two objects that leave the process — the execution record and the fault — not method names or type names.
- **Timers, deadlines, and scheduling.** ADR-000 defers these, and nothing in this ADR or its companions fires without a delivery. What this ADR does assign is the responsibility: following up on an execution that is waiting on something that never arrives belongs to whatever runs the handler ([ADR-009](./009-execution-bounds.md), **What else the runner owns**).
- **Cancellation as something one node does to another.** Decided against rather than deferred. Arvo defines no cancel event and no interruption mechanism: nothing can stop an execution that does not stop itself. What the model does provide is the means to cancel *cooperatively* — a hook for reading an application's own signal (**Dependencies**), and a terminal `cancelled` lifecycle so a record says why an execution ended (**Cancellation**). Compensation stays entirely an application's own concern, expressed through events its contracts already permit. This amends ADR-000's Deferred Decision by explicit reference.
- **Execution capability profiles.** ADR-000 defers their model. This ADR states the concrete requirements a handler places on a mechanism (**Required of infrastructure adapters**) without proposing the profile format that would carry them.

### How this ADR changes

Once accepted, this protocol changes only by a superseding ADR. Two parts of it are pinned more tightly than the rest and are named here so a reader knows what a supersession would have to touch: the derivation of `execution_id`, where any change alters every identifier every implementation derives; and, in its companions, the field names of the execution record (ADR-007) and the fault (ADR-008), where any change reinterprets data already in a store.

## Context

### What ADR-000 named and deferred

ADR-000 names **ArvoEventHandler** a first-class AAM concept — "a resumable component that implements one contract, declares the contracts it depends on, emits permitted events, awaits results, and later continues" — and places "handler interfaces and lifecycle semantics" inside the model. It then defers almost everything about how that works: execution semantics, state persistence and recovery, concurrency and event-waiting, cancellation, timers, and capability profiles each appear on its Deferred Decisions list as a separate item requiring its own ADR.

Two of its invariants bear directly on the shape any answer can take. *Event-Only Communication* forbids a node from relying on a control mechanism absent from the model, so whatever a handler does must be expressible as events governed by contracts. And its statement on suspension is exact: "no live implementation dependency may be relied upon to survive one", and a handler "must not require a continuously running process while awaiting events".

### What ADR-001 through ADR-005 settled

The five ADRs before this one have settled the things a handler operates on: what an event is and which field carries which role (ADR-001), the format each field must satisfy (ADR-002), how an event transforms to a CloudEvent and back (ADR-003), how a contract crosses a language boundary and what conformance means there (ADR-004), and what a contract is, how it is versioned, and the one standardized error event every version carries (ADR-005).

Nothing has yet said what happens when an event arrives. Every implementation has answered that privately, and the answers have not been the same twice — identity encoded into a structured subject in one generation, correlation left to an adapter in another. ADR-004 exists to prevent that kind of divergence across languages, and it cannot do so for behaviour no ADR has defined.

### Why resumability forces this decision

The pressure that makes this urgent is resumability. A handler that emits an event and later continues cannot be a running process holding a stack, because ADR-000 forbids relying on an implementation dependency across a suspension and forbids requiring a continuously running process while awaiting events. So continuation has to be reconstructed from durable data. That means the data has a shape, the shape has to be the same everywhere, and something has to guarantee it survives between one delivery and the next. Those are model concerns, not adapter concerns, and they are what this ADR and its companions settle.

The same pressure decides where the boundary sits. A handler that holds nothing between deliveries cannot know how much time has passed, whether a response is late, or whether this delivery is a retry — so everything that depends on time passing or on nothing happening has to be owned by whatever runs the handler. This ADR draws that line explicitly rather than leaving each mechanism to find it.

### What ADR-001 left to this ADR

ADR-001 anticipated this ADR in three places and left work for it explicitly: the derivation of `executionid` ("leaves the derivation itself to the handler protocol ADR", with the standing requirement that it be deterministic "so a redelivered trigger resolves to the existing execution rather than forking a new one"); how a handler classifies an incoming event and performs the `category` check ("How a receiver performs that check is the handler protocol ADR's"); and when it routes a failure to the workflow root. The first two are settled here. The third is not, for the reason given in [ADR-008](./008-execution-faults-and-abandonment.md) under [ADR-008](./008-execution-faults-and-abandonment.md), **No failure routes to the workflow root**. No assignment ADR-001 already made is disturbed.

ADR-005 likewise left "dependency declaration, event capabilities, resolution" — "how a handler declares, binds to, and is permitted to use a contract" — to this ADR, and left the meaning of a contract's `domain` at the point of use to "domain resolution, inheritance, and any orchestration-context-dependent routing strategy". Both are settled here, under **Definition and declaration** and **Addressing an emitted event**.

## Decision

### Definition and declaration

#### The self contract and the service contracts

An **ArvoEventHandler** implements exactly one ArvoContract — its **self contract** — and declares the set of contract versions it may send events to, its **service contracts**. Both are declared as part of the handler's definition, before any execution begins. This satisfies ADR-000's requirement that "a handler must declare its complete contract capability set as part of its definition, before any execution instance begins", and settles the "dependency declaration" ADR-005 left to this ADR: a dependency is a service contract at one declared version, and declaring it is the whole of binding to it.

The self contract is declared as a contract, not as a version. A handler implements every version of its self contract, one executor each (see below), and an incoming event selects among them. A service contract is declared as **one contract at one version**, for the reason given under **No two versions of one service contract**.

#### One executor per version

A handler MUST declare one **executor** per version of its self contract that it implements. An executor is the business code that runs when an execution of that version is entered or resumed. Versions are fully isolated under ADR-005 — "no two versions are ever compatible by construction" — so an executor written against one version's declared shapes has no defined behaviour against another's, and a handler MUST NOT run a version's executor over an execution that belongs to another version (see [ADR-007](./007-execution-record.md), **Version authority**).

A handler MUST declare an executor for **every** version its self contract declares, and MUST be rejected at declaration time if any version lacks one or if an executor names a version the self contract does not declare. ADR-005 already requires this: "a handler bound to this contract implements every declared version's `input`/`outputs` fully and independently; nothing here defines partial or inherited implementation". The consequence for removing a version is under [ADR-007](./007-execution-record.md), **Version authority**: a version leaves the handler by leaving the contract, and its executor with it.

#### The closed set of emittable events

The set of events a handler may emit is exactly:

- the input event type of each declared service contract, at its declared version;
- every key of its self contract version's `outputs`, for the version whose executor is running;
- its self contract version's handler error event.

An execution MUST NOT emit anything else, and MUST NOT acquire a capability not present in the declaration. This is the "static boundary" ADR-000 asks for, and it is what lets a mechanism determine what a handler may do before running it, and lets an implementation with a type system reject an impermissible emission before it is deployed.

The set is closed per version, not per handler. A handler with two versions has two such sets, sharing the service inputs and differing in the `outputs` keys and the handler error type.

#### What an executor may return

Of the three kinds of emittable event, **an executor may return the first two only.** It may return an event to a declared service, and it may return one of its own version's `outputs`. The handler error event is not something an executor constructs or returns: the handler produces it, and only in response to the executor failing or to a condition the handler itself detects. A returned event carrying the handler error type is an execution fault (`emission_not_permitted`), however it was built. An executor that could construct it could claim to have failed while continuing to run, and an executor that wants to say "I cannot do this" says so by failing. The causes are closed and listed under [ADR-008](./008-execution-faults-and-abandonment.md), **Failure protocol**.

#### No two capabilities may share an event type

**No two capabilities in a handler's declared set may share an event type**, and a handler MUST be rejected at declaration time if any two do: a service input against another service's input, a service input against a key of its own `outputs`, or either against its handler error type.

ADR-005 forbids only the within-contract case — a version's `outputs` may not reuse the contract's own `type` or its handler error type — and is explicit that `type` is not unique across contracts: "no ADR claims `type` is unique across contracts — two unrelated contracts can already declare the identical ordinary `type`". Nothing prevents two capabilities a handler declares from colliding until this rule does.

The rule exists to make an emitted event's type sufficient to determine its destination. Under **Addressing an emitted event**, `to` is derived from the type an executor supplies; if two declared capabilities shared a type, the handler could not tell which contract the executor meant. It is checked once, at declaration, where the entire capability set is visible — the only place it can be checked, since no declaration site knows every contract in existence, and ADR-005 rejected a cross-contract naming rule for exactly that reason.

#### No two versions of one service contract

**A handler MUST NOT declare two versions of the same service contract.** Doing so is a declaration error and the handler MUST be rejected. Where a deployment nonetheless reaches a delivery with such a declaration, the delivery is a non-retryable fault (`service_version_conflict`, see **The `fault_kind` vocabulary**).

Two versions of one contract share a `type` — ADR-005 makes `type` a property of the contract, not of a version — so their input types collide and the rule above already rejects them. It is stated separately because the collision rule reads as being about unrelated contracts, and this is the case an author is most likely to reach for deliberately: wanting to call an old and a new version of the same service from one handler. That is two dependencies on one contract, and the model has no way to tell their responses apart. A response's `dataschema` names the service's version, and **Entry validation** checks it against the one version the handler declared; with two declared there would be nothing to check against.

#### The self contract may be a service

**A handler MAY declare its own self contract as a service**, at one version like any other service, so that an execution can open a child execution of itself. This is how a handler recurses — a tree walk, a retry-with-narrower-scope, a fan-out over a list that hands each element back to the same contract — and nothing above forbids it. The collision rule is satisfied by construction: ADR-005 guarantees that a contract's `type` matches none of its `outputs` keys and not its handler error type, so the self contract's input, its outputs, and its handler error type are three disjoint sets whether the contract is declared once or twice.

What the declaration changes is classification. A recursive request and a recursive reply arrive with the **same** `dataschema` `uri`, and `dataschema` alone can no longer say which is which. **Classification** resolves the overlap by one further field, the event's `type`, and does so unambiguously for the reason just given. Once classified, a recursive delivery is an ordinary init or an ordinary followup, and nothing else in this ADR treats it specially: the child has its own `execution_id`, its own record, one more `depth`, and the parent as its caller.

#### Optional business state schema

An executor MAY declare a schema for business state it wishes to remember between deliveries. Where declared, it governs the `data` field of the execution record (see [ADR-007](./007-execution-record.md), **The execution record**) and is validated against `data` at every entry, once the version is known (see [ADR-007](./007-execution-record.md), **Hydration**).

An executor that declares none is still resumable — it may emit to a service and be re-entered on the response — and still has an execution record. It simply has nothing of its own in it. Resumability is a property of the protocol, carried by the record's own fields; business state is what an executor adds to that, and it is optional.

### Options

#### One table, one rule

Seven **options** govern how a version behaves. They are defined here and nowhere else: every other section says what its option *does*, and refers here for its type, its default, how its value is found, and what the protocol substitutes where a resolved value cannot be used at the moment it is needed — the **Fallback** column, which is N/A for every option whose value is a plain number or literal, since those cannot fail at use.

| Option | Type | Handler level | Version level | Fallback |
|---|---|---|---|---|
| `max_depth` | integer ≥ 0 | **required**; `10000` where the author writes nothing | unset inherits the handler's; a written value is the version's | N/A |
| `max_retry_attempts` | integer ≥ 0 | **required**; `3` where the author writes nothing | unset inherits the handler's; a written value is the version's | N/A |
| `retry_delay` | integer ms ≥ 0, or a function `(event, record \| null, attempt, max_retry_attempts) → integer ms` | **required**; `300` where the author writes nothing | unset inherits the handler's; a written value is the version's | `300` ms, where the function form fails at use ([ADR-009](./009-execution-bounds.md), **`retry delay` must not be able to fail**) |
| `run_timeout` | integer ms > 0, or `null` for unbounded | **required**; `30000` where the author writes nothing | unset inherits the handler's; a written value, `null` included, is the version's | N/A |
| `execution_timeout` | integer ms > 0, or `null` for unbounded | **required**; `null` where the author writes nothing | unset inherits the handler's; a written value, `null` included, is the version's | N/A |
| `collect` | `all` \| `each` | **required**; `all` where the author writes nothing | unset inherits the handler's; a written value is the version's | N/A |
| `handler_error_domain` | a domain literal, or one of the four source identifiers under **Domain** | **required**; `none` where the author writes nothing | unset inherits the handler's; a written value is the version's | N/A |

**The handler level is complete.** A handler always holds a value for every one of the seven. An author who writes nothing for one gets the value in the third column, which the protocol defines; there is no state in which a handler lacks an option. **The version level is sparse.** A version declares only what it wants to differ, and an option it leaves **unset** is inherited. *Unset* is a protocol concept — the option was not written — and each language spells it natively: an absent key, an undefined member, an empty optional. It is not the same as writing `null`. For the two timeouts `null` is a value, meaning unbounded, and a version that writes it has declared something. For the other five, `null` is outside the type and is refused at declaration like any other invalid value (**Validated at declaration, at both levels**). **An implementation MUST distinguish an option that is unset from one set to `null`, and MUST NOT collapse the two**: a version that inherits a thirty-second run clock and one that declares no run clock behave differently, and a language whose declaration surface cannot tell them apart cannot implement this ADR.

**Resolution is one rule:** the version's value where the version wrote one — `null` counts as written — otherwise the handler's. There is no third step, because the handler is never missing a value. The rule holds identically wherever and whenever an option is read — at declaration, at a gate step, on return — and it does not matter whether a version is known at that moment: **where no version is known, the version side is `null` for every option and the handler's values apply.**

#### What each option governs

| Option | Governs | Defined under |
|---|---|---|
| `max_depth` | how deep an execution of this version may sit or reach | [ADR-009](./009-execution-bounds.md), **Depth** |
| `max_retry_attempts`, `retry_delay` | how many attempts a retryable fault may be given, and how long to wait between them | [ADR-009](./009-execution-bounds.md), **Retry** |
| `run_timeout`, `execution_timeout` | how long one attempt may run, and how long the execution may live | [ADR-009](./009-execution-bounds.md), **Timeouts** |
| `collect` | whether the executor is entered once all responses are in, or on each | [ADR-009](./009-execution-bounds.md), **Collection** |
| `handler_error_domain` | the `domain` the handler error event carries | **Domain** |

#### Validated at declaration, at both levels

Every value at either level MUST lie in its type's domain, and a value outside it is a declaration error: the handler MUST be rejected at declaration time, the same treatment the ADR gives a version without an executor and a capability set with a type collision (**Definition and declaration**). A defect in code is visible before any event exists, so no fault is defined for it and no backstop at delivery is needed.

One relation spans two options and is checked on each version's **resolved** pair, after the rule above has been applied: **`execution_timeout` MUST NOT be smaller than `run_timeout`**, and **where `run_timeout` is `null`, `execution_timeout` MUST be `null` too** ([ADR-009](./009-execution-bounds.md), **Timeouts** gives the reason). A handler-level `run_timeout` and a per-version `execution_timeout` are checked against each other exactly as two per-version values would be.

#### Names are API shape; the rest is not

What each option is called in a language, and whether the two levels are two objects or one object with overrides, is API shape and each language's own choice (ADR-004). The set of seven, their types, their defaults, the two levels, and the resolution rule are not.

### The execution context

#### One object, built per delivery

Everything an executor can know or do, it knows or does through one object the handler builds for the delivery: the **execution context**. It is constructed after the gate has passed (**Entry validation**), the record hydrated and the dependencies resolved, and it is the only argument an executor receives. It MUST be built fresh for every delivery and MUST NOT be retained across deliveries: an executor that keeps a reference to it holds nothing meaningful once the delivery ends, which is the same property ADR-000 requires of every implementation dependency across a suspension.

The members below are normative in their existence and semantics. What each is called, and whether it is a property, a method, or a nested object, is API shape and each language's own choice (ADR-004). The **Type** column names the shape in language-neutral terms — an ArvoEvent, a JSON value, a boolean, an operation with its inputs and result — and is normative in the same way: what a member holds is fixed, how a language spells that type is not. An implementation MAY add members, and MUST NOT remove or alter the meaning of any listed here.

#### What the context exposes

| Member | Type | What it is | Read or write |
|---|---|---|---|
| **delivered event** | ArvoEvent | The event that caused this delivery, restored to an event value. On an init delivery it is the init event; on a followup it is one service's response — an `outputs` event or the handler error event of that service. | read |
| **entry kind** | `init` \| `followup` | `init` or `followup`, as **Classification** resolved it. The delivered event's payload MUST be reachable only once this is known, so business code cannot read an init payload as if it were a response, or the reverse. | read |
| **attempt** | integer, from 0 | Which attempt this delivery is, counting from 0, as the mechanism supplied it ([ADR-009](./009-execution-bounds.md), **Retry**). | read |
| **init event** | ArvoEvent | The event that opened this execution, from `state.init_event`. On an init delivery it is the same event as the delivered event. | read |
| **identity** | object: `subject` string, `execution_id` string, `parent_execution_id` string, `depth` integer, `version` string | `subject`, `execution_id`, `parent_execution_id`, `depth`, and `version`, as held on the record. Exposed so an executor can key its own resources on them (**Cancellation**), never so it can change them. | read |
| **collected** | map: emitted event `id` → ArvoEvent \| `null` | The responses in hand for the current round, keyed as `in_flight_event_map` keys them, and which keys are still outstanding. Under the default join it is always complete when the executor is entered ([ADR-009](./009-execution-bounds.md), **Collection**). | read |
| **state** | the declared schema's type \| `null`; absent where none declared | The executor's own business state, `state.data`. Present only where the version declared a schema. `null` on a new execution until written. Written through **set state** and no other way. | read, and write through `set state` |
| **set state** | operation: (value) → nothing; faults on rejection | Replaces the business state whole. There is no partial write and no merge: an executor that keeps part of the old state copies it forward itself. Validated against the declared schema, and a value the schema rejects is a non-retryable execution fault, `state_schema_rejected` ([ADR-008](./008-execution-faults-and-abandonment.md), **Failure protocol**). | write |
| **dependencies** | the executor's own type; empty object where none supplied | Whatever the dependency factory resolved for this delivery, or the value supplied (**Dependencies**). | read |
| **event builder** | operation: (`type`, `data`, options) → ArvoEvent | Constructs a fully addressed event from a `type` and a `data`, applying every default under **Addressing an emitted event**, and exposing the safe fields and the visibly unsafe group. The only member that produces an event. | produces an event |
| **at max depth** | boolean | True when an event this execution emits to a service could no longer increment `depth` without reaching the version's maximum ([ADR-009](./009-execution-bounds.md), **Depth**). | read |
| **time remaining** | object: `run` integer ms \| `null`, `execution` integer ms \| `null` | How many milliseconds remain on each of the version's two clocks at the moment the executor is entered: the run clock for this attempt, and the execution clock from the init event to the moment this execution's lifecycle becomes terminal ([ADR-009](./009-execution-bounds.md), **Timeouts**). `null` for a clock the version leaves unbounded. Read at entry and not updated: an executor that needs the live figure subtracts its own elapsed time. | read |
| **cancel** | operation: (reason string) → nothing | Marks this execution `cancelled` with a reason, terminal ([ADR-007](./007-execution-record.md), **The execution record**). | write |
| **fault** | operation: (reason string, retryable boolean = true) → ArvoHandlerFault | Builds an execution fault for the executor to raise deliberately, with a reason and whether a redelivery could fix it ([ADR-008](./008-execution-faults-and-abandonment.md), **Failure protocol**). | produces a fault |
| **telemetry** | object: `span`, `logger`, `meter` — OpenTelemetry API objects | The delivery's OpenTelemetry objects: its **span**, a **logger** bound to that span's context, and a **meter** scoped to the handler (**Observability**). | read, and record |
| **mechanism hooks** | object; empty where none supplied | Whatever the mechanism running this handler chooses to expose to an executor, supplied to the handler alongside the delivery. Which hooks exist is the mechanism's own scope and undefined here. Where none are supplied it is an empty object, never absent. | read, or stable mutation only — see below |

#### What the context does not expose

The context is the executor's whole view, and its boundary is as important as its contents. It MUST NOT expose:

- the execution record as a writable whole — the protocol fields are read through **identity** and **collected**, and only `data` is written, through **set state**;
- the mechanism, the store, or any transport — a handler reaches no store, and neither does anything it hands an executor;
- any means to construct or return the handler error event — the builder MUST refuse the handler error type, and a hand-built event carrying it is refused at return (**What an executor may return**);
- any means to alter the outcome of the gate, the collection, or the depth check — those are the handler's, decided before and after the executor runs.

#### Mechanism hooks

A mechanism MAY hand the handler a set of hooks for the executor, and the handler MUST pass them through on the context unchanged. What they are — a scheduler handle, a signal, a metrics sink, a mechanism-specific identifier — is the mechanism's prerogative and outside this ADR, exactly as the mechanism itself is. The handler does not interpret them, and an executor that uses them is coupled to that mechanism by its own choice.

This ADR places one constraint on them, because they cross into the executor's view of the protocol. A hook MUST be **read-only**, or it MUST permit only **stable mutation**: a change whose effect on this execution is the same however many times the delivery is attempted, and which alters nothing the protocol owns — not the record, not the events returned, not the lifecycle, not the outcome of any gate or guard. A hook that could change what this delivery concludes, or that a retry would apply twice with a different result, breaks the atomicity **Entry validation** relies on and MUST NOT be exposed.

Where a mechanism supplies no hooks, the member is present and empty, so an executor written against it never has to test for its absence.

#### The builder is help, not a gate

The event builder exists so that an executor never has to implement the addressing rules itself. It carries the record, the delivered event, the declared contracts and this execution's version, and from a `type` and a `data` produces an event with every field of the defaults table set correctly. An executor SHOULD build every event through it.

It is not the only way to produce a valid event, and the protocol does not make it one. What an executor returns is checked as an event, regardless of how it was built (**What an executor returns**). The builder is the handler making the correct path the easy path; the return check is the handler making the incorrect path a fault.

#### Reading the delivered event safely

On a followup, the delivered event is one of the service's `outputs` or that service's handler error event, and an executor has to know which before reading the payload. An implementation MUST make the delivered event's contract, version and type available on the context alongside the payload, so that the payload's shape can be established from the event rather than assumed. Where a language has a type system, an implementation SHOULD narrow the payload's type by the event's `type`, so that the wrong shape is unreachable rather than merely wrong.

### Execution identity

ADR-001 already assigns the two roles. `subject` identifies the workflow and is "deliberately inert — it encodes nothing, and nothing is derived from it by inspection". `executionid` identifies a specific durable, resumable execution of a handler, and ADR-001 leaves its derivation to this ADR. This section supplies that derivation and changes neither assignment.

#### The three identifying values

Three values identify an execution, all carried on the execution record.

| Field | Meaning |
|---|---|
| `subject` | The workflow. Taken from the init event and copied unchanged onto everything emitted. |
| `execution_id` | This execution of this handler. Derived, by the rule below. |
| `parent_execution_id` | The execution that caused this one — the init event's `executionid`. |

On entering a new execution, a handler MUST set:

```
state.subject             = init_event.subject
state.parent_execution_id = init_event.executionid
state.execution_id        = SHA-256( utf8(init_event.dataschema) ‖ 0x00 ‖ utf8(init_event.id) )
                            rendered as 64 lowercase hexadecimal characters
```

#### The derivation of `execution_id`

- **Algorithm:** SHA-256, as specified in FIPS 180-4. Chosen because it is available in every language's standard library or platform, not because Arvo needs its cryptographic properties for anything beyond collision resistance.
- **Input encoding:** the UTF-8 bytes of `dataschema`, then the single byte `0x00`, then the UTF-8 bytes of `id`. The delimiter is a byte, not a character, and it cannot occur inside either input under ADR-002's format rules — so no pair of distinct inputs can produce the same byte string.
- **Output encoding:** lowercase hexadecimal, 64 characters, no prefix and no separator.

The derivation MUST be pure: no randomness, no clock, no mutable input. It MUST be performed only when a new execution is entered; on every later delivery `execution_id` is read from the record, never recomputed. This satisfies ADR-001's standing requirement that the derivation be deterministic, "so a redelivered trigger resolves to the existing execution rather than forking a new one".

`dataschema` is the identifying component rather than `type`, because ADR-005 is explicit that no ADR makes `type` globally unique and that cross-contract collisions are resolved by "`type` and `dataschema` together". Since `dataschema` is `{uri}/{version}`, it names one contract at one version, and it is read directly off the init event that resolved this handler's version in the first place.

#### Why every part of the derivation is pinned

Every part of the derivation is pinned, and for the same reason ADR-005 pins its JSON Schema dialect rather than saying "JSON Schema": two implementations that disagree on any part of it derive different identifiers from the same init event, and a redelivery then forks a new execution — precisely the failure the derivation exists to prevent.

The rule has one implementor per language, and it is what a redelivered init is caught by: the handler derives the same key, asks the state function for it (**Resolving the existing execution**), and finds the record the first delivery wrote. Two languages that derived differently would each open a fresh execution for the other's redelivery.

Changing the algorithm, the input encoding, or the output encoding would change every identifier every implementation derives, so each changes only by a superseding ADR.

#### Properties that follow

Four properties follow, and all four are load-bearing.

- Every execution has a unique `execution_id`. ADR-001 requires an event's `id` to be globally unique, so two distinct init events never share one, and the derivation carries that uniqueness through to the identifier.
- A redelivered init event derives the same `execution_id` and therefore resolves to the same execution rather than forking a new one.
- Two handlers implementing different contracts derive different identifiers even where those contracts declare the same `type`, because their `dataschema` values differ.
- One handler invoking the same service twice within an execution produces two executions of it, because the two init events have different `id` values.

#### The residual case: two handlers on one contract version

The one case this does not separate is two handlers implementing the *same* contract version, which would derive the same identifier for the same init event. Nothing in the model can distinguish those handlers — node identity is deliberately not something Arvo depends on (ADR-000) — so the derivation cannot be made to separate them, and the rule closes the case from the other side:

**Within one execution context, two handlers MUST NOT implement the same self contract.** An execution context is the set of handlers among which a mechanism routes events by `to` — a deployment, in the ordinary case. Two handlers implementing one contract there would both be candidates for the same init event, both derive the same `execution_id`, and both attempt to own the same record. A deployment that violates this is non-conformant, and a mechanism SHOULD reject it where it can see the full handler set. This is a constraint on deployment rather than on the derivation, and it is named here so the case is not mistaken for a gap in the derivation.

Two handlers implementing the same contract in *different* execution contexts — two independent deployments — are unaffected, since no event of one is ever routed to the other.

#### The root case

**The root case changes nothing here, and is named so it cannot be misread.** ADR-001's *root execution* — the one whose identity is `subject`, whose completion carries it, and to which a failure event may one day be routed — is whatever minted the root event: a gateway, a scheduler, a webhook receiver. It sits outside this protocol, runs no executor, and owns no execution record.

The handler a root event opens is not that execution. It is an ordinary execution like any other, deriving `execution_id` by the rule above, with `parent_execution_id = init_event.executionid`, which on a root event equals `subject`. The two readings are indistinguishable on the wire — that handler's completion carries `subject` either way, since a completion carries its caller's identity and the minter is the caller — but they diverge on whether this derivation needs a root carve-out, and it does not.

A failure event routed to the root (`executionid = subject`, deferred as stated under [ADR-008](./008-execution-faults-and-abandonment.md), **Failure protocol**) is addressed to the minter, not to any record, which is why it would need no keyed lookup to land.

#### Depth of this execution

This execution's nesting level is recorded as `state.depth = init_event.depth`. Under ADR-001, "an event opening a new execution carries one more than the level of the execution emitting it", so the init event's depth already *is* the depth of the execution it opens. No arithmetic is performed on entry; the increment happens on emission, under **Addressing an emitted event**.

### Addressing an emitted event

#### What an executor returns

An executor leaves in exactly one of four ways, and the handler treats each as follows.

| The executor | The handler |
|---|---|
| returns one event | treats it as a batch of one |
| returns a list of events | treats it as one batch; an empty list is permitted |
| returns nothing | treats it as an empty batch — the execution rests at `waiting` or `idle` by what is still outstanding ([ADR-007](./007-execution-record.md), **The execution record**) |
| throws any error | produces the handler error event from it and ends the execution at `error` ([ADR-008](./008-execution-faults-and-abandonment.md), **Failure protocol**); the one exception is an error that is itself an execution fault, built through the context, which stays a fault |

There is no fifth. A return that is none of these — a value that is not an event, or a list containing one — is an execution fault, `emission_not_permitted`, non-retryable: the executor code is broken, and no redelivery repairs it. The distinction between the third row and the fourth is the distinction between the two failure classes: returning nothing says the work is not finished, throwing says the work cannot be finished.

**Every returned event is validated before anything leaves the handler**, and an event that fails is a non-retryable execution fault for the whole batch: nothing is emitted, no record is written. The checks are:

- its `type` is in the emittable set for this version and is not the handler error type (**Definition and declaration**) — else `emission_not_permitted`;
- it is not a second own-`outputs` event in the same batch — a batch carries at most one completion, because the caller awaits exactly one answer to its request ([ADR-007](./007-execution-record.md), **A mixed batch completes**) — else `emission_not_permitted`;
- its `data` satisfies the schema that `type` selects, at the declared version — else `emission_schema_rejected`;
- its `depth` passes the version's guard ([ADR-009](./009-execution-bounds.md), **Depth**) — else `max_depth_event_requested`;
- it is structurally valid under ADR-001 and ADR-002, which an event built through the builder is by construction and a hand-built event may not be — else `emission_not_permitted`.

The batch is validated whole and succeeds or fails whole, for the reason [ADR-009](./009-execution-bounds.md), **Depth** gives: a batch is one decision by one executor, and emitting part of it would leave an execution in a state no lifecycle can describe.

#### An executor returns finished events

**What an executor returns is complete**: every field set, every value final. The handler does not accept a request to be turned into an event; it accepts events, and validates them as above.

The addressing rules that follow are nonetheless the handler's, not the executor's. They are written once, in the handler, and reached by an executor through the **event builder** on the execution context (**The execution context**). Given a `type` and a `data`, the builder produces an event with every default below already set. An executor SHOULD build every event through it and SHOULD NOT construct events by hand, because the fields a mistake would misroute are all structurally valid either way: both values `executionid` can take are well-formed identifiers, so are both values of `to`, and every value of `subject` and `category`. A wrong one is a misrouted workflow, not a rejected event, and no check at return can catch it. ADR-001 assigns `category` "through contract event factories rather than handler or application code"; the builder is that factory, extended to every field whose value depends on the event's role.

The tables in this section therefore serve two purposes. They define what the builder produces. And they define what any hand-built event is expected to match, with the consequence of each departure named so that an author who departs does so knowingly.

#### The two destination roles

An emitted event goes to one of two places, and two fields depend on which.

- **To a service contract.** The event opens a new execution of a service. It carries this execution's own identity as `executionid`, and one more than this execution's `depth`.
- **To the caller — an own `outputs` event or the handler error event.** The event completes this execution. It carries the caller's identity as `executionid`, this execution's own `depth`, and the init event's `id` as `initid`.

`subject` is the same on both, exactly as ADR-001 requires. `executionid` is role-dependent: ADR-001 states that an execution stamps its own identity on what it sends downstream, and that a completion carries "its caller's, not its own". This ADR only makes that mechanical.

#### The complete field defaults

The complete set of defaults, for every field of an event:

| Field | To a service contract | Own `outputs`, or the handler error event |
|---|---|---|
| `subject` | `state.subject` | `state.subject` |
| `executionid` | `state.execution_id` | `state.parent_execution_id` |
| `depth` | `state.depth + 1` | `state.depth` |
| `parentid` | the delivered event's `id` | the delivered event's `id` |
| `initid` | `null` | `state.init_event_id` |
| `category` | `io.arvo.init` | `io.arvo.complete` |
| `source` | `state.source` | `state.source` |
| `to` | the service contract's own `type` | `state.init_event_source` |
| `baggage` | carried through unchanged | carried through unchanged |
| `domain` | absent unless asked for | absent unless asked for, or the version's handler-error default |
| `executionunits` | `0` | `0` |
| `type` | supplied by the executor | supplied by the executor |
| `data` | supplied by the executor | supplied by the executor, or composed from the error |
| `dataschema` | the target contract's, for the declared version | the self contract's, for this execution's version |
| `id` | fresh | fresh |
| `time` | the moment of construction | the moment of construction |
| `traceparent` / `tracestate` | the execution's own trace context | the execution's own trace context |

`category` MUST be set by the handler according to the emitted event's declared role, using the two values ADR-001 reserves. `parentid` is the delivered event's `id` on both, because ADR-001 defines it as "the `id` of the event that caused this one" and the delivered event is what caused this delivery. `baggage` is carried through because ADR-001 makes it "written once on the root event, then copied unchanged onto every event in the workflow".

#### `initid`

`initid` is set only on a completion, per ADR-001: "on a completion, the `id` of the init event that opened the execution being completed; `null` on every other event". It is what lets a caller match a response to the request it answers, and it is the value a caller looks up in its `in_flight_event_map` (see **Classification**).

Setting it on a service emission would mean something different — the id of the init event that opened the *emitting* execution — and ADR-001 reserves the field against exactly that. A service emission is not a completion of anything, so it carries `null`.

#### `source` and `to`

`source` is the handler's own self contract `type`, held on the record as `state.source`. It identifies the producing node without inventing an identity scheme the model does not have. It is a valid URI-reference under ADR-002 and normalizes to itself, so it satisfies `source`'s format rule unchanged. Every handler stamps it the same way, which is what makes the next default possible.

`to` follows from `source`. A service emission is addressed to the contract that declares it — the service contract's own `type`, which is what a handler implementing that contract expects to see as its `to` (**Entry validation**, step 12). A completion is addressed back to whoever opened this execution, which the init event's `source` names, since every handler stamps its own contract type there. Both are defaults, and both are unsafe to replace — see **What an executor may set**.

#### Domain

An executor may give an emitted event a literal domain, or name a **source** for the handler to read one from and resolve before the event exists. Either way the field is absent unless asked for. The handler error event, which an executor does not construct field by field, takes its domain from the option **`handler_error_domain`** (**Options**), which holds the same two forms: a literal, or a source identifier.

This confronts what ADR-005 left here rather than paraphrasing it. ADR-005 says why the field exists on a contract: "a value a contract carries so that events its factories construct can inherit a default without every call site repeating it", and it leaves "resolving a domain from the handler's own contract versus the contract of the event being emitted, from a triggering event, from orchestration parent/child context" to this ADR. Defaulting every emission to absent with no way to reach the contract's value would leave ADR-005's field inert in the one place it was meant to be used. So **the contract's own declared domain is one of the sources a request may name.** Reaching it takes a request rather than happening silently — which is what ADR-005's "carries no resolution logic, no inheritance chain" is about, and what keeps an event's domain something an author chose rather than something it acquired on the way past.

The sources a request may name, and how each resolves, are the substance of the deferral. At minimum an implementation MUST offer:

| Source | Identifier | Resolves to |
|---|---|---|
| none | `none` | no domain |
| the target contract | `target_contract` | the `domain` of the contract the event is built from |
| the self contract | `self_contract` | the `domain` of this handler's own contract |
| the delivered event | `delivered_event` | the `domain` of the event that caused this delivery |

A request naming a source whose value is `null` or absent resolves to no domain rather than failing, so a handler is never broken by context it did not receive. A resolved domain is always a plain value or absent — **a request MUST NOT reach the event**. How an implementation lets an executor or a declaration name these sources is API shape (ADR-004); the set, the resolution, and the **identifier** column are not. The identifier is fixed so that a declaration naming a source reads the same in every language.

ADR-001 holds that `domain` is "`null` for traffic inside a lattice" and set non-null "by an emitter whose event must be fulfilled elsewhere". The default of absent preserves the first half; the request is how an emitter does the second.

#### A root event must carry `to`

**A root event MUST carry a `to`, and it MUST be its own `type`.** Gate step 12 (**Entry validation**) makes `to` authoritative and requires it to equal the receiving handler's self contract type. A root event names a contract, the handler that implements that contract has that contract's `type` as its own, and so the only value of `to` any handler will accept is the event's own `type` — anything else is refused by every handler that could receive it. ADR-001's minimal root event, taking every default, has `to` at `null`, and is refused for the same reason. Whatever mints a root event therefore has one obligation this ADR places on it: set `to = type`. An implementation constructing a root event MUST apply that, not offer it as a default.

This is the only requirement this ADR makes of a participant that is not a handler. It is stated here because a root minter is outside the protocol and will not read the rest of it, and because the failure is otherwise baffling: a perfectly well-formed root event, rejected by every handler it reaches, for a field its author never knew mattered.

#### Record keys and grouping

Because `subject` is constant across a workflow, every record belonging to one workflow shares it, and a mechanism MAY group on it. Because `execution_id` identifies one execution, a mechanism MAY key the record on it. Neither is required of a mechanism; both are what the record's identifying fields make available.

#### `init_event_id` and `init_event_source`

`init_event_id` and `init_event_source` are held on the record as their own fields rather than read from `init_event` each time. Both are needed to address a completion — one becomes `initid`, the other becomes `to` — and the record already keeps them stable for the life of the execution. Carrying them directly means addressing a completion never depends on restoring an event, and a reader of a stored record can see where it will return to without parsing anything.

#### What an executor may set: safe, unsafe, required

Every value in the defaults table is what the builder sets. Whether an executor may replace one — on the builder's output, or by building the event by hand — follows from a single question: **does a wrong value spoil the event, or spoil something else?** A **safe** field spoils only the event. An **unsafe** field spoils a reply path, a correlation, a trace, or a guarantee the rest of the workflow was relying on. Two fields are neither: they are **required**, because the executor is the only party that knows them.

The builder MUST take the two required fields, MUST accept the two safe fields, and SHOULD expose the unsafe set only through a distinctly named, visibly unsafe group. The grouping is API shape and therefore each language's own choice (ADR-004); the classification is not. An event built by hand bypasses the grouping but not the consequences, which is why every row names them.

| Field | Class | Reason | Consequence of a wrong value | Consequence borne by | Safe only if the executor guarantees |
|---|---|---|---|---|---|
| `type` | required | Selects both the destination and the payload schema. | An undeclared type is rejected before deployment where types can catch it, and is an execution fault where they cannot. | This execution. Nothing is emitted. | It names a service's input type or a key of this version's `outputs` — not the handler error type, which is not an executor's to emit. Checked for you. |
| `data` | required | The payload, validated against whichever schema `type` selects. | A payload the schema rejects is a non-retryable fault; no event is emitted. | This execution. Nothing is emitted. | It satisfies the schema `type` selects. Checked for you. |
| `domain` | safe | Selects a processing path, and is the emitter's to choose. Takes a value or a request to read one — see **Domain**. | The event is fulfilled on a different path. Nothing that routes, correlates or identifies reads it. | This execution, which chose the path. | Something fulfils that domain and returns the event to the default path. |
| `executionunits` | safe | Accounting only. | A wrong cost figure, and nothing else. | Whoever reads cost reporting. | The figure means what the deployment's other producers mean by it. |
| `executionid` | unsafe | The reply path. A callee stores it as its `parent_execution_id` and stamps it on its completion. | The reply is addressed to an execution that does not exist, and this one waits forever. | This execution, and the callee whose work is discarded. | The named execution exists, is not terminal, and is awaiting exactly this reply. |
| `to` | unsafe | What Arvo routes on. ADR-001 makes it "set fresh by the emitter", and for these events the handler is that emitter. | The event is delivered elsewhere. No reply arrives from a service call; a completion never reaches the caller. | This execution, and whichever node receives an event it never expected. | The recipient implements this contract version, and — on a service call — replies with the same `subject`, `executionid` and `initid` the default would have produced. |
| `subject` | unsafe | Workflow identity, and one of this handler's own entry checks. | The callee's completion fails `state.subject == event.subject` and is rejected on arrival. | This execution, and anyone querying the workflow, which has silently lost a branch. | The new value is the workflow this execution genuinely belongs to, and every record later checked against it agrees. |
| `initid` | unsafe | Response correlation — the key a caller looks its outstanding request up by. | The reply matches no outstanding entry and is rejected as unawaited. | This execution. | It is the id of a request the recipient currently has outstanding. You are claiming to answer that one. |
| `id` | unsafe | The in-flight key, and an input to the callee's identity derivation. | A duplicate collapses two distinct calls onto one execution — the reason ADR-001 requires global uniqueness. | The callee, which merges two requests into one. | It is globally unique per ADR-001, colliding with no event any participant has emitted or will emit. |
| `dataschema` | unsafe | Names the contract and version that validate the payload, and the other input to the callee's derivation. | The callee rejects the event, or derives a different execution than intended. | The callee, then this execution when no reply comes. | The payload satisfies that contract version's schema, and a handler implementing it is deployed. |
| `source` | unsafe | The callee stores it as `init_event_source` and addresses its completion to it. | A handler that misreports its source never receives its own replies. | This execution, and whichever node is sent completions meant for it. | Whatever it names can receive this execution's completions and act on them. |
| `parentid` | unsafe | Lineage, and rootness: `parentid == null` is what defines a root event under ADR-001. | A null claims rootness, which then requires `executionid == subject` and usually fails validation outright. | The receiver, and anyone reconstructing causality afterwards. | It names an event that genuinely caused this one, and is not `null` unless this really is a root — which then also requires `executionid == subject`. |
| `category` | unsafe | The receiver's corroboration of what `dataschema` already told it. ADR-001 assigns it "through contract event factories rather than handler or application code". | The receiver's cross-check fails and the delivery is rejected. It cannot misroute — `dataschema` decides classification — but a wrong value turns a valid event into a fault. | The receiver, and this execution when the reply it was owed is rejected. | It states the event's actual role, so it corroborates the receiver's resolution rather than contradicting it. |
| `depth` | unsafe | The runaway-nesting signal. ADR-001 states it "never decrements", and it is what the execution-depth guard measures. | Unbounded recursion stops being visible — the one thing the field exists for. A value at or above the version's maximum also rejects the whole emission batch as `max_depth_event_requested` (see [ADR-009](./009-execution-bounds.md), **Depth**). | Operators, who lose the signal at the moment it matters. | It still counts real nesting from the root, and does not decrease. |
| `traceparent` / `tracestate` | unsafe | Trace context, inside the model per ADR-000. The default already continues the delivered event's trace. | The workflow's trace fragments into disconnected pieces, exactly where a suspension makes it hardest to reconstruct by hand. | Whoever debugs the workflow later. | It is a valid W3C context descending from this execution's own, so the chain still joins up. |
| `time` | unsafe | The moment of construction. ADR-001 makes it descriptive and forbids using it to establish ordering. | Nothing in the protocol; a misleading timeline for everyone reading the event stream afterwards. | Whoever reads or audits the stream later. | It is a real RFC 3339 instant carrying an offset, and describes when the event actually occurred. |
| `baggage` | unsafe | Written once, at the root. ADR-001: "copied unchanged onto every event in the workflow". | Every event in the workflow no longer carries an identical map. Branches diverge, fan-in needs a merge rule that does not exist, and two nodes couple without a contract declaring it. | Every participant in the workflow, downstream and in every other branch. | Nothing a handler can guarantee from where it stands. It would have to know every branch of the workflow, present and future, and that none fans back in. Only the root minter is in that position, and a handler never is. |

Read the *consequence borne by* column down and the case for the classification makes itself. For the required and safe rows the cost stops at the execution that caused it, or at a reader of a figure. For almost every unsafe row it does not. An executor setting an unsafe field is spending someone else's reliability — a callee's, a receiver's, an operator's, or in `baggage`'s case every participant in the workflow at once. That is the distinction the surface is marking, and the reason the ADR names who bears the cost rather than only what goes wrong.

#### What "unsafe" means

Four of these carry normative ADR-001 rules an override breaks outright rather than merely inadvisably — `baggage`, `depth`, `category`, and `initid`. The unsafe surface repeals none of them. An event constructed with an override that violates ADR-001's structural validity is still invalid, and a receiver's gate still rejects it.

**Unsafe means the handler permits the construction, not that the result conforms.** Return validation checks what is structurally checkable (**What an executor returns**), and a changed `baggage` or a shifted `depth` is structurally valid, so it passes. That is not the protocol blessing it. An override that satisfies the guarantee listed for its field produces a conformant event. An override that breaks a rule ADR-001 states — `baggage` "copied unchanged onto every event in the workflow", `depth` never decremented, `category` set by the factory and not by application code, `initid` naming the request being answered — produces an event that is **deliberately non-conformant**, and the handler emits it anyway because the developer asked for exactly that. The consequences, at the receiver's gate and in every record and trace downstream, are the developer's, and an implementation MUST document at the unsafe surface that this is what crossing it means.

The unsafe surface exists because a type boundary cannot enforce every rule in the model, and because hiding a field entirely leaves a developer with a real need no way forward and no way to weigh the cost. What it offers is reachability with the consequence named. A developer who crosses it owns that consequence fully, including on behalf of participants downstream who never chose it.

### Observability

Trace context is inside the model. ADR-000's *Observability by Default* requires that "the model must preserve sufficient correlation, causation, lineage, and trace context to make distributed composition observable", and lists "causation, lineage, and trace context" among AAM membership. ADR-001 places `traceparent` and `tracestate` on every event and states that the envelope "neither inherits nor synthesizes them" — whoever creates the event sets them. For every event this protocol emits, that is the handler, and this section states what it does.

#### Continuing the trace

A handler MUST continue an existing trace rather than begin a new one wherever it can. An execution's trace context for a delivery is taken from the delivered event's `traceparent` and `tracestate` where a `traceparent` is present, and begun fresh only where none is. Every event the handler emits carries that context by default (**The complete field defaults**), so a causal chain survives suspension without an executor doing anything.

The trace is per delivery, not per execution. An execution that suspends and resumes on a response continues the response's trace, which descends from the service's trace, which descends from the emission that opened it — so the chain joins across the suspension through the events themselves, which is the only thing that survives one. Nothing about the trace is stored on the record as its own field; the record's `triggering_event` carries it if a reader needs it later.

#### OpenTelemetry is the observability standard

**The observability surface of this protocol is OpenTelemetry**, and an implementation MUST expose it through the OpenTelemetry API for its language rather than through an API of its own. This is the first ADR to name an external standard as a requirement on handler behaviour, and it does so on ADR-000's stated preference for "established standards to invented ones". OpenTelemetry is the vendor-neutral API for traces, metrics and logs, `traceparent` and `tracestate` are its W3C propagation format — the one ADR-001 already places on every event — and every language Arvo targets has an official OpenTelemetry API.

What is mandated is the **API**: the types an executor records against and the handler emits through. Collection, retention and export remain infrastructure responsibilities per ADR-000's *Observability by Default*, and an implementation MUST NOT require a particular exporter, collector, sampler or backend. A deployment with no OpenTelemetry SDK configured gets the API's no-op behaviour, at no cost and with nothing to change in handler or executor code.

#### The executor's access to observability

An executor MUST be able to contribute to the execution's own telemetry rather than having to start a parallel one, and it reaches it through the **telemetry** member of the execution context (**The execution context**). That member holds three objects, each the OpenTelemetry API's own type for that language:

| Object | What it is | What an executor does with it |
|---|---|---|
| **span** | The delivery span the handler opened (**Instrumenting the protocol itself**). | Set custom attributes; add span events with their own attributes; record exceptions; set status. |
| **logger** | A logger already bound to the span's context. | Emit logs correlated to this delivery without passing context by hand. |
| **meter** | A meter scoped to the handler, with the span's context available for exemplars. | Record counters, histograms and gauges. |

Three objects rather than one because that is how OpenTelemetry is shaped: a span cannot emit a log or record a metric, and pretending otherwise would mean a wrapper that has to be re-learned per language. Each is the real API object, not a wrapper an implementation invents, so that anything the OpenTelemetry API permits an executor may do, and any OpenTelemetry instrumentation library an executor already uses works unchanged. An implementation MAY add convenience over them and MUST NOT narrow them.

Replacing an emission's trace context is possible but unsafe, for the reason the classification table gives under **What an executor may set**: a valid override descends from this execution's own context, and anything else fragments the workflow's trace at the point a suspension makes it hardest to reconstruct.

#### Instrumenting the protocol itself

An implementation MUST instrument the protocol so that a handler is observable without an executor writing any instrumentation. Each delivery MUST produce a span, and the stages this ADR defines — entry validation, hydration, classification, collection, executor entry, return validation, emission — SHOULD each be visible within it, so that a delivery that faulted at the gate and one that faulted on return can be told apart from telemetry alone, and so that time inside the executor can be separated from time in the protocol around it.

The delivery span SHOULD carry as attributes the identifiers a reader needs to find the execution: `subject`, `execution_id`, the self contract `type` and `version`, the entry kind, and the attempt number. Attribute names are API shape and each language's own choice, but an implementation SHOULD follow OpenTelemetry semantic conventions where one applies and SHOULD namespace Arvo's own under a single prefix, so that two languages' traces can be read side by side.

An implementation SHOULD publish protocol-level metrics — deliveries by outcome, faults by `fault_kind`, executor duration, collection size — through the same metrics API, and MUST NOT require an executor to opt in to them.

A fault MUST be recorded on the delivery span before it is raised, as an exception with its `fault_kind` and whether `retry` is present as attributes ([ADR-008](./008-execution-faults-and-abandonment.md), **The fault object**), because a fault writes no record and the trace may be the only place a retried-away failure is ever visible.

### Classification

#### Init or followup, nothing else

Every delivery is either an **init** — opening a new execution — or a **followup**, resuming one. There is no third outcome and no unclassified pass-through: a delivery that cannot be classified is a fault (`event_unclassifiable`). Classification is a property of the delivery, not of the execution, and MUST NOT be confused with the record's `lifecycle`, which records where an execution rests ([ADR-007](./007-execution-record.md), **The execution record**).

This settles the second of the three things ADR-001 left to this ADR — "how it classifies an incoming event" — and the `category` check ADR-001 assigned here.

#### `dataschema` decides it

**`dataschema` decides classification.** ADR-005 fixes `dataschema` as `{uri}/{version}`, and the `uri` names the contract that governs the event. A `uri` matching the self contract is an init; one matching a declared service contract is a followup; one matching neither is a fault. This is read from a field ADR-001 requires on every event, ADR-002 constrains the format of, and ADR-005 gives a fixed shape — not inferred from `type`, which ADR-005 makes version-independent and not globally unique, and not from the presence or absence of a record, which is a separate check (**Entry validation**, step 4).

**One overlap, and one tie-break.** Where the handler declares its self contract as a service (**The self contract may be a service**), a `uri` matching the self contract matches both a self and a service declaration, and `dataschema` cannot finish the job. For that `uri` only, the handler reads the event's `type`: **the self contract's input `type` classifies the delivery as an init; one of its `outputs` keys or its handler error type classifies it as a followup**; any other `type` is `event_unclassifiable`. This is unambiguous because ADR-005 forbids the input `type` from matching either of the other two. It is a tie-break and not a second rule: `type` is consulted only where `dataschema` names a contract that is both, and `category` keeps its role as a cross-check at step 2 in every case.

How the `uri` and version are split, and how the version is checked in each case, is under **Resolution, and which executor runs**.

#### `category` cross-checks it

**`category` cross-checks classification.** ADR-001 reserves `io.arvo.init` and `io.arvo.complete` and says a producer sets them "through contract event factories rather than handler or application code", so where one is present it states the sender's own contractual intent. It MUST agree with what classification decided: **`io.arvo.init` on a delivery classified as an init, `io.arvo.complete` on one classified as a followup.** The check is about the event's role, not about which contract it names — under recursion the same contract is both self and service, and the role is still one or the other.

A disagreement is a non-retryable fault (`category_mismatch`) — the same event would disagree however often it were redelivered — and catching it is the point. It means two independently deployed participants have diverged about what they are doing — a sender that believes it is completing something a receiver believes it is opening — which ADR-001 wants "detectable rather than silent". Any other value, including absence, carries no ecosystem meaning per ADR-001 and is not consulted. `category` never decides classification on its own; it can only confirm or contradict what `dataschema` already decided.

#### Resolving the existing execution

A delivery reaches the handler as an event and a **state function**. The mechanism does not hand over a record; it hands over the means to fetch one, and the handler decides what to fetch.

**The state function.** The mechanism MUST supply, alongside the event, an operation that takes an `execution_id` and yields the record stored under it, or nothing where none is. It may take time and may fail, since a store is behind it; how a language expresses that — a promise, a future, a coroutine, a blocking call — is that language's own choice (ADR-004). What is fixed is the input — one `execution_id`, together with the delivery's telemetry (**Observability**) so the read is logged and traced as part of this delivery, and the delivery's attempt number ([ADR-009](./009-execution-bounds.md), **Retry**) so the mechanism knows whether this read is the first or a retry of one that already failed; the output, a record or its absence; and the rules below. Telemetry and attempt are read-only context for the mechanism to record against and to tune its own read by — a longer timeout, a different replica — not information that changes which record it returns.

The mechanism behind it validates nothing beyond parsing: what it yields MUST be absence or a parsed JSON object, and whether that object is a record, belongs to this event, or is still resumable is the handler's to judge (**Entry validation**, steps 4, 5 and 12). It MUST read the store on every call rather than yield a value captured earlier, which is what makes a retry re-read the record by construction ([ADR-009](./009-execution-bounds.md), **Retry**). It MUST NOT be given the event or the classification, and it MUST NOT branch on anything but the key.

**The handler chooses the key.** It is the only party that knows which delivery this is, so it is the only party that can. After classification (**`dataschema` decides it**) and before any gate step that reads the record, the handler calls the state function exactly once:

| Delivery | Key passed |
|---|---|
| init | the `execution_id` derived from the event by the rule under **Execution identity** |
| followup | the event's own `executionid`, which a completion carries as its caller's identity — this handler's own `execution_id` |

This is why the mechanism need know nothing about init and followup, and why a store shared by several handlers causes no confusion: the handler always asks for its own key.

**The handler judges the result, and the two cases are strict.**

| Delivery | The record MUST be | Otherwise |
|---|---|---|
| init | `null` | non-retryable fault, `record_unexpected` |
| followup | present | non-retryable fault, `record_expected` |

A record under an init's derived key means an execution with this identifier already exists, and a redelivered init MUST NOT open a second one. A followup with no record names an execution this handler has no memory of; the only ways to arrive here are a record that was never committed, which obligation 1 rules out, or one that was deleted, which is a deployment's own doing. Neither is repaired by redelivery, which is why both are non-retryable. Both are checked at gate step 4.

**A failing state function is a retry-safe fault.** Where the operation fails, however the language signals it, the handler MUST NOT catch and reinterpret it. The failure surfaces as an execution fault of kind `state_resolution_failed`, retry safe, because a store that is unreachable now may be reachable a moment later. It is, with dependency resolution (**Dependencies**), one of only two entry-path faults whose outcome may legitimately differ on retry, and for the same reason: both reach outside the handler.

#### Matching a response by `initid`

**A response is matched to what it answers by `initid`.** ADR-001 defines `initid` as "the `id` of the init event that opened the execution this event completes", and states that it "is the only field that answers *which request is this the answer to*". `executionid` cannot, because every completion carries the caller's identity and so every response to this execution carries the same value. `parentid` cannot, because it "degrades to noise across suspension boundaries" — a response's `parentid` is whatever event the service last processed, not the request it is answering.

A response is therefore recorded against `in_flight_event_map[response.initid]`, which is the `id` of the event this execution emitted to open that service's execution ([ADR-009](./009-execution-bounds.md), **Collection**). A response whose `initid` names no outstanding key is a fault (`response_unawaited`), and one whose `id` has already been recorded is a duplicate and is discarded (**Entry validation**, steps 9 and 15).

### Entry validation

#### The gate

Before any executor code runs, a handler MUST work through the following gate **in sequence**. Each step is a precondition for the ones after it, and no `state.*` value may be read until the record has been fetched and validated — which is why classification comes first, the fetch follows it, and validation of the record precedes everything that reads one.

| Step | Applies to | Check | On failure | Short-circuits | Retry safe |
|---|---|---|---|---|---|
| 1 | every delivery | **`dataschema` resolves against a declared contract**, naming one contract at one version and thereby classifying the delivery as init or followup. Where the `uri` names the self contract and the handler also declares it as a service, the event's `type` breaks the tie (**`dataschema` decides it**). See **Resolution, and which executor runs**. | fault, `event_unclassifiable` | yes | no |
| 2 | every delivery | **`category` agrees with the classification.** `io.arvo.init` on a delivery classified as an init, `io.arvo.complete` on one classified as a followup. Absent or unrecognised, it is not consulted. | fault, `category_mismatch` | yes | no |
| 3 | every delivery | **The record is fetched**, once, through the state function, under the key classification selects (**Resolving the existing execution**). | fault, `state_resolution_failed` | yes | **yes** |
| 4 | every delivery | **Presence matches classification.** An init delivery MUST have fetched nothing; a followup MUST have fetched a record. | fault, `record_unexpected` or `record_expected` | yes | no |
| 5 | followups | **The record's envelope validates, its events hydrate, and it agrees with itself.** The record validates against the fixed envelope under [ADR-007](./007-execution-record.md), **The execution record**, with `data` accepted as any JSON value for now; every event it holds restores to an event value; and the fields copied or derived from the init event still equal what the restored init event says ([ADR-007](./007-execution-record.md), **The record must agree with itself**). No `state.*` value may be read until this passes. | fault, `record_invalid` or `record_event_unrestorable` | yes | no |
| 6 | followups | **The record's version is still declared.** The handler MUST still declare an executor for `state.version`; a version withdrawn from a deployed handler strands its in-flight executions ([ADR-007](./007-execution-record.md), **Version authority**), and this is where that surfaces. The fault carries the abandonment event, and its `handler_error_domain` resolves with the version side unset — the version is gone — so the handler's value applies (**Options**). | fault, `version_not_declared` | yes | no |
| 7 | followups | **`data` satisfies the owning version's schema.** Validated against the schema the version confirmed at step 6 declares — placed here, and not at step 5, because that schema cannot be chosen until the version is known and confirmed ([ADR-007](./007-execution-record.md), **Hydration**). Where the version declares no schema, `data` MUST be `null`. | fault, `record_invalid` | yes | no |
| 8 | every delivery | **The event is below the version's maximum depth.** `event.depth < max depth` for the version resolution selected — the event's on an init, the record's on a followup ([ADR-009](./009-execution-bounds.md), **Depth**). Placed here because it is the first point at which that version is known and confirmed declared. | fault, `max_depth_event_received` | yes | no |
| 9 | followups | **Already seen.** The delivered event's `id` is already in `event_ids` as `received`, so this delivery has been processed. | discard | yes | n/a |
| 10 | followups | **Lifecycle admits the delivery.** A record at `success`, `error`, `cancelled` or `failure` accepts nothing further. A record at `waiting` or `idle` accepts a followup. | fault, `lifecycle_terminal` | yes | no |
| 11 | every delivery | **The execution has not outlived its execution timeout.** Where the version sets one, the time from the init event's `time` — the delivered event's on an init, `state.init_event`'s on a followup — to now is below it ([ADR-009](./009-execution-bounds.md), **Timeouts**). Where the version sets none, this step passes. Placed after the lifecycle check so that a late event reaching a finished execution is refused for its lifecycle, not abandoned for time; and before the checks on the event itself, because an execution past its bound has nothing further to do with the event whatever it carries. | fault, `execution_timeout` | yes | no |
| 12 | `event.to` on every delivery; the rest on followups | **Record, handler and event agree.** `event.to == handler's self contract type`; and on a followup `state.source == handler's self contract type`, `state.execution_id == event.executionid`, `state.subject == event.subject`. `to` is authoritative, so an event carrying none is invalid here. | fault, `event_unaddressed` or `addressing_mismatch` | no — all applicable comparisons are reported together | no |
| 13 | every delivery | **The type is one the resolved contract can send here.** For the self contract, its own `type`. For a service contract, one of that version's `outputs` or its handler error type. | fault, `type_not_receivable` | yes | no |
| 14 | every delivery | **Payload satisfies its schema**, as declared by the contract and version step 1 resolved. | fault, `event_schema_rejected` | no | no |
| 15 | followups | **Awaited.** The response's `initid` names a key of `in_flight_event_map` whose value is still outstanding. | fault, `response_unawaited` | yes | no |
| 16 | every delivery | **Dependencies resolve.** Where a factory was supplied, it is called exactly once with the delivered event, the hydrated record or absence, and the attempt number, and yields the executor's dependencies (**Dependencies**). Last, because it is the one step that reaches outside the handler and it should not be paid for a delivery any earlier step refuses. | fault, `dependency_resolution_failed` | yes | **yes** |

An init delivery has no record, so the steps that read one do not apply to it — which is most of what the **applies to** column records. Only step 12 is split: `event.to` is on the event and is checked either way, while the three comparisons against the record are followups only.

#### Three ways out: proceed, discard, fault

A delivery leaves the gate one of three ways. **Proceed**: every applicable step passed, the execution context is built (**The execution context**), and the executor is entered — or, under the default join, the response is recorded and the delivery ends without entering it ([ADR-009](./009-execution-bounds.md), **Collection**). **Discard**: step 9 recognised a duplicate; nothing is written and nothing is raised. **Fault**: a step failed, and an execution fault is raised carrying every check that failed ([ADR-008](./008-execution-faults-and-abandonment.md), **Failure protocol**).

Every fault here but one is non-retryable, and for one reason: each describes a delivery that would fail identically however often it were repeated. The exception is step 3, which reaches a store and may succeed a moment later.

#### Resolution, and which executor runs

Every delivered event is resolved through its `dataschema` before anything reads its type. ADR-005 fixes `dataschema` as `{uri}/{version}`, split at the last `/`, so the `uri` names a contract and the remainder names one of its versions.

The `uri` MUST match the self contract or one of the declared service contracts. If it matches neither, the delivery is a fault. Then the two cases differ, and so does where the version comes from:

| | init delivery | followup delivery |
|---|---|---|
| `uri` resolves to | the self contract | a declared service contract |
| the record fetched is | nothing | the execution's record |
| the executor is chosen by | the **event's** version, from its `dataschema` | the **record's** `version` |
| the version check is | the handler declares an executor for that version, else `event_unclassifiable` | the event's version equals the declared service version exactly, else `event_unclassifiable` |

Where the self contract is also a declared service, the `uri` resolves to both columns and the event's `type` selects one (**`dataschema` decides it**). A recursive request then takes the init column exactly: its version is the event's, and the handler must declare an executor for it. A recursive reply takes the followup column exactly: its version must equal the version at which the handler declared itself as a service, because that is the version it opened the child at.

For an init there is no record, so the event is the only thing that can say which version to run — and if the handler declares no executor for it, that is a fault rather than a fallback to a neighbour.

For a followup the record is authoritative, because a response's `dataschema` names the *service's* contract and version and says nothing about this handler's. The event's version is still checked, against the version the handler declared for that service, and it MUST be equal. This is the check that catches version skew: a response from `payments/1.1.0` arriving at a handler that declared `payments/1.0.0` carries the same version-independent `type`, would pass a type check, and would then be validated against the wrong version's schema — passing wrongly or failing with a misleading diagnosis. ADR-001 made `dataschema` required so that version skew "becomes detectable rather than silent", and this is where a followup gets that.

#### Why resolution comes first

Resolution is first because everything else depends on it. It decides which contract and version validate the payload (step 14), which type set the event must belong to (step 13), and — because it classifies the delivery — which key the record is fetched under (step 3) and whether one is expected at all (step 4). A `type` alone could do none of this: ADR-005 makes it a property of the contract, so it cannot name a version, and it is not globally unique, so it cannot reliably name a contract.

It also settles which kind of delivery this is, which is why `category` follows it rather than preceding it. Classification is read from a required field that ADR-002 constrains and ADR-005 gives a fixed shape; `category` then cross-checks it — a sender's stated intent against a receiver's declarations, which is what ADR-001 put the field there for. Deciding the same question twice by two independent means, with no rule for disagreement, is the thing this ordering removes.

#### Why the record is validated before anything reads it

Every step after 5 that touches the record reads it — step 6 reads `version`, step 9 reads `event_ids`, step 10 reads `lifecycle`, step 12 reads three identifiers, step 15 reads the collection. A gate that compared before it validated would be reading fields off a structure it had not established was a record at all, and would report a mismatch where the truth was corruption. Step 5 is therefore the first step that touches the record's contents, and no step before it does.

One field is validated later than the rest, and deliberately. `data` is governed by the schema the owning version declares, and the owning version is `state.version` — a field that cannot be read until step 5 has passed and is not confirmed declared until step 6. Validating `data` at step 5 would need a schema chosen by a value the step is not yet allowed to trust. So step 5 validates the envelope with `data` held as an opaque JSON value, step 6 confirms the version, and step 7 validates `data` against that version's schema. The whole record is validated before any executor code runs; only the order inside the gate reflects the dependency.

#### Why the duplicate check precedes the lifecycle check

A redelivery of the very event that completed an execution would otherwise reach the terminal check first and be reported as a fault — so under at-least-once delivery, the final response of every execution could produce a spurious failure whenever the transport repeated it.

Putting step 9 ahead of step 10 costs nothing, because the two catch disjoint things. Step 9 discards only an event the execution has demonstrably already processed. A genuinely late message — one arriving at a finished execution having never been seen — is not in `event_ids`, passes step 9 untouched, and is reported by step 10 exactly as it should be. Quiet about repetition, loud about lateness.

#### Why an idle record admits a followup

Step 10 admits a followup to a record at `idle`, which step 15 will then almost certainly reject, and that is deliberate rather than redundant. `idle` is not terminal, so rejecting at step 10 would report that the execution has ended, which is untrue. Letting it through means step 15 reports what is actually wrong — nothing is awaiting this response. The cost is one extra step evaluated; the gain is a diagnosis that does not send a reader looking for a completion that never happened.

#### Every fault names every failed check

**A fault names every check that failed**, not merely the first — where the sequence allowed more than one to be evaluated, all of them are reported, in the fault's `violations` ([ADR-008](./008-execution-faults-and-abandonment.md), **The fault object**). Steps 12 and 14 do not short-circuit for this reason: the four addressing comparisons are reported together, and a payload's schema violations are reported in full. This matches ADR-005, whose contract validation reports every broken rule at once, and it is the difference between one diagnosis and a run of redeliveries each revealing one more problem.

#### Protocol outputs commit atomically

Discarding a duplicate at step 9 is safe because the record that would have been written already exists, carrying that event's id in `event_ids`. **The protocol outputs of one delivery commit atomically**: the emitted events and the next record are preserved together, or neither is (**Required of infrastructure adapters**, obligation 1). **That atomicity covers only those two things. It does not cover anything the executor did outside Arvo.** A database write or an HTTP call made during a delivery that then faults, loses a compare-and-swap, or is redelivered has already happened and will happen again on the next attempt. The protocol offers no partial-completion state for such effects to resume from, so an executor MUST treat every external effect as one that may be repeated, and make it idempotent or cheap to repeat.

Inside the executor code, the developer can leverage two values the protocol already guarantees as idempotency keys. The delivered event's `id` is globally unique (ADR-001) and identical on every retry of the same delivery, so it keys a side effect that must happen once per delivery. The execution's `execution_id` is derived deterministically (**Execution identity**) and identical on every delivery to the same execution, so it keys a side effect that must happen once per execution. Both are on the execution context (**The execution context**). An executor that keys its external writes on one of them has a stable idempotency key on every repeat; whether that yields exactly-once effects depends on the external system honouring the key, which is outside the protocol and the executor's to verify.

#### What the gate asks of a mechanism

Because the handler fetches the record itself under a key it chooses, a mechanism need not classify, derive, or compare anything before dispatch. What the gate asks is that the state function answer honestly (**Resolving the existing execution**), and that a redelivered init find the record its first delivery wrote — which follows from committing the record durably under `execution_id` (obligation 1) and nothing else. A redelivered init then fetches a record at step 3 and faults at step 4 with `record_unexpected`, and a mechanism MAY treat that kind as a signal to stop redelivering rather than as an error to escalate.

### One delivery, in order

Every rule in this ADR and its companions applies at a definite point inside one delivery. The points are listed here in the order they occur, so that an implementation assembles the sequence from the specification rather than from inference. Each step is defined where the reference says; this list adds only the order.

1. **Receive.** The mechanism hands the handler the delivered event, the state function, dependencies as a value or a factory, the attempt number, the delivery's OpenTelemetry context, and hooks or an empty object (**Required of infrastructure adapters**).
2. **Open the delivery span**, continuing the delivered event's trace (**Observability**). Everything after this records against it.
3. **Run the gate**, steps 1 through 16 in sequence (**Entry validation**). Dependency resolution is its last step, so nothing outside the handler is reached for a delivery an earlier step refuses. A fault at any step ends the delivery at step 10 below; a discard at step 8 ends it with nothing to do.
4. **Resolve every option** for the version the gate confirmed (**Options**). Before step 6 of the gate only the handler level was available; from here the version's declarations apply.
5. **Build the execution context** for this delivery and nothing else (**The execution context**).
6. **Start the run clock and enter the executor** ([ADR-009](./009-execution-bounds.md), **Timeouts**). Nothing before this step is timed by it.
7. **On return, stop the run clock.** Where it expired, evaluate the execution clock before reporting, so the broader verdict wins ([ADR-009](./009-execution-bounds.md), **Where both expire in one attempt**). Where the executor returned in time, evaluate the execution clock anyway, since a return after the bound is a fault at return.
8. **Validate everything returned**, whole: each event's type, schema, depth and structure; the batch's composition; the value written through `set state` against the declared schema and for a JSON round trip (**What an executor returns**; [ADR-007](./007-execution-record.md), **A mixed batch completes**). A failure anywhere rejects the batch.
9. **Build the outputs.** On success, the emitted events and the next record, `cas_version` set, lifecycle decided by the batch ([ADR-007](./007-execution-record.md), **The execution record**). On a fault at any step above, the fault with its contingencies — the abandonment event where the caller can be addressed, the record at `failure` where one exists or can be built ([ADR-008](./008-execution-faults-and-abandonment.md), **Abandonment**).
10. **Record the outcome on the span and return** the produced pair, the discard, or the fault to the mechanism (**Instrumenting the protocol itself**). The handler retains nothing.

Two things the order settles that are otherwise stated only in passing: the run clock covers the executor alone, because it starts at step 6 and stops at step 7 with the gate — dependency resolution included — and return validation outside it; and a version's options are never consulted before step 4, because until the gate has confirmed the version there is no version to consult.

### Dependencies

#### Outside the model, supplied per delivery

An executor's implementation dependencies — a database client, an HTTP client, a clock, a secret — are outside the model. ADR-000 constrains them in exactly one way: "no live implementation dependency may be relied upon to survive one", a suspension. This ADR settles how they reach an executor so that the constraint holds by construction rather than by discipline.

**Dependencies are supplied per delivery, by the mechanism, alongside the event, the state function and the attempt number** ([ADR-009](./009-execution-bounds.md), **Retry**). They are not part of the handler's declaration: the record never holds them, and two handlers declaring the same contracts with different dependencies are the same handler to the protocol. What the executor is written against — the shape it expects to find on **dependencies** in the execution context — is that executor's own concern, and each language expresses it in its own way (ADR-004).

Dependencies are distinct from **mechanism hooks** (**The execution context**). Dependencies are the executor's: things its business code needs and would need under any mechanism. Hooks are the mechanism's: things one particular runner chooses to expose. An executor that uses a dependency is coupled to nothing; one that uses a hook is coupled to that mechanism by its own choice.

#### The two forms: a value or a factory

An implementation MUST accept dependencies in either of two forms:

```
dependencies    optional; where absent, the context member is present and empty

    either      a value                              used as given
    or          a factory                            called once per delivery
                  taking the delivered event,
                         the execution record or absence,
                         and the attempt number
                  yielding the value
                  may be asynchronous where a language distinguishes it
```

The value form is for dependencies that are safe to share across deliveries and hold no per-execution state — a configuration object, a pure client. The factory form is for everything else. Where a factory is supplied, the handler calls it **exactly once per delivery**, as the last step of the gate — step 16 under **Entry validation** — after every other check has passed and before the executor is entered. It is a gate step because it is a precondition of running business code, exactly as the fifteen before it are, and it is last because it is the one step that reaches outside the handler. It therefore receives a record the handler has already validated, or absence on an init, and never a structure not yet established to be a record (**Why the record is validated before anything reads it**). Whatever it yields is placed on the context as **dependencies**, unchanged; the handler does not inspect it.

The factory receives the attempt number for the same reason the state function does (**Resolving the existing execution**): a dependency built for a third attempt may reasonably differ from one built for a first — a longer connection timeout, a different replica — and the factory is the only place that decision can be made.

#### Why the factory form matters for resumability

The factory form is what a resumable handler needs. A handler runs only when something delivers to it, and between deliveries there is no process to hold anything; ADR-000's rule that no live dependency survives a suspension is not a restriction the protocol imposes on an executor so much as a description of the executor's situation. The factory makes that situation the ordinary one: nothing live is constructed until a delivery needs it, it lives for that delivery, and nothing about it is captured anywhere the next delivery could see. An executor that stashes a client in module scope and reaches for it next time has stepped outside the protocol, and an implementation SHOULD make the factory the easy path so that it need not.

Giving the factory the delivered event and the record lets a dependency be built *for this execution* rather than for the process: a client scoped to the tenant the init event names, a lock keyed on `execution_id`, a signal keyed on `subject`. That is what makes the cooperative pattern under **Cancellation** possible without adding anything to the model.

Three rules follow, and they are the whole of what the protocol asks:

- a resolved dependency MUST NOT be retained by the handler across deliveries — it is built for one and discarded with it, exactly as the execution context is (**One object, built per delivery**);
- a resolved dependency MUST NOT be written into the execution record — the record is JSON and a dependency is live, and `data` that will not survive a round trip is already a fault ([ADR-007](./007-execution-record.md), **Serializability of `data`**);
- a factory MUST NOT be able to alter the outcome of any other gate step, the collection, the depth check or the timeouts — it runs after every other step has decided and before the executor, and it is given the record to read, not to write.

#### A failing factory is a retry-safe fault

**A factory that fails is an execution fault, `dependency_resolution_failed`, and it is retry safe.** However the language signals the failure, the handler MUST NOT catch and reinterpret it: it surfaces as a fault with the failure rendered into `cause`, and nothing is emitted or written. It is retry safe because constructing a dependency reaches outside the handler — a pool that is exhausted now, a service that is restarting — and what is outside may answer differently a moment later. It is, with the state function, one of the two gate faults with that verdict ([ADR-008](./008-execution-faults-and-abandonment.md), **The `fault_kind` vocabulary and retry verdicts**), and for the same reason. Like every retry-safe fault it is subject to exhaustion, and on a followup it carries the abandonment pair, so a mechanism facing a dependency that never comes back can end the execution at `failure` with the cause on record rather than leave it at `waiting` forever.

The factory is not under the run clock ([ADR-009](./009-execution-bounds.md), **Timeouts**): the run clock bounds the executor's code, and a factory that hangs is diagnosed as a dependency failure, not as a stuck executor. An implementation MAY bound the factory on its own account, and where it does, expiry is this same fault.

### Cancellation

#### Nothing cancels an execution but itself

**Nothing can cancel an execution but the execution itself**, and this is a decision rather than an omission. There is no cancel event, and there is no way for one node to interrupt another. This ADR settles the point ADR-000 deferred, and settles it in the negative (**Scope**).

Two things already decided leave no room for anything else. A contract version declares exactly one `input` (ADR-005), so a handler's inbound events are its init event and its services' responses and nothing more; a cancel event would have to be a second model-level derived event alongside the handler error event, arriving at every version of every contract, and nothing in ADR-005 provides for one. And interrupting an execution that is *running* would need a control path outside the event stream, which ADR-000's *Event-Only Communication* forbids: "no node, coordinating or otherwise, may rely on a control mechanism absent from the model". Between deliveries there is nothing running to interrupt, and during one the executor is inside a delivery whose protocol outputs commit atomically (**Protocol outputs commit atomically**) and which either concludes or faults.

The absence is also honest about what a cancel event could not do. A response already in flight from a service would still arrive; an execution already at `success` cannot be un-completed; and an executor with side effects already made would need compensation the model cannot write for it. A cancel event would promise what only the application can deliver.

#### What the model provides

What the model provides is enough for an execution to stop itself and say so, and nothing more:

- **a way to notice.** The dependency factory receives the delivered event and the record (**Dependencies**), so it can consult whatever cancellation signal an application maintains — a flag in a store, a revoked token, a closed ticket — and hand the answer to the executor as part of its dependencies;
- **a way to record it.** The **cancel** member of the execution context marks the execution `cancelled` with a reason, and `cancelled` is terminal ([ADR-007](./007-execution-record.md), **Marking an execution `cancelled`**);
- **a way for the caller to be told.** An execution that marks itself cancelled and does not answer its caller raises `execution_cancelled`, non-retryable, carrying the abandonment pair, so a mechanism that abandons has the caller's answer ready and nothing to compose.

Everything else — what the signal is, where it lives, who sets it, what an execution does on the way out — is built on those by whoever needs it.

#### The cooperative pattern

The pattern that follows from the three provisions is short, and an implementation SHOULD document it as the way to cancel:

1. The application writes its signal somewhere its own code can read, keyed on an identifier the record carries.
2. On the next delivery, the dependency factory reads the signal and exposes it to the executor — conventionally as a flag or a value on the dependencies it returns.
3. The executor reads the flag and winds itself down: emitting whatever compensating events its contracts already permit, answering its caller with an own-`outputs` event that says what happened, and marking the execution `cancelled` so the record says why it ended rather than leaving it to look like any other completion.

Step 2 is why the signal is read through the factory and not through a mechanism hook: the pattern then works under every mechanism, and an executor written to it is coupled to nothing but its own application. A mechanism MAY additionally expose a cancellation hook of its own, under the constraints on hooks (**Mechanism hooks**), but the protocol does not depend on one.

#### Scope is the application's choice

**Scope is the application's choice**, because the record carries both identifiers and exposes both through **identity** on the context. Keyed on `execution_id`, a signal cancels one execution. Keyed on `subject`, it cancels every execution of a workflow, at every depth, the next time each is delivered to. Keyed on anything else the application derives — a tenant carried in the init event's payload, an order number in `data` — it cancels whatever the application means by that. Neither requires anything of the model, and all work through the same three steps.

What the model does not provide is a scope of its own, and this is deliberate. A model-defined "cancel this workflow" would have to choose between the executions that have already completed, those waiting on a service, and those not yet started, and no single answer is right for every application.

#### What cooperative means

Cooperative means the execution stops when it next runs and chooses to. Four limits follow, and an application relying on the pattern MUST be told them:

- **It takes effect on the next delivery, not now.** An execution at `waiting` is cancelled only when a response arrives; one whose services never respond is never delivered to again and never reads the signal ([ADR-009](./009-execution-bounds.md), **A service that never responds**). The execution timeout does not change this: it is checked only when a delivery arrives, so an execution nothing delivers to is never checked either ([ADR-009](./009-execution-bounds.md), **Timeouts**). What it adds is that the *next* delivery, if one comes, is refused for time whether or not any signal was read. An execution nobody will ever deliver to again is the mechanism's to notice, not the handler's.
- **A response already in flight still arrives.** It reaches a record at `cancelled`, which is terminal, and is refused at gate step 10 as `lifecycle_terminal`. That refusal is a fault, and the mechanism handles it as one; it is not a defect in the cancelling execution.
- **The executor decides what winding down means.** The protocol does not know which side effects were made or how to undo them. Compensation is expressed through events the contracts already permit, and where a contract permits none, there is none.
- **The cancelling execution still answers.** Marking `cancelled` is a reason to stop, not a way out of the protocol, and the three outcomes under [ADR-007](./007-execution-record.md), **Marking an execution `cancelled`** decide what reaches the caller, or what the mechanism is handed to send.

## Consequences

### Gained

**A handler is a function.** Of a delivered event, a record fetched through a state function, resolved dependencies, and an attempt number — and of nothing else. That makes it testable with literal values and no infrastructure, which is the property that most reliably decides whether resumable code can be reasoned about. A test hands in an event, a function that returns a fixed record, a value for dependencies and the number 0, and checks the events and record that come back.

**Resumption is one keyed read, and the mechanism needs to understand nothing.** The state function takes `execution_id` and returns what is under it. A mechanism does not classify, does not derive, does not know what a record is, and never authors one. Everything it stores and forwards was built by the handler, so the model's data has one author everywhere.

**Identity is derived, unique, and the same in every language.** `execution_id` is a pinned hash of two fields the init event already carries, so two handlers in two languages reading one event agree on which execution it opens, and a unique init `id` makes every execution unique without a coordination step.

**The capability set is closed and known before anything runs.** A mechanism can determine what a handler may emit from its declaration, a type system can reject an impermissible emission before deployment, and a declaration that cannot work — a version without an executor, a type collision, two versions of one service, an execution timeout shorter than a run timeout — is refused before any event exists.

**Observability is uniform.** Every delivery is a span continuing the event's trace, and every executor reaches the same three OpenTelemetry objects through the context, so a workflow's trace joins up across suspensions and across implementations without an adapter for each backend.

**Silence is never the handler's doing.** An execution cannot cancel without either answering or handing the mechanism the answer, cannot complete a sink version without resting at `success`, and cannot be abandoned without the caller's answer already built. Where a caller is left waiting, it is a mechanism's policy that left it, and a visible one. `idle` remains, and because every legitimate way of returning nothing rests elsewhere, it is a reliable signal that something was forgotten.

### Paid for

**The mechanism carries more.** It must supply a state function that reads live on every call, an attempt number it may not naturally track, dependencies in either of two forms, and hooks under a mutability constraint. The obligations under **Required of infrastructure adapters** are strict enough that a naive mechanism — publish, then persist — is non-conformant rather than merely lossy, and one that cannot compare-and-swap cannot claim conformance at all.

**Durability moves entirely onto whatever runs the handler.** The handler writes nothing and remembers nothing; every guarantee about the record's survival is the mechanism's, and the protocol can only state what it requires.

**The executor holds the misrouting risk.** Because it returns finished events, a hand-built event with a wrong `subject` or `initid` is structurally valid and passes every check at return. The builder removes the need to take that risk, and the unsafe surface names it, but the protocol cannot make it impossible without refusing pre-built events, which **Considered Alternatives** rejects.

**OpenTelemetry is named.** Mandating an observability API is a mild strain on Infrastructure Independence (**Invariants strained**); the ADR accepts it because the alternative is a workflow trace that fragments at every language boundary.

## Considered Alternatives

### Deriving the per-execution identifier into `subject`

Considered, not chosen. A draft of this protocol took that shape — a fresh `subject` per execution, `executionid` constant across the workflow — on the reasoning that a record wants a unique key and `subject` was the more natural name for one. It contradicts ADR-001 twice over: `subject` is defined there as inert, with "nothing derived from it by inspection", and as minted once and copied unchanged; and `executionid` is defined as identifying an execution, not a workflow. ADR-001 also records the same idea as already tried — "earlier designs chained subjects to carry coordination state, making one field both the workflow key and the coordination mechanism; it served neither well."

The storage motivation survives intact under ADR-001's assignment, which is why nothing was lost: `execution_id` is the unique record key and `subject` is the grouping key, the same two-key design with the roles as ADR-001 assigns them. Resumption remains a single keyed read, because a completion carries its caller's `executionid`.

### Having the handler construct every event from a type-and-payload request, refusing pre-built events

Considered, not chosen. A draft had the executor return requests — a `type` and a `data` — and the handler build every event from them, refusing any finished event an executor handed back. It is the tighter shape: the addressing rules run in exactly one place, and a misrouted `subject` or `initid` becomes impossible rather than merely unsafe.

It was rejected because it makes the handler the only party that can ever produce an event, and there are legitimate cases where an executor must set what the defaults would not — a domain from a source the builder does not know, a `traceparent` continuing a context the executor received from outside the model, a `to` for a service contract shared by several handlers. Under a request model each of those becomes a request option the protocol has to define, and the list never closes. Under the chosen model the executor returns finished events, the builder makes the correct event the easy one, the unsafe fields are named so that overriding one is a visible act (**What an executor may set**), and validation at return catches everything that is structurally checkable. What the handler cannot check — a wrong but well-formed `subject` — it cannot check under either model, since the request model merely moves the same mistake to a request option.

### Prohibiting the self contract as a service

Considered, not chosen. Forbidding a handler from declaring its own contract as a service would keep `dataschema` sufficient for classification on its own, with no tie-break to state. It would also forbid recursion, which is a legitimate shape — a tree walk or a fan-out over the same contract has no other honest expression in a model where a handler implements exactly one contract. The tie-break costs one field read on one overlap, and it is unambiguous by a rule ADR-005 already holds, so the prohibition would buy simplicity the protocol does not need at the price of a capability it does (**The self contract may be a service**).

### Naming a destination on each emission

Considered, not chosen. Deriving `to` from the emitted event's type is what forces the collision rule under **No two capabilities may share an event type**, and that rule is a real cost: it can reject a handler whose declared capabilities are individually valid, and a contract author cannot anticipate it. Letting an executor name the destination would remove it.

It was rejected because naming a destination introduces a second way to say the same thing and therefore a way for the two to disagree, and because the collision it guards against is detectable once, at declaration, where the whole capability set is visible, rather than at every call site.

### Having the mechanism classify the delivery and resolve the record

Considered, not chosen. A draft had the mechanism read `dataschema`, decide init from followup, derive or read the key, and hand the handler a record or nothing. It removes a call from the handler's entry path. It also puts classification — the first and most consequential step of the gate — in code this ADR does not govern, so a mechanism that got it wrong would hand the handler a plausible record for the wrong execution, and the handler's every later check would be validating the wrong thing. The state function (**Resolving the existing execution**) keeps the mechanism classification-blind: it receives a key and returns what is under it, and every judgement about what came back is the handler's.

### Defining cancellation as a model primitive

Considered, not chosen. A derived cancel event on every contract, mirroring the handler error event, is the only shape that would work event-natively, and it fits the machinery: `in_flight_event_map` already names exactly the children an execution would need to cancel, so propagation down the tree would need nothing new. It was rejected on cost against demand. It makes the handler error event no longer the single standardized emit ADR-005 deliberately kept it as, it adds a third classification case every implementation and every handler must then handle, and it makes cancellation a thing a node can have done *to* it — a meaningful shift in what a participant is, for a capability most handlers never use.

Note what was and was not avoided. The terminal `cancelled` lifecycle exists either way, because a record should say why an execution ended under either design; that was never the expensive part. What the cooperative form avoids is the inbound event, the classification case, and a participant losing the property that nothing external stops it (**Cancellation**).

### Requiring a specific concurrency mechanism

Considered, not chosen. Naming a locking or transaction strategy would make the guarantee concrete and testable. It would also make this ADR the first to require a particular infrastructure capability by name, which ADR-000's *Infrastructure Independence* is explicit about avoiding. Stating the obligation — compare-and-swap on `cas_version`, and the outbox behaviour under **Required of infrastructure adapters** — and leaving the mechanism free preserves that.

## Conformance to ADR-000

### Effect on AAM

This ADR amends the AAM membership list (ADR-000, *Arvo Application Model*) by explicit reference, in four ways, and its companions in two more (ADR-007 and ADR-008, **Effect on AAM**).

**It replaces "handler interfaces and lifecycle semantics"** with what this ADR and its companions define: the declaration model and options, execution identity, the execution context, classification and the gate (here); the execution record and its lifecycle (ADR-007); the failure categories and the abandonment pair (ADR-008); depth, retry, the two timeouts and collection (ADR-009). All of these are inside the model, because a handler whose lifecycle meant different things under two mechanisms would not be one handler.

**It places one derivation inside the model.** The `execution_id` derivation (**Execution identity**), pinned byte for byte, because an identifier two implementations compute differently is not an identifier.

**It places the observability API inside the model, and leaves the backend outside.** The shape through which an executor reaches trace, log and metric — OpenTelemetry's span, logger and meter — is inside (**Observability**). Collection, retention and export remain outside, exactly where ADR-000 already lists them. The line is drawn at the API because that is where a workflow's trace would otherwise fragment.

**It decides the Deferred Decision on cancellation, interruption and compensation by splitting it.** *Interruption* — one node stopping another — is placed outside the model, and Arvo defines nothing for it. *Compensation* is likewise outside: it happens through events a contract already permits and needs no primitive. What is inside is only what a durable record requires: the terminal `cancelled` lifecycle, `lifecycle_description` to say why, and the `execution_cancelled` fault that hands a mechanism the caller's answer when an execution cancels without giving one. The signal an application reads is not a model concept (**Cancellation**).

### Invariants depended on

- **Event-Only Communication.** Every interaction here, including a handler's own failure and its abandonment, is an ArvoEvent governed by a contract. Cancellation is defined cooperatively precisely so that nothing needs a control path outside the stream.
- **Explicit Contracts and Runtime Validation.** The closed capability set, the gate, the record's validation and the checks at return all rest on a contract being a complete, checkable declaration, and all validate at runtime rather than trusting a type.
- **Infrastructure Independence.** The handler reaches no store and names no transport. It receives a state function, an attempt number and dependencies, and returns events and a record; everything it requires of a mechanism is stated as a property.
- **Nondeterminism Is Permitted.** Nothing here requires an executor to be deterministic, because recovery republishes what was committed rather than recomputing it, which follows from adapter obligation 1 below.
- **Observability by Default.** Every delivery continues the delivered event's trace, and the lineage fields ADR-001 defines are set by the handler on every emission, so composition stays observable without an executor doing anything.
- **Explicit Failure Boundaries.** ADR-000 distinguishes protocol failures from handler failures and defers their representation; [ADR-008](./008-execution-faults-and-abandonment.md) supplies it, and this ADR's gate is where the protocol failures arise.

### Invariants strained

**Open Composition** is addressed rather than strained by the depth guard; the reasoning is in [ADR-009](./009-execution-bounds.md), **Invariants strained**.

**Infrastructure Independence**, mildly and deliberately, in two places.

The first is **Required of infrastructure adapters** below, which places five hard obligations on any mechanism, a stronger demand than any prior ADR makes. The strain is contained: every obligation is stated as a behaviour the mechanism must exhibit, never as a technology it must use, and ADR-000's *Applying This ADR* already anticipates that a downstream ADR states what it requires of adapters.

The second is naming OpenTelemetry. ADR-000 says the model "must not depend on a particular ... delivery mechanism", and an observability vendor is not on that list, but the spirit of the invariant is that the model names no technology. This ADR names one API. The defence is the distinction **Observability** draws between API and backend: OpenTelemetry is a vendor-neutral specification with implementations in every language AAM targets, naming it fixes nothing about where telemetry goes, and the alternative — each implementation choosing its own tracing API — is a workflow whose trace breaks at every language boundary, which *Observability by Default* forbids more directly than *Infrastructure Independence* forbids naming an API.

### Required of infrastructure adapters

Five obligations. Each is a behaviour, and how a mechanism achieves it is the mechanism's own. The first and fifth are not sufficient alone, for the reason given after them.

1. **The emitted events and the next execution record MUST be preserved together, and the events MUST reach their destinations once the record is committed. This is the outbox guarantee, and a mechanism MUST provide it.** Concretely: the record and the events a delivery returns are committed as one unit or not at all; no event is published before that commit succeeds; every event so committed is published at least once, however many crashes intervene; and on recovery a mechanism republishes the committed events *as committed*, byte for byte, rather than re-running the delivery to regenerate them. How the guarantee is met — a transactional outbox table, a log the store and the transport share, a single durable component doing both — is not this ADR's concern, and it names none. What it requires is that the behaviour hold.

   Two consequences follow, and the rest of this ADR leans on both. A mechanism that publishes events but loses the record, or commits the record but drops the events, produces an execution whose own history describes traffic that never happened, and no handler-side behaviour can repair that from the inside. And recovery **republishes what was committed** rather than recomputing it: either the commit succeeded, in which case the events are durable and a recovery re-sends those exact events, or it did not, in which case nothing was published and a retry runs against an unchanged record. There is no third case in which *committed* output is regenerated and might differ — which is why nothing here requires an executor to be deterministic, and why the abandonment event must be complete, `id` included, so that a republished copy is discarded at the receiver's gate as already seen. A delivery whose commit did not succeed is a different matter: it runs again on retry, its executor runs again, and any external effect it made is made again (**Protocol outputs commit atomically**).

2. **The mechanism MUST supply the state function, and MUST answer it live.** For every delivery it gives the handler an operation that takes `execution_id`, the delivery's telemetry and the attempt number, and yields absence or a parsed JSON object (**Resolving the existing execution**). The operation MUST read the store on every call rather than yield a value captured earlier; it MUST NOT be given the event or the classification; it MUST NOT branch on anything but the key; and it MUST validate nothing beyond parsing. Whether what it yields is a record, belongs to this event, or is still resumable is the handler's to judge. A mechanism that classifies, derives, or filters on the handler's behalf has taken a decision this ADR gives the handler, and is non-conformant even where it happens to be right.

3. **A mechanism that abandons an execution MUST do so with the fault's `abandonment_state` and `abandonment_event`, together, and with nothing of its own.** Whether to abandon is the mechanism's policy, and this ADR neither requires nor enumerates what a mechanism does with a fault it will not retry ([ADR-008](./008-execution-faults-and-abandonment.md), **Abandonment**). The only requirement is negative: on a fault that is not retry safe, or one whose attempts are spent, it MUST NOT redeliver. Dead-lettering, alerting, or holding for a person are examples of what a deployment might choose, offered as illustration and nothing more. Where it does abandon, it commits whichever of the two the fault carries under obligation 1, and at no earlier moment: publishing on an attempt that then succeeds would hand a caller both an error and a real completion for the same request. Without the record, an abandoned execution is indistinguishable from one still waiting; without the event, the caller waits on an execution already given up on; so where the fault carries both, a mechanism that abandons commits both as one unit or neither. The fault does not always carry both ([ADR-008](./008-execution-faults-and-abandonment.md), **When each is present, and why they differ**), and the rule is the same for every shape: **act on every contingency the fault carries, exactly as handed, and on nothing it does not.**

   | The fault carries | Abandoning means |
   |---|---|
   | event and record | commit the record and publish the event together, under obligation 1 |
   | event only — an init fault raised in the gate | publish the event; no execution began, so there is no record to commit and none is invented |
   | neither — `event_unclassifiable`, a pre-record followup fault, `lifecycle_terminal` | there is nothing to act on; what the mechanism does with the fault is entirely its own |

   It authors neither: only the handler could have addressed the event or written the record's own version and state, so it is handed both finished and MUST NOT compose a substitute.

4. **Every retry MUST be a fresh delivery.** The mechanism re-invokes the handler with the same event and the incremented attempt number, and the handler re-reads the record through the state function, which obligation 2 keeps live. The mechanism MUST NOT cache behind the state function, MUST re-resolve dependencies through the factory where one is supplied, and MUST NOT continue past a fault whose `retry` is `null` ([ADR-009](./009-execution-bounds.md), **Retry**). Only the attempt number carries forward, which is the one input a retry genuinely inherits.

5. **Writes to one execution record MUST be serialized.** Two responses arriving concurrently otherwise read the same record and write disjoint entries, and the later write erases the earlier — leaving an execution awaiting a response it already received. The record carries `cas_version` so that optimistic concurrency can satisfy this ([ADR-007](./007-execution-record.md), **`cas_version`**). A mechanism MUST commit a record at `cas_version` `0` only where no record exists under its key — a create-if-absent — and MUST refuse it where one does, since two init deliveries for the same execution would otherwise both create it. It MUST refuse any other record whose `cas_version` is not exactly one greater than the stored record's.

Optimistic concurrency is a good fit here: concurrent responses write different keys of the collection, so the contention is an artefact of storing one record rather than a semantic conflict, and the mechanism may redeliver the losing delivery. Where a response lands on an incomplete collection the executor is never entered, so a failed write has no side effect to undo. Where a response completes the collection, two writers can each believe they completed it and each enter the executor — which the first obligation resolves for the protocol's outputs, since the loser's events and record fail to commit as one unit and nothing is published. It does not resolve anything the losing executor did outside Arvo: both executors ran, and an external effect each made was made twice. Compare-and-swap serializes commits, not executions, and repeated external effects remain the executor's responsibility (**Protocol outputs commit atomically**). This is why obligations 1 and 5 are stated together and neither is sufficient alone.

Beside the five, a mechanism supplies three inputs this ADR defines the shape of and nothing else about: the attempt number, counting from 0 ([ADR-009](./009-execution-bounds.md), **Retry**); dependencies, as a value or a factory (**Dependencies**); and hooks, read-only or stably mutable, or an empty object (**Mechanism hooks**). And it MUST supply a delivery's OpenTelemetry context so that the handler's span continues the delivered event's trace (**Observability**).

### Left deferred

- **Execution capability profiles as a format**, including how a handler would declare the five obligations above rather than have an ADR assert them.
- **Domain sources beyond the minimum.** **Domain** fixes the sources an implementation MUST offer; whether the set should be closed, extended, or made pluggable is left open.
- **Whether emitted event identifiers should be derived** rather than freshly generated — unnecessary given obligation 1, and available as defence in depth if a later decision wants it.
- **Delivery ordering and concurrent event handling** across executions. Obligation 5 serializes writes to one record and says nothing about order across records.

## Appendix: An illustrative handler surface

These sketches are illustrative only. They do not define the protocol and they are not a specification of any language's API — per ADR-004, API shape is each language's own choice. They exist to make the rules above concrete by showing them together, in a notation belonging to no language. Where prose and a sketch ever appear to disagree, the prose governs.

### Declaring a handler

```
handler
    self        com_order_create                    the contract this handler implements;
                                                    every version it declares gets an executor
    services                                        declared once, for the handler
        payments    com_payment_charge @ 1.0.0      a contract it may send to,
                                                    at exactly one version

    options                                         handler level: all seven always present;
                                                    the protocol default fills any the author omits;
                                                    never hashed -- see Options
        max_depth              10000                (default)
        max_retry_attempts     5
        retry_delay            f(event, record | null, attempt, max) → 200 × attempt
                                                    record is null when called before a version is known
        run_timeout            10000
        execution_timeout      null                 (default) unbounded
        collect                all                  (default)
        handler_error_domain   none                 (default)

    version 1.0.0
        state                                       optional; omit for a stateless version
            order_id    string                      the author's schema for record.data,
            attempts    integer                     kept compatible once deployed
        options                                     version level: every key optional;
                                                    unset means inherit the handler's value
            max_depth              250
            execution_timeout      86400000         never below the resolved run_timeout
            handler_error_domain   "orders_failures"
                                                    the other four are inherited from the handler above
        execute(ctx) → event | [event, ...] | nothing, or throw

    version 1.2.0
        execute(ctx) → ...                          stateless: the executor alone

a declaration that cannot work is refused here, before any event exists:
a version without an executor, an executor for an undeclared version,
two capabilities sharing a type, two versions of one service, an option
outside its domain
```

### Inside an executor

The context is the executor's whole view. `entry` discriminates `event`, so a payload is only reachable once the case is settled.

```
execute(ctx):

    ctx.event               the delivered event, restored
                              entry = init      → the init event
                              entry = followup  → one service's response: its
                                                  outputs event or its handler error event
    ctx.entry               init | followup
    ctx.attempt             which attempt this delivery is, from 0
    ctx.init_event          the event that opened this execution
    ctx.identity            subject, execution_id, parent_execution_id, depth, version
    ctx.collected           the responses in hand this round, and what is still outstanding
                            under collect = all it is always complete on entry
    ctx.state               record.data; present only where the version declared a schema;
                            null until written
    ctx.set_state(value)    replaces data whole; the schema rejects → state_schema_rejected
    ctx.dependencies        as resolved for this delivery, or empty
    ctx.at_max_depth        true when one more service emission would reach max_depth
    ctx.time_remaining      ms left on the run clock and on the execution clock,
                            as of entry; null where a clock is unbounded
    ctx.telemetry           span, logger, meter -- OpenTelemetry, for this delivery
    ctx.hooks               whatever the mechanism exposed; read-only or stably
                            mutable; empty where none

    ctx.build(
        type                a service's input type, or a key of this version's outputs
                            -- never the handler error type
        data                checked against whichever schema that type selects
        domain              optional; a literal, or a source to resolve one from
        ...                 the safe fields; the unsafe group only through a
                            visibly separate surface -- see "What an executor may set"
    ) → event               fully addressed; to, subject, executionid, initid,
                            parentid, depth, category, dataschema all set for you

    ctx.cancel(reason)      marks cancelled, terminal; still answer your caller,
                            or the handler raises execution_cancelled for you

    throw ctx.fault(reason, retryable = true)
                            an execution fault, for a delivery that cannot proceed;
                            the caller hears nothing while retries remain, and
                            afterwards only if the mechanism abandons with the pair

    to report that the work failed, just fail: any error escaping the executor
    becomes the handler error event, which the caller already handles

    return event            a batch of one
    return [ ... ]          one batch, validated whole; [] emits nothing
    return                  nothing; rests at waiting if anything is outstanding,
                            at idle if not -- or at success for a sink version
```

### What the mechanism calls

The handler is entered once per delivery and holds nothing between them. It is given a way to reach the record, never the record itself.

```
execute(
    event           the delivered event
    state           an operation: (execution_id, telemetry, attempt) → record | absence
                    reads the store on every call; parses and nothing more;
                    knows nothing of init or followup
    dependencies    a value, or a factory (event, record | absence, attempt) → value
    attempt         which attempt this delivery is, from 0
    telemetry       the delivery's OpenTelemetry context
    hooks           optional; whatever this mechanism exposes to executors
)
    → produced { events, record }        commit together, then publish -- the outbox
                                         guarantee, obligation 1. includes the case
                                         where the executor failed and the handler
                                         error event is among the events
    → discarded                          already seen; nothing to do, nothing wrong
    → fault    an ArvoHandlerFault       nothing is committed or emitted now.
                                         read retry; where present, redeliver with
                                         attempt + 1; where null, do not. what happens to a
                                         fault you will not retry is your policy; if
                                         you abandon, commit abandonment_state and
                                         publish abandonment_event together, as handed
```

The asymmetry in that return is the failure model in one place. A handler error comes back as `produced`, because it is a concluded execution that happens to have emitted an error event. Only a fault comes back as `fault`, and only a fault is a mechanism's problem.

Note what the two returns have in common. `produced` hands over events and a record to commit together, and a fault's abandonment pair is the same two things held back for a decision only the mechanism can make. A mechanism that has implemented `produced` correctly has already implemented most of abandonment.
