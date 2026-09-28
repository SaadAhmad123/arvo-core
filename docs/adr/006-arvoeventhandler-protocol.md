# ADR-006: ArvoEventHandler Protocol

- **Status:** Proposed
- **Date:** 2026-09-27
- **Scope:** Arvo ecosystem
- **Amends:** AAM 1 membership (ADR-000)
- **Supplies:** the `executionid` derivation and the incoming-event classification that [ADR-001](./001-arvoevent-structure.md) leaves to "the handler protocol ADR"; the conditions for routing a failure to the workflow root remain deferred (see **Left deferred**)
- **Addresses, in part:** ADR-000 Deferred Decisions — "ArvoEventHandler execution semantics" (settled here); "Handler state serialization, persistence, migration, and recovery" (settled here, migration by prohibiting it); "Handler concurrency and event-waiting patterns" (settled here); "Cancellation, interruption, and compensation semantics" (decided here by splitting it — see **Conformance to ADR-000**). [ADR-005](./005-arvocontract-structure.md) **Left deferred** — "dependency declaration, capability resolution, and binding", "a handler's own runtime decision of which permitted event to emit and when", and "domain resolution, inheritance, and any orchestration-context-dependent routing strategy" (all settled here)
- **Left deferred:** timers, deadlines, and scheduling; the conditions for routing a failure to the workflow root; any bound on fan-out; execution capability profiles as a format; error kinds beyond handler failure. The full list is under **Conformance to ADR-000**

Conformance language is as defined in [ADR-000](./000-arvo-system-identity-and-architectural-principles.md).

## Scope

### What this ADR defines

This ADR defines what an **ArvoEventHandler** is and how one is entered, resumed, and completed. It settles how a handler declares the contracts it implements and depends on, how an execution is identified, what an execution durably remembers, how an incoming event is classified and checked before any business code runs, how outstanding responses are collected, how deep a handler will go before it stops calling out, how failure is categorized and retried, how an executor's dependencies reach it, how an execution stops itself, and what a handler requires of whatever runs it.

It defines the handler as a **stateless operation over a delivered event, a prior execution record, its resolved dependencies, and which attempt this delivery is**, returning emitted events and the next execution record. The handler holds nothing between deliveries and reaches no store. The executor it runs is not pure — it may call a database or a service through its dependencies — and what those calls do outside Arvo is the executor's own to make safe.

Two parties appear throughout, and the ADR keeps them apart. The **handler** is the protocol layer this ADR specifies: it validates, classifies, records, supplies the addressing for every event, and checks every event an executor returns. The **executor** is the business code a handler runs for one version of its contract: it reads what the handler gives it through a context, returns the events it wants emitted, and may fail. Everything between one delivery and the next belongs to a third party, the **mechanism** that runs the handler, and this ADR states what the handler requires of it without saying how it is built.

### What this ADR deliberately does not define

- **Any particular durable mechanism.** This ADR states obligations a mechanism must meet. It names no broker, database, transaction, lock implementation, or scheduler, and requires no specific one. Where it requires a behaviour — the outbox guarantee under **Required of infrastructure adapters**, obligation 1 — it requires the behaviour and not any implementation of it.
- **Native API shape.** Per [ADR-004](./004-multi-language-implementation-governance.md), how a language exposes handler declaration, the execution context, or emission is that language's own choice. This ADR fixes semantics and the field names of the two objects that leave the process — the execution record and the fault — not method names or type names.
- **Migration of an execution record.** Not deferred — decided against. An execution record belongs to one contract version for its whole life and MUST NOT be moved to another (see **Version authority**).
- **Timers, deadlines, and scheduling.** ADR-000 defers these, and this ADR defines no timer: nothing in it fires without a delivery. The two timeouts under **Timeouts** are bounds a handler checks when it is entered, not scheduled events, and they leave the deferral intact. What this ADR does assign is the responsibility: following up on an execution that is waiting on something that never arrives belongs to whatever runs the handler (**Retry**, **Collection**).
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

The self contract is declared as a contract, not as a version. A handler implements every version of its self contract, one executor each (see below), and an incoming event selects among them. A service contract is declared as **one contract at one version**, for the reason given under **No two versions of one service contract**.

#### One executor per version

A handler MUST declare one **executor** per version of its self contract that it implements. An executor is the business code that runs when an execution of that version is entered or resumed. Versions are fully isolated under ADR-005 — "no two versions are ever compatible by construction" — so an executor written against one version's declared shapes has no defined behaviour against another's, and a handler MUST NOT run a version's executor over an execution that belongs to another version (see **Version authority**).

A handler MUST declare an executor for **every** version its self contract declares, and MUST be rejected at declaration time if any version lacks one or if an executor names a version the self contract does not declare. ADR-005 already requires this: "a handler bound to this contract implements every declared version's `input`/`outputs` fully and independently; nothing here defines partial or inherited implementation". The consequence for removing a version is under **Version authority**: a version leaves the handler by leaving the contract, and its executor with it.

#### The closed set of emittable events

The set of events a handler may emit is exactly:

- the input event type of each declared service contract, at its declared version;
- every key of its self contract version's `outputs`, for the version whose executor is running;
- its self contract version's handler error event.

An execution MUST NOT emit anything else, and MUST NOT acquire a capability not present in the declaration. This is the "static boundary" ADR-000 asks for, and it is what lets a mechanism determine what a handler may do before running it, and lets an implementation with a type system reject an impermissible emission before it is deployed.

The set is closed per version, not per handler. A handler with two versions has two such sets, sharing the service inputs and differing in the `outputs` keys and the handler error type.

#### What an executor may return

Of the three kinds of emittable event, **an executor may return the first two only.** It may return an event to a declared service, and it may return one of its own version's `outputs`. The handler error event is not something an executor constructs or returns: the handler produces it, and only in response to the executor failing or to a condition the handler itself detects. A returned event carrying the handler error type is an execution fault (`emission_not_permitted`), however it was built. An executor that could construct it could claim to have failed while continuing to run, and an executor that wants to say "I cannot do this" says so by failing. The causes are closed and listed under **Failure protocol**.

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

An executor MAY declare a schema for business state it wishes to remember between deliveries. Where declared, it governs the `data` field of the execution record (see **The execution record**) and is validated against `data` at every entry, once the version is known (see **Hydration**).

An executor that declares none is still resumable — it may emit to a service and be re-entered on the response — and still has an execution record. It simply has nothing of its own in it. Resumability is a property of the protocol, carried by the record's own fields; business state is what an executor adds to that, and it is optional.

### Options

#### One table, one rule

Seven **options** govern how a version behaves. They are defined here and nowhere else: every other section says what its option *does*, and refers here for its type, its default, how its value is found, and what the protocol substitutes where a resolved value cannot be used at the moment it is needed — the **Fallback** column, which is N/A for every option whose value is a plain number or literal, since those cannot fail at use.

| Option | Type | Handler level | Version level | Fallback |
|---|---|---|---|---|
| `max_depth` | integer ≥ 0 | **required**; `10000` where the author writes nothing | optional; falls back to the handler's | N/A |
| `max_retry_attempts` | integer ≥ 0 | **required**; `3` where the author writes nothing | optional; falls back to the handler's | N/A |
| `retry_delay` | integer ms ≥ 0, or a function `(event, record \| null, attempt, max_retry_attempts) → integer ms` | **required**; `300` where the author writes nothing | optional; falls back to the handler's | `300` ms, where the function form fails at use (**`retry delay` must not be able to fail**) |
| `run_timeout` | integer ms > 0, or `null` for unbounded | **required**; `30000` where the author writes nothing | optional; falls back to the handler's | N/A |
| `execution_timeout` | integer ms > 0, or `null` for unbounded | **required**; `null` where the author writes nothing | optional; falls back to the handler's | N/A |
| `collect` | `all` \| `each` | **required**; `all` where the author writes nothing | optional; falls back to the handler's | N/A |
| `handler_error_domain` | a domain literal, or one of the four source identifiers under **Domain** | **required**; `none` where the author writes nothing | optional; falls back to the handler's | N/A |

**The handler level is complete.** A handler always holds a value for every one of the seven. An author who writes nothing for one gets the value in the third column, which the protocol defines; there is no state in which a handler lacks an option. **The version level is sparse.** A version declares only what it wants to differ, and an option it does not declare is `null`, meaning *inherited*.

**Resolution is one rule:** the version's value where the version declared one, otherwise the handler's. There is no third step, because the handler is never missing a value. The rule holds identically wherever and whenever an option is read — at declaration, at a gate step, on return — and it does not matter whether a version is known at that moment: **where no version is known, the version side is `null` for every option and the handler's values apply.**

#### What each option governs

| Option | Governs | Defined under |
|---|---|---|
| `max_depth` | how deep an execution of this version may sit or reach | **Depth** |
| `max_retry_attempts`, `retry_delay` | how many attempts a retryable fault may be given, and how long to wait between them | **Retry** |
| `run_timeout`, `execution_timeout` | how long one attempt may run, and how long the execution may live | **Timeouts** |
| `collect` | whether the executor is entered once all responses are in, or on each | **Collection** |
| `handler_error_domain` | the `domain` the handler error event carries | **Domain** |

#### Validated at declaration, at both levels

Every value at either level MUST lie in its type's domain, and a value outside it is a declaration error: the handler MUST be rejected at declaration time, the same treatment the ADR gives a version without an executor and a capability set with a type collision (**Definition and declaration**). A defect in code is visible before any event exists, so no fault is defined for it and no backstop at delivery is needed.

One relation spans two options and is checked on each version's **resolved** pair, after the rule above has been applied: **`execution_timeout` MUST NOT be smaller than `run_timeout`**, and **where `run_timeout` is `null`, `execution_timeout` MUST be `null` too** (**Timeouts** gives the reason). A handler-level `run_timeout` and a per-version `execution_timeout` are checked against each other exactly as two per-version values would be.

#### Names are API shape; the rest is not

What each option is called in a language, and whether the two levels are two objects or one object with overrides, is API shape and each language's own choice (ADR-004). The set of seven, their types, their defaults, the two levels, and the resolution rule are not.

### The execution context

#### One object, built per delivery

Everything an executor can know or do, it knows or does through one object the handler builds for the delivery: the **execution context**. It is constructed after the gate has passed (**Entry validation**) and the record has been hydrated, and it is the only argument an executor receives. It MUST be built fresh for every delivery and MUST NOT be retained across deliveries: an executor that keeps a reference to it holds nothing meaningful once the delivery ends, which is the same property ADR-000 requires of every implementation dependency across a suspension.

The members below are normative in their existence and semantics. What each is called, and whether it is a property, a method, or a nested object, is API shape and each language's own choice (ADR-004). The **Type** column names the shape in language-neutral terms — an ArvoEvent, a JSON value, a boolean, an operation with its inputs and result — and is normative in the same way: what a member holds is fixed, how a language spells that type is not. An implementation MAY add members, and MUST NOT remove or alter the meaning of any listed here.

#### What the context exposes

| Member | Type | What it is | Read or write |
|---|---|---|---|
| **delivered event** | ArvoEvent | The event that caused this delivery, restored to an event value. On an init delivery it is the init event; on a followup it is one service's response — an `outputs` event or the handler error event of that service. | read |
| **entry kind** | `init` \| `followup` | `init` or `followup`, as **Classification** resolved it. The delivered event's payload MUST be reachable only once this is known, so business code cannot read an init payload as if it were a response, or the reverse. | read |
| **attempt** | integer, from 0 | Which attempt this delivery is, counting from 0, as the mechanism supplied it (**Retry**). | read |
| **init event** | ArvoEvent | The event that opened this execution, from `state.init_event`. On an init delivery it is the same event as the delivered event. | read |
| **identity** | object: `subject` string, `execution_id` string, `parent_execution_id` string, `depth` integer, `version` string | `subject`, `execution_id`, `parent_execution_id`, `depth`, and `version`, as held on the record. Exposed so an executor can key its own resources on them (**Cancellation**), never so it can change them. | read |
| **collected** | map: emitted event `id` → ArvoEvent \| `null` | The responses in hand for the current round, keyed as `in_flight_event_map` keys them, and which keys are still outstanding. Under the default join it is always complete when the executor is entered (**Collection**). | read |
| **state** | the declared schema's type \| `null`; absent where none declared | The executor's own business state, `state.data`. Present only where the version declared a schema. `null` on a new execution until written. Written through **set state** and no other way. | read, and write through `set state` |
| **set state** | operation: (value) → nothing; faults on rejection | Replaces the business state whole. There is no partial write and no merge: an executor that keeps part of the old state copies it forward itself. Validated against the declared schema, and a value the schema rejects is a non-retryable execution fault, `state_schema_rejected` (**Failure protocol**). | write |
| **dependencies** | the executor's own type; empty object where none supplied | Whatever the dependency factory resolved for this delivery, or the value supplied (**Dependencies**). | read |
| **event builder** | operation: (`type`, `data`, options) → ArvoEvent | Constructs a fully addressed event from a `type` and a `data`, applying every default under **Addressing an emitted event**, and exposing the safe fields and the visibly unsafe group. The only member that produces an event. | produces an event |
| **at max depth** | boolean | True when an event this execution emits to a service could no longer increment `depth` without reaching the version's maximum (**Depth**). | read |
| **time remaining** | object: `run` integer ms \| `null`, `execution` integer ms \| `null` | How many milliseconds remain on each of the version's two clocks at the moment the executor is entered: the run clock for this attempt, and the execution clock from the init event to the moment this execution's lifecycle becomes terminal (**Timeouts**). `null` for a clock the version leaves unbounded. Read at entry and not updated: an executor that needs the live figure subtracts its own elapsed time. | read |
| **cancel** | operation: (reason string) → nothing | Marks this execution `cancelled` with a reason, terminal (**The execution record**). | write |
| **fault** | operation: (reason string, retryable boolean = true) → ArvoHandlerFault | Builds an execution fault for the executor to raise deliberately, with a reason and whether a redelivery could fix it (**Failure protocol**). | produces a fault |
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

A failure event routed to the root (`executionid = subject`, deferred as stated under **Failure protocol**) is addressed to the minter, not to any record, which is why it would need no keyed lookup to land.

#### Depth of this execution

This execution's nesting level is recorded as `state.depth = init_event.depth`. Under ADR-001, "an event opening a new execution carries one more than the level of the execution emitting it", so the init event's depth already *is* the depth of the execution it opens. No arithmetic is performed on entry; the increment happens on emission, under **Addressing an emitted event**.

### Addressing an emitted event

#### What an executor returns

An executor leaves in exactly one of four ways, and the handler treats each as follows.

| The executor | The handler |
|---|---|
| returns one event | treats it as a batch of one |
| returns a list of events | treats it as one batch; an empty list is permitted |
| returns nothing | treats it as an empty batch — the execution rests at `waiting` or `idle` by what is still outstanding (**The execution record**) |
| throws any error | produces the handler error event from it and ends the execution at `error` (**Failure protocol**); the one exception is an error that is itself an execution fault, built through the context, which stays a fault |

