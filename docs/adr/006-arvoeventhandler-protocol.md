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

Two parties appear throughout, and the ADR keeps them apart. The **handler** is the protocol layer this ADR specifies: it validates, classifies, records, supplies the addressing for every event, and checks every event an executor returns. The **executor** is the business code a handler runs for one version of its contract: it reads what the handler gives it through a context, returns the events it wants emitted, and may fail. Everything between one delivery and the next belongs to a third party, the **mechanism** that runs the handler, and this ADR states what the handler requires of it without saying how it is built.

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

#### Optional business state schema

An executor MAY declare a schema for business state it wishes to remember between deliveries. Where declared, it governs the `data` field of the execution record (see **The execution record**) and is composed into the record's validation at every entry (see **Hydration**).

An executor that declares none is still resumable — it may emit to a service and be re-entered on the response — and still has an execution record. It simply has nothing of its own in it. Resumability is a property of the protocol, carried by the record's own fields; business state is what an executor adds to that, and it is optional.

### The execution context

#### One object, built per delivery

Everything an executor can know or do, it knows or does through one object the handler builds for the delivery: the **execution context**. It is constructed after the gate has passed (**Entry validation**) and the record has been hydrated, and it is the only argument an executor receives. It MUST be built fresh for every delivery and MUST NOT be retained across deliveries: an executor that keeps a reference to it holds nothing meaningful once the delivery ends, which is the same property ADR-000 requires of every implementation dependency across a suspension.

The members below are normative in their existence and semantics. What each is called, and whether it is a property, a method, or a nested object, is API shape and each language's own choice (ADR-004). An implementation MAY add members, and MUST NOT remove or alter the meaning of any listed here.

#### What the context exposes

| Member | What it is | Read or write |
|---|---|---|
| **delivered event** | The event that caused this delivery, restored to an event value. On an init delivery it is the init event; on a followup it is one service's response — an `outputs` event or the handler error event of that service. | read |
| **entry kind** | `init` or `followup`, as **Classification** resolved it. The delivered event's payload MUST be reachable only once this is known, so business code cannot read an init payload as if it were a response, or the reverse. | read |
| **attempt** | Which attempt this delivery is, counting from 0, as the mechanism supplied it (**Retry**). | read |
| **init event** | The event that opened this execution, from `state.init_event`. On an init delivery it is the same event as the delivered event. | read |
| **identity** | `subject`, `execution_id`, `parent_execution_id`, `depth`, and `version`, as held on the record. Exposed so an executor can key its own resources on them (**Cancellation**), never so it can change them. | read |
| **collected** | The responses in hand for the current round, keyed as `in_flight_event_map` keys them, and which keys are still outstanding. Under the default join it is always complete when the executor is entered (**Collection**). | read |
| **state** | The executor's own business state, `state.data`. Present only where the version declared a schema. `null` on a new execution until written. Written through **set state** and no other way. | read, and write through `set state` |
| **set state** | Replaces the business state whole. There is no partial write and no merge: an executor that keeps part of the old state copies it forward itself. Validated against the declared schema, and a value the schema rejects is an execution fault. | write |
| **dependencies** | Whatever the dependency factory resolved for this delivery, or the value supplied (**Dependencies**). | read |
| **event builder** | Constructs a fully addressed event from a `type` and a `data`, applying every default under **Addressing an emitted event**, and exposing the safe fields and the visibly unsafe group. The only member that produces an event. | produces an event |
| **at max depth** | True when an event this execution emits to a service could no longer increment `depth` without reaching the version's maximum (**Depth**). | read |
| **cancel** | Marks this execution `cancelled` with a reason, terminal (**The execution record**). | write |
| **fault** | Builds an execution fault for the executor to raise deliberately, with a reason and whether it is retry safe (**Failure protocol**). | produces a fault |
| **telemetry** | The delivery's OpenTelemetry objects: its **span**, a **logger** bound to that span's context, and a **meter** scoped to the handler (**Observability**). | read, and record |
| **mechanism hooks** | Whatever the mechanism running this handler chooses to expose to an executor, supplied to the handler alongside the delivery. Which hooks exist is the mechanism's own scope and undefined here. Where none are supplied it is an empty object, never absent. | read, or stable mutation only — see below |

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

