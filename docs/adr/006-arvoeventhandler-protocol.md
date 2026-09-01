# ADR-006: ArvoEventHandler Protocol

- **Status:** Proposed
- **Date:** 2026-08-31
- **Scope:** Arvo ecosystem
- **Amends:** AAM 1 membership (ADR-000)
- **Supplies:** the `executionid` derivation and the event classification that [ADR-001](./001-arvoevent-structure.md) defers to "the handler protocol ADR"; the conditions for routing a failure to the workflow root remain deferred
- **Addresses, in part:** ADR-000 Deferred Decisions — "ArvoEventHandler execution semantics" (settled here); "Handler state serialization, persistence, migration, and recovery" (settled here, migration by prohibiting it); "Handler concurrency and event-waiting patterns" (settled here). ADR-005 **Left deferred** — "dependency declaration, contract resolution, and binding", "a handler's own runtime decision of which permitted event to emit and when", and "domain resolution, inheritance, and any orchestration-context-dependent routing strategy" (all settled here).

Conformance language is as defined in [ADR-000](./000-arvo-system-identity-and-architectural-principles.md).

## Scope

This ADR defines what an **ArvoEventHandler** is and how one is entered, resumed, and completed: how it declares the contracts it implements and depends on, how an execution is identified, what an execution durably remembers, how an incoming event is classified, how outstanding responses are collected, how failure is categorized, and what a handler requires of whatever runs it.

It defines the handler as a **pure function of a delivered event, a prior execution record, its resolved dependencies, and which attempt this delivery is**, returning emitted events and the next execution record. The handler holds nothing between deliveries and reaches no store.

Several things are deliberately not defined here:

- **Any particular durable mechanism.** This ADR states obligations a mechanism must meet. It names no broker, database, transaction, outbox, lock implementation, or scheduler, and requires no specific one.
- **Native API shape.** Per ADR-004, how a language exposes handler declaration, the execution context, or emission is that language's own choice. This ADR fixes semantics and the durable record's field names, not method names or type names.
- **Migration of an execution record.** Not deferred — decided against. An execution record belongs to one contract version for its whole life and MUST NOT be moved to another (see **Version authority**).
- **Timers, deadlines, and scheduling.** ADR-000 defers these, and this ADR invents no semantics for them. It does assign the responsibility: following up on an execution that is waiting on something that never arrives belongs to whatever runs the handler (**Retry**, **Collection**).
- **Cancellation as something one node does to another.** Decided against rather than deferred. Arvo defines no cancel event and no interruption mechanism: nothing can stop an execution that does not stop itself. What the model does provide is the means to cancel *cooperatively* — a hook for reading an application's own signal (**Dependencies**), and a terminal `cancelled` lifecycle so a record says why an execution ended. Compensation stays entirely an application's own concern, expressed through events its contracts already permit. This amends ADR-000's Deferred Decision by explicit reference.
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

**A handler MUST NOT declare two versions of the same service contract.** Doing so is a declaration error, and where it reaches a delivery it is a non-retryable fault. Two versions of one contract share a `type` — ADR-005 makes `type` a property of the contract, not of a version — so their input types collide and the rule above already rejects them. It is stated separately because the collision rule reads as being about unrelated contracts, and this is the case an author is most likely to reach for deliberately: wanting to call an old and a new version of the same service from one handler. That is two dependencies on one contract, and the model has no way to tell their responses apart.

Both rules exist to make an emitted event's type sufficient to determine its destination. Each is checked once, at declaration, where the entire capability set is visible — the only place it can be checked, since no declaration site knows every contract in existence.

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
state.execution_id        = SHA-256( utf8(init_event.dataschema) ‖ 0x00 ‖ utf8(init_event.id) )
                            rendered as 64 lowercase hexadecimal characters