There is no fifth. A return that is none of these — a value that is not an event, or a list containing one — is an execution fault, `emission_not_permitted`, non-retryable: the executor code is broken, and no redelivery repairs it. The distinction between the third row and the fourth is the distinction between the two failure classes: returning nothing says the work is not finished, throwing says the work cannot be finished.

**Every returned event is validated before anything leaves the handler**, and an event that fails is a non-retryable execution fault for the whole batch: nothing is emitted, no record is written. The checks are:

- its `type` is in the emittable set for this version and is not the handler error type (**Definition and declaration**) — else `emission_not_permitted`;
- it is not a second own-`outputs` event in the same batch — a batch carries at most one completion, because the caller awaits exactly one answer to its request (**A mixed batch completes**) — else `emission_not_permitted`;
- its `data` satisfies the schema that `type` selects, at the declared version — else `emission_schema_rejected`;
- its `depth` passes the version's guard (**Depth**) — else `max_depth_event_requested`;
- it is structurally valid under ADR-001 and ADR-002, which an event built through the builder is by construction and a hand-built event may not be — else `emission_not_permitted`.

The batch is validated whole and succeeds or fails whole, for the reason **Depth** gives: a batch is one decision by one executor, and emitting part of it would leave an execution in a state no lifecycle can describe.

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
| `depth` | unsafe | The runaway-nesting signal. ADR-001 states it "never decrements", and it is what the execution-depth guard measures. | Unbounded recursion stops being visible — the one thing the field exists for. A value at or above the version's maximum also rejects the whole emission batch as `max_depth_event_requested` (see **Depth**). | Operators, who lose the signal at the moment it matters. | It still counts real nesting from the root, and does not decrease. |
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

A fault MUST be recorded on the delivery span before it is raised, as an exception with its `fault_kind` and whether `retry` is present as attributes (**The fault object**), because a fault writes no record and the trace may be the only place a retried-away failure is ever visible.

### Classification

#### Init or followup, nothing else

Every delivery is either an **init** — opening a new execution — or a **followup**, resuming one. There is no third outcome and no unclassified pass-through: a delivery that cannot be classified is a fault (`event_unclassifiable`). Classification is a property of the delivery, not of the execution, and MUST NOT be confused with the record's `lifecycle`, which records where an execution rests (**The execution record**).

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

**The state function.** The mechanism MUST supply, alongside the event, an operation that takes an `execution_id` and yields the record stored under it, or nothing where none is. It may take time and may fail, since a store is behind it; how a language expresses that — a promise, a future, a coroutine, a blocking call — is that language's own choice (ADR-004). What is fixed is the input — one `execution_id`, together with the delivery's telemetry (**Observability**) so the read is logged and traced as part of this delivery, and the delivery's attempt number (**Retry**) so the mechanism knows whether this read is the first or a retry of one that already failed; the output, a record or its absence; and the rules below. Telemetry and attempt are read-only context for the mechanism to record against and to tune its own read by — a longer timeout, a different replica — not information that changes which record it returns.

The mechanism behind it validates nothing beyond parsing: what it yields MUST be absence or a parsed JSON object, and whether that object is a record, belongs to this event, or is still resumable is the handler's to judge (**Entry validation**, steps 4, 5 and 12). It MUST read the store on every call rather than yield a value captured earlier, which is what makes a retry re-read the record by construction (**Retry**). It MUST NOT be given the event or the classification, and it MUST NOT branch on anything but the key.

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

A response is therefore recorded against `in_flight_event_map[response.initid]`, which is the `id` of the event this execution emitted to open that service's execution (**Collection**). A response whose `initid` names no outstanding key is a fault (`response_unawaited`), and one whose `id` has already been recorded is a duplicate and is discarded (**Entry validation**, steps 9 and 15).

### Entry validation

#### The gate

Before any executor code runs, a handler MUST work through the following gate **in sequence**. Each step is a precondition for the ones after it, and no `state.*` value may be read until the record has been fetched and validated — which is why classification comes first, the fetch follows it, and validation of the record precedes everything that reads one.

| Step | Applies to | Check | On failure | Short-circuits | Retry safe |
|---|---|---|---|---|---|
| 1 | every delivery | **`dataschema` resolves against a declared contract**, naming one contract at one version and thereby classifying the delivery as init or followup. Where the `uri` names the self contract and the handler also declares it as a service, the event's `type` breaks the tie (**`dataschema` decides it**). See **Resolution, and which executor runs**. | fault, `event_unclassifiable` | yes | no |
| 2 | every delivery | **`category` agrees with the classification.** `io.arvo.init` on a delivery classified as an init, `io.arvo.complete` on one classified as a followup. Absent or unrecognised, it is not consulted. | fault, `category_mismatch` | yes | no |
| 3 | every delivery | **The record is fetched**, once, through the state function, under the key classification selects (**Resolving the existing execution**). | fault, `state_resolution_failed` | yes | **yes** |
| 4 | every delivery | **Presence matches classification.** An init delivery MUST have fetched nothing; a followup MUST have fetched a record. | fault, `record_unexpected` or `record_expected` | yes | no |
| 5 | followups | **The record's envelope validates and its events hydrate.** The record validates against the fixed envelope under **The execution record**, with `data` accepted as any JSON value for now, and every event it holds restores to an event value (**Hydration**). No `state.*` value may be read until this passes. | fault, `record_invalid` or `record_event_unrestorable` | yes | no |
| 6 | followups | **The record's version is still declared.** The handler MUST still declare an executor for `state.version`; a version withdrawn from a deployed handler strands its in-flight executions (**Version authority**), and this is where that surfaces. | fault, `version_not_declared` | yes | no |
| 7 | followups | **`data` satisfies the owning version's schema.** Validated against the schema the version confirmed at step 6 declares — placed here, and not at step 5, because that schema cannot be chosen until the version is known and confirmed (**Hydration**). Where the version declares no schema, `data` MUST be `null`. | fault, `record_invalid` | yes | no |
| 8 | every delivery | **The event is below the version's maximum depth.** `event.depth < max depth` for the version resolution selected — the event's on an init, the record's on a followup (**Depth**). Placed here because it is the first point at which that version is known and confirmed declared. | fault, `max_depth_event_received` | yes | no |
| 9 | followups | **Already seen.** The delivered event's `id` is already in `event_ids` as `received`, so this delivery has been processed. | discard | yes | n/a |
| 10 | followups | **Lifecycle admits the delivery.** A record at `success`, `error`, `cancelled` or `failure` accepts nothing further. A record at `waiting` or `idle` accepts a followup. | fault, `lifecycle_terminal` | yes | no |
| 11 | every delivery | **The execution has not outlived its execution timeout.** Where the version sets one, the time from the init event's `time` — the delivered event's on an init, `state.init_event`'s on a followup — to now is below it (**Timeouts**). Where the version sets none, this step passes. Placed after the lifecycle check so that a late event reaching a finished execution is refused for its lifecycle, not abandoned for time; and before the checks on the event itself, because an execution past its bound has nothing further to do with the event whatever it carries. | fault, `execution_timeout` | yes | no |
| 12 | `event.to` on every delivery; the rest on followups | **Record, handler and event agree.** `event.to == handler's self contract type`; and on a followup `state.source == handler's self contract type`, `state.execution_id == event.executionid`, `state.subject == event.subject`. `to` is authoritative, so an event carrying none is invalid here. | fault, `event_unaddressed` or `addressing_mismatch` | no — all applicable comparisons are reported together | no |
| 13 | every delivery | **The type is one the resolved contract can send here.** For the self contract, its own `type`. For a service contract, one of that version's `outputs` or its handler error type. | fault, `type_not_receivable` | yes | no |
| 14 | every delivery | **Payload satisfies its schema**, as declared by the contract and version step 1 resolved. | fault, `event_schema_rejected` | no | no |
| 15 | followups | **Awaited.** The response's `initid` names a key of `in_flight_event_map` whose value is still outstanding. | fault, `response_unawaited` | yes | no |

An init delivery has no record, so the steps that read one do not apply to it — which is most of what the **applies to** column records. Only step 12 is split: `event.to` is on the event and is checked either way, while the three comparisons against the record are followups only.

#### Three ways out: proceed, discard, fault

A delivery leaves the gate one of three ways. **Proceed**: every applicable step passed, the execution context is built (**The execution context**), and the executor is entered — or, under the default join, the response is recorded and the delivery ends without entering it (**Collection**). **Discard**: step 9 recognised a duplicate; nothing is written and nothing is raised. **Fault**: a step failed, and an execution fault is raised carrying every check that failed (**Failure protocol**).

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

**A fault names every check that failed**, not merely the first — where the sequence allowed more than one to be evaluated, all of them are reported, in the fault's `violations` (**The fault object**). Steps 12 and 14 do not short-circuit for this reason: the four addressing comparisons are reported together, and a payload's schema violations are reported in full. This matches ADR-005, whose contract validation reports every broken rule at once, and it is the difference between one diagnosis and a run of redeliveries each revealing one more problem.

#### Protocol outputs commit atomically

Discarding a duplicate at step 9 is safe because the record that would have been written already exists, carrying that event's id in `event_ids`. **The protocol outputs of one delivery commit atomically**: the emitted events and the next record are preserved together, or neither is (**Required of infrastructure adapters**, obligation 1). **That atomicity covers only those two things. It does not cover anything the executor did outside Arvo.** A database write or an HTTP call made during a delivery that then faults, loses a compare-and-swap, or is redelivered has already happened and will happen again on the next attempt. The protocol offers no partial-completion state for such effects to resume from, so an executor MUST treat every external effect as one that may be repeated, and make it idempotent or cheap to repeat.

Inside the executor code, the developer can leverage two values the protocol already guarantees as idempotency keys. The delivered event's `id` is globally unique (ADR-001) and identical on every retry of the same delivery, so it keys a side effect that must happen once per delivery. The execution's `execution_id` is derived deterministically (**Execution identity**) and identical on every delivery to the same execution, so it keys a side effect that must happen once per execution. Both are on the execution context (**The execution context**). An executor that keys its external writes on one of them has a stable idempotency key on every repeat; whether that yields exactly-once effects depends on the external system honouring the key, which is outside the protocol and the executor's to verify.

#### What the gate asks of a mechanism

Because the handler fetches the record itself under a key it chooses, a mechanism need not classify, derive, or compare anything before dispatch. What the gate asks is that the state function answer honestly (**Resolving the existing execution**), and that a redelivered init find the record its first delivery wrote — which follows from committing the record durably under `execution_id` (obligation 1) and nothing else. A redelivered init then fetches a record at step 3 and faults at step 4 with `record_unexpected`, and a mechanism MAY treat that kind as a signal to stop redelivering rather than as an error to escalate.

### Depth

#### An execution-level guard, not an event constraint

**This is an execution-level guard, not a constraint on the event.** It does not narrow `depth` as ADR-001 defines it, does not restrict what depth an event may carry across the ecosystem, and imposes no limit the model enforces. ADR-000 holds that "Arvo imposes no architectural limit on composition depth", and this section does not contradict it: a version chooses its own maximum, and may choose one high enough that the guard never fires. What it bounds is how deep *this handler, at this version* is willing to be, and to go — a handler's own decision about its own recursion, not an architectural limit on composition.

ADR-001 gives `depth` its purpose: it "exists for operational comprehension", because unbounded nesting is "an operational risk rather than a structural impossibility". This guard is the one place in the protocol that reads the field for that purpose, and turns a runaway recursion into a diagnosable stop rather than an exhausted store.

#### One option, resolved per version

The bound is the option **`max_depth`** (**Options**), resolved for the version an execution belongs to. It is resolved per version because two versions of one contract may nest differently and a version's executor is the code whose recursion it bounds; the handler-level value is what a version inherits when it declares none, not a bound on the handler as a whole.

There is no option for what happens when the limit is crossed. **Crossing it is always a non-retryable execution fault.** It has two kinds, one for each place it can be detected: `max_depth_event_received` where an event arrives at or beyond the limit, and `max_depth_event_requested` where the executor returns an event that would go beyond it.

#### Checked twice: on delivery, and on return

The guard is applied at two points, with one threshold.

**On delivery, at gate step 8** (**Entry validation**), fault `max_depth_event_received`: the delivered event's `depth` MUST be below the version's maximum. The version is the one resolution selected — the event's on an init, the record's on a followup — which is why the check sits after the version is known and confirmed declared, and not earlier. It catches a caller with a looser limit than this handler's reaching it from too deep.

**On return, as part of return validation** (**What an executor returns**), fault `max_depth_event_requested`: for each event the executor returned that would open a new execution — one addressed to a service — the depth it would carry is `state.depth + 1`, and that value MUST be below the maximum. An own-`outputs` event carries `state.depth` and can never violate.

The two thresholds are the same number, and that is what makes both checks safe together. Because emission refuses at `state.depth + 1 >= max`, no execution of this version ever opens a service execution at or above `max`, so no legitimate response — which carries the depth of the execution that produced it — ever arrives at or above `max` either. The delivery check therefore never rejects a reply this handler was owed, and only ever rejects an init that arrived from beyond the limit.

Refusing the *emission* is where the protection lies. A delivered response has already happened; nothing about refusing it prevents any depth. Refusing to emit stops the doomed work before it runs, which is the only point at which stopping is worth anything. The delivery check is the second line: a handler protecting itself against a caller that does not share its limit.

An executor does not have to discover the limit by hitting it. The execution context carries **at max depth** (**The execution context**), true exactly when a service emission from this execution would fail the return check. An executor that reads it before deciding what to return can choose an own-`outputs` event instead, safely and inside its own logic, and never raise the fault at all.

#### One offending event rejects the whole batch

**One offending event rejects the whole batch.** Where any event an executor returns fails the guard, none of them is emitted, no record is written, and `max_depth_event_requested` is raised for the delivery. The alternative — emitting the permitted ones and faulting on the violation — would leave a fault describing a delivery that partly succeeded, which a fault by definition cannot (**Failure protocol**). A batch is one decision by one executor, and it succeeds or fails as one. The same rule governs every other return-time check.

#### The executor can see it coming

**An executor can see it coming, which is why the outcome is its own.** The execution context exposes **at max depth** (**The execution context**) — true when an event this execution emits to a service could no longer increment `depth` without reaching the maximum. An executor that checks it can take a different path, complete early with an own-`outputs` event that explains itself, or fail deliberately so the caller hears a handler error rather than an abandonment. Raising this fault on return therefore takes a deliberate act: emitting to a service after being told the limit is reached, or overriding `depth` outright, which is already among the unsafe fields under **What an executor may set**.

#### What the caller hears

Because a fault carries its abandonment pair (**Abandonment**), a depth fault need not be silence. The fault is non-retryable, so a mechanism MUST NOT redeliver it; what it does instead is its own policy. Where it chooses to abandon, it publishes the handler error event and commits the record at `failure` together (**Required of infrastructure adapters**, obligation 3), and the caller learns the work will not be done in the one shape it is already obliged to handle, with the record saying why. On a `max_depth_event_received` fault against an init delivery, the record half is `null` — no execution began — and only the event is available, exactly as for any other init fault.