`to` follows from `source`. A service emission is addressed to the contract that declares it — the service contract's own `type`, which is what a handler implementing that contract expects to see as its `to` (**Entry validation**, step 10). A completion is addressed back to whoever opened this execution, which the init event's `source` names, since every handler stamps its own contract type there. Both are defaults, and both are unsafe to replace — see **What an executor may set**.

#### Domain

An executor may give an emitted event a literal domain, or name a **source** for the handler to read one from and resolve before the event exists. Either way the field is absent unless asked for. The handler error event, which an executor does not construct field by field, takes the same two forms as a per-version default (see the appendix for an illustrative option name).

This confronts what ADR-005 left here rather than paraphrasing it. ADR-005 says why the field exists on a contract: "a value a contract carries so that events its factories construct can inherit a default without every call site repeating it", and it leaves "resolving a domain from the handler's own contract versus the contract of the event being emitted, from a triggering event, from orchestration parent/child context" to this ADR. Defaulting every emission to absent with no way to reach the contract's value would leave ADR-005's field inert in the one place it was meant to be used. So **the contract's own declared domain is one of the sources a request may name.** Reaching it takes a request rather than happening silently — which is what ADR-005's "carries no resolution logic, no inheritance chain" is about, and what keeps an event's domain something an author chose rather than something it acquired on the way past.

The sources a request may name, and how each resolves, are the substance of the deferral. At minimum an implementation MUST offer:

| Source | Resolves to |
|---|---|
| none | no domain |
| the target contract | the `domain` of the contract the event is built from |
| the self contract | the `domain` of this handler's own contract |
| the delivered event | the `domain` of the event that caused this delivery |

A request naming a source whose value is `null` or absent resolves to no domain rather than failing, so a handler is never broken by context it did not receive. A resolved domain is always a plain value or absent — **a request MUST NOT reach the event**. The names an implementation gives these sources are API shape (ADR-004); the set and the resolution are not.

ADR-001 holds that `domain` is "`null` for traffic inside a lattice" and set non-null "by an emitter whose event must be fulfilled elsewhere". The default of absent preserves the first half; the request is how an emitter does the second.

#### A root event must carry `to`

**A root event MUST carry a `to`, and it SHOULD be its own `type`.** Gate step 10 (**Entry validation**) makes `to` authoritative, so an event arriving with none is a fault — and ADR-001's minimal root event, taking every default, has `to` at `null`. Whatever mints a root event therefore has one obligation this ADR places on it: address the event. `to = type` is the sensible default and the one an implementation SHOULD apply when constructing a root event, since a root event by definition goes to the handler that implements the contract it names.

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

A fault MUST be recorded on the delivery span before it is raised, as an exception with its `fault_kind` and whether it is retry safe as attributes (**The fault object**), because a fault writes no record and the trace may be the only place a retried-away failure is ever visible.

### Classification

#### Init or followup, nothing else

Every delivery is either an **init** — opening a new execution — or a **followup**, resuming one. There is no third outcome and no unclassified pass-through: a delivery that cannot be classified is a fault (`event_unclassifiable`). Classification is a property of the delivery, not of the execution, and MUST NOT be confused with the record's `lifecycle`, which records where an execution rests (**The execution record**).

This settles the second of the three things ADR-001 left to this ADR — "how it classifies an incoming event" — and the `category` check ADR-001 assigned here.

#### `dataschema` decides it

**`dataschema` decides classification.** ADR-005 fixes `dataschema` as `{uri}/{version}`, and the `uri` names the contract that governs the event. A `uri` matching the self contract is an init; one matching a declared service contract is a followup; one matching neither is a fault. This is read from a field ADR-001 requires on every event, ADR-002 constrains the format of, and ADR-005 gives a fixed shape — not inferred from `type`, which ADR-005 makes version-independent and not globally unique, and not from the presence or absence of a record, which is a separate check (**Entry validation**, step 4).

