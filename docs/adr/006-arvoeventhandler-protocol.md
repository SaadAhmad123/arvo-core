# ADR-006: ArvoEventHandler Protocol

- **Status:** Proposed
- **Date:** 2026-08-31
- **Scope:** Arvo ecosystem
- **Amends:** AAM 1 membership (ADR-000)
- **Supplies:** the `executionid` derivation and the event classification that [ADR-001](./001-arvoevent-structure.md) defers to "the handler protocol ADR"; the conditions for routing a failure to the workflow root remain deferred
- **Addresses, in part:** ADR-000 Deferred Decisions — "ArvoEventHandler execution semantics" (settled here); "Handler state serialization, persistence, migration, and recovery" (settled here, migration by prohibiting it); "Handler concurrency and event-waiting patterns" (settled here). ADR-005 **Left deferred** — "dependency declaration, contract resolution, and binding" and "a handler's own runtime decision of which permitted event to emit and when" (settled here).

Conformance language is as defined in [ADR-000](./000-arvo-system-identity-and-architectural-principles.md).

## Scope

This ADR defines what an **ArvoEventHandler** is and how one is entered, resumed, and completed: how it declares the contracts it implements and depends on, how an execution is identified, what an execution durably remembers, how an incoming event is classified, how outstanding responses are collected, how failure is categorized, and what a handler requires of whatever runs it.

It defines the handler as a **pure function of a delivered event, a prior execution record, and its resolved dependencies**, returning emitted events and the next execution record. The handler holds nothing between deliveries and reaches no store.

Several things are deliberately not defined here:

- **Any particular durable mechanism.** This ADR states obligations a mechanism must meet. It names no broker, database, transaction, outbox, lock implementation, or scheduler, and requires no specific one.
- **Native API shape.** Per ADR-004, how a language exposes handler declaration, the execution context, or emission is that language's own choice. This ADR fixes semantics and the durable record's field names, not method names or type names.
- **Migration of an execution record.** Not deferred — decided against. An execution record belongs to one contract version for its whole life and MUST NOT be moved to another (see **Version authority**).
- **Timers, deadlines, and scheduling.** ADR-000 defers these. A consequence is stated under **Collection** and left unresolved rather than answered here.
- **Cancellation, interruption, and compensation as model primitives.** Decided against rather than deferred. Arvo defines no cancel event, no cancelled lifecycle, and no interruption mechanism; cancellation is cooperative and application-level, and **Dependencies** gives it the only hook it needs. This places the concern outside the model, amending ADR-000's Deferred Decision by explicit reference.
- **Execution capability profiles.** ADR-000 defers their model. This ADR states the concrete requirements a handler places on a mechanism (**Required of infrastructure adapters**) without proposing the profile format that would carry it.
- **Error taxonomy beyond handler failure.** As in ADR-005, exactly one standardized emit is in play — the handler error event. This ADR adds the non-event failure category an execution can be in, and no further error kinds.

Once accepted, this protocol changes only by a superseding ADR.

## Context

ADR-000 names **ArvoEventHandler** a first-class AAM concept — "a resumable component that implements one contract, declares the contracts it depends on, emits permitted events, awaits results, and later continues" — and places "handler interfaces and lifecycle semantics" inside the model. It then defers almost everything about how that works.

ADR-001 through ADR-005 have settled the things a handler operates on: what an event is, how it transforms to a CloudEvent, what a contract is, and how a contract crosses a language boundary. Nothing has yet said what happens when an event arrives. Every implementation has answered that privately, and the answers have not been the same twice — identity encoded into a structured subject in one generation, correlation left to an adapter in another.

The pressure that makes this urgent is resumability. A handler that emits an event and later continues cannot be a running process holding a stack, because ADR-000 forbids relying on an implementation dependency across a suspension and forbids requiring a continuously running process while awaiting events. So continuation has to be reconstructed from durable data, which means the data has a shape, the shape has to be the same everywhere, and something has to guarantee it survives. Those are model concerns, not adapter concerns, and they are what this ADR settles.

ADR-001 anticipated this ADR in three places and left work for it explicitly: the derivation of `executionid` ("leaves the derivation itself to the handler protocol ADR"), how a handler classifies an incoming event, and when it routes a failure to the workflow root. The first two are settled here; the third is not, for the reason given under **Failure**. No assignment ADR-001 already made is disturbed.

## Decision

### Definition and declaration

An **ArvoEventHandler** implements exactly one ArvoContract — its **self contract** — and declares the set of contract versions it may send events to, its **service contracts**. Both are declared as part of the handler's definition, before any execution begins, satisfying ADR-000's requirement that a handler declare its complete contract capability set statically.