The fault's `message`, and the `lifecycle_description` of the abandonment record where there is one, MUST state the limit in force, the depth at which the execution sat or the event arrived, and — on `max_depth_event_requested` — the type and would-be depth of each event in the rejected batch, offenders and non-offenders alike, because the batch was rejected whole and a diagnostic showing only part of it would misrepresent what happened.

### The execution record

#### One record, representable as JSON

An execution's entire memory is one record. It MUST be representable as JSON, so that no mechanism has to understand any language's object model to store it, and it MUST carry the fields below under these names. The **Type** column gives each field's JSON shape, and is as normative as the names: a record whose field holds a value of another shape is `record_invalid` at gate step 5. The names are normative — the record is a durable format, and a record written by one language MUST be readable by another (ADR-004). A mechanism stores and returns it; it never authors one (**Resolving the existing execution**).

#### The fields

| Field | Type | Meaning |
|---|---|---|
| `record_format_version` | string, `MAJOR.MINOR.PATCH` | The version of this record envelope, as a `MAJOR.MINOR.PATCH` string. Under this ADR it is exactly `1.0.0`. Set by the handler on every record it writes (**`record_format_version`**). |
| `subject` | string | The workflow. Grouping key. |
| `execution_id` | string, 64 lowercase hex | This execution. Record key. |
| `parent_execution_id` | string; never `null` — on a root init it equals `subject` | The execution that caused this one. |
| `depth` | integer ≥ 0 | This execution's nesting level, from the init event that opened it. |
| `source` | string | The self contract `type` this execution belongs to, and the `source` of every event it emits. |
| `version` | string, a semver the self contract declares | The self contract version whose executor owns this execution. |
| `cas_version` | integer ≥ 0 | Non-negative integer. **`0` on the first record of an execution**, the one an init delivery produces; on every later record, **exactly one greater than the record the delivery read**, including the `abandonment_state` a fault prepares against being given up on (**Abandonment**). A mechanism commits records but never authors one, so it never sets or increments this itself. Exists so a mechanism can compare-and-swap (**Required of infrastructure adapters**, obligation 5). |
| `lifecycle` | `idle` \| `waiting` \| `success` \| `error` \| `cancelled` \| `failure` | `idle`, `waiting`, `success`, `error`, `cancelled`, or `failure`. |
| `lifecycle_description` | string \| `null` | Free text explaining how the execution reached its current `lifecycle`, or `null`. |
| `event_ids` | array of `{ id: string, direction: "received" \| "emitted" }` | Every event the execution has touched, each as an `id` and a `direction` of `received` or `emitted`, relative to this handler. |
| `init_event_id` | string | The `id` of the init event. |
| `init_event_source` | string | The `source` of the init event — the caller a completion returns to. |
| `init_event` | ArvoEvent as JSON; materialized as an ArvoEvent during hydration | The event that began the execution. |
| `triggering_event` | ArvoEvent as JSON; materialized as an ArvoEvent during hydration | The event that caused the most recent delivery. |
| `in_flight_event_map` | object: emitted event `id` string → ArvoEvent as JSON \| `null`; each non-null value materialized as an ArvoEvent during hydration | Keyed by the `id` of each event emitted to a service in the current round. The value is the collected response, or `null` while outstanding — the key MUST be present either way, because the key set is what the execution is waiting for. |
| `contracts` | object: `{ self: canonical contract, services: canonical contract[] }` | The handler's `self` and `services` contracts, in their canonical form (ADR-005). Carried for a reader's benefit only — nothing in execution consults it. |
| `data` | JSON value \| `null`; validated against this version's declared schema during hydration | The executor's own business state, governed by the schema that executor declared, or `null` where none is declared or nothing has been written. |

`execution_id` identifies a record uniquely and `subject` groups the records of one workflow; a mechanism MAY use them as its record and grouping keys, and both are inside the record so that it is self-describing.

#### `direction`: received or emitted

`direction` is `received` or `emitted` rather than `input` or `output`, deliberately. Those two words already name something else in this model — ADR-005's declared shapes, and a version's `outputs` — and a service's reply is `received` here while being that service's output. Two axes sharing a vocabulary is how a reader ends up confidently wrong.

#### `contracts` is informational only

`contracts` is informational by construction, and an implementation MUST NOT resolve, bind, or validate against it. It exists so that a record found in a store years later can be understood without the code that wrote it, which is the same reason the identifying fields are inside the record rather than only in the keys. A reader should be aware it is a snapshot: a contract that has since changed will not match a live one, and that discrepancy carries no meaning at execution time. Whether it should be compared against the live contract as a drift warning is left deferred (**Left deferred**).

#### `lifecycle`: where an execution rests

`lifecycle` records where an execution **rests**, not how it was entered. How a delivery was classified is a property of that delivery (**Classification**) and MUST NOT be conflated with this field.

#### The six lifecycle values

| Value | Terminal | When an execution rests here |
|---|---|---|
| `idle` | no | Alive, with nothing outstanding and nothing completed. |
| `waiting` | no | One or more responses are outstanding. |
| `success` | yes | An own `outputs` event was emitted, whether alone or alongside service emissions in the same batch (**A mixed batch completes**); or, for a version with empty `outputs` in a handler with no service contracts, the executor returned nothing (**A sink version completes by returning nothing**). |
| `error` | yes | The handler error event was emitted because the executor failed. |
| `cancelled` | yes | The executor marked the execution cancelled and returned an own `outputs` event. |
| `failure` | yes | The mechanism abandoned the execution after a fault, and committed the record the handler prepared for that (**Abandonment**). |

A terminal record accepts no further delivery (**Entry validation**, step 10). `failure` is the one value no handler reaches under its own steam: a fault writes no record, so only the mechanism, acting on the fault's `abandonment_state`, can put an execution there (**Retry**).

#### Marking an execution `cancelled`

**An executor MUST be able to mark its own execution `cancelled`**, through the **cancel** member of the execution context (**The execution context**), and doing so is terminal. It is how a cooperative wind-down records *why* an execution ended rather than leaving it indistinguishable from an ordinary completion (**Cancellation**).

Marking cancelled does not excuse an execution from answering its caller. Cancelling is a reason to stop, not a way out of the protocol, and the protocol never lets a cancel end in silence of the handler's making. The three ways a cancelling executor can leave are decided as follows:

| The executor marks cancelled and… | The handler |
|---|---|
| returns an own-`outputs` event, alone or with service emissions | emits everything; the record rests at `cancelled`, with the executor's reason in `lifecycle_description`. An explicit statement of why an execution ended outranks what is inferred from what it emitted. Service emissions beside the completion are the compensating work **Cancellation** describes — a refund, a release, a notification — sent fire-and-forget, exactly as in any mixed batch (**A mixed batch completes**): the execution is finished when it answers, and their responses will find a terminal record. |
| returns nothing, or only service emissions | raises a non-retryable execution fault, `execution_cancelled`. Nothing is emitted and no record is written by the handler. The fault carries the handler error event and the record at `failure` as its abandonment pair (**Abandonment**), with the executor's reason in the fault's `message` and the record's `lifecycle_description`, so a mechanism that abandons can tell the caller and record why. Service emissions without a completion are refused because they would leave the execution at `waiting` for responses a cancelled execution has no business processing, with the caller still unanswered. It is the missing answer that is refused, not the compensation. |
| throws | the throw wins: the handler error event is emitted and the record rests at `error`, because a failure after a cancellation is still a failure and the caller should hear it as one. |

An implementation SHOULD make the first row the easy path. The second exists so that a developer who forgets to answer is caught by the protocol rather than by a caller that waits forever, and it uses no machinery the fault does not already have. One consequence follows: the `cancelled` lifecycle appears in a store only where the execution also answered its caller. An execution that cancelled without answering rests at `failure`, with its reason preserved in `lifecycle_description`, where the mechanism abandons it, and stays as the fault found it where the mechanism does something else.

#### `lifecycle_description`

`lifecycle_description` carries free text explaining how the execution reached its `lifecycle`, and is `null` wherever nothing explains it — which is every `idle`, `waiting` and `success`. It is populated on `cancelled`, with whatever reason the executor gives; on `error`, with the executor's failure message; and on `failure`, with the message of the fault the mechanism gave up on. It is diagnostic only: nothing in the protocol reads it, and no behaviour may depend on its contents.

#### Emitting nothing: `waiting` or `idle`

**An executor that returns nothing rests at `waiting` or `idle`, depending on what is still outstanding** (**What an executor returns**). Returning nothing says only "no new events"; it does not say the execution has nothing to wait for. Under the per-version override that enters the executor on each response (**Collection**), returning nothing on a partial collection is the ordinary case — responses remain outstanding, so the execution stays at `waiting`. Where nothing is outstanding and nothing terminal was emitted, it rests at `idle` — except for a sink version, which rests at `success` (below).

#### A mixed batch completes

A batch may carry service emissions and an own `outputs` event together, and the rule for it is simple: **every event in the batch is emitted, and the execution rests terminal.** The lifecycle a batch produces depends only on whether a completion is among its events:

| The batch carries | The execution rests at |
|---|---|
| service emissions only | `waiting`, with each recorded in `in_flight_event_map` (**Collection**) |
| one own `outputs` event only | `success` — or `cancelled`, where the executor marked it so |
| service emissions and one own `outputs` event | `success` — or `cancelled` — and the service emissions are emitted and recorded exactly as in the first row |
| nothing | `waiting`, `idle`, or `success` for a sink version (**Emitting nothing: `waiting` or `idle`**) |
| more than one own `outputs` event | nothing; the batch is a fault, `emission_not_permitted` (**What an executor returns**) |

The completion wins because it is what the caller is waiting for, and the caller awaits exactly one answer to its request. An execution that has answered is finished, whatever else it set in motion on the way out. The service emissions are not suppressed and not deferred: an executor that answers its caller and in the same batch asks a service to do something has said, in one decision, "here is my answer, and also start this" — and both halves are honoured.

**The consequence is that the service's response has nowhere to go.** It arrives carrying this execution's identity, finds a record at `success`, and is refused at gate step 10 as `lifecycle_terminal`, a fault whose abandonment pair is `null` by rule (**`lifecycle_terminal` yields neither**). The mechanism handles it as it handles any fault it will not retry. This is accepted, not accidental: a completing execution that emits to a service is emitting fire-and-forget work, and an implementation SHOULD say so where the pattern is likely to be met, because an author who expected to process that response has misunderstood what completing means. An executor that needs the response completes *after* it arrives, not alongside asking for it.

#### A sink version completes by returning nothing

There is one version shape for which returning nothing is the only possible completion: a version whose `outputs` is empty — which ADR-005 permits — belonging to a handler that declares no service contracts. Such a version's executor can legitimately return nothing at all: no own output exists to return, and no service exists to call. It does its work by side effect and is done.

For that shape, and only that shape, an executor returning nothing MUST rest the execution at `success`, not `idle`. The two conditions are both required: with a service declared, the executor could have called it; with an output declared, it could have answered. Where either is present, returning nothing means the executor had a choice and did not take it, and `idle` is the correct and honest state.

The caller receives no completion event, but the contract said so in advance by declaring no outputs, and the handler error event remains available so that failure still reaches it. The condition is a property of the declaration, so an implementation can determine it once, at declaration time, and need not re-derive it per delivery.

#### `idle` is legal and almost always a defect

Outside the sink shape above, `idle` is named for the state rather than for how it was reached, because it can be reached two ways: an executor that returned nothing on the delivery that created the execution, and one that returned nothing after its last response came in. Both leave an execution that is alive, waiting for nothing, and finished with nothing — so nothing will ever deliver to it again and it rests there forever. It is a legal state, it is almost always a defect, and an implementation SHOULD make it visible rather than silent: on the delivery span (**Observability**), and in whatever protocol-level metrics it publishes. Because the sink shape rests at `success` instead, `idle` is reachable only where the executor had something it could have returned, which is what makes it a reliable defect signal.

#### `record_format_version`

`record_format_version` says which envelope a record was written under, so that a reader can tell what shape it holds before validating it. Under this ADR the value is exactly `1.0.0`, and a handler MUST write it on every record it produces — the next record on a successful delivery and the `abandonment_state` on a fault. Neither a mechanism nor an executor ever sets it.

Its three components carry the meaning semantic versioning gives them, applied to the envelope rather than to a contract. **MAJOR** changes only by a superseding ADR, and only for a change the rules under **How this record may change later** forbid — a field removed, a field's meaning changed, a required field added. **MINOR** marks an additive change under those rules, a new nullable field with a defined absence. **PATCH** marks a clarification that alters neither shape nor meaning. A reader at `1.x` therefore reads any `1.y` record, which is what the additive rules are for; a reader meeting a MAJOR it does not know cannot validate a shape it has no schema for, and MUST fault non-retryably at gate step 5 as `record_invalid` rather than guess.

It is the first field in the table for the reason it exists: it is the one field a reader must consult before it knows how to read the rest.

#### How this record may change later

A stored record outlives the deployment that wrote it, and an execution in flight when a handler is upgraded is read back by the newer code. So every field a future ADR adds to this record MUST be nullable, with absence carrying a defined meaning — a record written before the field existed is still a valid record, and must validate and resume without alteration.

Two rules follow from the same premise and are stated here so a later ADR does not have to rediscover them. A field MUST NOT be removed, and a field's meaning MUST NOT change, because both silently reinterpret records already in a store. And validation MUST NOT reject a record for carrying a field the reader does not know, so that a record written by a newer deployment survives being read by an older one during a rollout.

These rules hold within a MAJOR of `record_format_version`. A change that cannot satisfy them is a MAJOR bump, made only by a superseding ADR, and a reader distinguishes the two envelopes by the field rather than by inspection.

This is deliberately narrower than migration, which **Version authority** prohibits outright. Migration would move a record between contract versions, remapping state whose meaning only its own executor knows. This is the envelope growing new optional fields around state that is untouched.

#### `cas_version`

`cas_version` MUST NOT be reset or wrapped by an implementation. It is an integer exactly representable in JSON, which bounds it far above any reachable execution length. The handler sets it on every record it produces: `0` where the delivery was an init and no record existed, and the read record's value plus one otherwise — the next record on a successful delivery, and the `abandonment_state` on a fault. A mechanism comparing the stored value against the one on the record it is asked to commit can then tell whether another write landed in between, and a record at `0` tells it that no stored record must exist at all (**Required of infrastructure adapters**, obligation 5).

#### Version authority

After the first delivery, the record is the only place the handler's own version survives — a followup response's `dataschema` names the *service's* contract and version, not this handler's. That is why a followup's executor is chosen by `state.version` (**Resolution, and which executor runs**), and why the record's version must still be one the handler declares (**Entry validation**, step 6). If it is not, the delivery is a fault and the execution is not resumed.

#### A record belongs to one version for its whole life