```

Every part of that is pinned, and pinned for the same reason ADR-005 pins its JSON Schema dialect rather than saying "JSON Schema": two implementations that disagree on any of it derive different identifiers from the same init event, and a redelivery then forks a new execution — precisely the failure the derivation exists to prevent. Adapter obligation 2 makes a mechanism compute this too, so the rule has at least two independent implementors before a second language exists.

- **Algorithm:** SHA-256, as specified in FIPS 180-4. Chosen because it is available in every language's standard library or platform, not because Arvo needs its cryptographic properties for anything beyond collision resistance.
- **Input encoding:** the UTF-8 bytes of `dataschema`, then the single byte `0x00`, then the UTF-8 bytes of `id`. The delimiter is a byte, not a character, and it cannot occur inside either input — so no pair of distinct inputs can produce the same byte string.
- **Output encoding:** lowercase hexadecimal, 64 characters, no prefix and no separator.

The derivation MUST be pure: no randomness, no clock, no mutable input, and it MUST be performed only when a new execution is entered. This satisfies ADR-001's standing requirement that the derivation be deterministic, "so a redelivered trigger resolves to the existing execution rather than forking a new one".

Changing any of the three would change every identifier every implementation derives, so it changes only by a superseding ADR.

`dataschema` is the identifying component rather than `type`, because ADR-005 is explicit that no ADR makes `type` globally unique and that cross-contract collisions are resolved by "`type` and `dataschema` together". Since `dataschema` is `{uri}/{version}`, it names one contract at one version, and it is read directly off the init event that resolved this handler's version in the first place.

Three properties follow, and all three are load-bearing. A redelivered init event derives the same `execution_id` and therefore resolves to the same execution rather than forking a new one. Two handlers implementing different contracts derive different identifiers even where those contracts declare the same `type`, because their `dataschema` values differ. One handler invoking the same service twice within an execution produces two executions of it, because the two init events have different `id` values.

The residual case this does not separate is two handlers implementing the *same* contract version, which would derive the same identifier for the same init event. Nothing in the model forbids that deployment, and nothing in the model can distinguish those handlers either — node identity is deliberately not something Arvo depends on (ADR-000). It is a deployment error, and named here so it is not mistaken for a gap in the derivation.

**The root case changes nothing here, and is named so it cannot be misread.** ADR-001's *root execution* — the one whose identity is `subject`, whose completion carries it, and to which a failure event may one day be routed — is whatever minted the root event: a gateway, a scheduler, a webhook receiver. It sits outside this protocol, runs no executor, and owns no execution record. The handler a root event opens is not that execution; it is an ordinary execution like any other, deriving `execution_id = H(...)` by the rule above, with `parent_execution_id = init_event.executionid`, which on a root event is `subject`. The two readings are indistinguishable on the wire — that handler's completion carries `subject` either way, since a completion carries its caller's identity and the minter is the caller — but they diverge on whether this derivation needs a root carve-out, and it does not. A failure event routed to the root (`executionid = subject`, deferred as stated under **Failure**) is addressed to the minter, not to any record, which is why it needs no keyed lookup to land.

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
| `domain` | absent unless asked for | absent unless asked for, or the version's handler-error default |
| `executionunits` | `0` | `0` |
| `type` | supplied by the executor | supplied by the executor |
| `data` | supplied by the executor | supplied by the executor, or composed from the error |
| `dataschema` | the target contract's, for the resolved version | the self contract's, for this execution's version |
| `id` | fresh | fresh |
| `time` | the moment of construction | the moment of construction |
| `traceparent` / `tracestate` | the execution's own trace context | the execution's own trace context |

`initid` is set only on a completion, per ADR-001: "on a completion, the `id` of the init event that opened the execution being completed; `null` on every other event". It is what lets a caller match a response to the request it answers, and it is the value a caller looks up in `in_flight_event_map`. Setting it on a service emission would mean something different — the id of the init event that opened the *emitting* execution — and ADR-001 reserves the field against exactly that.

`source` is the handler's own contract type, which identifies the producing node without inventing an identity scheme the model does not have. It is a valid URI-reference under ADR-002 and normalizes to itself, so it satisfies `source`'s format rule unchanged.

**Domain.** An executor may give an emitted event a literal domain, or name a source for the handler to read one from and resolve before the event exists. Either way it is absent unless asked for. The handler error event, which an executor does not construct field by field, takes the same two forms as a per-version default.

This is worth confronting rather than paraphrasing, because ADR-005 says why the field exists: a contract carries `domain` "so that events its factories construct can inherit a default without every call site repeating it". Defaulting every emission to absent with no way to reach that value would leave ADR-005's field inert in the one place it was meant to be used. So **the contract's own declared domain is one of the sources a request may name.** Reaching it takes a request rather than happening silently — which is what ADR-005's "not inherited" language is about, and what keeps an event's domain something an author chose rather than something it acquired on the way past.

The sources a request may name, and how they resolve, are the substance of ADR-005's deferred "domain resolution, inheritance, and orchestration-context routing". At minimum they are: no domain at all, the domain of the contract the event is built from, the domain of the contract of whoever is building it, and the domain of the event that caused this delivery. A request naming a source that was not supplied resolves to no domain rather than failing, so a handler is never broken by context it did not receive. A resolved domain is always a plain value or absent — **a request MUST NOT reach the event**.

`to` follows from that. A service emission is addressed to the contract that declares it, and a completion is addressed back to whoever opened this execution — which the init event's `source` names, since every handler stamps its own contract type there. Both are defaults, and both are unsafe to replace — see below.

Because `subject` is constant across a workflow, every record belonging to one workflow shares it, and a mechanism MAY group on it. Because `execution_id` identifies one execution, a mechanism MAY key the record on it.

`init_event_id` and `init_event_source` are held on the record as their own fields rather than read from `init_event` each time. Both are needed to address a completion, and the record already keeps them stable for the life of the execution; carrying them directly means addressing a completion never depends on restoring an event, and a reader of a stored record can see where it will return to without parsing anything.

**What an executor may set.** Every value above is a default. Whether an executor may replace one follows from a single question: does a wrong value spoil the event, or spoil something else? A **safe** field spoils only the event. An **unsafe** field spoils a reply path, a correlation, a trace, or a guarantee the rest of the workflow was relying on.

An implementation SHOULD separate the three in its surface, reaching the unsafe set only through a distinctly named, visibly unsafe group. The grouping is API shape and therefore each language's own choice (ADR-004); the classification is not.

| Field | Executor-owned edit | Reason | Consequence of a wrong value | Consequence borne by | Safe only if the executor guarantees |
|---|---|---|---|---|---|
| `type` | required | Selects both the destination and the payload schema. | An undeclared type does not compile, and is an execution fault where types cannot catch it. | This execution. Nothing is emitted. | It names a capability in the declared set. Checked for you. |
| `data` | required | The payload, validated against whichever schema `type` selects. | A payload the schema rejects is a non-retryable fault; no event is emitted. | This execution. Nothing is emitted. | It satisfies the schema `type` selects. Checked for you. |
| `domain` | safe | Selects a processing path, and is the emitter's to choose. Takes a value or a request to read one — see **Domain**. | The event is fulfilled on a different path. Nothing that routes, correlates or identifies reads it. | This execution, which chose the path. | Something fulfils that domain and returns the event to the default path. |
| `executionunits` | safe | Accounting only. | A wrong cost figure, and nothing else. | Whoever reads cost reporting. | The figure means what the deployment's other producers mean by it. |
| `executionid` | unsafe | The reply path. A callee stores it as its `parent_execution_id` and stamps it on its completion. | The reply is addressed to an execution that does not exist, and this one waits forever. | This execution, and the callee whose work is discarded. | The named execution exists, is not terminal, and is awaiting exactly this reply. |
| `to` | unsafe | What Arvo routes on. ADR-001 makes it "set fresh by the emitter", and for these events the handler is that emitter. | The event is delivered elsewhere. No reply arrives from a service call; a completion never reaches the caller. | This execution, and whichever node receives an event it never expected. | The recipient implements this contract version, and — on a service call — replies with the same `subject`, `executionid` and `initid` the default would have produced. |
| `subject` | unsafe | Workflow identity, and one of this handler's own entry checks. | The callee's completion fails `state.subject == event.subject` and is rejected on arrival. | This execution, and anyone querying the workflow, which has silently lost a branch. | The new value is the workflow this execution genuinely belongs to, and every record later checked against it agrees. |
| `initid` | unsafe | Response correlation — the key a caller looks its outstanding request up by. | The reply matches no outstanding entry and is discarded as an orphan. | This execution. | It is the id of a request the recipient currently has outstanding. You are claiming to answer that one. |
| `id` | unsafe | The in-flight key, and an input to the callee's identity derivation. | A duplicate collapses two distinct calls onto one execution — the reason ADR-001 requires global uniqueness. | The callee, which merges two requests into one. | It is globally unique per ADR-001, colliding with no event any participant has emitted or will emit. |
| `dataschema` | unsafe | Names the contract and version that validate the payload, and the other input to the callee's derivation. | The callee rejects the event, or derives a different execution than intended. | The callee, then this execution when no reply comes. | The payload satisfies that contract version's schema, and a handler implementing it is deployed. |
| `source` | unsafe | The callee stores it as `init_event_source` and addresses its completion to it. | A handler that misreports its source never receives its own replies. | This execution, and whichever node is sent completions meant for it. | Whatever it names can receive this execution's completions and act on them. |
| `parentid` | unsafe | Lineage, and rootness: `parentid == null` is what defines a root event. | A null claims rootness, which then requires `executionid == subject` and usually fails validation outright. | The receiver, and anyone reconstructing causality afterwards. | It names an event that genuinely caused this one, and is not `null` unless this really is a root — which then also requires `executionid == subject`. |
| `category` | unsafe | Classification, consulted before contract declarations. ADR-001 assigns it "through contract event factories rather than handler or application code". | The receiver rejects the delivery, or takes an init for a followup. | The receiver. | It states the event's actual role, so the receiver's classification and its contract declarations agree. |
| `depth` | unsafe | The runaway-nesting signal. ADR-001 states it never decrements, and it is what the execution-depth guard measures. | Unbounded recursion stops being visible — the one thing the field exists for. A value at or above the version's maximum also rejects the whole emission batch (see **Depth**). | Operators, who lose the signal at the moment it matters. | It still counts real nesting from the root, and does not decrease. |
| `traceparent` / `tracestate` | unsafe | Trace context, inside the model per ADR-000. The default already continues the delivered event's trace. | The workflow's trace fragments into disconnected pieces, exactly where a suspension makes it hardest to reconstruct by hand. | Whoever debugs the workflow later. | It is a valid W3C context descending from this execution's own, so the chain still joins up. |
| `time` | unsafe | The moment of construction. ADR-001 makes it descriptive and forbids using it to establish ordering. | Nothing in the protocol; a misleading timeline for everyone reading the event stream afterwards. | Whoever reads or audits the stream later. | It is a real RFC 3339 instant carrying an offset, and describes when the event actually occurred. |
| `baggage` | unsafe | Written once, at the root. ADR-001: "no handler may add a key, remove a key, or change a value". | Every event in the workflow no longer carries an identical map. Branches diverge, fan-in needs a merge rule that does not exist, and two nodes couple without a contract declaring it. | Every participant in the workflow, downstream and in every other branch. | Nothing a handler can guarantee from where it stands. It would have to know every branch of the workflow, present and future, and that none fans back in. Only the root minter is in that position, and a handler never is. |

Read the *consequence borne by* column down and the case for the category makes itself: for three of the four safe and required rows the cost stops at the execution that caused it, and for almost every unsafe row it does not. An executor setting an unsafe field is spending someone else's reliability — a callee's, a receiver's, an operator's, or in `baggage`'s case every participant in the workflow at once. That is the distinction the surface is marking, and the reason the ADR names an owner rather than only a symptom.

**What "unsafe" means.** Four of these carry normative ADR-001 rules an override breaks outright rather than merely inadvisably — `baggage`, `depth`, `category`, and `initid`. The unsafe surface repeals none of them. It exists because a type boundary cannot enforce every rule in the model, and because hiding a field entirely leaves a developer with a real need no way forward and no way to weigh the cost.

What it offers is reachability with the consequence named. A developer who crosses it owns that consequence fully, including on behalf of participants downstream who never chose it.

### Observability

Trace context is inside the model (ADR-000). A handler MUST continue an existing trace rather than begin a new one wherever it can: an execution's trace context is taken from the delivered event's `traceparent` and `tracestate` where a `traceparent` is present, and begun fresh only where none is. Every event the handler emits carries that context by default, so a causal chain survives suspension without an executor doing anything.

An executor MUST be able to contribute to the execution's own trace rather than having to start a parallel one, and it reaches it through the context alongside everything else it is given. The type it is handed, and what it can record on it, are API shape and each language's own choice (ADR-004).

Replacing an emission's trace context is possible but unsafe, for the reason the table gives. An implementation SHOULD instrument the protocol itself — entry validation, hydration, classification, collection, emission — so that a handler is observable without an executor writing any instrumentation, and SHOULD make adding custom instrumentation a first-class part of its surface rather than something reached around the framework for.


### Classification

Every delivery is either an **init** — opening a new execution — or a **followup**, resuming one. There is no third outcome and no unclassified pass-through: a delivery that cannot be classified is a fault.

**`dataschema` decides it.** ADR-005 fixes `dataschema` as `{uri}/{version}`, and the `uri` names the contract that governs the event. A `uri` matching the self contract is an init; one matching a declared service contract is a followup; one matching neither is a fault. This is read from a field ADR-001 requires on every event, ADR-002 constrains the format of, and ADR-005 gives a fixed shape — not inferred.

**`category` cross-checks it.** ADR-001 reserves `io.arvo.init` and `io.arvo.complete` and says a producer sets them "through contract event factories rather than handler or application code", so where one is present it states the sender's own contractual intent. It MUST agree with what `dataschema` resolved: `io.arvo.init` on a self-contract event, `io.arvo.complete` on a service-contract one. A disagreement is a fault, and catching it is the point — it means two independently deployed participants have diverged about what they are doing, which ADR-001 wants "detectable rather than silent". Any other value, including absence, carries no ecosystem meaning per ADR-001 and is not consulted.

An init delivery derives a new execution. A followup resolves the existing one by the arriving event's `executionid`, which a completion carries as its caller's identity — that is, as this handler's own.

**A response is matched to what it answers by `initid`.** ADR-001 defines `initid` as "the `id` of the init event that opened the execution this event completes", and states that it "is the only field that answers *which request is this the answer to*" — `executionid` cannot, because every completion carries the caller's identity, and `parentid` cannot, because it degrades to noise across a suspension. A response is therefore recorded against `in_flight_event_map[response.initid]`, which is the id of the event this execution emitted to open that service's execution.

### Entry validation

Before any executor code runs, a handler MUST work through the following gate **in sequence**. Each step is a precondition for the ones after it, and the record must be known to be well formed before anything reads a field from it — which is why validating it comes first and everything else follows.

A delivery leaves the gate one of three ways: **proceed** to the executor, **discard** with nothing written and nothing raised, or **fault**.

| Sequence | Description | Behaviour on invalid | Short-circuits | Retry safe |
|---|---|---|---|---|
| 1 | **State object validation.** Where a record is supplied, it validates against the fixed envelope composed with the executor's own declared schema at `data`, and every event it holds restores to an event value (see **Hydration**). No `state.*` value may be read until this passes. | fault | yes | no |
| 2 | **`dataschema` resolves against a declared contract**, naming one contract at one version and thereby determining whether this is an init or a followup. See **Resolution**. | fault | yes | no |
| 3 | **`category` agrees with what resolution found.** `io.arvo.init` accompanies a self-contract event, `io.arvo.complete` a service-contract one. Absent or unrecognised, it is not consulted. | fault | yes | no |
| 4 | **Presence matches classification, and the record's version is still declared.** An init delivery MUST be given no record; every other delivery MUST be given a complete one. Where one is present, the handler MUST still declare an executor for its `version` — a version withdrawn from a deployed handler strands its in-flight executions (see **Version authority**), and this is where that surfaces. | fault | yes | no |
| 5 | **Already seen.** The delivered event's `id` is already in `event_ids` as `received`, so this delivery has been processed. Applies to followups; a duplicate init is the mechanism's to suppress. | discard | yes | n/a |
| 6 | **Lifecycle admits the delivery.** A record at `success`, `error`, `cancelled` or `failure` accepts nothing further. A record at `waiting` accepts a followup. | fault | yes | no |
| 7 | **Record, handler and event agree.** `event.to == handler's self contract type`, `state.source == handler's self contract type`, `state.execution_id == event.executionid`, `state.subject == event.subject`. `to` is authoritative, so an event carrying none is invalid here. | fault | no — all four are reported together | no |
| 8 | **The type is one the resolved contract can send here.** For the self contract, its own type. For a service contract, one of that version's `outputs` or its handler error type. | fault | yes | no |
| 9 | **Payload satisfies its schema**, as declared by the contract and version step 2 resolved. | fault | no | no |
| 10 | **Awaited, on a followup.** The response's `initid` names a key of `in_flight_event_map` whose value is still outstanding. | fault | yes | no |

Every fault here is non-retryable, and for one reason: each describes a delivery that would fail identically however often it were repeated. **A fault names every check that failed**, not merely the first — where the sequence allowed more than one to be evaluated, all of them are reported. This matches ADR-005, whose contract validation reports every broken rule at once, and it is the difference between one diagnosis and a run of redeliveries each revealing one more problem.

**Resolution, and which executor runs.** Every delivered event is resolved through its `dataschema` before anything reads its type. ADR-005 fixes `dataschema` as `{uri}/{version}`, split at the last `/`, so the `uri` names a contract and the remainder names one of its versions.

The `uri` MUST match the self contract or one of the declared service contracts. If it matches neither, the delivery is a fault. Then the two cases differ, and so does where the version comes from:

| | init delivery | followup delivery |
|---|---|---|
| `uri` resolves to | the self contract | a declared service contract |
| the record is | `null` | non-null |
| the executor is chosen by | the **event's** version, from its `dataschema` | the **record's** `source` and `version` |
| the version check is | the handler declares an executor for that version, else a fault | the event's version equals the declared service version exactly, else a fault |

For an init there is no record, so the event is the only thing that can say which version to run — and if the handler declares no executor for it, that is a fault rather than a fallback to a neighbour.

For a followup the record is authoritative, because a response's `dataschema` names the *service's* contract and version and says nothing about this handler's. The event's version is still checked, against the version the handler declared for that service, and it MUST be equal. This is the check that catches version skew: a response from `payments/1.1.0` arriving at a handler that declared `payments/1.0.0` carries the same version-independent `type`, would pass a type check, and would then be validated against the wrong version's schema — passing wrongly or failing with a misleading diagnosis. ADR-001 made `dataschema` required so that "version skew … becomes detectable rather than silent", and this is where a followup gets that.

**Why step 1 is first.** Every later step that touches the record reads it — step 5 reads `event_ids`, step 6 reads `lifecycle`, step 7 reads three identifiers. A gate that compared before it validated would be reading fields off a structure it had not established was a record at all, and would report a mismatch where the truth was corruption.

**Why resolution comes second, ahead of everything about the event.** A `type` is version-independent — ADR-005 makes it a property of the contract — so a type alone cannot say which schema to validate against, nor even reliably which contract sent it. `dataschema` names exactly one contract at exactly one version, so resolving it first gives every later step one answer to work from.

It also settles which kind of delivery this is, which is why classification follows it rather than preceding it. A self-contract `uri` is an init and a service `uri` is a followup, and that is not a guess: it is read from a required field that ADR-002 constrains and ADR-005 gives a fixed shape. `category` then cross-checks it — a sender's stated intent against a receiver's declarations, which is what ADR-001 put the field there for. Deciding the same question twice by two independent means, with no rule for disagreement, is the thing this ordering removes.

**Why the duplicate check precedes the lifecycle check.** A redelivery of the very event that completed an execution would otherwise reach the terminal check first and be reported as a fault — so under at-least-once delivery, the final response of every execution could produce a spurious failure whenever the transport repeated it.

Putting step 5 ahead of step 6 costs nothing, because the two catch disjoint things. Step 5 discards only an event the execution has demonstrably already processed. A genuinely late message — one arriving at a finished execution having never been seen — is not in `event_ids`, passes step 5 untouched, and is reported by step 6 exactly as it should be. Quiet about repetition, loud about lateness.

Discarding a duplicate at step 5 is safe because the record that would have been written already exists, carrying that event's id in `event_ids`. **Arvo treats one execution of an executor as atomic**: it either produced its events and its record together, or it produced neither. An executor should be written on the same assumption — where side effects outside Arvo are unavoidable, they should be idempotent or cheap to repeat, because the protocol offers no partial-completion state for them to resume from.

**What step 4 asks of a mechanism.** It is the reason the derivation in **Execution identity** is specified publicly rather than left internal. A mechanism MUST resolve the record *before* dispatch, computing the identifier from the init event by the same rule the handler would, and MUST NOT dispatch an init delivery for which a record already exists. That is how a redelivered init event "resolves to the existing execution rather than forking a new one", which ADR-001 gives as the reason for requiring deterministic derivation in the first place.

### Depth

**This is an execution-level guard, not a constraint on the event.** It does not narrow `depth` as ADR-001 defines it, does not restrict what depth an event may carry, and imposes no limit the model enforces. A version chooses its own maximum, and may choose one high enough that the guard never fires. What it bounds is how deep *this handler* is willing to go before it stops calling out — which is a handler's own decision about its own recursion, not an architectural limit on composition.

**A version MAY set a maximum execution depth**, defaulting to 1000:

```
max depth                  a number; 1000 unless set
on max depth violation     'error' | 'event' | f({ ctx, violation }) → event or events
                           'event' unless set