How the `uri` and version are split, and how the version is checked in each case, is under **Resolution, and which executor runs**.

#### `category` cross-checks it

**`category` cross-checks classification.** ADR-001 reserves `io.arvo.init` and `io.arvo.complete` and says a producer sets them "through contract event factories rather than handler or application code", so where one is present it states the sender's own contractual intent. It MUST agree with what `dataschema` resolved: `io.arvo.init` on a self-contract event, `io.arvo.complete` on a service-contract one.

A disagreement is a non-retryable fault (`category_mismatch`) — the same event would disagree however often it were redelivered — and catching it is the point. It means two independently deployed participants have diverged about what they are doing — a sender that believes it is completing something a receiver believes it is opening — which ADR-001 wants "detectable rather than silent". Any other value, including absence, carries no ecosystem meaning per ADR-001 and is not consulted. `category` never decides classification on its own; it can only confirm or contradict what `dataschema` already decided.

#### Resolving the existing execution

A delivery reaches the handler as an event and a **state function**. The mechanism does not hand over a record; it hands over the means to fetch one, and the handler decides what to fetch.

**The state function.** The mechanism MUST supply, alongside the event, an operation that takes an `execution_id` and yields the record stored under it, or nothing where none is. It may take time and may fail, since a store is behind it; how a language expresses that — a promise, a future, a coroutine, a blocking call — is that language's own choice (ADR-004). What is fixed is the input — one `execution_id`, together with the delivery's telemetry (**Observability**) so the read is logged and traced as part of this delivery, and the delivery's attempt number (**Retry**) so the mechanism knows whether this read is the first or a retry of one that already failed; the output, a record or its absence; and the rules below. Telemetry and attempt are read-only context for the mechanism to record against and to tune its own read by — a longer timeout, a different replica — not information that changes which record it returns.

The mechanism behind it validates nothing beyond parsing: what it yields MUST be absence or a parsed JSON object, and whether that object is a record, belongs to this event, or is still resumable is the handler's to judge (**Entry validation**, steps 4, 5 and 10). It MUST read the store on every call rather than yield a value captured earlier, which is what makes a retry re-read the record by construction (**Retry**). It MUST NOT be given the event or the classification, and it MUST NOT branch on anything but the key.

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

A response is therefore recorded against `in_flight_event_map[response.initid]`, which is the `id` of the event this execution emitted to open that service's execution (**Collection**). A response whose `initid` names no outstanding key is a fault (`response_unawaited`), and one whose `id` has already been recorded is a duplicate and is discarded (**Entry validation**, steps 8 and 13).

### Entry validation

#### The gate

Before any executor code runs, a handler MUST work through the following gate **in sequence**. Each step is a precondition for the ones after it, and no `state.*` value may be read until the record has been fetched and validated — which is why classification comes first, the fetch follows it, and validation of the record precedes everything that reads one.