**An execution record belongs to one contract version for its whole life.** It MUST NOT be resumed under another version, and it MUST NOT be migrated to one. This is not a conservative default awaiting a better answer; it follows from ADR-005, where each version is fully isolated and "no two versions are ever compatible by construction". A migration would need a defined mapping from one version's state to another's, and isolation is precisely the statement that no such mapping exists — a `data` shape is governed by the schema its own executor declared, and a neighbouring version's schema has no claim on it. Silently running one version's executor over another version's state would corrupt an execution rather than report one.

#### Removing a version strands its executions

Removing a version from a deployed handler's self contract — and with it, under **One executor per version**, its executor — therefore strands that version's in-flight executions, permanently. Each will fault at gate step 6 on its next delivery and, being non-retryable, will never be redelivered; whether it is then abandoned or held is the mechanism's policy, and either way it never resumes. A version is drained before it is removed, and that is the whole of the migration story.

#### Hydration

On a followup delivery, a handler MUST validate the whole record and MUST restore every event the record holds to an event value before any executor code runs. This happens in three consecutive steps of the gate (**Entry validation**): step 5 validates the fixed envelope and hydrates the events, treating `data` as an opaque JSON value; step 6 confirms `state.version` is declared; step 7 validates `data` against that version's schema. The split exists because the schema for `data` is chosen by a field the gate cannot read until the envelope has passed. A record that fails any of it is a fault. Validating eagerly costs every stored event on every delivery; the ADR chooses that so a corrupt record fails once, at entry, with its cause named, rather than surfacing from inside business logic where it cannot be attributed.

#### The cost of eager hydration

**This is an accepted trade-off, and its cost scales with fan-out.** An execution awaiting a thousand responses restores a thousand events on each of them, and the record grows with the collection. Eager hydration is the rule regardless: a handler that reasons about a record it has only partly validated is worse than a handler that is slow. Nothing here bounds fan-out, and how to bound it — a cap, lazy restoration for entries an executor never reads, or something else — is left to a later decision rather than guessed at now (**Left deferred**).

#### Changing a deployed version's state schema

The state schema is enforced on every entry, at gate step 7, against the schema the version declares *today*. That creates an obligation the protocol cannot enforce for the author, and it is stated here so the consequence is not discovered in production.

**Once a version has been deployed and has records in a store, any change to its declared state schema MUST be compatible with the `data` those records already hold.** That is the whole of the obligation. The schema is the version author's, not the protocol's — the protocol validates `data` against it and does nothing else with it — so *how* compatibility is kept is the author's affair, and this ADR places no rule on it. The rules the record envelope holds itself to under **How this record may change later** are one way to keep it and are offered as such, not imposed.

The consequence of breaking them is exact. Every in-flight execution of that version fails step 7 on its next delivery with `record_invalid`, which is non-retryable, so none is ever redelivered, and a mechanism that abandons them tells each caller the work will not be done. Nothing can rescue them: migration is prohibited (**A record belongs to one version for its whole life**).

A change the author cannot make compatibly is a new version. It is declared alongside the old one, the old one is drained, and then the old one is removed — the same story as any other version change, and the only one the protocol supports.

#### Serializability of `data`

A handler MUST verify that `data` survives a JSON round trip when an executor returns, and report a non-retryable fault (`state_not_serializable`) if it does not. This is the executor author's obligation and cannot be prevented by a declared schema, which will not catch a native date or class instance passed through a permissive schema position. Checking at return keeps the failure attributable to the executor that caused it, and it is part of return validation alongside the checks on returned events (**What an executor returns**).

The schema at `data` is the version author's, not the protocol's. The protocol validates stored `data` against whatever that schema declares at the time of a delivery, and nothing more. Keeping a change to that schema safe for the `data` already in a store, after the handler's first production deployment, is therefore the author's responsibility, and this ADR places no rule on how it is done.

### Retry

#### A handler cannot retry itself

A handler cannot retry itself. It is stateless and runs only when something delivers to it, so a retry is a redelivery and every decision about one belongs to whatever runs the handler. What this ADR settles is what the handler must tell it, and what the mechanism must do with what it is told.

#### Every delivery carries its attempt number

**Every delivery carries which attempt it is.** The mechanism supplies an attempt number alongside the event, the state function and the dependencies. It is on the execution context (**The execution context**), so an executor may read it — knowing this is the third attempt is sometimes exactly what a decision turns on — and it is also passed to the state function, so a mechanism can tune its own read by it (**Resolving the existing execution**).

It is not part of the record. It describes a delivery, not an execution, and a record that carried it would be claiming to remember something no delivery can know about another.

#### Attempts count from zero

**Attempts count from 0**, and a retry is in prospect while `attempt < max_retry_attempts_allowed`. Both halves are pinned because neither is inferable: with the default of 3 and an unpinned base, one implementation delivers three times and another four, and both could call themselves conformant.

#### Retry information travels on the fault

**Retry information travels on the fault, not in the record.** Where a delivery ends in an execution fault, the fault carries everything a mechanism needs to decide what happens next — `attempt`, `timestamp`, `fault_kind`, and the `retry` block. Those fields are defined once, with the rest of the object, under **The fault object**; what follows is what they mean rather than a second copy of their shape.

`retry` is `null` where no retry is in prospect: a fault whose kind no redelivery fixes, or one whose attempts are spent. A mechanism can therefore read "retry, and here is when" or "do not" without interpreting a message. **`retry` is the permission and `fault_kind` is the nature**, and the two are kept on separate fields on purpose: a mechanism that will not retry can still tell, from the kind, whether the failure was the fixable sort that ran out of budget or the defective sort that never was, and that difference may decide what it does instead (**Abandonment**).

#### Why the fault is the only place this can live

**The fault is the only place this can live.** A fault produces no record, so a figure written into the record could never be persisted at the moment it mattered — and outside a fault there is nothing to retry, so the field would be `null` on every record that ever reached a store. The fault exists exactly when the information is meaningful and at no other time.

#### No exhaustion flag, no cross-delivery total

There is deliberately no exhaustion flag and no cross-delivery total. A flag would be dead weight — `retry` is `null` exactly when no redelivery is in prospect, so any flag beside it could only ever restate it; and there is no separate retry-safety field for the same reason, since the kind's verdict is fixed in the vocabulary and a second field carrying it could only agree or wrongly disagree.

A total is worse than redundant: it is uncomputable. The mechanism supplies only this delivery's attempt number, retry state is deliberately absent from the record, and a fault writes no record — so nothing the handler is given could produce a figure spanning deliveries, and a field no conformant implementation can fill does not belong in a specification.

#### Units: milliseconds throughout

`timestamp` and `retry_at` are instants and `retry_in_ms` a duration. **All three are numbers in milliseconds** — the instants as milliseconds since the Unix epoch, the duration as a count of milliseconds — so `retry_at = timestamp + retry_in_ms` is arithmetic between like units and needs no conversion rule, notwithstanding that the two operands sit at different levels of the object.

Milliseconds rather than the finest precision available, for three reasons. It keeps that addition honest: a microsecond instant plus a millisecond duration is a unit error waiting to be written. A millisecond epoch sits far inside the range a JSON number represents exactly, where a nanosecond epoch does not — nothing here needs precision a durable format cannot carry. Furthermore, a millisecond clock is something every language implementing AAM can read from its standard library without a platform-specific call.

#### The two retry options

Retry is governed by two options, **`max_retry_attempts`** and **`retry_delay`** (**Options**), which a mechanism reads off the fault rather than from the handler's declaration.

In its function form, `retry delay` receives the retry state as well as the delivery: which attempt this was and how many the version allows. That is what makes a backoff expressible — a figure that grows with `attempt`, or one that stretches as the budget nears its end — without the function reaching for state the handler does not hold. It receives no more than that, because nothing else about a retry exists: the record carries no retry state, and no attempt can know about another (**No exhaustion flag, no cross-delivery total**).

The handler must put a number in the fault's `retry_in_ms`, so `retry_delay` is never undefined: the handler level always holds a value (**Options**). A mechanism may of course ignore the figure, but it must be given one.

#### Retry before a version is known

`state_resolution_failed` is raised at gate step 3, before the record has been read and therefore, on a followup, before any version is known — a followup's `dataschema` names the service, and the version that owns the execution is inside the record the read failed to produce. On an init the event's own `dataschema` names the version and the version's options apply as usual. **On a followup, the version side of every option is `null`, so the handler's values apply** — the ordinary resolution rule with nothing on the version side (**Options**), and the fault's `retry` block carries those figures. Its `message` SHOULD say so.

In its function form `retry_delay` is then called with `null` in place of the record, because none was read; a handler-level function MUST accept that. This is the one fault today for which a version's own retry options are never consulted, and only because no version can be known.

#### `retry delay` must not be able to fail

In its function form `retry delay` **MUST NOT be able to fail**. Where it does — throwing, or returning anything that is not a usable number — an implementation MUST substitute the fixed protocol fallback for `retry_delay`, `300` ms from the Fallback column under **Options**, rather than propagate the failure. The fallback is never a declared value: a handler-level function that fails would otherwise be its own fallback. A failure while working out how long to wait before retrying would turn a recoverable situation into an unrecoverable one, which is the one outcome the retry path exists to prevent.

#### Exhaustion ends retrying

**Exhaustion ends retrying, and the handler says so.** Where `attempt` has reached `max_retry_attempts_allowed`, a fault of a retry-safe kind MUST carry `retry` as `null`, exactly as a non-retry-safe kind always does. Its `fault_kind` is unchanged — the failure is still the fixable sort, and the budget, not the nature, is what ran out. A mechanism stops rather than loops.

The handler is the party that applies this because it is the party that knows the version's limit; the mechanism knows only which attempt it is making. A mechanism MAY stop earlier than the handler tells it to — its own budgets are its own — but it MUST NOT continue past a fault that says no retry is in prospect.

#### Only the mechanism can bring an execution to `failure`

**`failure` is the one lifecycle only the mechanism can reach, and it reaches it by choosing to abandon.** This needs stating because no handler gets there under its own steam: a handler runs only when something delivers to it, and exhaustion is the case where nothing more will. A fault commits no record of its own, so the stored record still says `waiting`. A mechanism that abandons an exhausted execution commits the `failure` record so that it is distinguishable from one legitimately waiting on a slow service; a mechanism that does not abandon leaves the record at `waiting`, and owns the fact that the two now look alike.

Where a mechanism chooses to abandon, it commits the fault's `abandonment_state` and publishes its `abandonment_event` together, where the fault carries them (**Abandonment**; **Required of infrastructure adapters**, obligation 3). Whether to abandon, dead-letter, alert, or hold the fault for a human is the mechanism's own policy; the protocol requires only that it not retry. `failure` is terminal, and no delivery to it is ever processed (**Entry validation**, step 10).

**Only the mechanism can put an execution there, but it never composes what it writes.** The record it commits and the event it sends were both built by the handler, on the attempt that failed, and carried on the fault against precisely this outcome — so the rule that model data originates in the handler holds without an exception here. What is genuinely the mechanism's, and only its, is the decision that no further attempt will be made. That is a decision no handler can reach, because a handler is entered only when something delivers to it and giving up is the case where nothing will.

#### Every retry re-reads the record

**Every retry MUST fetch the record afresh.** A retry is a new delivery, not a replay of the one that failed. Between the failed attempt and the retry the record may have moved on — another response may have arrived, been recorded, and advanced `cas_version` — so re-running against a record read before the failure would compute from state that is no longer current. With compare-and-swap in place that write fails and the retry never converges; without it, the retry silently erases work that succeeded in between.

The state function makes this structural rather than a rule a mechanism must remember: the handler calls it on every delivery, and the function MUST read the store rather than return a value captured earlier (**Resolving the existing execution**). What a mechanism must still get right is not caching behind it, and re-resolving the dependencies for each attempt. Only the attempt number carries forward, which is the one input a retry genuinely inherits.

#### What else the runner owns

Everything that depends on time passing or on nothing happening is outside what a handler can observe, because it is entered only when something delivers to it:

- storing, interpreting and acting on the `retry` a fault carries, including whether to honour the delay at all;
- following up on an execution resting at `waiting` whose responses have not arrived — the handler has no way to notice absence, and the model defines no deadline (ADR-000 defers timers);
- persisting the record, publishing the events, and delivering them;
- deciding when to stop, what to do with a fault it will not retry, and whether to act on the abandonment pair.

This ADR states what a handler produces and what it requires. Everything between one delivery and the next belongs to the mechanism, and is deliberately not divided further here.

### Timeouts

#### Two clocks, resolved per version

Time is bounded in two places by two options, **`run_timeout`** and **`execution_timeout`** (**Options**), and the two are different questions.

The **run clock** bounds one entry into the executor: how long a single attempt may spend in business code before the handler stops waiting. The **execution clock** bounds the execution itself: how long may pass from the init event to the moment this execution's lifecycle becomes terminal. The first asks whether *this attempt* is stuck. The second asks whether *the business process* has taken longer, start to finish, than the version allows.

Both are in milliseconds, as everything under **Retry** is.

#### `null` is unbounded

On either clock, `null` means **no bound**: the handler starts no timer and the corresponding check never fails. The run clock defaults to thirty seconds because business code that has not returned in that time is far more often stuck than slow, and a mechanism that is never told so retries nothing and frees nothing. The execution clock defaults to `null` because many workflows legitimately live for hours or days between deliveries, and a default that could end one of those silently would be worse than no default.

#### Why the execution clock cannot be shorter than the run clock

**Options** requires that a version's resolved `execution_timeout` not be smaller than its resolved `run_timeout`, and that a `null` run timeout force a `null` execution timeout. The reason belongs here. A single attempt that may run longer than the whole execution is allowed to could never complete inside the execution's bound, so the version could never succeed; and an unbounded attempt is longer than any finite bound on the whole. Both are defects in the declaration, visible before any event exists, and **Options** refuses them there.

#### The run clock: what it covers, and what it does not

The run clock starts when the handler enters the executor and stops when the executor returns or fails. It covers nothing else: not the gate, not the state function, not the dependency factory, not return validation. Each of those either has its own fault (`state_resolution_failed`, `dependency_resolution_failed`) or is the handler's own code, and bundling them into one clock would blur who was slow when it fired.

**Where the run clock expires, the handler stops waiting and raises a retry-safe execution fault, `run_timeout`.** Nothing is emitted and no record is written by the handler. The fault carries retry information like any other retry-safe fault (**Retry information travels on the fault**), so a mechanism redelivers under the version's retry options and each attempt has its own thirty seconds — or whatever the version set. A timed-out attempt is an attempt: it consumes one of `max retry attempts`, and where it is the last, the fault is reported with no retry in prospect — `retry` null, the kind unchanged — and carries the abandonment pair (**Exhaustion ends retrying**). A stuck executor is therefore bounded twice over, once per attempt and once in how many attempts it gets.