```

**The guard is checked on emission, not on delivery.** After the executor has run, the handler checks each event it wants to emit: an event that would open a new execution carries `state.depth + 1`, and where that reaches the maximum the emission is a violation.

**One violating event rejects the whole batch.** Where any event an executor returns violates the guard, none of them is emitted and `on max depth violation` decides what happens instead. The alternative — emitting the permitted ones and handling only the violation — would leave an execution simultaneously waiting on real services and terminal at `error`, which no lifecycle can express and no caller could interpret. A batch is one decision by one executor, and it succeeds or is replaced as one.

Checking here rather than at the gate matters. A delivered response necessarily arrives at `state.depth + 1`, because a completion carries the depth of the execution that produced it — so a gate that rejected on the incoming depth would reject *every* response to a handler sitting one below the limit, discarding work a service had already completed successfully. Nothing about refusing a reply prevents any depth; the nesting has already happened. Refusing the *emission* stops it before the doomed work runs, which is the only point at which stopping is worth anything.

It also keeps a service's own depth violation deliverable. Where a service refuses at its limit and completes with its handler error event, that response reaches its caller normally and the caller's executor can do something about it, rather than tripping a gate and being replaced by the caller's own error one level further up.

**An executor can see it coming, which is why the outcome is its own.** The context exposes whether this execution has reached its limit — true when an event it emits could no longer increment `depth`. An executor that checks it can take a different path, complete early, or explain itself. Reaching a violation therefore takes a deliberate act: emitting to a service after being told the limit is reached, or overriding `depth` outright, which is already among the unsafe fields under **Addressing an emitted event**.

**On a violation**, what happens is the version's to choose:

| Choice | Behaviour |
|---|---|
| `'error'` | A non-retryable execution fault. Nothing is emitted, no record is written, and the mechanism decides what to do with a workflow that has run away. |
| `'event'` | The default. The handler error event is emitted and the execution terminates at `error`. The caller learns the work will not be done, in the one shape it is already obliged to handle. |
| a function | Called with the same context the executor had, plus a description of what was rejected. Whatever it returns is emitted and the execution terminates accordingly. |

The function receives the context and a `violation`, so it can explain itself rather than guess:

```
violation
    max_depth             the limit in force for this version
    execution_depth       state.depth — where this execution sits
    would_be_depth        the depth a new execution would have carried
    rejected              for each event the executor returned:
                              type      the event type
                              depth     the depth it would have carried
                              violating whether this event is one of the offenders