A handler MUST declare one **executor** per version of its self contract. Versions are fully isolated under ADR-005, so an executor written against one version's declarations has no defined behaviour against another's.

The set of events a handler may emit is exactly: the input event type of each declared service contract, every key of its self contract version's `outputs`, and its self contract version's handler error event. An execution MUST NOT emit anything else, and MUST NOT acquire a capability not present in the declaration.

**No two capabilities in a handler's declared set may share an event type**, and a handler MUST be rejected at declaration time if any two do — a service input against another service's input, a service input against a key of its own `outputs`, or either against its handler error type. ADR-005 forbids only the within-contract case, and is explicit that `type` is not globally unique across contracts, so nothing prevents two declared capabilities colliding until this rule does.

The rule is what makes an emitted event's type sufficient to determine its destination. It is checked once, at declaration, where the entire capability set is visible — the only place it can be checked, since no declaration site knows every contract in existence.

An executor MAY declare a schema for business state it wishes to remember between deliveries. An executor that declares none is still resumable — it may emit to a service and be re-entered on the response — and still has an execution record. It simply has nothing of its own in it.

### Execution identity

ADR-001 already assigns the two roles: `subject` identifies the workflow and is "deliberately inert — it encodes nothing, and nothing is derived from it by inspection"; `executionid` identifies "a specific durable, resumable execution of a handler", and ADR-001 leaves its derivation to this ADR. This ADR supplies that derivation and changes neither assignment.

Three values identify an execution, all carried on the execution record.

| | |
|---|---|
| `subject` | The workflow. Taken from the init event and copied unchanged onto everything emitted. |
| `execution_id` | This execution of this handler. Derived. |
| `parent_execution_id` | The execution that caused this one — the init event's `executionid`. |

On entering a new execution, a handler MUST set:

```
state.subject             = init_event.subject
state.parent_execution_id = init_event.executionid
state.execution_id        = H(init_event.dataschema || 0x00 || init_event.id)
```

where `H` is a cryptographic hash and `||` is concatenation over an explicitly delimited input. The derivation MUST be pure: no randomness, no clock, no mutable input, and it MUST be performed only when a new execution is entered. This satisfies ADR-001's standing requirement that the derivation be deterministic, "so a redelivered trigger resolves to the existing execution rather than forking a new one".

`dataschema` is the identifying component rather than `type`, because ADR-005 is explicit that no ADR makes `type` globally unique and that cross-contract collisions are resolved by "`type` and `dataschema` together". Since `dataschema` is `{uri}/{version}`, it names one contract at one version, and it is read directly off the init event that resolved this handler's version in the first place.

Three properties follow, and all three are load-bearing. A redelivered init event derives the same `execution_id` and therefore resolves to the same execution rather than forking a new one. Two handlers implementing different contracts derive different identifiers even where those contracts declare the same `type`, because their `dataschema` values differ. One handler invoking the same service twice within an execution produces two executions of it, because the two init events have different `id` values.

The residual case this does not separate is two handlers implementing the *same* contract version, which would derive the same identifier for the same init event. Nothing in the model forbids that deployment, and nothing in the model can distinguish those handlers either — node identity is deliberately not something Arvo depends on (ADR-000). It is a deployment error, and named here so it is not mistaken for a gap in the derivation.

This execution's nesting level is recorded as `state.depth = init_event.depth`. That is this execution's own level by ADR-001's rule that an event opening a new execution carries one more than the level of the execution emitting it — so the init event's depth already *is* the depth of the execution it opens.

### Addressing an emitted event

Every field of an emitted event is set by the handler, from the record and the event being answered. Two of them depend on where the event is going, and those two are the ones a mistake would misroute silently: `subject` is the same on everything, exactly as ADR-001 requires, while `executionid` is role-dependent — an execution stamps its own identity on what it sends downstream, and a completion carries its caller's identity rather than its own. ADR-001 states both; this ADR only makes them mechanical.

A handler MUST construct emitted events itself rather than accept them pre-built from executor code. Both values of `executionid` are structurally valid, so a mistake there is a misrouted workflow rather than a rejected event, and the same is true of `subject`, `to` and `category`. What an executor supplies is the event's type, its payload, and the two fields named safe below.

`category` in particular MUST be set by the handler according to the emitted event's declared role, using the values ADR-001 reserves — ADR-001 assigns them "through contract event factories rather than handler or application code".

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
| `domain` | absent | absent, or a per-version default for the handler error event |
| `executionunits` | `0` | `0` |
| `type` | supplied by the executor | supplied by the executor |
| `data` | supplied by the executor | supplied by the executor, or composed from the error |
| `dataschema` | the target contract's, for the resolved version | the self contract's, for this execution's version |
| `id` | fresh | fresh |
| `time` | the moment of construction | the moment of construction |
| `traceparent` / `tracestate` | the execution's running span | the execution's running span |