**The protocol does not promise that the executor's work stops.** No language can guarantee that arbitrary running code halts on demand, and a rule that pretended otherwise would be one every implementation broke. What the handler guarantees is narrower and keepable: once the clock has expired, nothing the executor later returns, writes through **set state**, or raises is accepted or acted on. Whether the underlying work is interrupted is each language's own affair. An executor MUST NOT assume it was stopped, and an executor with side effects that must not outlive the attempt SHOULD watch **time remaining** on the context rather than rely on being killed.

#### The execution clock: from the init event to this execution's end

**The execution clock spans the whole life of one execution: from the init event that opened it to the moment its lifecycle becomes terminal** — `success`, `error`, `cancelled` or `failure` (**The six lifecycle values**). That is the same notion of finished the gate uses at step 10, and it covers every way an execution can end: a completion emitted, a handler error event emitted, a cancellation, a sink version resting at `success` by returning nothing, and abandonment by a mechanism. Between those two points an execution may emit any number of requests to services and receive any number of their responses. **None of those is an end.** A service request is a step on the way, its response is another, and the clock neither stops at one nor restarts from one. It is one interval, measured once, from start to finish.

The clock is measured from the init event's `time` — the delivered event's on an init delivery, `state.init_event`'s on a followup. It is the protocol's own notion of when the execution began, it is on the record for the whole life of the execution, and it needs no field this ADR does not already carry. The producer's clock set it, so skew is possible; ADR-001 already accepts that for `time` and this ADR does not tighten it. `time` is used here as a duration's origin, not to order events, which is what ADR-001 forbids.

#### How the execution clock is enforced

A handler runs only when an event is delivered, so it cannot watch an execution between deliveries. The bound is therefore enforced at the two moments the handler is present, entry and return, and **the check at either moment is how the bound is enforced, not what the bound means.**

**On entry, at gate step 11** (**Entry validation**): where the version sets an execution timeout and the time from the init event to now is not below it, the delivery is a non-retryable execution fault, `execution_timeout`. It follows the duplicate and lifecycle checks deliberately: a redelivered event is discarded and a late event reaching a finished execution is refused for its lifecycle, so neither can abandon a record that has already concluded. It precedes the checks on the event itself because an execution past its bound has nothing further to do with the event, whatever it carries. It applies on an init delivery too: an init that sat undelivered longer than the version allows is refused on arrival rather than started late, and the fault carries what a mechanism needs to tell the caller why.

**On return, after the executor finishes**: where the version sets an execution timeout and the time from the init event to the moment of return is not below it, the return is a non-retryable execution fault, `execution_timeout`, and nothing the executor returned is emitted or written. This is what makes the bound a bound on the *end* of the execution rather than on its last entry. Without it, an execution entered a moment before its limit could run for the whole of a run timeout and emit its completion well beyond the bound, and the bound would have meant nothing. Depth is checked at the same two moments for the same reason (**Checked twice: on delivery, and on return**).

Being non-retryable, the fault carries the abandonment pair (**Abandonment**): the handler error event and a record at `failure`, so a mechanism that chooses to abandon can publish and commit them together and the caller learns the process was abandoned for time. The fault's `message` and the record's `lifecycle_description` MUST state the limit in force, the init event's `time`, and the elapsed time as the handler measured it.

#### Where both expire in one attempt

A run that expires can carry the execution past its own bound in the same attempt. **When the run clock fires, the handler MUST evaluate the execution clock before reporting**: where that too has passed, the fault is `execution_timeout` and non-retryable, not `run_timeout` and retryable. Retrying an execution that the next gate would refuse for time would cost a redelivery to reach the same answer, and the non-retryable verdict is the broader judgement of the two.

#### Why these are options and not fixed limits

Depth has one fixed treatment because the sensible bound is the same for almost every version and its failure is always a defect. Time is not like that. A version fronting a synchronous lookup and a version orchestrating a week-long approval have nothing in common in how long an attempt should take or how long the process should live, and the protocol has no ground to choose for either. What the protocol fixes is the shape — two clocks, one retryable and one not — and a run default conservative enough that a stuck executor is never invisible.

### Collection

An execution that calls out to services has to know what it is waiting for, and has to be re-enterable when an answer arrives. `in_flight_event_map` is that memory, and this section defines what goes into it, when a response re-enters the executor, and what happens to a response nothing is waiting for.

#### Recording emissions as outstanding

When an executor returns one or more events addressed to service contracts, the handler records each in `in_flight_event_map` before the delivery ends, keyed by the `id` of the event it is emitting, with `null` as the value. The execution then rests at `waiting` (**The execution record**) — unless the same batch also carried an own `outputs` event, in which case the emissions still go out and are still recorded, but the execution rests terminal (**A mixed batch completes**).

The key is the emitted event's `id` because that is the value a response carries back in `initid` (**Matching a response by `initid`**). The key MUST be present while the answer is outstanding, because the key set — not the values — is what says what the execution is waiting for. A response arriving for a key replaces that key's `null` with the response event.

#### The default: join on all

**By default a handler joins on all of them.** On a response delivery the handler records the response against its key and then:

- if any entry in the map is still `null`, the executor MUST NOT be entered. The delivery ends, the record is written, and the execution stays at `waiting`.
- if none is, the executor is entered with every response available to it through **collected** on the execution context (**The execution context**).

This makes concurrency invisible to an executor. It is entered once per round with a complete collection, and never has to reason about how many responses have arrived, in what order, or whether it has seen this one before. The safe behaviour is the one that requires no decision from an author.

#### The per-version override: enter on each

The join is governed by the option **`collect`** (**Options**): `all` joins, `each` enters the executor on every response with whatever the collection holds at that moment — some entries answered, others still `null`.

It is resolved per version rather than fixed per handler, because an executor entered on every response must be safe to enter repeatedly, and that is a property of executor code, which is written per version. State is version-bound too, so a version keeping a running tally may tolerate this where its successor does not.

Under the override, returning nothing on a partial collection is the ordinary case rather than a defect: responses remain outstanding, so the execution stays at `waiting` (**Emitting nothing: `waiting` or `idle`**). An implementation SHOULD document the cost plainly at the point the option is offered, because an executor that is not in fact safe to enter repeatedly will appear to work until two responses arrive close together.

#### The map is rebuilt, not merged

`in_flight_event_map` is **rebuilt on every emission**, not merged into. When an executor returns service emissions, the new map is exactly those emissions; whatever the map held before is gone. It therefore always describes precisely what the current round awaits, and "what is this execution waiting for" has one answer at all times.

Under the default join this is unobservable, because the executor is entered only on a complete collection and a complete collection is the only state from which it can emit again. Under the override it is observable and lossy: emitting while a response is still outstanding abandons that response, since the rebuilt map no longer holds its key and the answer will not be awaited when it arrives. An implementation MUST document this as the cost of the override.

#### A response is processed only if awaited

**A response is processed only if the collection is awaiting it.** One that is not is a fault, `response_unawaited`, checked at gate step 15 (**Entry validation**).

One rule covers three situations: a response whose key the map was rebuilt without, a response answering a key that already holds an answer, and a response arriving at an execution that has already finished. None of them re-enters the executor, and none reopens a terminal execution — the last is caught earlier still, by the lifecycle check at step 10.

#### Duplicate versus unawaited

The one response delivery that is discarded rather than faulted is an outright duplicate, recognised at gate step 9 by its event `id` already appearing in `event_ids` (**Why the duplicate check precedes the lifecycle check**).

The distinction is worth holding onto. A duplicate is the transport doing its job under at-least-once delivery, and the handler has demonstrably already processed that exact event, so there is nothing to report and nothing to do. An unawaited response is a participant sending something nobody asked for, which is a real disagreement between two deployed nodes. Quiet about the first, loud about the second.

#### A service that never responds

Under the default join, a service that never responds leaves an execution at `waiting` indefinitely, and every other response it was waiting for is held with it. The handler cannot notice this: it is entered only when something arrives, and nothing arriving is precisely the case.

Following up on such an execution belongs to whatever runs the handler (**What else the runner owns**). The model defines no deadline of its own — ADR-000 defers timers, and this ADR assigns the responsibility without inventing the semantics. What a bound on `waiting` should be is left deferred (**Left deferred**).

### Failure protocol

#### The two categories

An execution's failures fall into exactly two categories. Both are defined before either is elaborated, because everything after this — the fault object, the retry figures, the abandonment pair, and what a mechanism is obliged to do — turns on which one is in play.

| | **Execution fault** | **Handler error** |
|---|---|---|
| What failed | The delivery — a precondition the handler required, or an obligation it had to meet | The work — the executor could not fulfil the contract it implements |
| Protocol state | Broken or unverifiable; nothing the executor determined can be relied upon | Intact; the delivery classified, the record was sound, the execution ran |
| Is it a conclusion? | No. Nothing was concluded | Yes. This is the execution's conclusion |
| Becomes an event | Not itself. It carries one, published only if the execution is abandoned | Yes — the version's handler error event |
| Record written by the handler | None | Yes; terminal at `error` |
| Audience | Whatever runs the handler | The caller |
| Retry | Carried explicitly: retry safe or not, with figures | Not applicable — a concluded execution has nothing to retry |

#### Execution fault

**Execution fault** is the condition in which a delivery could not be carried through to a trustworthy conclusion. What broke is a precondition the handler required before it could run — the gate (**Entry validation**), the state function, the dependency factory — or an obligation it had to meet in order to commit: a returned event that is not permitted, a state that will not serialize, a batch that would breach the version's depth or time bound. Because nothing the executor determined can be relied upon, **a fault concludes nothing: it emits no event and writes no record.** It is a statement about the delivery, and its audience is whatever runs the handler.

#### Handler error

**Handler error** is the condition in which a delivery was carried through to a valid conclusion, and that conclusion is that the executor could not fulfil the contract it implements. The protocol was intact throughout: the gate passed, the record was sound, the executor ran and failed. Because the outcome is a contractual one, it is expressible as the standardized handler error event every contract version carries (ADR-005), and it returns to the caller as an ordinary event. It is a statement about the work, and its audience is the caller.

#### The single test: was anything concluded?

The test for any failure, including one a later ADR introduces, is one question: **did anything get concluded?** If nothing was, it is a fault. If something was, and what was concluded is "I could not", it is a handler error. The two timeouts under **Timeouts** show the test at work: a run that overran concluded nothing and is a fault, retry safe because the next attempt may finish; an execution that outlived its bound also concluded nothing and is a fault, not retry safe because no attempt can give it back the time.

#### Handler error: the event and the terminal lifecycle

A handler error MUST be reported as the self contract version's handler error event, addressed as an own-contract emission under **The complete field defaults**, and the execution MUST reach a terminal lifecycle. Which lifecycle depends on who publishes the event: **`error`** where the handler emits it itself, and **`failure`** where a mechanism publishes it for an execution already abandoned (**Abandonment**). In the first case it is a concluded execution — it produced an event and a record, and a mechanism has nothing to retry.

The event's payload is ADR-005's fixed shape: `error_name`, `error_message`, and `error_stack`. Where the executor failed, `error_name` is the name of the failure the language raised, `error_message` its message and `error_stack` its stack or `null`. Where the execution was abandoned, `error_name` is `ArvoHandlerFault` (**Why the name is fixed**), and the other two are the fault's `message` and `stack`.

#### The two causes, and the set is closed

**An executor never constructs the handler error event.** The handler does, from exactly two causes:

- **a failure escaping the executor** — the handler produces the event, emits it, and writes the record at `error` with the failure's message in `lifecycle_description`;
- **an execution abandoned after a fault** — the handler built the event in advance and carried it on the fault, and a mechanism publishes it on the handler's behalf when it gives up, committing the record at `failure` beside it (**Abandonment**).

That set is closed, and only the first is one an executor reaches by its own act. Everything else that ends in the handler error event arrives through the second: a depth bound crossed (**Depth**), a time bound crossed (**Timeouts**), a cancellation without an answer (**Marking an execution `cancelled`**), a retry budget spent (**Retry**). Each is a fault first, and becomes the event only if the mechanism abandons the execution. The two causes differ in who acts and where the record rests, and the record keeps them apart on purpose: being abandoned and concluding "I could not" are different facts, and `error` and `failure` are how a reader tells them apart later.

#### An executor never constructs the handler error event

Failing and the event are one thing seen from two sides: an executor says "I cannot fulfil this contract" by failing, and the caller hears it as the event. There is no path by which an execution reports its own failure and carries on, and none by which it carries on while claiming to have failed. This is why the **event builder** refuses the handler error type and a hand-built event carrying it is refused at return as `emission_not_permitted` (**What an executor may return**): an executor that could construct the event could emit it and then keep running, and the event would no longer mean what ADR-005 says it means.

#### The narrow exception: an executor raising a fault

The exception is deliberate and narrow. Where an executor raises a failure that *is* an execution fault — one built through the **fault** member of the execution context (**The execution context**) — it stays a fault and does not become a handler error. It carries `fault_kind` `executor_raised`, the executor's reason as `message`, and the retry verdict the executor chose, **retry safe unless the executor says otherwise**, expressed as `retry` present or `null`. Where the executor said not, or where its retries are spent, `retry` is `null` and it carries the abandonment pair like any other fault. It is the one kind whose verdict is not fixed in the vocabulary, so for it alone `fault_kind` does not tell a mechanism whether the failure was fixable; the executor's `message` is where that reason lives.

How such a failure is distinguished from an ordinary one is API shape and each language's own choice (ADR-004); what this ADR fixes is that the distinction exists, which side of it produces an event, and what it costs (**The cost of an executor raising a fault**).

#### The fault object

A fault MUST carry whether a **retry is in prospect** and, where it is, how long a mechanism should wait before the next attempt — so a mechanism can retry, dead-letter, or escalate without inspecting a message or consulting a handler's declaration. It carries the rest of what follows for the same reason: a fault writes no record, so anything not on the fault is lost to everything downstream of it.

```
ArvoHandlerFault                     extends the language's native error type;
                                     every field below is JSON-representable

    name                string          'ArvoHandlerFault', fixed; reaches the wire via error_name
    fault_kind          string          which fault this is; the vocabulary is the table below
    message             string          what failed, the value, and the rule broken
    cause               string | null   the underlying failure rendered as a string,
                                        or null where nothing underlies it
    stack               string | null
    violations          string[]        every check that failed, not only the first;
                                        one human-readable entry per failed check,
                                        naming the check and the value that failed it.
                                        empty only where nothing was checked

    subject             string          the delivered event's subject
    execution_id        string | null   the key the state function was called with: on an
                                        init, the identifier derived from the event; on a
                                        followup, the event's executionid. null only where
                                        the delivery could not be classified
    event_id            string          the delivered event's id

    attempt             integer         this delivery's attempt number, counting from 0
    timestamp           integer         when this delivery was processed, ms since the Unix epoch
    retry               object | null   null where no retry is in prospect
        max_retry_attempts_allowed   integer
        retry_in_ms                  integer   milliseconds
        retry_at                     integer   ms since the Unix epoch; timestamp + retry_in_ms

    abandonment_event   ArvoEvent | null    the handler error event to publish if this
                                            execution is abandoned
    abandonment_state   record | null       the execution record to commit alongside it,
                                            already terminal at failure

                                            NEITHER is acted on when the fault is received --
                                            only if the execution is abandoned. See Abandonment
```