```

`rejected` lists the whole batch rather than only the offenders, because the batch was rejected whole and a diagnostic that showed only part of it would misrepresent what happened.

**A function MAY return only the self contract's own `outputs` or its handler error event.** A service emission is refused, and the reason is the whole point: an execution stopped for being too deep must not go deeper.

**A function MUST NOT be able to fail**, and every way it can go wrong has the same answer. Where it throws, returns nothing usable, or returns a service emission, an implementation MUST fall back to `'event'` — the handler error event — rather than propagate anything. One rule covers all three, which is deliberate: this code runs precisely when a workflow is already in trouble, and a violation handler that can itself derail the response is worth less than no violation handler at all. Same rule as `retry delay`, same reason.

Whichever branch runs, `lifecycle_description` SHOULD record that the depth limit was reached, since an execution ending at `error` for this reason and one ending there for a handler failure are otherwise indistinguishable in the record.

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
| `cas_version` | Non-negative integer, starting at 0 and incremented on every write to the record — by the handler ordinarily, and by the mechanism on the one write it makes itself (see obligation 3). Exists so a mechanism can compare-and-swap. |
| `lifecycle` | `init`, `waiting`, `success`, `error`, `cancelled`, or `failure`. |
| `lifecycle_description` | Free text explaining how the execution reached its current `lifecycle`, or `null`. |
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
| `cancelled` | Terminal. The executor marked the execution cancelled. |
| `failure` | Terminal. Retries were exhausted and the execution could not proceed. |

**An executor MUST be able to mark its own execution `cancelled`**, and doing so is terminal. It is how a cooperative wind-down records *why* an execution ended rather than leaving it indistinguishable from an ordinary completion. What it is called, and how it is reached, is API shape and each language's own choice (ADR-004).

Marking cancelled does not excuse an execution from answering its caller. An execution that ends without emitting anything leaves whoever is waiting on it waiting forever — cancelling is a reason to stop, not a way out of the protocol. An executor that cancels SHOULD still emit something that completes its own contract, and an implementation SHOULD make that the easy path.

Where an executor both marks cancelled and emits an own-contract event, `cancelled` is the recorded lifecycle. An explicit statement of why an execution ended outranks what is inferred from what it emitted.

`lifecycle_description` carries free text explaining how the execution reached its `lifecycle`, and is `null` wherever nothing explains it — which is every `init`, `waiting` and `success`. It is populated on `cancelled`, with whatever reason the executor gives; on `error`, with the handler failure's own message; and on `failure`, with the message of whatever the mechanism gave up retrying. It is diagnostic only: nothing in the protocol reads it, and no behaviour may depend on its contents.

`init` deserves a warning rather than only a definition. An executor that emits nothing has neither completed nor asked for anything, so nothing will ever deliver to that execution again and it rests there forever. It is a legal state, it is almost always a defect, and an implementation SHOULD make it visible rather than silent.

**How this record may change later.** A stored record outlives the deployment that wrote it, and an execution in flight when a handler is upgraded is read back by the newer code. So every field a future ADR adds to this record MUST be nullable, with absence carrying a defined meaning — a record written before the field existed is still a valid record, and must validate and resume without alteration.

Two rules follow from the same premise and are stated here so a later ADR does not have to rediscover them. A field MUST NOT be removed, and a field's meaning MUST NOT change, because both silently reinterpret records already in a store. And validation MUST NOT reject a record for carrying a field the reader does not know, so that a record written by a newer deployment survives being read by an older one during a rollout.

This is deliberately narrower than migration, which **Version authority** prohibits outright. Migration would move a record between contract versions, remapping state whose meaning only its own executor knows. This is the envelope growing new optional fields around state that is untouched.

`cas_version` MUST NOT be reset or wrapped by an implementation. It is an integer exactly representable in JSON, which bounds it far above any reachable execution length.

**Version authority.** After the first delivery, the record is the only place the handler's own version survives — a followup response's `dataschema` names the *service's* contract and version, not this handler's. If a record's `version` is one the handler no longer declares, the delivery is a fault and the execution is not resumed.

**An execution record belongs to one contract version for its whole life.** It MUST NOT be resumed under another version, and it MUST NOT be migrated to one. This is not a conservative default awaiting a better answer; it follows from ADR-005, where each version is fully isolated and "no two versions are ever compatible by construction". A migration would need a defined mapping from one version's state to another's, and isolation is precisely the statement that no such mapping exists — a `data` shape is governed by the schema its own executor declared, and a neighbouring version's schema has no claim on it. Silently running one version's executor over another version's state would corrupt an execution rather than report one.

Removing a version from a deployed handler therefore strands its in-flight executions, permanently. A version is drained before it is removed, and that is the whole of the migration story.

**Hydration.** On entering a delivery, a handler MUST validate the whole record — a fixed envelope, composed with the executor's own declared schema at `data` — and MUST restore every event the record holds to an event value before any executor code runs. A record that fails either is a fault. Validating eagerly costs every stored event on every delivery; the ADR chooses that so a corrupt record fails once, at entry, with its cause named, rather than surfacing from inside business logic where it cannot be attributed.

**This is an accepted trade-off, and its cost scales with fan-out.** An execution awaiting a thousand responses restores a thousand events on each of them, and the record grows with the collection. Eager hydration is the rule regardless: a handler that reasons about a record it has only partly validated is worse than a handler that is slow. Nothing here bounds fan-out, and how to bound it — a cap, lazy restoration for entries an executor never reads, or something else — is left to a later decision rather than guessed at now.

**Serializability of `data`.** A handler MUST verify that `data` survives a JSON round trip when an executor returns, and report a fault if it does not. This is the executor author's obligation and cannot be prevented by a declared schema, which will not catch a native date or class instance passed through a permissive schema position. Checking at return keeps the failure attributable to the executor that caused it.

### Retry

A handler cannot retry itself. It is stateless and runs only when something delivers to it, so a retry is a redelivery and every decision about one belongs to whatever runs the handler. What this ADR settles is what the handler must tell it.

**Every delivery carries which attempt it is.** The mechanism supplies an attempt number alongside the event, the record and the dependencies. An executor may read it — knowing this is the third attempt is sometimes exactly what a decision turns on — but it is not part of the record. It describes a delivery, not an execution.

**Retry information travels on the fault, not in the record.** Where a delivery ends in an execution fault, the fault carries everything a mechanism needs to decide what happens next:

```
retry                            null where no retry is in prospect
    current_retry_attempt        this delivery's attempt number
    total_retry_attempts         attempts this execution has seen in total
    max_retry_attempts_allowed   from the version's options; 3 unless set
    is_retry_exhausted           current_retry_attempt >= max_retry_attempts_allowed
    retry_in_ms                  how long to wait before the next attempt
    current_time                 when this delivery was processed
    retry_at                     current_time + retry_in_ms