`initid` is set only on a completion, per ADR-001: "on a completion, the `id` of the init event that opened the execution being completed; `null` on every other event". It is what lets a caller match a response to the request it answers, and it is the value a caller looks up in `in_flight_event_map`. Setting it on a service emission would mean something different — the id of the init event that opened the *emitting* execution — and ADR-001 reserves the field against exactly that.

`source` is the handler's own contract type, which identifies the producing node without inventing an identity scheme the model does not have. It is a valid URI-reference under ADR-002 and normalizes to itself, so it satisfies `source`'s format rule unchanged.

`to` follows from that. A service emission is addressed to the contract that declares it, and a completion is addressed back to whoever opened this execution — which the init event's `source` names, since every handler stamps its own contract type there. Both are defaults, and both are unsafe to replace — see below.

Because `subject` is constant across a workflow, every record belonging to one workflow shares it, and a mechanism MAY group on it. Because `execution_id` identifies one execution, a mechanism MAY key the record on it.

`init_event_id` and `init_event_source` are held on the record as their own fields rather than read from `init_event` each time. Both are needed to address a completion, and the record already keeps them stable for the life of the execution; carrying them directly means addressing a completion never depends on restoring an event, and a reader of a stored record can see where it will return to without parsing anything.

**What an executor may set.** Every value above is a default. Which of them an executor may replace freely, and which it may not, follows from one question: does getting it wrong break the protocol, or only the event?

An implementation SHOULD separate the two in its surface — the safe fields as ordinary parameters, the rest reachable only through a distinctly named, visibly unsafe group. The grouping is API shape and therefore each language's own choice (ADR-004); the classification is not.

**Safe.** `type` and `data` are required rather than overrides: `type` selects both the destination and the schema, and `data` is validated against whichever schema it selects. Beyond those two, an executor may freely set exactly `domain` and `executionunits`. Neither is read by anything that routes, correlates, or identifies — `domain` selects a processing path the model already treats as the emitter's choice, and `executionunits` is accounting.

**Unsafe.** Everything else. Each of these is read by something other than the recipient's business logic, and a wrong value fails somewhere far from where it was set:

| Field | What a wrong value breaks |
|---|---|
| `executionid` | The reply path. A callee stores it as its `parent_execution_id` and stamps it on its completion, so a wrong value sends the reply to an execution that does not exist and this one waits forever. |
| `subject` | Workflow identity, and this handler's own entry validation — the callee's completion fails the `state.subject == event.subject` check and is rejected on arrival. |
| `initid` | Response correlation. A caller matches a reply by `in_flight_event_map[response.initid]`, so a wrong value matches nothing and the reply is discarded as an orphan. |
| `id` | Both the in-flight key and an input to the callee's identity derivation. A duplicate collapses two distinct calls onto one execution, which is why ADR-001 requires global uniqueness. |
| `dataschema` | Which contract and version validate the payload, and the other input to the callee's identity derivation. |
| `parentid` | Lineage, and rootness: `parentid == null` defines a root event, which must then satisfy `executionid == subject`. |
| `source` | A callee stores it as `init_event_source` and addresses its completion to it, so a handler that misreports its source never receives its own replies. |
| `category` | Classification, which is consulted before contract declarations. A wrong value makes a receiver reject the delivery or take an init for a followup. |
| `depth` | The runaway-nesting signal, which ADR-001 states never decrements. Overriding hides unbounded recursion — the one thing the field exists to make visible. |
| `to` | Delivery. Arvo's routing reads it, so a wrong value does not fail — it sends the event somewhere else. On a service emission no reply ever arrives and the execution waits forever; on a completion the caller never resumes. ADR-001 makes `to` "set fresh by the emitter", and the handler is that emitter; an executor replacing it is redirecting the protocol's own traffic. |
| `traceparent` / `tracestate`, or a span | The trace. An emission carrying anything other than the execution's running context detaches from the causal chain, so a workflow's trace fragments into disconnected pieces exactly where a suspension makes it hardest to reconstruct. Trace context is inside the model (ADR-000), and the default already continues the delivered event's trace, so replacing it is nearly always a mistake. |
| `time` | Nothing in the protocol; ADR-001 makes it descriptive and forbids using it for ordering. It is here because a value that is normally the moment of construction should not be quietly replaceable. |
| `baggage` | Workflow-global sameness. ADR-001 writes it once, at the root, so every event in a workflow carries an identical map — no branch diverges, no fan-in needs a merge rule, and no two nodes couple without a contract declaring it. A handler that writes it takes all three of those away, for the whole workflow, from every participant downstream. |