| Step | Applies to | Check | On failure | Short-circuits | Retry safe |
|---|---|---|---|---|---|
| 1 | every delivery | **`dataschema` resolves against a declared contract**, naming one contract at one version and thereby classifying the delivery as init or followup. See **Resolution, and which executor runs**. | fault, `event_unclassifiable` | yes | no |
| 2 | every delivery | **`category` agrees with what resolution found.** `io.arvo.init` accompanies a self-contract event, `io.arvo.complete` a service-contract one. Absent or unrecognised, it is not consulted. | fault, `category_mismatch` | yes | no |
| 3 | every delivery | **The record is fetched**, once, through the state function, under the key classification selects (**Resolving the existing execution**). | fault, `state_resolution_failed` | yes | **yes** |
| 4 | every delivery | **Presence matches classification.** An init delivery MUST have fetched nothing; a followup MUST have fetched a record. | fault, `record_unexpected` or `record_expected` | yes | no |
| 5 | followups | **The record validates and hydrates.** It validates against the fixed envelope composed with the executor's declared schema at `data`, and every event it holds restores to an event value (**Hydration**). No `state.*` value may be read until this passes. | fault, `record_invalid` or `record_event_unrestorable` | yes | no |
| 6 | followups | **The record's version is still declared.** The handler MUST still declare an executor for `state.version`; a version withdrawn from a deployed handler strands its in-flight executions (**Version authority**), and this is where that surfaces. | fault, `version_not_declared` | yes | no |
| 7 | every delivery | **The event is below the version's maximum depth.** `event.depth < max depth` for the version resolution selected — the event's on an init, the record's on a followup (**Depth**). Placed here because it is the first point at which that version is known and confirmed declared. | fault, `max_depth_event_received` | yes | no |
| 8 | followups | **Already seen.** The delivered event's `id` is already in `event_ids` as `received`, so this delivery has been processed. | discard | yes | n/a |
| 9 | followups | **Lifecycle admits the delivery.** A record at `success`, `error`, `cancelled` or `failure` accepts nothing further. A record at `waiting` or `idle` accepts a followup. | fault, `lifecycle_terminal` | yes | no |
| 10 | `event.to` on every delivery; the rest on followups | **Record, handler and event agree.** `event.to == handler's self contract type`; and on a followup `state.source == handler's self contract type`, `state.execution_id == event.executionid`, `state.subject == event.subject`. `to` is authoritative, so an event carrying none is invalid here. | fault, `event_unaddressed` or `addressing_mismatch` | no — all applicable comparisons are reported together | no |
| 11 | every delivery | **The type is one the resolved contract can send here.** For the self contract, its own `type`. For a service contract, one of that version's `outputs` or its handler error type. | fault, `type_not_receivable` | yes | no |
| 12 | every delivery | **Payload satisfies its schema**, as declared by the contract and version step 1 resolved. | fault, `event_schema_rejected` | no | no |
| 13 | followups | **Awaited.** The response's `initid` names a key of `in_flight_event_map` whose value is still outstanding. | fault, `response_unawaited` | yes | no |

An init delivery has no record, so the steps that read one do not apply to it — which is most of what the **applies to** column records. Only step 10 is split: `event.to` is on the event and is checked either way, while the three comparisons against the record are followups only.

#### Three ways out: proceed, discard, fault

A delivery leaves the gate one of three ways. **Proceed**: every applicable step passed, the execution context is built (**The execution context**), and the executor is entered — or, under the default join, the response is recorded and the delivery ends without entering it (**Collection**). **Discard**: step 8 recognised a duplicate; nothing is written and nothing is raised. **Fault**: a step failed, and an execution fault is raised carrying every check that failed (**Failure protocol**).

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

For an init there is no record, so the event is the only thing that can say which version to run — and if the handler declares no executor for it, that is a fault rather than a fallback to a neighbour.

For a followup the record is authoritative, because a response's `dataschema` names the *service's* contract and version and says nothing about this handler's. The event's version is still checked, against the version the handler declared for that service, and it MUST be equal. This is the check that catches version skew: a response from `payments/1.1.0` arriving at a handler that declared `payments/1.0.0` carries the same version-independent `type`, would pass a type check, and would then be validated against the wrong version's schema — passing wrongly or failing with a misleading diagnosis. ADR-001 made `dataschema` required so that version skew "becomes detectable rather than silent", and this is where a followup gets that.

#### Why resolution comes first

Resolution is first because everything else depends on it. It decides which contract and version validate the payload (step 12), which type set the event must belong to (step 11), and — because it classifies the delivery — which key the record is fetched under (step 3) and whether one is expected at all (step 4). A `type` alone could do none of this: ADR-005 makes it a property of the contract, so it cannot name a version, and it is not globally unique, so it cannot reliably name a contract.

It also settles which kind of delivery this is, which is why `category` follows it rather than preceding it. Classification is read from a required field that ADR-002 constrains and ADR-005 gives a fixed shape; `category` then cross-checks it — a sender's stated intent against a receiver's declarations, which is what ADR-001 put the field there for. Deciding the same question twice by two independent means, with no rule for disagreement, is the thing this ordering removes.

#### Why the record is validated before anything reads it