```

This is where it has to live. A fault produces no record, so a retry figure written into the record could never be persisted at the moment it mattered — and outside a fault there is nothing to retry, so the field would be null on every record that ever reached a store. The fault is the only object that exists exactly when the information is meaningful.

`retry` is `null` where no retry is in prospect: a fault that is not retry safe, or one whose attempts are spent. A mechanism can therefore read "retry, and here is when" or "do not" without interpreting a message.

`current_time` and `retry_at` are instants and `retry_in_ms` a duration. **All three are numbers**, and their precision is the finest an implementation can offer that remains exactly representable where the value is carried — integers up to 2^53−1 wherever that is JSON. In practice that admits milliseconds and microseconds and rules out nanoseconds: a microsecond epoch is around 1.8×10^15 today and stays inside the range for centuries, while a nanosecond epoch is already around 1.8×10^18 and is past it now. Both instants MUST use the same precision.

**A version MAY set two options** governing what a mechanism should do:

```
max retry attempts   a number; 3 unless set
retry delay          a number of milliseconds
                     or  f(event, state) → milliseconds
                     300ms unless set
```

Their names are each language's own choice; what this ADR fixes is that both exist and what they mean.

`retry delay` is 300ms where a version sets none. The handler must put a number in the fault's `retry_in_ms`, so leaving it undefined is not an option — a mechanism may of course ignore the figure, but it must be given one.

In its function form it **MUST NOT be able to fail**. Where it does — throwing, or returning anything that is not a usable number — an implementation MUST substitute that same 300ms rather than propagate the failure. A failure while working out how long to wait before retrying would turn a recoverable situation into an unrecoverable one, which is the one outcome the retry path exists to prevent.

**Exhaustion ends retrying, and the handler says so.** Where attempts are spent, a fault that would otherwise be retry safe MUST be reported as no longer retry safe, and its `retry` is `null`. A mechanism stops rather than loops.

**An exhausted execution ends at `failure`, and only the mechanism can put it there.** This needs stating because it is the one lifecycle the handler cannot write. A fault produces no record, so the stored record still says `waiting` — and an execution abandoned after its retries are spent would otherwise be indistinguishable from one legitimately waiting on a slow service. On giving up, a mechanism MUST mark the record `failure` and put the failure's message in `lifecycle_description`. `failure` is terminal, and no delivery to it is ever processed.

That obligation asks something new of a mechanism: it must be able to write a record's `lifecycle` and `lifecycle_description` without running the handler. This is deliberate. Every other write flows through the handler because every other write depends on the executor's own logic; this one exists precisely because the handler could not be reached.

**Every retry MUST fetch the record afresh, and that is the runner's responsibility.** A retry is a new delivery, not a replay of the one that failed. Between the failed attempt and the retry the record may have moved on — another response may have arrived, been recorded, and advanced `cas_version` — so re-dispatching the tuple the mechanism already held would compute from a record that is no longer current. With compare-and-swap in place that write fails and the retry never converges; without it, the retry silently erases work that succeeded in between.

So a mechanism re-reads the record, the event and the dependencies for each attempt, carrying forward only the attempt number, which is the one input a retry genuinely inherits. A handler cannot enforce this: it is handed whatever it is handed, and has no way to tell a fresh record from a stale one.

**What else the runner owns, for the same reason.** The handler is entered only when something delivers to it, so everything that depends on time passing or on nothing happening is outside what it can observe:

- storing, interpreting and acting on the `retry` a fault carries, including whether to honour the delay at all;
- following up on an execution resting at `waiting` whose responses have not arrived — the handler has no way to notice absence, and the model defines no deadline (ADR-000 defers timers);
- persisting the record, publishing the events, and delivering them.

This ADR states what a handler produces and what it requires. Everything between one delivery and the next belongs to the mechanism, and is deliberately not divided further here.

### Collection

When an executor emits one or more events to service contracts, the handler records them in `in_flight_event_map` as outstanding, and the execution rests at `waiting`.

**By default a handler joins on all of them.** A response is recorded against its key, and then:

- if any entry is still outstanding, the executor MUST NOT be entered; the delivery ends and the record is written;
- if none is, the executor is entered with every response available.

A handler MUST allow this to be overridden per handler definition, so that an executor is entered on every response with the partial collection available to it. An implementation SHOULD document that such an executor runs once per arriving response and must therefore be safe to repeat.

`in_flight_event_map` is **rebuilt on every emission**, not merged into. It always describes exactly what the current round awaits. Under the default this is unobservable, since the executor is only entered on a complete collection. Under the override it means emitting while a response is still outstanding abandons that response, and an implementation MUST document this as the cost of the override.

**A response is processed only if the collection is awaiting it**, and one that is not is a fault — see steps 6 and 10 of **Entry validation**. This covers a response the collection was rebuilt without, one answering a question already answered, and one arriving at an execution that has already finished. None of them re-enters the executor and none reopens a terminal execution.

The one delivery that is discarded rather than faulted is an outright duplicate, recognised at step 4 by its event id. The distinction is worth holding onto: a duplicate is the transport doing its job, while an unawaited response is a participant sending something nobody asked for.

Under the default join, a service that never responds leaves an execution at `waiting` indefinitely. The handler cannot notice this — it is entered only when something arrives, and nothing arriving is precisely the case. Following up on such an execution is the mechanism's, as **Retry** sets out. The model still defines no deadline of its own; ADR-000 defers timers, and this ADR assigns the responsibility without inventing the semantics.

### Failure

An execution's failures fall into two categories, and the distinction is which of them becomes an event.

**Handler failure** is the executor failing to fulfil its contract — its own code raising something the protocol did not define. It MUST be reported as the self contract version's **handler error event**, addressed as an own-contract emission, and the execution MUST reach `error`. This is a completed execution: it produced events and a record, and a mechanism has nothing to retry.

**Execution fault** is a failure of the protocol or its surroundings: a record that will not validate, an event that will not restore, a delivery that will not classify, a version no longer declared, a payload an executor asked to emit that its contract rejects, a dependency that would not resolve. A fault MUST NOT become an event. It MUST carry whether it is **retry safe** and, where it is, how long a mechanism should wait before the next attempt — so a mechanism can retry, dead-letter, or escalate without inspecting a message or consulting a handler's declaration. See **Retry**.

| Fault | Retry safe |
|---|---|
| the record fails validation | no |
| an event in the record fails to restore | no |
| the record's `version` is no longer declared | no |
| the delivered event fails classification or its contract's schema | no |
| an init delivery arrives with a record, or any other delivery without one | no |
| the record does not match the delivery's addressing, or the event carries no `to` | no |
| the delivery reaches a record already at a terminal `lifecycle` | no |
| a response's `initid` names nothing the collection is awaiting | no |
| the event's type is not one the handler can receive | no |
| a handler declares two versions of the same service contract | no |
| an emission would exceed the version's maximum execution depth, where that version chose `'error'` | no |
| `data` does not survive a JSON round trip | no |
| an emission the executor requested is not permitted, or its payload is rejected | no |
| resolving the executor's dependencies fails | yes |
| a fault the executor raises deliberately | executor's choice; **retry safe** unless stated |

The verdicts follow from one question: would the same inputs produce the same failure? A malformed record, a removed version, and an impermissible emission are all defects that a retry reproduces exactly. Dependency resolution is the one listed case whose outcome may legitimately differ a moment later.

**No failure defined here routes to the workflow root.** ADR-001 permits such an event — carrying `subject` as its `executionid`, bypassing intermediate executions so a failure surfaces at the top regardless of depth — and defers the conditions to this ADR. This ADR defines none: a handler failure is attributable to the execution that suffered it and returns to that execution's caller, and a fault never becomes an event at all. The capability remains available and unused, and the conditions stay deferred rather than being invented to fill the slot.

Both categories record their cause in `lifecycle_description` where a record survives them — a handler failure reaching `error` writes the failure's message there. A fault that prevents a record being written at all leaves nothing behind but what the mechanism logs, which is why a fault's retry-safety must travel with the fault itself rather than in the record.

The two categories are named distinctly on purpose. "Handler error" refers only to the event; a fault is never an event. An implementation MUST NOT use one name for both.

### Dependencies

An executor's implementation dependencies are outside the model (ADR-000) and are not part of a handler's declaration as a runtime concern. They are supplied per delivery, and an implementation MUST accept them in either of two forms:

```
dependencies  :  optional
    either      D                            a value, used as given
    or          factory(event, state) → D    called once per delivery
                                             may be asynchronous where a language distinguishes it