**What an unsafe field means.** Several of these carry normative rules from ADR-001 that an override breaks outright, not merely inadvisably: `baggage` is written exactly once and "no handler may add a key, remove a key, or change a value"; `depth` "never decrements"; `category` is assigned "through contract event factories rather than handler or application code"; `initid` is `null` on every event but a completion.

The unsafe surface does not repeal any of them. It exists because a type boundary cannot enforce every rule in the model, and because an implementation that hides a field entirely leaves a developer with a genuine need no way forward and no way to reason about the cost. What it offers is reachability with the consequence named — and a developer who crosses it owns that consequence fully, including for participants downstream who never chose it.

That is the whole of the distinction between safe and unsafe here. A safe field is one where a wrong value spoils the event. An unsafe field is one where a wrong value spoils something else: a reply path, a correlation, a trace, or in `baggage`'s case a guarantee the entire workflow was relying on.

### Observability

Trace context is inside the model (ADR-000). A handler MUST continue an existing trace rather than start a new one wherever it can: the span an execution runs under is derived from the delivered event's `traceparent` where one is present, and started fresh only where none is. Every event the handler emits carries that span's context by default, so causal chains survive suspension without an executor doing anything.

An executor MUST be given the running span so it can record its own attributes and events on the same trace. Replacing an emission's trace context is possible but unsafe, for the reason given above — it is one of the fields an implementation puts behind its unsafe surface, not an ordinary parameter. An implementation SHOULD instrument the protocol itself — entry validation, hydration, classification, collection, emission — so that a handler is observable without an executor writing any instrumentation, and SHOULD make adding custom instrumentation a first-class part of its surface rather than something reached around the framework for.


### Classification

On receiving an event, a handler MUST classify it as an **init** or a **followup**, in this precedence:

1. If `category` is `io.arvo.init`, the event's type MUST match the handler's declared init event type for the resolved version; otherwise the delivery is a fault. If `category` is `io.arvo.complete`, the event's type MUST match a declared service response type; otherwise the delivery is a fault.
2. If `category` is absent or any other value, classification falls back to the contract declarations: the declared init type is an init, a declared service response type is a followup, and anything else is a fault.

Every delivery MUST resolve to init, followup, or a fault. There is no unclassified outcome. The two-step precedence exists so that a sender's declared intent is cross-checked against the receiver's declarations, and version skew between independently deployed participants is detected rather than silently misrouted.

An init delivery derives a new execution. A followup delivery resolves the existing execution by the arriving event's `executionid`, which a completion carries as its caller's identity — that is, as this handler's own.

**A response is matched to what it answers by `initid`.** ADR-001 defines `initid` as "the `id` of the init event that opened the execution this event completes", and states that it "is the only field that answers *which request is this the answer to*" — `executionid` cannot, because every completion carries the caller's identity, and `parentid` cannot, because it degrades to noise across a suspension. A response is therefore recorded against `in_flight_event_map[response.initid]`, which is the id of the event this execution emitted to open that service's execution.

### Entry validation

Before any executor code runs, a handler MUST perform the following checks in full. **Every one of them fails as a non-retryable fault**, because each describes a delivery that would fail identically however many times it were repeated.

1. **The delivered event is one this handler's contracts expect** — it classifies as an init or a followup under **Classification**, and its payload satisfies the schema the relevant contract declares for it.
2. **The record is a well-formed execution record** — it validates against the fixed envelope composed with the executor's own declared schema at `data`, and every event it holds restores to an event value (see **Hydration**).
3. **The record, the event and the handler agree.** A record that validates in isolation may still be the wrong record:

   ```
   event.to           == handler's self contract type
   state.source       == handler's self contract type
   state.execution_id == event.executionid
   state.subject      == event.subject
   ```

4. **Presence matches classification.** An init delivery MUST be given no record — an init event opens a new execution, so a record already existing for it means the delivery is not what it claims to be. Every other delivery MUST be given a complete record. A missing record on a followup, or a present one on an init, is a fault.

Rule 4 places one obligation on whatever runs the handler, and it is the reason the derivation in **Execution identity** is specified publicly rather than left internal. A mechanism MUST resolve the record *before* dispatch, computing the identifier from the init event by the same rule the handler would, and MUST NOT dispatch an init delivery for which a record already exists. That is how a redelivered init event "resolves to the existing execution rather than forking a new one", which ADR-001 gives as the reason for requiring deterministic derivation in the first place. Were the handler to absorb a duplicate init silently instead, the model would have no way to distinguish a redelivery from a genuine collision, and rule 4 would have nothing to catch.

### The execution record

An execution's entire memory is one record. It MUST be representable as JSON, so that no mechanism has to understand any language's object model to store it, and MUST carry the following fields under these names:

| Field | |
|---|---|
| `subject` | The workflow. Grouping key. |
| `execution_id` | This execution. Record key. |
| `parent_execution_id` | The execution that caused this one. |
| `depth` | This execution's nesting level, from the init event that opened it. |
| `source` | The self contract type this execution belongs to, and the `source` of every event it emits. |
| `version` | The self contract version whose executor owns this execution. |
| `cas_version` | Non-negative integer, starting at 0 and incremented by the handler on every write. Exists so a mechanism can compare-and-swap. |
| `lifecycle` | `init`, `waiting`, `success`, or `error`. |
| `event_ids` | Every event the execution has touched, each as an `id` and a `direction` of `received` or `emitted`, relative to this handler. |
| `init_event_id` | The `id` of the init event. |
| `init_event_source` | The `source` of the init event — the caller a completion returns to. |
| `init_event` | The event that began the execution. |
| `triggering_event` | The event that caused the most recent delivery. |
| `in_flight_event_map` | Keyed by the `id` of each event emitted to a service in the current round. The value is the collected response, or `null` while outstanding — the key MUST be present either way, because the key set is what the execution is waiting for. |
| `contracts` | The handler's `self` and `services` contracts, in their canonical form. Carried for a reader's benefit only — nothing in execution consults it. |
| `data` | The executor's own business state, governed by the schema that executor declared. |

`direction` is `received` or `emitted` rather than `input` or `output`, deliberately. Those two words already name something else in this model — ADR-005's declared shapes, and this ADR's own `outputs` — and a service's reply is `received` here while being that service's output. Two axes sharing a vocabulary is how a reader ends up confidently wrong.

`contracts` is informational by construction, and an implementation MUST NOT resolve, bind, or validate against it. It exists so that a record found in a store years later can be understood without the code that wrote it, which is the same reason the identifying fields are inside the record rather than only in the keys. A reader should be aware it is a snapshot: a contract that has since changed will not match a live one, and that discrepancy carries no meaning at execution time.

`execution_id` identifies a record uniquely and `subject` groups the records of one workflow; a mechanism MAY use them as its record and grouping keys, and both are inside the record so that it is self-describing.

`lifecycle` records where an execution **rests**, not how it was entered. How a delivery was classified is a property of that delivery and MUST NOT be conflated with this field.

| Value | When an execution rests here |
|---|---|
| `init` | Created, with nothing outstanding and nothing completed — reachable only when an executor emits no events at all. |
| `waiting` | One or more responses are outstanding. |
| `success` | Terminal. An own `outputs` event was emitted. |
| `error` | Terminal. The handler error event was emitted. |

`init` deserves a warning rather than only a definition. An executor that emits nothing has neither completed nor asked for anything, so nothing will ever deliver to that execution again and it rests there forever. It is a legal state, it is almost always a defect, and an implementation SHOULD make it visible rather than silent.

`cas_version` MUST NOT be reset or wrapped by an implementation. It is an integer exactly representable in JSON, which bounds it far above any reachable execution length.

**Version authority.** After the first delivery, the record is the only place the handler's own version survives — a followup response's `dataschema` names the *service's* contract and version, not this handler's. If a record's `version` is one the handler no longer declares, the delivery is a fault and the execution is not resumed.

**An execution record belongs to one contract version for its whole life.** It MUST NOT be resumed under another version, and it MUST NOT be migrated to one. This is not a conservative default awaiting a better answer; it follows from ADR-005, where each version is fully isolated and "no two versions are ever compatible by construction". A migration would need a defined mapping from one version's state to another's, and isolation is precisely the statement that no such mapping exists — a `data` shape is governed by the schema its own executor declared, and a neighbouring version's schema has no claim on it. Silently running one version's executor over another version's state would corrupt an execution rather than report one.

Removing a version from a deployed handler therefore strands its in-flight executions, permanently. A version is drained before it is removed, and that is the whole of the migration story.

**Hydration.** On entering a delivery, a handler MUST validate the whole record — a fixed envelope, composed with the executor's own declared schema at `data` — and MUST restore every event the record holds to an event value before any executor code runs. A record that fails either is a fault. Validating eagerly costs every stored event on every delivery; the ADR chooses that so a corrupt record fails once, at entry, with its cause named, rather than surfacing from inside business logic where it cannot be attributed.

**Serializability of `data`.** A handler MUST verify that `data` survives a JSON round trip when an executor returns, and report a fault if it does not. This is the executor author's obligation and cannot be prevented by a declared schema, which will not catch a native date or class instance passed through a permissive schema position. Checking at return keeps the failure attributable to the executor that caused it.

### Collection

When an executor emits one or more events to service contracts, the handler records them in `in_flight_event_map` as outstanding, and the execution rests at `waiting`.