Every step after 5 that touches the record reads it — step 6 reads `version`, step 8 reads `event_ids`, step 9 reads `lifecycle`, step 10 reads three identifiers, step 13 reads the collection. A gate that compared before it validated would be reading fields off a structure it had not established was a record at all, and would report a mismatch where the truth was corruption. Step 5 is therefore the first step that touches the record's contents, and no step before it does.

#### Why the duplicate check precedes the lifecycle check

A redelivery of the very event that completed an execution would otherwise reach the terminal check first and be reported as a fault — so under at-least-once delivery, the final response of every execution could produce a spurious failure whenever the transport repeated it.

Putting step 8 ahead of step 9 costs nothing, because the two catch disjoint things. Step 8 discards only an event the execution has demonstrably already processed. A genuinely late message — one arriving at a finished execution having never been seen — is not in `event_ids`, passes step 8 untouched, and is reported by step 9 exactly as it should be. Quiet about repetition, loud about lateness.

#### Why an idle record admits a followup

Step 9 admits a followup to a record at `idle`, which step 13 will then almost certainly reject, and that is deliberate rather than redundant. `idle` is not terminal, so rejecting at step 9 would report that the execution has ended, which is untrue. Letting it through means step 13 reports what is actually wrong — nothing is awaiting this response. The cost is one extra step evaluated; the gain is a diagnosis that does not send a reader looking for a completion that never happened.

#### Every fault names every failed check

**A fault names every check that failed**, not merely the first — where the sequence allowed more than one to be evaluated, all of them are reported, in the fault's `violations` (**The fault object**). Steps 10 and 12 do not short-circuit for this reason: the four addressing comparisons are reported together, and a payload's schema violations are reported in full. This matches ADR-005, whose contract validation reports every broken rule at once, and it is the difference between one diagnosis and a run of redeliveries each revealing one more problem.

#### One execution is atomic

Discarding a duplicate at step 8 is safe because the record that would have been written already exists, carrying that event's id in `event_ids`. **Arvo treats one execution of an executor as atomic**: it either produced its events and its record together, or it produced neither (**Required of infrastructure adapters**, obligation 1). An executor should be written on the same assumption — where side effects outside Arvo are unavoidable, they should be idempotent or cheap to repeat, because the protocol offers no partial-completion state for them to resume from.

Inside the executor code, the developer can leverage two values the protocol already guarantees as idempotency keys. The delivered event's `id` is globally unique (ADR-001) and identical on every retry of the same delivery, so it keys a side effect that must happen once per delivery. The execution's `execution_id` is derived deterministically (**Execution identity**) and identical on every delivery to the same execution, so it keys a side effect that must happen once per execution. Both are on the execution context (**The execution context**), and an executor that keys its external writes on one of them gets exactly-once effects from at-least-once delivery without a store of its own.

#### What the gate asks of a mechanism

Because the handler fetches the record itself under a key it chooses, a mechanism need not classify, derive, or compare anything before dispatch. What the gate asks is that the state function answer honestly (**Resolving the existing execution**), and that a redelivered init find the record its first delivery wrote — which follows from committing the record durably under `execution_id` (obligation 1) and nothing else. A redelivered init then fetches a record at step 3 and faults at step 4 with `record_unexpected`, and a mechanism MAY treat that kind as a signal to stop redelivering rather than as an error to escalate.

### Depth

#### An execution-level guard, not an event constraint

**This is an execution-level guard, not a constraint on the event.** It does not narrow `depth` as ADR-001 defines it, does not restrict what depth an event may carry across the ecosystem, and imposes no limit the model enforces. ADR-000 holds that "Arvo imposes no architectural limit on composition depth", and this section does not contradict it: a version chooses its own maximum, and may choose one high enough that the guard never fires. What it bounds is how deep *this handler, at this version* is willing to be, and to go — a handler's own decision about its own recursion, not an architectural limit on composition.

ADR-001 gives `depth` its purpose: it "exists for operational comprehension", because unbounded nesting is "an operational risk rather than a structural impossibility". This guard is the one place in the protocol that reads the field for that purpose, and turns a runaway recursion into a diagnosable stop rather than an exhausted store.

#### One option, per version

**A version MAY set a maximum execution depth**:

```
max depth      a number; 10000 unless set
```

Its name is each language's own choice (ADR-004); what this ADR fixes is that it exists, its default, and what it means. It is per version, not per handler, because two versions of one contract may nest differently and a version's executor is the code whose recursion it bounds.

There is no option for what happens when the limit is crossed. **Crossing it is always a non-retryable execution fault.** It has two kinds, one for each place it can be detected: `max_depth_event_received` where an event arrives at or beyond the limit, and `max_depth_event_requested` where the executor returns an event that would go beyond it.

#### Checked twice: on delivery, and on return

The guard is applied at two points, with one threshold.

**On delivery, at gate step 7** (**Entry validation**), fault `max_depth_event_received`: the delivered event's `depth` MUST be below the version's maximum. The version is the one resolution selected — the event's on an init, the record's on a followup — which is why the check sits after the version is known and confirmed declared, and not earlier. It catches a caller with a looser limit than this handler's reaching it from too deep.

**On return, as part of return validation** (**What an executor returns**), fault `max_depth_event_requested`: for each event the executor returned that would open a new execution — one addressed to a service — the depth it would carry is `state.depth + 1`, and that value MUST be below the maximum. An own-`outputs` event carries `state.depth` and can never violate.

The two thresholds are the same number, and that is what makes both checks safe together. Because emission refuses at `state.depth + 1 >= max`, no execution of this version ever opens a service execution at or above `max`, so no legitimate response — which carries the depth of the execution that produced it — ever arrives at or above `max` either. The delivery check therefore never rejects a reply this handler was owed, and only ever rejects an init that arrived from beyond the limit.

Refusing the *emission* is where the protection lies. A delivered response has already happened; nothing about refusing it prevents any depth. Refusing to emit stops the doomed work before it runs, which is the only point at which stopping is worth anything. The delivery check is the second line: a handler protecting itself against a caller that does not share its limit.

An executor does not have to discover the limit by hitting it. The execution context carries **at max depth** (**The execution context**), true exactly when a service emission from this execution would fail the return check. An executor that reads it before deciding what to return can choose an own-`outputs` event instead, safely and inside its own logic, and never raise the fault at all.

#### One offending event rejects the whole batch

**One offending event rejects the whole batch.** Where any event an executor returns fails the guard, none of them is emitted, no record is written, and `max_depth_event_requested` is raised for the delivery. The alternative — emitting the permitted ones and faulting on the violation — would leave a fault describing a delivery that partly succeeded, which a fault by definition cannot (**Failure protocol**). A batch is one decision by one executor, and it succeeds or fails as one. The same rule governs every other return-time check.

#### The executor can see it coming

**An executor can see it coming, which is why the outcome is its own.** The execution context exposes **at max depth** (**The execution context**) — true when an event this execution emits to a service could no longer increment `depth` without reaching the maximum. An executor that checks it can take a different path, complete early with an own-`outputs` event that explains itself, or fail deliberately so the caller hears a handler error rather than an abandonment. Raising this fault on return therefore takes a deliberate act: emitting to a service after being told the limit is reached, or overriding `depth` outright, which is already among the unsafe fields under **What an executor may set**.

#### What the caller hears

Because a fault carries its abandonment pair (**Abandonment**), a depth fault is not silence. The fault is non-retryable, so a conformant mechanism gives up at once and, where the fault carries them, publishes the handler error event and commits the record at `failure` (**Required of infrastructure adapters**, obligation 3). The caller learns the work will not be done, in the one shape it is already obliged to handle, and the record says why. On a `max_depth_event_received` fault against an init delivery, the record half is `null` — no execution began — and only the event is published, exactly as for any other init fault.

The fault's `message`, and the `lifecycle_description` of the abandonment record where there is one, MUST state the limit in force, the depth at which the execution sat or the event arrived, and — on `max_depth_event_requested` — the type and would-be depth of each event in the rejected batch, offenders and non-offenders alike, because the batch was rejected whole and a diagnostic showing only part of it would misrepresent what happened.

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

### Having the handler construct every event from a type-and-payload request, refusing pre-built events

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