```

The factory form is what a resumable handler needs. Nothing live is constructed until a delivery needs it, so nothing is captured across a suspension — ADR-000 requires that no implementation dependency be relied upon to survive one. Giving the factory the delivered event and the current record lets a dependency be built *for this execution* rather than for the process, which is what makes the next section possible.

A factory that fails is an **execution fault and is retry safe**: constructing a dependency is the one entry-path failure whose outcome may legitimately differ a moment later.

### Cancellation

**Nothing can cancel an execution but the execution itself**, and this is a decision rather than an omission. There is no cancel event and no way for one node to interrupt another. A contract version declares exactly one `input`, so a handler's inbound events are its init event and its services' responses and nothing else; a cancel event would therefore have to be a second model-level derived event alongside the handler error, and interrupting a running execution would require a control path outside the event stream, which ADR-000's *Event-Only Communication* forbids.

What the model does provide is enough for an execution to stop itself and say so: the terminal `cancelled` lifecycle under **The execution record**, and a hook for noticing that someone wants it to. Everything else is built on those by whoever needs it.

- A dependency factory receives the delivered event and the current record, so it can consult whatever cancellation signal an application maintains and expose the answer to the executor — conventionally as a flag on the dependencies it returns.
- The executor reads that flag and winds itself down: emitting whatever compensating events its contracts already permit, answering its caller, and marking its execution `cancelled` so the record says why it ended rather than leaving it to look like any other completion.
- **Scope is the application's choice**, because the record carries both identifiers. Keyed on `execution_id`, a signal cancels one execution; keyed on `subject`, it cancels every execution of a workflow. Neither requires anything of the model, and both work through the same hook.

This is cooperative, and the guidance should say so plainly: an execution that never receives another delivery never observes the signal, and an executor that does not check it is not cancellable. Arvo does not make a handler stoppable against its will. What it guarantees is that a handler which wants to be stoppable has somewhere to look, and that looking costs nothing when no one is cancelling.

## Consequences

**Gained.** A handler becomes a function of an event, a record, its dependencies and an attempt number, which makes it testable with literal values and no infrastructure — the property that most reliably decides whether resumable code can be reasoned about. Resumption is a single keyed read, so no mechanism needs a correlation index to participate. The capability set is closed and statically known, so a mechanism can determine what a handler may do before running it, and an implementation with a type system can reject an impermissible emission before it is deployed. The two failure categories give a mechanism an unambiguous rule for when to retry, which is the question adapters otherwise answer by guessing from an error message.

**Paid for.** A mechanism must now supply an attempt number as well as an event, a record and dependencies, which is a fourth input and one it may not naturally track. Durability moves entirely onto whatever runs a handler, and the obligations under **Required of infrastructure adapters** are strict enough that a naive mechanism — publish, then persist — is non-conformant rather than merely lossy. The default join makes concurrency invisible to an executor, and pays for it with an execution that waits indefinitely on a service that never answers, until a deadline decision exists. Eager hydration costs every stored event on every delivery, which a handler awaiting many responses pays repeatedly. Removing a contract version strands its in-flight executions permanently, with no migration path by design, so deployment acquires a drain step it did not previously have. A default depth guard means a handler that legitimately nests beyond 1000 must say so, and one that does not notice will meet the limit as an error rather than as a stack overflow — which is the trade the default is making. And a handler must construct emitted events itself, which removes an executor's ability to hand back an event it built by hand — deliberately, since the addressing rule is not something a call site can be trusted with.

## Considered Alternatives

**Deriving the per-execution identifier into `subject`, leaving `executionid` constant across the workflow** — considered, not chosen. A draft of this protocol took that shape, on the reasoning that a record wants a unique key and `subject` was the more natural name for one. It contradicts ADR-001 twice over: `subject` is defined there as inert, with "nothing derived from it by inspection", and as minted once and copied unchanged; and `executionid` is defined as identifying an execution, not a workflow. ADR-001 also records the same idea as already tried — "earlier designs chained subjects to carry coordination state, making one field both the workflow key and the coordination mechanism; it served neither well."

The storage motivation survives intact under ADR-001's assignment, which is why nothing was lost by abandoning the inversion: `execution_id` is the unique record key and `subject` is the grouping key, the same two-key design with the roles as ADR-001 assigns them. Resumption remains a single keyed read, because a completion carries its caller's `executionid`.

**Letting an executor return events it built itself** — considered, not chosen. It is more explicit about what reaches the wire, and it was the shape a first sketch took. But `subject` differs by destination and both values are structurally valid, so a mistake produces a misrouted workflow rather than a rejected event. The same applies to `category`. A rule that cannot be checked at the point of use does not belong at the point of use.

**Naming a destination on each emission, rather than deriving it from the event's type** — considered, not chosen. It would remove the collision rule under **Definition and declaration**, which is a real cost: that rule can reject a handler whose declared capabilities are individually valid, and a contract author cannot anticipate it. It was rejected because naming a destination introduces a second way to say the same thing and therefore a way for the two to disagree, and because the collision it guards against is detectable once, at declaration, rather than at every call site.

**Entering the executor on every response by default, with joining as the opt-in** — considered, not chosen. It is the more flexible default and needs no override. It also makes every multi-service handler concurrency-sensitive by default, and the failure mode is a partially-processed execution rather than an error. The safe behaviour is the one that should require no decision.

**Merging into `in_flight_event_map` on emission rather than rebuilding it** — considered, not chosen. It would prevent a response being abandoned under the override. It would also let a collection span rounds and outlive the emission that created it, so "what is this execution waiting for" would no longer have a single answer. One rule that is occasionally lossy is preferred to a rule that is always ambiguous, and the loss is documented.

**Reporting a handler failure as a fault rather than as an event** — considered, not chosen. It would let a mechanism retry application failures uniformly. It would also make a handler's failure invisible to the caller that is waiting for it, which contradicts ADR-000's *Event-Only Communication*: the caller's continuation depends on an event arriving, and a failure it never hears about is a workflow that stalls.

**Keeping the revision outside the record, as purely a mechanism's concern** — considered, not chosen. It keeps a storage concern out of a model-level format. But the handler is the only party that knows a write has occurred, and a mechanism that must invent its own revision cannot check it against what the handler intended. Putting it in the record makes incrementing it part of the handler's defined behaviour rather than a convention a mechanism supplies.

**Defining cancellation as a model primitive — a derived cancel event on every contract, mirroring the handler error** — considered, not chosen. It is the only shape that would work event-natively, and it fits the machinery: `in_flight_event_map` already names exactly the children an execution would need to cancel, so propagation down the tree would need nothing new. It was rejected on cost against demand. It makes the handler error no longer the single standardized emit ADR-005 deliberately kept it as, it adds a third classification case every implementation and every handler must then handle, and it makes cancellation a thing a node can have done *to* it — a meaningful shift in what a participant is, for a capability most handlers never use.

Note what was and was not avoided. The terminal `cancelled` lifecycle exists either way, because a record should say why an execution ended under either design; that was never the expensive part. What the cooperative form avoids is the inbound event, the classification case, and a participant losing the property that nothing external stops it.

**Defining a migration path for an execution record, so a version could be removed without draining** — considered, not chosen. It is the obvious answer to the operational cost above, and every durable-execution system eventually grows one. It cannot be built on ADR-005's foundation: per-version isolation means there is no compatibility relation between two versions to migrate along, so any mapping would be one an implementation invented, applied to state whose meaning only the original executor knows. An honest prohibition is better than a mechanism that silently reinterprets state, and draining is a cost a deployment can see and plan for.

**Requiring a specific concurrency mechanism, such as a named locking or transaction strategy** — considered, not chosen. It would make the guarantee concrete and testable. It would also make this ADR the first to require a particular infrastructure capability by name, which ADR-000 is explicit about avoiding. Stating the obligation and leaving the mechanism free preserves that.

## Conformance to ADR-000

**Effect on AAM.** This ADR amends the AAM membership list in three ways. It replaces *"handler interfaces and lifecycle semantics"* with the declaration model, execution identity, execution record, classification, collection, and failure categories defined above. It adds the execution record's field names as a durable format, for the same reason ADR-005 placed the canonical contract form inside the model: durable data outlives the code that wrote it, and a record that means different things in two languages is not one model. And it decides ADR-000's Deferred Decision on **cancellation, interruption, and compensation**, whose membership was undetermined until decided, by splitting it. *Interruption* — one node stopping another — is placed outside the model and Arvo defines nothing for it. *Compensation* is likewise outside: it happens through events a contract already permits, and needs no primitive. What is inside is narrow and only what a durable record requires: a terminal `cancelled` lifecycle, and `lifecycle_description` to say why. The hook under **Cancellation** reads an application's own signal and is not itself a model concept.

**Invariants depended on.** *Event-Only Communication* — every interaction here, including a handler's own failure, is an ArvoEvent governed by a contract. *Explicit Contracts and Runtime Validation* — the closed capability set and the record's validation both rest on a contract being a complete, checkable declaration. *Infrastructure Independence* — the handler reaches no store and names no transport. *Nondeterminism Is Permitted* — nothing here requires an executor to be deterministic; recovery republishes what was committed rather than recomputing it.

**Invariants strained.** *Open Composition* is addressed rather than strained, but only because of how the depth guard is shaped, so it is worth stating why. ADR-000 holds that "Arvo imposes no architectural limit on composition depth" and that practical limits belong to the selected infrastructure. The guard under **Depth** is not such a limit: it constrains nothing about the `depth` field, applies to what one handler is willing to emit rather than to what the model permits, and its maximum is a version's own choice which may be set arbitrarily high. Two handlers in one workflow may hold different limits, which an architectural limit could not tolerate. What it adds is a default — 1000 — where previously an author had to notice the risk themselves, and a default is not a constraint.

*Infrastructure Independence*, mildly and deliberately. **Required of infrastructure adapters** below places five hard obligations on any mechanism, which is a stronger demand than any prior ADR makes. The strain is contained: the obligations are stated as properties, not implementations, and ADR-000's *Downstream ADR Requirements* already anticipates that a downstream ADR states what it requires of adapters.

**Required of infrastructure adapters.** Five obligations. The first and fifth are not sufficient alone — see below.

1. **The emitted events and the next execution record MUST be preserved together.** A mechanism that publishes events but loses the record, or commits the record but drops the events, produces an execution whose own history describes traffic that never happened, and no handler-side behaviour can repair that from the inside.
2. **An init delivery MUST NOT be dispatched where a record already exists for it.** The mechanism resolves the record first, computing the identifier from the init event by the rule in **Execution identity**. This is what makes a redelivered init resolve to its existing execution instead of reaching the handler as a fault.
3. **A record whose retries are exhausted MUST be marked `failure`.** Where a mechanism gives up on a retry-safe fault, it writes `failure` and the failure's message to the record itself. Without this an abandoned execution is indistinguishable from one still waiting, and nothing else is in a position to write it — the handler was never reached.
4. **Every retry MUST re-read the record.** A retry is a new delivery, not a replay of a failed one. Re-dispatching a record fetched before the failed attempt computes from state that may have advanced in between — which, with obligation 5 in place, cannot commit, and without it silently overwrites. Only the attempt number carries forward.
5. **Writes to one execution record MUST be serialized.** Two responses arriving concurrently otherwise read the same record and write disjoint entries, and the later write erases the earlier — leaving an execution awaiting a response it already received.

Optimistic concurrency satisfies the fifth, and `cas_version` exists so it can. It is a good fit here: concurrent responses write different keys of the collection, so the contention is an artefact of storing one record rather than a semantic conflict, and a loser can simply redo its work. Where a response lands on an incomplete collection the executor is never entered, so a failed write has no side effect to undo. Where a response completes the collection, two writers can each believe they completed it and each enter the executor — which the first obligation resolves, since the loser's events and record fail to commit as one unit and nothing is published. This is why those two are stated together.

**Left deferred.** How to bound fan-out, given that hydration is eager and its cost scales with the size of `in_flight_event_map` — a cap, lazy restoration, or something else. Whether the `contracts` snapshot should be compared against the live contract at entry as a drift warning; it is free to do and would surface "this execution began under a contract that has since changed" at the moment it matters, but it is not decided here and nothing may enforce against the snapshot in the meantime. The conditions under which a handler routes a failure to the workflow root, which ADR-001 deferred here and this ADR does not settle. Timers, deadlines, and any bound on how long an execution may rest at `waiting`. Execution capability profiles as a format, including how a handler would declare the five obligations above rather than have an ADR assert them. Error kinds beyond handler failure. Whether emitted event identifiers should be derived rather than freshly generated — unnecessary given the first adapter obligation, and available as defence in depth if a later decision wants it.


## Appendix: An illustrative handler surface

These sketches are illustrative only. They do not define the protocol and they are not a specification of any language's API — per ADR-004, API shape is each language's own choice. They exist to make the rules above concrete by showing them together, in a notation belonging to no language. Where prose and a sketch ever appear to disagree, the prose governs.

**Declaring a handler.**

```
handler
    self       com_order_create                     the contract this handler implements
    services                                         declared once, for the handler
        payments   com_payment_charge @ 1.0.0       a contract it may send to
                                                    at most one version per contract

    version 1.0.0
        state                                       optional; omit for a stateless version
            order_id   string
            attempts   integer
        options                                     all optional
            maxRetryAttempts     5                  default 3
            retryDelay           f(event, state) → 200 × attempt   default 300ms
            handlerErrorDomain   "orders_failures"  default: no domain
            collect              all                all | each; default all
            maxDepth             250                default 1000
            onMaxDepthViolation  event              error | event | f({ctx, violation}); default event
        execute(ctx) → [ event, ... ]

    version 1.2.0
        execute(ctx) → [ event, ... ]               stateless: the executor alone