**By default a handler joins on all of them.** A response is recorded against its key, and then:

- if any entry is still outstanding, the executor MUST NOT be entered; the delivery ends and the record is written;
- if none is, the executor is entered with every response available.

A handler MUST allow this to be overridden per handler definition, so that an executor is entered on every response with the partial collection available to it. An implementation SHOULD document that such an executor runs once per arriving response and must therefore be safe to repeat.

`in_flight_event_map` is **rebuilt on every emission**, not merged into. It always describes exactly what the current round awaits. Under the default this is unobservable, since the executor is only entered on a complete collection. Under the override it means emitting while a response is still outstanding abandons that response, and an implementation MUST document this as the cost of the override.

**A response is processed only if the collection is awaiting it.** A response whose `initid` is not a key of the collection, or is a key whose value is already filled, is ignored — whether because the collection was rebuilt without it, or because the execution has already reached a terminal `lifecycle`. It does not re-enter the executor, does not reopen a terminal execution, and is not a fault.

A consequence this ADR states rather than resolves: under the default join, a service that never responds leaves an execution at `waiting` indefinitely. Bounding that requires deadlines, which ADR-000 defers.

### Failure

An execution's failures fall into two categories, and the distinction is which of them becomes an event.

**Handler failure** is the executor failing to fulfil its contract — its own code raising something the protocol did not define. It MUST be reported as the self contract version's **handler error event**, addressed as an own-contract emission, and the execution MUST reach `error`. This is a completed execution: it produced events and a record, and a mechanism has nothing to retry.

**Execution fault** is a failure of the protocol or its surroundings: a record that will not validate, an event that will not restore, a delivery that will not classify, a version no longer declared, a payload an executor asked to emit that its contract rejects, a dependency that would not resolve. A fault MUST NOT become an event. It MUST carry whether it is **retry safe**, so a mechanism can retry, dead-letter, or escalate without inspecting a message.

| Fault | Retry safe |
|---|---|
| the record fails validation | no |
| an event in the record fails to restore | no |
| the record's `version` is no longer declared | no |
| the delivered event fails classification or its contract's schema | no |
| an init delivery arrives with a record, or any other delivery without one | no |
| the record does not match the delivery's addressing | no |
| `data` does not survive a JSON round trip | no |
| an emission the executor requested is not permitted, or its payload is rejected | no |
| resolving the executor's dependencies fails | yes |
| a fault the executor raises deliberately | executor's choice; **retry safe** unless stated |

The verdicts follow from one question: would the same inputs produce the same failure? A malformed record, a removed version, and an impermissible emission are all defects that a retry reproduces exactly. Dependency resolution is the one listed case whose outcome may legitimately differ a moment later.

**No failure defined here routes to the workflow root.** ADR-001 permits such an event — carrying `subject` as its `executionid`, bypassing intermediate executions so a failure surfaces at the top regardless of depth — and defers the conditions to this ADR. This ADR defines none: a handler failure is attributable to the execution that suffered it and returns to that execution's caller, and a fault never becomes an event at all. The capability remains available and unused, and the conditions stay deferred rather than being invented to fill the slot.

The two categories are named distinctly on purpose. "Handler error" refers only to the event; a fault is never an event. An implementation MUST NOT use one name for both.

### Dependencies

An executor's implementation dependencies are outside the model (ADR-000) and are not part of a handler's declaration as a runtime concern. They are supplied per delivery, either as a value or as a factory:

```
dependencies?: D | (({ event, state }) => D | Promise<D>)
```

The factory form is what a resumable handler needs. Nothing live is constructed until a delivery needs it, so nothing is captured across a suspension — ADR-000 requires that no implementation dependency be relied upon to survive one. Passing it the delivered event and the current record lets a dependency be built *for this execution* rather than for the process, which is what makes the next section possible.

A factory that fails is an **execution fault and is retry safe**: constructing a dependency is the one entry-path failure whose outcome may legitimately differ a moment later.

### Cancellation

**Arvo defines no cancellation primitive**, and this is a decision rather than an omission. There is no cancel event, no `cancelled` lifecycle, and no way for one node to interrupt another. A contract version declares exactly one `input`, so a handler's inbound events are its init event and its services' responses and nothing else; a cancel event would therefore have to be a second model-level derived event alongside the handler error, and interrupting a running execution would require a control path outside the event stream, which ADR-000's *Event-Only Communication* forbids.

What the model provides instead is the hook, and cancellation is built on it by whoever needs it:

- A dependency factory receives `{ event, state }`, so it can consult whatever cancellation signal an application maintains and expose the answer to the executor — conventionally as a flag on the dependencies it returns.
- The executor reads that flag and winds itself down: emitting whatever compensating events its contracts already permit, then completing. Cancellation therefore terminates an execution the same way any other completion does, and needs no new lifecycle.
- **Scope is the application's choice**, because the record carries both identifiers. Keyed on `execution_id`, a signal cancels one execution; keyed on `subject`, it cancels every execution of a workflow. Neither requires anything of the model, and both work through the same hook.

This is cooperative, and the guidance should say so plainly: an execution that never receives another delivery never observes the signal, and an executor that does not check it is not cancellable. Arvo does not make a handler stoppable against its will. What it guarantees is that a handler which wants to be stoppable has somewhere to look, and that looking costs nothing when no one is cancelling.

## Consequences

**Gained.** A handler becomes a function of an event, a record, and its dependencies, which makes it testable with literal values and no infrastructure — the property that most reliably decides whether resumable code can be reasoned about. Resumption is a single keyed read, so no mechanism needs a correlation index to participate. The capability set is closed and statically known, so a mechanism can determine what a handler may do before running it, and an implementation with a type system can reject an impermissible emission before it is deployed. The two failure categories give a mechanism an unambiguous rule for when to retry, which is the question adapters otherwise answer by guessing from an error message.

**Paid for.** Durability moves entirely onto whatever runs a handler, and the obligations under **Required of infrastructure adapters** are strict enough that a naive mechanism — publish, then persist — is non-conformant rather than merely lossy. The default join makes concurrency invisible to an executor, and pays for it with an execution that waits indefinitely on a service that never answers, until a deadline decision exists. Eager hydration costs every stored event on every delivery, which a handler awaiting many responses pays repeatedly. Removing a contract version strands its in-flight executions permanently, with no migration path by design, so deployment acquires a drain step it did not previously have. And a handler must construct emitted events itself, which removes an executor's ability to hand back an event it built by hand — deliberately, since the addressing rule is not something a call site can be trusted with.

## Considered Alternatives

**Deriving the per-execution identifier into `subject`, leaving `executionid` constant across the workflow** — considered, not chosen. A draft of this protocol took that shape, on the reasoning that a record wants a unique key and `subject` was the more natural name for one. It contradicts ADR-001 twice over: `subject` is defined there as inert, with "nothing derived from it by inspection", and as minted once and copied unchanged; and `executionid` is defined as identifying an execution, not a workflow. ADR-001 also records the same idea as already tried — "earlier designs chained subjects to carry coordination state, making one field both the workflow key and the coordination mechanism; it served neither well."

The storage motivation survives intact under ADR-001's assignment, which is why nothing was lost by abandoning the inversion: `execution_id` is the unique record key and `subject` is the grouping key, the same two-key design with the roles as ADR-001 assigns them. Resumption remains a single keyed read, because a completion carries its caller's `executionid`.

**Letting an executor return events it built itself** — considered, not chosen. It is more explicit about what reaches the wire, and it was the shape a first sketch took. But `subject` differs by destination and both values are structurally valid, so a mistake produces a misrouted workflow rather than a rejected event. The same applies to `category`. A rule that cannot be checked at the point of use does not belong at the point of use.

**Naming a destination on each emission, rather than deriving it from the event's type** — considered, not chosen. It would remove the collision rule under **Definition and declaration**, which is a real cost: that rule can reject a handler whose declared capabilities are individually valid, and a contract author cannot anticipate it. It was rejected because naming a destination introduces a second way to say the same thing and therefore a way for the two to disagree, and because the collision it guards against is detectable once, at declaration, rather than at every call site.

**Entering the executor on every response by default, with joining as the opt-in** — considered, not chosen. It is the more flexible default and needs no override. It also makes every multi-service handler concurrency-sensitive by default, and the failure mode is a partially-processed execution rather than an error. The safe behaviour is the one that should require no decision.

**Merging into `in_flight_event_map` on emission rather than rebuilding it** — considered, not chosen. It would prevent a response being abandoned under the override. It would also let a collection span rounds and outlive the emission that created it, so "what is this execution waiting for" would no longer have a single answer. One rule that is occasionally lossy is preferred to a rule that is always ambiguous, and the loss is documented.

**Reporting a handler failure as a fault rather than as an event** — considered, not chosen. It would let a mechanism retry application failures uniformly. It would also make a handler's failure invisible to the caller that is waiting for it, which contradicts ADR-000's *Event-Only Communication*: the caller's continuation depends on an event arriving, and a failure it never hears about is a workflow that stalls.

**Keeping the revision outside the record, as purely a mechanism's concern** — considered, not chosen. It keeps a storage concern out of a model-level format. But the handler is the only party that knows a write has occurred, and a mechanism that must invent its own revision cannot check it against what the handler intended. Putting it in the record makes incrementing it part of the handler's defined behaviour rather than a convention a mechanism supplies.