`subject` and `event_id` are read from the delivered event and are never `null`: ADR-001 requires both on every event, and the gate has them before it checks anything. `execution_id` is **the execution this delivery concerns, as the key the handler passed to the state function** (**Resolving the existing execution**). On an init that is the identifier derived from the event's `dataschema` and `id` (**Execution identity**), which is *not* the event's own `executionid` — that names the caller and becomes `parent_execution_id`. On a followup the two coincide, because a response carries its caller's identity in `executionid`. It is `null` only on `event_unclassifiable`, where step 1 failed and no key was ever selected. Defining it as the key rather than as a field of the event is what lets a mechanism dead-lettering the fault find the record it concerns.

#### What is normative in the fault object

**Everything above is normative: the semantics of every field, the field names, the value `ArvoHandlerFault`, the `fault_kind` vocabulary, and the requirement that the whole object be representable as JSON.** The names are fixed for the same reason the record's are (**The execution record**). A mechanism may dead-letter a fault, and dead-lettering means storing it; a fault stored by one language MUST be readable by another (ADR-004), and a durable format with per-language spellings is not one format. This is the second of the two objects that leave the process (**Scope**), and it is held to the same standard as the first.

What is *not* normative is the shape of the object in a language's own terms: which native error type it extends, whether the fields are properties or accessors, and how an executor's `fault` is told apart from an ordinary failure. Those are API shape (ADR-004).

#### Why the name is fixed

`ArvoHandlerFault` is fixed rather than left to each language because it does not stay inside the implementation. It is what the abandonment event carries in `error_name`, which is the only thing telling a caller that its callee was *abandoned* rather than that its callee's own logic failed. A caller filtering on that string against an implementation that spelled its class differently does not error — it silently falls through to the wrong branch, and the one signal that distinguishes "the work was given up" from "the work was tried and failed" is lost.

#### `cause` and `violations`

`cause` is a string rather than the underlying error value because a fault may be dead-lettered, and dead-lettering means persisting it. That is the same reason the whole object must survive JSON: anything added here later must survive it too.

`violations` exists because **Entry validation** requires a fault to name every check that failed rather than only the first (**Every fault names every failed check**), and a single `message` cannot carry that structurally — a reader would have to parse prose to recover a list, which is the interpreting-a-message this object exists to avoid. **Each entry is a string**, one per failed check, naming the check and the value that failed it; the list is JSON `string[]` and nothing more structured, because a reader in another language needs to display it, not to branch on it — branching is what `fault_kind` is for. Where the gate short-circuited, `violations` holds the one check that stopped it; where it evaluated several, as steps 12 and 14 do, it holds all of them. On a return fault it holds every rejected event in the batch, offenders and non-offenders alike (**One offending event rejects the whole batch**). `message` remains the human-readable rendering of the same thing.

#### `attempt` and `timestamp`

`attempt` and `timestamp` sit on the fault rather than inside `retry`, because both are true whether or not another attempt is coming, while everything inside `retry` is only meaningful if one is. Nulling them alongside the forward-looking figures would lose the attempt count at exactly the moment it is most worth having — the fault that exhausts a retry budget, on which a mechanism decides whether to abandon. Their units, and those of the `retry` block, are pinned under **Units: milliseconds throughout**.

#### The `fault_kind` vocabulary and retry verdicts

| Where | Fault | `fault_kind` | Retry safe |
|---|---|---|---|
| gate 1 | the delivered event's `dataschema` names no declared contract at a declared version | `event_unclassifiable` | no |
| gate 2 | `category` contradicts what resolution found | `category_mismatch` | no |
| gate 3 | the state function failed | `state_resolution_failed` | **yes** |
| gate 4 | an init delivery arrives with a record | `record_unexpected` | no |
| gate 4 | a followup delivery arrives without one | `record_expected` | no |
| gate 5, gate 7 | the record's envelope fails validation, or its `data` fails the owning version's schema | `record_invalid` | no |
| gate 5 | an event in the record fails to restore | `record_event_unrestorable` | no |
| gate 6 | the record's `version` is no longer declared | `version_not_declared` | no |
| gate 8 | the delivered event's `depth` is at or beyond the version's maximum | `max_depth_event_received` | no |
| gate 10 | the delivery reaches a record already at a terminal `lifecycle` | `lifecycle_terminal` | no |
| gate 11, and return | the execution has outlived the version's execution timeout | `execution_timeout` | no |
| gate 12 | the event carries no `to` | `event_unaddressed` | no |
| gate 12 | record, handler and event disagree on `to`, `source`, `execution_id` or `subject` | `addressing_mismatch` | no |
| gate 13 | the event's type is not one the resolved contract can send here | `type_not_receivable` | no |
| gate 14 | the delivered event's payload fails its contract's schema | `event_schema_rejected` | no |
| gate 15 | a response's `initid` names nothing the collection is awaiting | `response_unawaited` | no |
| declaration reached a delivery | the handler declares two versions of one service contract | `service_version_conflict` | no |
| after the gate | resolving the executor's dependencies failed | `dependency_resolution_failed` | **yes** |
| execution | the executor did not return within the version's run timeout | `run_timeout` | **yes** |
| execution | the executor marked the execution cancelled and returned no own-`outputs` event | `execution_cancelled` | no |
| execution | a fault the executor raised deliberately through the context | `executor_raised` | **executor's choice; yes unless stated** |
| return | a returned value is not an event, or an event's type is not emittable by this version, or it is structurally invalid, or a batch carries more than one own-`outputs` event | `emission_not_permitted` | no |
| return | a returned event's payload is rejected by its schema | `emission_schema_rejected` | no |
| return | a returned event would go beyond the version's maximum depth | `max_depth_event_requested` | no |
| return | the value written through `set state` is rejected by the declared schema | `state_schema_rejected` | no |
| return | `data` does not survive a JSON round trip | `state_not_serializable` | no |

This table is the whole of the `fault_kind` vocabulary, and it is here rather than in a list of its own so that a kind, its meaning, where it arises, and its retry verdict cannot drift apart. Several conditions a mechanism must be able to tell apart are named separately even where one gate step catches both — a record that arrived when none was expected is a different diagnosis from one that never arrived at all, and a mechanism reading `fault_kind` should not have to recover that distinction from a message.

The verdicts follow from one question: **would the same inputs produce the same failure?** A malformed record, a removed version, a bad payload, an impermissible emission and a crossed bound are all reproduced exactly by a redelivery. Three are different. The state function and the dependency factory reach outside the handler, and what is outside may answer differently a moment later. A run timeout says only that *this* attempt did not finish, and the next may. Every retry-safe verdict is subject to exhaustion: once `attempt` reaches the version's limit the fault is reported with no retry in prospect — `retry` is `null` while `fault_kind` and its verdict are unchanged — and carries the abandonment pair (**Exhaustion ends retrying**).

#### Abandonment: the contingency a fault carries

A fault never becomes an event and never writes a record. What it carries is a **contingency**: a handler error event and the execution record that accompanies it, both built by the handler while it still had what it needed, to be acted on for it if it is never going to run again.

#### The pair is what an ordinary delivery returns

**The pair is exactly what an ordinary delivery returns.** A successful delivery hands the mechanism events and a next record to commit together; abandonment hands it the same two things, prepared in advance for a delivery that could not finish. The obligation that the event and the record be committed together or not at all (**Required of infrastructure adapters**, obligation 1) therefore applies unchanged, and no new rule about their ordering is needed.

#### Acted on only when a mechanism gives up

The distinction from an ordinary emission is only *when*. **Neither is acted on when the fault is received.** They MAY be acted on at exactly one moment: when a mechanism has decided it will not retry, and has chosen to abandon (obligation 3). Publishing on an attempt that is then retried successfully would deliver a caller both a handler error event and a real completion for the same request, which is worse than the silence this exists to end.

**Whether to abandon is the mechanism's decision, and this ADR does not make it.** A non-retryable fault, or an exhausted one, means one thing to a mechanism: it MUST NOT redeliver. What it does instead — abandon with the pair, dead-letter the fault for a human, alert and hold, discard — is policy that belongs to the deployment, because the mechanism knows things the handler cannot: whether a store outage is being repaired, whether a `record_unexpected` was its own redelivery rather than a defect, whether an operator would rather decide. The pair exists so that abandonment, when chosen, needs nothing composed; it does not exist to force the choice. What the protocol fixes is only that a mechanism which abandons MUST use the pair as handed, together, and MUST NOT author a substitute.

#### The handler builds both, the mechanism composes neither

This is the point of carrying them. A mechanism gains no ability to construct an event and no ability to author a record — it commits one and sends the other, exactly as it does for a delivery that succeeded. It is also why the event must be complete, `id` included, rather than a recipe: should a mechanism commit the pair, publish the event, and crash before it has recorded that the event was sent, it will publish the same committed event again on recovery (obligation 1), and the caller's gate discards the second copy at step 9 as already seen — where a regenerated event would arrive as a second, distinct error.

#### `abandonment_state`

**`abandonment_state` is the record at `failure`**, with `lifecycle_description` carrying the fault's own message, `event_ids` extended with the abandonment event's `id` as `emitted`, `triggering_event` set to the delivered event, and `cas_version` incremented as for any other write. Every other field is carried forward from the record as the attempt read it. `failure` rather than `error` because the execution was abandoned rather than concluded, and **The execution record** keeps those apart.

#### Each attempt builds its own pair

Each attempt builds its own pair from the record it was given, which is what the re-read under **Every retry re-reads the record** makes correct: the pair a mechanism finally commits was derived from the record as of the attempt it gave up on, not as of the first one. Where a write nonetheless lands in between, the compare-and-swap fails (obligation 5), and what to do then is the mechanism's — committing anyway overwrites a record that legitimately advanced, while honouring the failure leaves an execution un-abandoned. Neither is safe in general, so this ADR requires the attempt and leaves the resolution where the knowledge is.

#### When each is present, and why they differ

`abandonment_event` is present wherever the handler can address a completion. On an **init** delivery that is as soon as step 1 has classified it: the init event itself carries the caller's `source`, the `subject`, and the `executionid` a completion answers to, so every init fault from step 2 onward carries the event, `max_depth_event_received` included. On a **followup** delivery it is as soon as step 5 has passed: the record is then trustworthy and holds `init_event_source` and everything else the defaults table needs. Before that point a followup holds only a service's response, whose `source`, `initid` and `executionid` all name the service rather than this execution's caller, and there is nothing to address from. So the event is `null` on `event_unclassifiable`, where the delivery could not even be told init from followup; and on a followup's `category_mismatch`, `state_resolution_failed`, `record_expected`, `record_invalid` and `record_event_unrestorable`. An implementation MUST NOT salvage the addressing fields from a record that failed validation — reading fields off a structure not established to be a record is what **Why the record is validated before anything reads it** rules out.

`abandonment_state` is present on a narrower set: only where a trustworthy record exists to be brought to `failure`, which is a followup past step 5. **On a fault against an init delivery it is `null` even though the event is not**, because no execution validly began and there is nothing to mark terminal. Manufacturing a record for one would also make the init undeliverable: the next attempt would find a record where step 4 requires none, and a transient init fault would become an init that can never be delivered again. So on an init fault the caller is told and nothing is stored, which is the correct pair of outcomes: something was waiting on an answer, and nothing was ever waiting on a record.

#### `lifecycle_terminal` yields neither

`lifecycle_terminal` yields `null` for both, by rule rather than by inability. That execution already answered its caller and already rests terminal; a second completion would be discarded or refused at the caller's gate, and overwriting its lifecycle would erase how it actually ended. The same holds for `response_unawaited`, `event_unaddressed` and `addressing_mismatch` on a record already terminal, since step 10 refuses those deliveries before the later steps run.

#### What the abandonment event carries

**`error_name` carries `ArvoHandlerFault`**, which is what distinguishes this event from one an executor's own failure produced. `error_message` carries the fault's `message` and `error_stack` its `stack`, per ADR-005's fixed payload. Every other field follows the own-contract column of **The complete field defaults**, `parentid` being the delivered event's `id` because that delivery is what caused the abandonment.

Because that message crosses into another handler's event stream and is persisted in that handler's record for as long as the record lives, an implementation SHOULD keep raw infrastructure detail — hosts, credentials, connection strings — out of fault messages, or redact when building this event. It is the one place this protocol moves diagnostic text across a node boundary.

#### No failure routes to the workflow root

**No failure defined here routes to the workflow root.** ADR-001 permits such an event — carrying `subject` as its `executionid`, bypassing intermediate executions so a failure surfaces at the top regardless of depth — and defers the conditions to this ADR. This ADR defines none: a handler failure is attributable to the execution that suffered it and returns to that execution's caller, and an abandonment event goes to that same caller for the same reason. The capability remains available and unused, and the conditions stay deferred rather than being invented to fill the slot (**Left deferred**).

#### Where each category records its cause

Both categories record their cause in `lifecycle_description` where a record survives them — a handler error reaching `error` writes the failure's message there, and a mechanism abandoning an execution writes the fault's message alongside `failure`. A fault leaves nothing behind of its own, which is why its retry safety and everything else a mechanism needs must travel on the fault itself rather than in the record.

#### The cost of an executor raising a fault

**An executor raising a fault leaves its caller waiting until the retry budget is spent, and that consequence MUST be documented wherever the means to raise one is offered.** A fault is not an answer, so nothing reaches the caller while the mechanism is still retrying — and where the fault carries no abandonment event, nothing reaches it afterwards either. The cost is bounded by the version's retry options and by the mechanism's own patience, but it is not nothing: the caller waits for as long as the retries take, and **Considered Alternatives** rejects the general shape of it for handler failures on the ground that a failure a caller never hears about is a workflow that stalls.

#### When to raise a fault and when to fail

That makes the choice a narrow one rather than a matter of taste. Raise a fault where the *delivery* is compromised and a retry is the only sensible response: a resource that would not open this time, a precondition the executor can see is not yet met. Where the executor's own *work* failed, fail — and let the handler error event tell the caller now, which is the shape it is already obliged to handle. An executor that is unsure should fail: a handler error the caller hears at once is recoverable by the caller, and a fault the caller waits on is recoverable only by the mechanism.

#### The two names are kept distinct

The two categories are named distinctly on purpose. "Handler error" refers only to the event; a fault is never an event, and the event it may carry is the handler's, not the fault's. An implementation MUST NOT use one name for both, and the fault's own name is fixed at `ArvoHandlerFault` rather than left to each language, for the reason given under **Why the name is fixed**.

### Dependencies

#### Outside the model, supplied per delivery

An executor's implementation dependencies — a database client, an HTTP client, a clock, a secret — are outside the model. ADR-000 constrains them in exactly one way: "no live implementation dependency may be relied upon to survive one", a suspension. This ADR settles how they reach an executor so that the constraint holds by construction rather than by discipline.