```

**Inside an executor.** `ctx.entry` discriminates `ctx.triggeringEvent`, so a payload is only reachable once the case is settled.

```
execute(ctx):

    ctx.span                the execution's own trace, to record against
    ctx.entry               init | followup
    ctx.initEvent           the event that opened this execution
    ctx.triggeringEvent     what caused this delivery
                              entry = init      → the init event
                              entry = followup  → one of: a service's outputs,
                                                  or a service's handler error event
    ctx.dependencies        as resolved for this delivery
    ctx.attempt             which attempt this delivery is
    ctx.isMaxExecutionDepth true when an emission could no longer increment depth
    ctx.collected           for collect = each: which responses are in, which outstanding

    ctx.state               present only where the version declared a schema
    ctx.initState(value)    first write
    ctx.setState(partial)   subsequent writes

    ctx.createOutput(
        type        one of: a service's input type
                          | a key of this version's outputs
                          | this version's handler error type
        data        checked against whichever schema that type selects
        domain      optional; a value, or a source to resolve one from
        executionunits optional
        dangerously_set   optional; everything else, with the consequences
                          in "What an executor may set"
    ) → event

    ctx.setCancel(description)   terminal; still answer your caller

    ctx.fault(description, retrySafe)   raise an execution fault
                                        retrySafe defaults to true

    return [ ... ]          emitted; [] emits nothing and preserves the collection
```

**What the mechanism calls.** The handler is entered once per delivery and holds nothing between them.

```
tryExecute(
    event          the delivered event
    state          the execution record, or nothing on an init delivery
    dependencies   a value, or a factory
    attempt        which attempt this delivery is
)
    → produced { events, state }         includes the case where the executor failed
                                          and the handler error event is among the events
    → discarded                           a duplicate; nothing to do, nothing wrong
    → fault    { retrySafe, retry, description }
                                          never an event; nothing was produced
                                          retry: the figures under Retry, or null
```

The asymmetry in that return is the failure model in one place. A handler failure comes back as `produced`, because it is a completed execution that happens to have emitted an error event. Only a fault comes back as `fault`, and only a fault is a mechanism's problem.