**Defining cancellation as a model primitive — a derived cancel event on every contract, mirroring the handler error** — considered, not chosen. It is the only shape that would work event-natively, and it fits the machinery: `in_flight_event_map` already names exactly the children an execution would need to cancel, so propagation down the tree would need nothing new. It was rejected on cost against demand. It makes the handler error no longer the single standardized emit ADR-005 deliberately kept it as, it adds a terminal lifecycle and a third classification case that every implementation and every handler must then handle, and it makes cancellation a thing a node can have done *to* it — a meaningful shift in what a participant is, for a capability most handlers never use. The cooperative hook costs nothing when unused and is enough for the case that motivated asking.

**Defining a migration path for an execution record, so a version could be removed without draining** — considered, not chosen. It is the obvious answer to the operational cost above, and every durable-execution system eventually grows one. It cannot be built on ADR-005's foundation: per-version isolation means there is no compatibility relation between two versions to migrate along, so any mapping would be one an implementation invented, applied to state whose meaning only the original executor knows. An honest prohibition is better than a mechanism that silently reinterprets state, and draining is a cost a deployment can see and plan for.

**Requiring a specific concurrency mechanism, such as a named locking or transaction strategy** — considered, not chosen. It would make the guarantee concrete and testable. It would also make this ADR the first to require a particular infrastructure capability by name, which ADR-000 is explicit about avoiding. Stating the obligation and leaving the mechanism free preserves that.

## Conformance to ADR-000

**Effect on AAM.** This ADR amends the AAM membership list in three ways. It replaces *"handler interfaces and lifecycle semantics"* with the declaration model, execution identity, execution record, classification, collection, and failure categories defined above. It adds the execution record's field names as a durable format, for the same reason ADR-005 placed the canonical contract form inside the model: durable data outlives the code that wrote it, and a record that means different things in two languages is not one model. And it places **cancellation, interruption, and compensation outside the model** — ADR-000 lists them as a Deferred Decision, whose membership is therefore undetermined until decided, and this ADR decides it by explicit reference. Arvo defines no primitive for any of the three; the hook under **Cancellation** is a place for an application's own signal to be read, not a model concept.

**Invariants depended on.** *Event-Only Communication* — every interaction here, including a handler's own failure, is an ArvoEvent governed by a contract. *Explicit Contracts and Runtime Validation* — the closed capability set and the record's validation both rest on a contract being a complete, checkable declaration. *Infrastructure Independence* — the handler reaches no store and names no transport. *Nondeterminism Is Permitted* — nothing here requires an executor to be deterministic; recovery republishes what was committed rather than recomputing it.

**Invariants strained.** *Infrastructure Independence*, mildly and deliberately. **Required of infrastructure adapters** below places three hard obligations on any mechanism, which is a stronger demand than any prior ADR makes. The strain is contained: the obligations are stated as properties, not implementations, and ADR-000's *Downstream ADR Requirements* already anticipates that a downstream ADR states what it requires of adapters.

**Required of infrastructure adapters.** Three obligations. The first and third are not sufficient alone — see below.

1. **The emitted events and the next execution record MUST be preserved together.** A mechanism that publishes events but loses the record, or commits the record but drops the events, produces an execution whose own history describes traffic that never happened, and no handler-side behaviour can repair that from the inside.
2. **An init delivery MUST NOT be dispatched where a record already exists for it.** The mechanism resolves the record first, computing the identifier from the init event by the rule in **Execution identity**. This is what makes a redelivered init resolve to its existing execution instead of reaching the handler as a fault.
3. **Writes to one execution record MUST be serialized.** Two responses arriving concurrently otherwise read the same record and write disjoint entries, and the later write erases the earlier — leaving an execution awaiting a response it already received.

Optimistic concurrency satisfies the third, and `cas_version` exists so it can. It is a good fit here: concurrent responses write different keys of the collection, so the contention is an artefact of storing one record rather than a semantic conflict, and a loser can simply redo its work. Where a response lands on an incomplete collection the executor is never entered, so a failed write has no side effect to undo. Where a response completes the collection, two writers can each believe they completed it and each enter the executor — which the first obligation resolves, since the loser's events and record fail to commit as one unit and nothing is published. This is why those two are stated together.

**Left deferred.** The conditions under which a handler routes a failure to the workflow root, which ADR-001 deferred here and this ADR does not settle. Timers, deadlines, and any bound on how long an execution may rest at `waiting`. Execution capability profiles as a format, including how a handler would declare the three obligations above rather than have an ADR assert them. Error kinds beyond handler failure. Whether emitted event identifiers should be derived rather than freshly generated — unnecessary given the first adapter obligation, and available as defence in depth if a later decision wants it.