**Dependencies are supplied per delivery, by the mechanism, alongside the event, the state function and the attempt number** (**Retry**). They are not part of the handler's declaration: the record never holds them, and two handlers declaring the same contracts with different dependencies are the same handler to the protocol. What the executor is written against — the shape it expects to find on **dependencies** in the execution context — is that executor's own concern, and each language expresses it in its own way (ADR-004).

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

The value form is for dependencies that are safe to share across deliveries and hold no per-execution state — a configuration object, a pure client. The factory form is for everything else. Where a factory is supplied, the handler calls it **exactly once per delivery**, after the gate has passed and the record has been hydrated, and before the executor is entered. It therefore receives a record the handler has already validated, or absence on an init, and never a structure not yet established to be a record (**Why the record is validated before anything reads it**). Whatever it yields is placed on the context as **dependencies**, unchanged; the handler does not inspect it.

The factory receives the attempt number for the same reason the state function does (**Resolving the existing execution**): a dependency built for a third attempt may reasonably differ from one built for a first — a longer connection timeout, a different replica — and the factory is the only place that decision can be made.

#### Why the factory form matters for resumability

The factory form is what a resumable handler needs. A handler runs only when something delivers to it, and between deliveries there is no process to hold anything; ADR-000's rule that no live dependency survives a suspension is not a restriction the protocol imposes on an executor so much as a description of the executor's situation. The factory makes that situation the ordinary one: nothing live is constructed until a delivery needs it, it lives for that delivery, and nothing about it is captured anywhere the next delivery could see. An executor that stashes a client in module scope and reaches for it next time has stepped outside the protocol, and an implementation SHOULD make the factory the easy path so that it need not.

Giving the factory the delivered event and the record lets a dependency be built *for this execution* rather than for the process: a client scoped to the tenant the init event names, a lock keyed on `execution_id`, a signal keyed on `subject`. That is what makes the cooperative pattern under **Cancellation** possible without adding anything to the model.

Three rules follow, and they are the whole of what the protocol asks:

- a resolved dependency MUST NOT be retained by the handler across deliveries — it is built for one and discarded with it, exactly as the execution context is (**One object, built per delivery**);
- a resolved dependency MUST NOT be written into the execution record — the record is JSON and a dependency is live, and `data` that will not survive a round trip is already a fault (**Serializability of `data`**);
- a factory MUST NOT be able to alter the outcome of the gate, the collection, the depth check or the timeouts — it runs after the gate has decided and before the executor, and it is given the record to read, not to write.

#### A failing factory is a retry-safe fault

**A factory that fails is an execution fault, `dependency_resolution_failed`, and it is retry safe.** However the language signals the failure, the handler MUST NOT catch and reinterpret it: it surfaces as a fault with the failure rendered into `cause`, and nothing is emitted or written. It is retry safe because constructing a dependency reaches outside the handler — a pool that is exhausted now, a service that is restarting — and what is outside may answer differently a moment later. It is, with the state function, one of the two entry-path faults with that verdict (**The `fault_kind` vocabulary and retry verdicts**), and for the same reason. Like every retry-safe fault it is subject to exhaustion, and on a followup it carries the abandonment pair, so a mechanism facing a dependency that never comes back can end the execution at `failure` with the cause on record rather than leave it at `waiting` forever.

The factory is not under the run clock (**Timeouts**): the run clock bounds the executor's code, and a factory that hangs is diagnosed as a dependency failure, not as a stuck executor. An implementation MAY bound the factory on its own account, and where it does, expiry is this same fault.

### Cancellation

#### Nothing cancels an execution but itself

**Nothing can cancel an execution but the execution itself**, and this is a decision rather than an omission. There is no cancel event, and there is no way for one node to interrupt another. This ADR settles the point ADR-000 deferred, and settles it in the negative (**Scope**).

Two things already decided leave no room for anything else. A contract version declares exactly one `input` (ADR-005), so a handler's inbound events are its init event and its services' responses and nothing more; a cancel event would have to be a second model-level derived event alongside the handler error event, arriving at every version of every contract, and nothing in ADR-005 provides for one. And interrupting an execution that is *running* would need a control path outside the event stream, which ADR-000's *Event-Only Communication* forbids: "no node, coordinating or otherwise, may rely on a control mechanism absent from the model". Between deliveries there is nothing running to interrupt, and during one the executor is inside a delivery whose protocol outputs commit atomically (**Protocol outputs commit atomically**) and which either concludes or faults.

The absence is also honest about what a cancel event could not do. A response already in flight from a service would still arrive; an execution already at `success` cannot be un-completed; and an executor with side effects already made would need compensation the model cannot write for it. A cancel event would promise what only the application can deliver.

#### What the model provides

What the model provides is enough for an execution to stop itself and say so, and nothing more:

- **a way to notice.** The dependency factory receives the delivered event and the record (**Dependencies**), so it can consult whatever cancellation signal an application maintains — a flag in a store, a revoked token, a closed ticket — and hand the answer to the executor as part of its dependencies;
- **a way to record it.** The **cancel** member of the execution context marks the execution `cancelled` with a reason, and `cancelled` is terminal (**Marking an execution `cancelled`**);
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

- **It takes effect on the next delivery, not now.** An execution at `waiting` is cancelled only when a response arrives; one whose services never respond is never delivered to again and never reads the signal (**A service that never responds**). Where an application needs a bound on that, the execution timeout is the protocol's instrument (**Timeouts**): it ends the execution for time whether or not any signal was ever read.
- **A response already in flight still arrives.** It reaches a record at `cancelled`, which is terminal, and is refused at gate step 10 as `lifecycle_terminal`. That refusal is a fault, and the mechanism handles it as one; it is not a defect in the cancelling execution.
- **The executor decides what winding down means.** The protocol does not know which side effects were made or how to undo them. Compensation is expressed through events the contracts already permit, and where a contract permits none, there is none.
- **The cancelling execution still answers.** Marking `cancelled` is a reason to stop, not a way out of the protocol, and the three outcomes under **Marking an execution `cancelled`** decide what reaches the caller, or what the mechanism is handed to send.

## Consequences

### Gained

**A handler is a function.** Of a delivered event, a record fetched through a state function, resolved dependencies, and an attempt number — and of nothing else. That makes it testable with literal values and no infrastructure, which is the property that most reliably decides whether resumable code can be reasoned about. A test hands in an event, a function that returns a fixed record, a value for dependencies and the number 0, and checks the events and record that come back.

**Resumption is one keyed read, and the mechanism needs to understand nothing.** The state function takes `execution_id` and returns what is under it. A mechanism does not classify, does not derive, does not know what a record is, and never authors one. Everything it stores and forwards was built by the handler, so the model's data has one author everywhere.

**Identity is derived, unique, and the same in every language.** `execution_id` is a pinned hash of two fields the init event already carries, so two handlers in two languages reading one event agree on which execution it opens, and a unique init `id` makes every execution unique without a coordination step.

**The capability set is closed and known before anything runs.** A mechanism can determine what a handler may emit from its declaration, a type system can reject an impermissible emission before deployment, and a declaration that cannot work — a version without an executor, a type collision, two versions of one service, an execution timeout shorter than a run timeout — is refused before any event exists.

**Every failure has one of two shapes, and a mechanism never guesses.** A fault says on its face whether to retry and when; a handler error is an event the caller already handles. An adapter that reads `retry` and `fault_kind` has all it needs, and never parses a message.

**An abandoned execution can still answer its caller and record how it ended, with nothing composed by the mechanism.** The fault carries both, built by the handler before it lost the ability to speak. The failure that most reliably strands a workflow — retries exhausted, a store gone, a depth or time bound crossed — can surface in the shape every caller already handles, and the mechanism's only work is to commit and publish what it was handed. Whether it does is its policy; that it can, without inventing model data, is the gain.

**Recursion and time are both bounded by default.** A version that says nothing gets a depth guard and a thirty-second run clock, so a runaway fan-out and a stuck executor both end as named faults carrying the caller's answer ready for a mechanism to send, rather than as a stack overflow or a process that never returns. A version that says more gets an execution clock, and its total lifetime is bounded too.

**Records and faults are durable formats, readable across languages.** Both carry normative field names and survive JSON, and the record carries its own format version. A record written by one implementation is resumed by another, a fault dead-lettered by one is read by another, and a future change to either has a defined place to announce itself.

**Observability is uniform.** Every delivery is a span continuing the event's trace, and every executor reaches the same three OpenTelemetry objects through the context, so a workflow's trace joins up across suspensions and across implementations without an adapter for each backend.

**Silence is never the handler's doing.** An execution cannot cancel without either answering or handing the mechanism the answer, cannot complete a sink version without resting at `success`, and cannot be abandoned without the caller's answer already built. Where a caller is left waiting, it is a mechanism's policy that left it, and a visible one. `idle` remains, and because every legitimate way of returning nothing rests elsewhere, it is a reliable signal that something was forgotten.

### Paid for

**The mechanism carries more.** It must supply a state function that reads live on every call, an attempt number it may not naturally track, dependencies in either of two forms, and hooks under a mutability constraint. The obligations under **Required of infrastructure adapters** are strict enough that a naive mechanism — publish, then persist — is non-conformant rather than merely lossy, and one that cannot compare-and-swap cannot claim conformance at all.

**Durability moves entirely onto whatever runs the handler.** The handler writes nothing and remembers nothing; every guarantee about the record's survival is the mechanism's, and the protocol can only state what it requires.

**Every fault builds a pair that is usually thrown away.** Most faults are retried successfully, so the abandonment event and record are constructed on the expectation that they will be discarded. And where the record is the thing that broke, neither half can be built at all: the stranding the pair exists to prevent survives in exactly the case where the execution's own memory is what failed.

**A mechanism must make a judgement this ADR declines to make for it.** When the abandonment record loses a compare-and-swap, committing overwrites a record that legitimately advanced and not committing leaves an execution un-abandoned. The ADR requires the attempt and leaves the resolution where the knowledge is.

**The default join waits forever.** Concurrency is invisible to an executor, and the price is an execution at `waiting` on a service that never answers, which the handler cannot notice. The execution timeout bounds this only where a version sets one; the default is unbounded, because the alternative is a default that ends legitimate long-lived workflows.

**A run clock that cannot stop the code.** The protocol promises to stop *waiting*, not to stop the executor, and an executor with side effects must watch the clock itself. An implementation that could interrupt would be more useful than the guarantee the ADR can actually make.

**Eager hydration costs every stored event on every delivery.** A handler awaiting many responses pays that repeatedly, and the ADR chooses it so that a corrupt record fails once at entry with its cause named.

**Removing a version strands its executions, by design.** There is no migration path, so deployment acquires a drain step it did not previously have, and an operator who skips it leaves every in-flight execution of that version unresumable, faulting non-retryably on its next delivery, to be abandoned or held as the mechanism's policy decides.

**A state schema, once deployed, is a contract with the store.** Its author must keep every change compatible with the `data` already written, or take the same drain-and-remove path as any other breaking change. The protocol cannot check this for them.

**The executor holds the misrouting risk.** Because it returns finished events, a hand-built event with a wrong `subject` or `initid` is structurally valid and passes every check at return. The builder removes the need to take that risk, and the unsafe surface names it, but the protocol cannot make it impossible without refusing pre-built events, which **Considered Alternatives** rejects.

**OpenTelemetry is named.** Mandating an observability API is a mild strain on Infrastructure Independence (**Invariants strained**); the ADR accepts it because the alternative is a workflow trace that fragments at every language boundary.

**Time is measured against a producer's clock.** The execution clock starts from the init event's `time`, which the producer set and the handler cannot verify. Skew between a producer and a handler is read as elapsed time, and a version with a tight execution timeout inherits the producer's clock discipline.

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

### Entering the executor on every response by default

Considered, not chosen. It is the more flexible default and needs no override. It also makes every multi-service handler concurrency-sensitive by default, and the failure mode is a partially processed execution rather than an error — an executor that was not written to be entered twice appears to work until two responses arrive close together. The safe behaviour is the one that should require no decision, so joining is the default and entering on each is the per-version opt-in (**Collection**).

### Merging into `in_flight_event_map` on emission

Considered, not chosen. It would prevent a response being abandoned under the enter-on-each override. It would also let a collection span rounds and outlive the emission that created it, so "what is this execution waiting for" would no longer have a single answer. One rule that is occasionally lossy is preferred to a rule that is always ambiguous, and the loss is documented at the point the override is offered.

### Reporting a handler failure as a fault

Considered, not chosen. It would let a mechanism retry application failures uniformly, with one path for everything that goes wrong. It would also make a handler's failure invisible to the caller waiting on it, which contradicts ADR-000's *Event-Only Communication*: the caller's continuation depends on an event arriving, and a failure it never hears about is a workflow that stalls. A handler error is a conclusion and travels as an event; a fault concludes nothing and does not (**Failure protocol**).

### Letting an executor construct the handler error event

Considered, not chosen. It would let an executor say "I failed" and keep running — emit the error event to its caller and then go on to call a service, for instance. That is the property ADR-005 gave the event and this ADR must not lose: it means the handler failed, full stop. An executor that wants to say it cannot do the work says so by failing, and the handler turns that into the event (**An executor never constructs the handler error event**). Refusing the type at the builder and at return costs an executor nothing it legitimately needs.

### Letting a mechanism compose the abandonment event

Considered, not chosen. It looks simpler, since the mechanism is the party that knows abandonment has happened. But addressing a completion needs `to`, `initid`, `executionid`, `subject`, `category`, `dataschema` and a version, all of which are read off a record or an init event by rules this ADR spends a section on — so a mechanism composing one would be reimplementing **Addressing an emitted event**, and any drift between its version and the handler's would misroute a failure at the exact moment a workflow is already in trouble. Carrying a finished event keeps one implementation of the addressing rules and reduces the mechanism's new capability to publishing something it was handed.

### Mandating abandonment on every non-retryable fault

Considered, not chosen. A draft required a conformant mechanism to act on the abandonment pair the moment it received a non-retryable or exhausted fault, so that whether a stranded caller is told would be a property of the model rather than of the deployment. It is the more predictable rule, and ADR-004's concern about behaviour varying by deployment weighs in its favour.

It was rejected because it makes the handler decide something only the mechanism can know. A `record_unexpected` on an init may be the mechanism's own redelivery, and publishing a handler error event for it tells the caller its work failed when the work is running. A store outage under `record_invalid` may be minutes from repair. A deployment may want every abandonment reviewed by a person. Under a mandate each of those produces a false or premature error event; under the chosen rule the handler builds the pair so that abandonment costs the mechanism nothing to compose, and the mechanism decides whether this fault is one to abandon on. What the protocol keeps is the part that must not vary: a fault that says no retry is never redelivered, and a mechanism that does abandon uses the pair as handed.

### Having the mechanism classify the delivery and resolve the record

Considered, not chosen. A draft had the mechanism read `dataschema`, decide init from followup, derive or read the key, and hand the handler a record or nothing. It removes a call from the handler's entry path. It also puts classification — the first and most consequential step of the gate — in code this ADR does not govern, so a mechanism that got it wrong would hand the handler a plausible record for the wrong execution, and the handler's every later check would be validating the wrong thing. The state function (**Resolving the existing execution**) keeps the mechanism classification-blind: it receives a key and returns what is under it, and every judgement about what came back is the handler's.

### Keeping the revision outside the record

Considered, not chosen. It keeps a storage concern out of a model-level format. But the handler is the only party that knows a write has occurred, and a mechanism that must invent its own revision cannot check it against what the handler intended. Putting `cas_version` in the record makes incrementing it part of the handler's defined behaviour rather than a convention a mechanism supplies (**`cas_version`**).

### Letting a version choose between a fault and an error event on a depth breach

Considered, not chosen. A draft offered a per-version option — fault, or emit the handler error event — and a function form that could pick per event. It gave an author control over what the caller hears. It was rejected because the fault already carries the handler error event as its abandonment pair, so the option chose between two paths to the same event, and the function form was a second place for business logic to live outside the executor. One outcome, always a fault, with the executor able to see the limit coming through **at max depth** and choose its own path, is the same expressiveness with one path (**Depth**).

### Bounding time with a single timeout

Considered, not chosen. One number is simpler to declare and to explain. But the two questions it would have to answer have different answers and different remedies: an attempt that is stuck should be retried, and an execution that has lived too long should not. A single clock would either retry an execution that no attempt can rescue or abandon one whose only problem was a slow attempt. Two clocks, one retryable and one not, with a rule about their relation, is the smallest shape that gets both verdicts right (**Timeouts**).

### Defining cancellation as a model primitive

Considered, not chosen. A derived cancel event on every contract, mirroring the handler error event, is the only shape that would work event-natively, and it fits the machinery: `in_flight_event_map` already names exactly the children an execution would need to cancel, so propagation down the tree would need nothing new. It was rejected on cost against demand. It makes the handler error event no longer the single standardized emit ADR-005 deliberately kept it as, it adds a third classification case every implementation and every handler must then handle, and it makes cancellation a thing a node can have done *to* it — a meaningful shift in what a participant is, for a capability most handlers never use.

Note what was and was not avoided. The terminal `cancelled` lifecycle exists either way, because a record should say why an execution ended under either design; that was never the expensive part. What the cooperative form avoids is the inbound event, the classification case, and a participant losing the property that nothing external stops it (**Cancellation**).

### Defining a migration path for an execution record

Considered, not chosen. It is the obvious answer to the drain cost under **Paid for**, and every durable-execution system eventually grows one. It cannot be built on ADR-005's foundation: per-version isolation means there is no compatibility relation between two versions to migrate along, so any mapping would be one an implementation invented, applied to state whose meaning only the original executor knows. An honest prohibition is better than a mechanism that silently reinterprets state, and draining is a cost a deployment can see and plan for (**A record belongs to one version for its whole life**).

### Defining compatibility rules for a version's state schema

Considered, not chosen. A draft wrote a rule set for how `data`'s schema may change after deployment — which fields may be added, which constraints tightened — mirroring the rules the record envelope holds itself to. It was withdrawn because the schema is the version author's, not the protocol's: the protocol composes it into validation and does nothing else with it, and a rule set it cannot enforce would be advice dressed as a requirement. What remains is the one fact the protocol can state, that an incompatible change fails every in-flight execution at gate step 7, and the one obligation that follows from it (**Changing a deployed version's state schema**).

### Requiring a specific concurrency mechanism

Considered, not chosen. Naming a locking or transaction strategy would make the guarantee concrete and testable. It would also make this ADR the first to require a particular infrastructure capability by name, which ADR-000's *Infrastructure Independence* is explicit about avoiding. Stating the obligation — compare-and-swap on `cas_version`, and the outbox behaviour under **Required of infrastructure adapters** — and leaving the mechanism free preserves that.

## Conformance to ADR-000

### Effect on AAM

This ADR amends the AAM membership list (ADR-000, *Arvo Application Model*) by explicit reference, in five ways.

**It replaces "handler interfaces and lifecycle semantics"** with what this ADR defines: the declaration model, execution identity, the execution context, the execution record and its lifecycle, classification and the gate, depth, collection, retry verdicts, the two timeouts, the failure categories, and the abandonment pair. All of these are inside the model, because a handler whose lifecycle meant different things under two mechanisms would not be one handler.

**It places two durable formats inside the model.** The execution record's field names and the fault object's field names, and the value `ArvoHandlerFault`. ADR-005 placed the canonical contract form inside the model for the reason that applies here: durable data outlives the code that wrote it, and a record or a dead-lettered fault that means different things in two languages is not one model (ADR-004).

**It places one derivation inside the model.** The `execution_id` derivation (**Execution identity**), pinned byte for byte, because an identifier two implementations compute differently is not an identifier.

**It places the observability API inside the model, and leaves the backend outside.** The shape through which an executor reaches trace, log and metric — OpenTelemetry's span, logger and meter — is inside (**Observability**). Collection, retention and export remain outside, exactly where ADR-000 already lists them. The line is drawn at the API because that is where a workflow's trace would otherwise fragment.

**It decides the Deferred Decision on cancellation, interruption and compensation by splitting it.** *Interruption* — one node stopping another — is placed outside the model, and Arvo defines nothing for it. *Compensation* is likewise outside: it happens through events a contract already permits and needs no primitive. What is inside is only what a durable record requires: the terminal `cancelled` lifecycle, `lifecycle_description` to say why, and the `execution_cancelled` fault that hands a mechanism the caller's answer when an execution cancels without giving one. The signal an application reads is not a model concept (**Cancellation**).

One item ADR-000 lists outside the model is touched and left there. "Retry counts, batching, and other adapter-internal behaviour" remain the mechanism's. What this ADR adds is that the *handler* states a verdict — `retry` present with a suggested delay, or `null` — and the mechanism MUST NOT continue past a fault that says no retry is in prospect (**Exhaustion ends retrying**). How many times it actually tries within that verdict, and whether it honours the delay, stay its own.

### Invariants depended on

- **Event-Only Communication.** Every interaction here, including a handler's own failure and its abandonment, is an ArvoEvent governed by a contract. Cancellation is defined cooperatively precisely so that nothing needs a control path outside the stream.
- **Explicit Contracts and Runtime Validation.** The closed capability set, the gate, the record's validation and the checks at return all rest on a contract being a complete, checkable declaration, and all validate at runtime rather than trusting a type.
- **Infrastructure Independence.** The handler reaches no store and names no transport. It receives a state function, an attempt number and dependencies, and returns events and a record; everything it requires of a mechanism is stated as a property.
- **Nondeterminism Is Permitted.** Nothing here requires an executor to be deterministic, because recovery republishes what was committed rather than recomputing it, which follows from adapter obligation 1 below.
- **Observability by Default.** Every delivery continues the delivered event's trace, and the lineage fields ADR-001 defines are set by the handler on every emission, so composition stays observable without an executor doing anything.
- **Explicit Failure Boundaries.** ADR-000 distinguishes protocol failures from handler failures and defers their representation. The two categories under **Failure protocol** are that representation for the two of its three boundaries a handler can see: an execution fault is a protocol failure, a handler error is a handler failure. Infrastructure and delivery failures stay the mechanism's, and stay deferred.

### Invariants strained

**Open Composition**, addressed rather than strained, and stated so a reader sees why. ADR-000 holds that "Arvo imposes no architectural limit on composition depth" and that "practical limits belong to the selected infrastructure". The guard under **Depth** is not such a limit. It constrains nothing about the `depth` field, applies to what one handler is willing to emit rather than to what the model permits, and its maximum is a version's own choice, settable arbitrarily high. Two handlers in one workflow may hold different limits, which an architectural limit could not tolerate. What it adds is a default — 10000 — where previously an author had to notice the risk themselves, and a default is not a constraint. The execution timeout is the same shape with a `null` default, so it constrains nothing until a version asks it to.

**Infrastructure Independence**, mildly and deliberately, in two places.

The first is **Required of infrastructure adapters** below, which places five hard obligations on any mechanism, a stronger demand than any prior ADR makes. The strain is contained: every obligation is stated as a behaviour the mechanism must exhibit, never as a technology it must use, and ADR-000's *Applying This ADR* already anticipates that a downstream ADR states what it requires of adapters.

The second is naming OpenTelemetry. ADR-000 says the model "must not depend on a particular ... delivery mechanism", and an observability vendor is not on that list, but the spirit of the invariant is that the model names no technology. This ADR names one API. The defence is the distinction **Observability** draws between API and backend: OpenTelemetry is a vendor-neutral specification with implementations in every language AAM targets, naming it fixes nothing about where telemetry goes, and the alternative — each implementation choosing its own tracing API — is a workflow whose trace breaks at every language boundary, which *Observability by Default* forbids more directly than *Infrastructure Independence* forbids naming an API.

### Required of infrastructure adapters

Five obligations. Each is a behaviour, and how a mechanism achieves it is the mechanism's own. The first and fifth are not sufficient alone, for the reason given after them.

1. **The emitted events and the next execution record MUST be preserved together, and the events MUST reach their destinations once the record is committed. This is the outbox guarantee, and a mechanism MUST provide it.** Concretely: the record and the events a delivery returns are committed as one unit or not at all; no event is published before that commit succeeds; every event so committed is published at least once, however many crashes intervene; and on recovery a mechanism republishes the committed events *as committed*, byte for byte, rather than re-running the delivery to regenerate them. How the guarantee is met — a transactional outbox table, a log the store and the transport share, a single durable component doing both — is not this ADR's concern, and it names none. What it requires is that the behaviour hold.

   Two consequences follow, and the rest of this ADR leans on both. A mechanism that publishes events but loses the record, or commits the record but drops the events, produces an execution whose own history describes traffic that never happened, and no handler-side behaviour can repair that from the inside. And recovery **republishes what was committed** rather than recomputing it: either the commit succeeded, in which case the events are durable and a recovery re-sends those exact events, or it did not, in which case nothing was published and a retry runs against an unchanged record. There is no third case in which *committed* output is regenerated and might differ — which is why nothing here requires an executor to be deterministic, and why the abandonment event must be complete, `id` included, so that a republished copy is discarded at the receiver's gate as already seen. A delivery whose commit did not succeed is a different matter: it runs again on retry, its executor runs again, and any external effect it made is made again (**Protocol outputs commit atomically**).

2. **The mechanism MUST supply the state function, and MUST answer it live.** For every delivery it gives the handler an operation that takes `execution_id`, the delivery's telemetry and the attempt number, and yields absence or a parsed JSON object (**Resolving the existing execution**). The operation MUST read the store on every call rather than yield a value captured earlier; it MUST NOT be given the event or the classification; it MUST NOT branch on anything but the key; and it MUST validate nothing beyond parsing. Whether what it yields is a record, belongs to this event, or is still resumable is the handler's to judge. A mechanism that classifies, derives, or filters on the handler's behalf has taken a decision this ADR gives the handler, and is non-conformant even where it happens to be right.

3. **A mechanism that abandons an execution MUST do so with the fault's `abandonment_state` and `abandonment_event`, together, and with nothing of its own.** Whether to abandon is the mechanism's policy: on a fault that is not retry safe, or one whose attempts are spent, it MUST NOT redeliver, and beyond that it may abandon, dead-letter, alert, or hold, as its deployment requires (**Abandonment**). Where it does abandon, it commits whichever of the two the fault carries under obligation 1, and at no earlier moment: publishing on an attempt that then succeeds would hand a caller both an error and a real completion for the same request. Without the record, an abandoned execution is indistinguishable from one still waiting; without the event, the caller waits on an execution already given up on; so a mechanism that abandons does both or neither. It authors neither: only the handler could have addressed the event or written the record's own version and state, so it is handed both finished and MUST NOT compose a substitute.

4. **Every retry MUST be a fresh delivery.** The mechanism re-invokes the handler with the same event and the incremented attempt number, and the handler re-reads the record through the state function, which obligation 2 keeps live. The mechanism MUST NOT cache behind the state function, MUST re-resolve dependencies through the factory where one is supplied, and MUST NOT continue past a fault whose `retry` is `null` (**Retry**). Only the attempt number carries forward, which is the one input a retry genuinely inherits.

5. **Writes to one execution record MUST be serialized.** Two responses arriving concurrently otherwise read the same record and write disjoint entries, and the later write erases the earlier — leaving an execution awaiting a response it already received. The record carries `cas_version` so that optimistic concurrency can satisfy this (**`cas_version`**). A mechanism MUST commit a record at `cas_version` `0` only where no record exists under its key — a create-if-absent — and MUST refuse it where one does, since two init deliveries for the same execution would otherwise both create it. It MUST refuse any other record whose `cas_version` is not exactly one greater than the stored record's.

Optimistic concurrency is a good fit here: concurrent responses write different keys of the collection, so the contention is an artefact of storing one record rather than a semantic conflict, and the mechanism may redeliver the losing delivery. Where a response lands on an incomplete collection the executor is never entered, so a failed write has no side effect to undo. Where a response completes the collection, two writers can each believe they completed it and each enter the executor — which the first obligation resolves for the protocol's outputs, since the loser's events and record fail to commit as one unit and nothing is published. It does not resolve anything the losing executor did outside Arvo: both executors ran, and an external effect each made was made twice. Compare-and-swap serializes commits, not executions, and repeated external effects remain the executor's responsibility (**Protocol outputs commit atomically**). This is why obligations 1 and 5 are stated together and neither is sufficient alone.

Beside the five, a mechanism supplies three inputs this ADR defines the shape of and nothing else about: the attempt number, counting from 0 (**Retry**); dependencies, as a value or a factory (**Dependencies**); and hooks, read-only or stably mutable, or an empty object (**Mechanism hooks**). And it MUST supply a delivery's OpenTelemetry context so that the handler's span continues the delivered event's trace (**Observability**).

### Left deferred

- **Timers, deadlines and scheduling.** Nothing in this ADR fires without a delivery. The two timeouts are bounds checked on entry and return, not timers, and following up on an execution at `waiting` whose responses never come remains the mechanism's, with no deadline the model defines.
- **A bound on fan-out**, given that hydration is eager and its cost scales with `in_flight_event_map` — a cap, lazy restoration, or something else (**Hydration**).
- **Whether the `contracts` snapshot should be compared against the live contract** at entry as a drift warning. It is free to do and would surface "this execution began under a contract that has since changed", but nothing may enforce against the snapshot in the meantime (**`contracts` is informational only**).
- **The conditions under which a handler routes a failure to the workflow root**, which ADR-001 deferred here and this ADR does not settle (**No failure routes to the workflow root**).
- **Execution capability profiles as a format**, including how a handler would declare the five obligations above rather than have an ADR assert them.
- **Error kinds beyond handler failure**, and the representation of infrastructure and delivery failures, which ADR-000's *Explicit Failure Boundaries* names and this ADR does not reach.
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
