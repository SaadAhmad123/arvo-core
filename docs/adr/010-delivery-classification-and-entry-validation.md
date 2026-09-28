# ADR-010: Delivery Classification and Entry Validation

- **Status:** Proposed
- **Date:** 2026-09-28
- **Scope:** Arvo ecosystem
- **Amends:** nothing in the AAM membership list; refines the handler lifecycle semantics [ADR-006](./006-arvoeventhandler-protocol.md) places inside the model
- **Supplies:** the incoming-event classification and the `category` check that [ADR-001](./001-arvoevent-structure.md) leaves to "the handler protocol ADR"
- **Depends on:** [ADR-006](./006-arvoeventhandler-protocol.md), which defines the handler, its declaration and options, its execution context, and the mechanism obligations; [ADR-007](./007-execution-record.md), which defines the record the gate reads and validates; [ADR-008](./008-execution-faults-and-abandonment.md), which defines every fault the gate raises; [ADR-009](./009-execution-bounds.md), which defines the bounds the gate enforces on entry
- **Left deferred:** nothing of its own; see the companions

Conformance language is as defined in [ADR-000](./000-arvo-system-identity-and-architectural-principles.md).

## Scope

### What this ADR defines

This ADR defines what happens between an event arriving at a handler and business code running: how the delivery is **classified** as an init or a followup, how the existing execution is **resolved** through the state function, and the **gate** — sixteen ordered checks every delivery MUST pass, each with its fault, whether it short-circuits, and whether a retry could change its outcome. It closes with the whole of one delivery in order, from receipt to return, so that an implementation assembles the sequence from the specification rather than from inference.

It is one of five ADRs that together specify the ArvoEventHandler protocol. [ADR-006](./006-arvoeventhandler-protocol.md) defines the handler, its declaration, options, execution context, identity, addressing, observability, dependencies and cancellation, and what the handler requires of the mechanism that runs it. [ADR-007](./007-execution-record.md) defines the execution record the gate reads. [ADR-008](./008-execution-faults-and-abandonment.md) defines the faults the gate raises. [ADR-009](./009-execution-bounds.md) defines the bounds the gate enforces. The five were written as one and split for size; where one refers to a heading in another, the reference names the ADR.

### What this ADR deliberately does not define

- **What any fault means to a mechanism.** The gate names the fault; [ADR-008](./008-execution-faults-and-abandonment.md) defines the object, its retry verdict and what a mechanism may do with it.
- **The record's shape.** Step 5 validates it; [ADR-007](./007-execution-record.md) defines it.
- **The bounds.** Steps 8 and 11 enforce depth and the execution timeout; [ADR-009](./009-execution-bounds.md) defines both.

### How this ADR changes

Once accepted, this changes only by a superseding ADR. The gate's order is normative: a step added later goes where its preconditions place it, and every step after it renumbers, which is why the companions refer to steps by number and this ADR is the only one that assigns them.

## Context

ADR-001 made `dataschema` required on every event so that version skew "becomes detectable rather than silent", defined `category` as the sender's statement of an event's role, and left to the handler protocol how a receiver classifies an event and performs the `category` check. ADR-006 defines a handler as a stateless operation that holds nothing between deliveries and reaches no store, given a state function by the mechanism that runs it. Everything a handler knows about a delivery it must therefore establish from the event and from what the state function returns, in an order where no check reads a value a prior check has not yet established is safe to read. That order is this ADR.

## Decision

### Classification

#### Init or followup, nothing else

Every delivery is either an **init** — opening a new execution — or a **followup**, resuming one. There is no third outcome and no unclassified pass-through: a delivery that cannot be classified is a fault (`event_unclassifiable`). Classification is a property of the delivery, not of the execution, and MUST NOT be confused with the record's `lifecycle`, which records where an execution rests ([ADR-007](./007-execution-record.md), **The execution record**).

This settles the second of the three things ADR-001 left to this ADR — "how it classifies an incoming event" — and the `category` check ADR-001 assigned here.

#### `dataschema` decides it

**`dataschema` decides classification.** ADR-005 fixes `dataschema` as `{uri}/{version}`, and the `uri` names the contract that governs the event. A `uri` matching the self contract is an init; one matching a declared service contract is a followup; one matching neither is a fault. This is read from a field ADR-001 requires on every event, ADR-002 constrains the format of, and ADR-005 gives a fixed shape — not inferred from `type`, which ADR-005 makes version-independent and not globally unique, and not from the presence or absence of a record, which is a separate check (**Entry validation**, step 4).

**One overlap, and one tie-break.** Where the handler declares its self contract as a service ([ADR-006](./006-arvoeventhandler-protocol.md), **The self contract may be a service**), a `uri` matching the self contract matches both a self and a service declaration, and `dataschema` cannot finish the job. For that `uri` only, the handler reads the event's `type`: **the self contract's input `type` classifies the delivery as an init; one of its `outputs` keys or its handler error type classifies it as a followup**; any other `type` is `event_unclassifiable`. This is unambiguous because ADR-005 forbids the input `type` from matching either of the other two. It is a tie-break and not a second rule: `type` is consulted only where `dataschema` names a contract that is both, and `category` keeps its role as a cross-check at step 2 in every case.

How the `uri` and version are split, and how the version is checked in each case, is under **Resolution, and which executor runs**.

#### `category` cross-checks it

**`category` cross-checks classification.** ADR-001 reserves `io.arvo.init` and `io.arvo.complete` and says a producer sets them "through contract event factories rather than handler or application code", so where one is present it states the sender's own contractual intent. It MUST agree with what classification decided: **`io.arvo.init` on a delivery classified as an init, `io.arvo.complete` on one classified as a followup.** The check is about the event's role, not about which contract it names — under recursion the same contract is both self and service, and the role is still one or the other.

A disagreement is a non-retryable fault (`category_mismatch`) — the same event would disagree however often it were redelivered — and catching it is the point. It means two independently deployed participants have diverged about what they are doing — a sender that believes it is completing something a receiver believes it is opening — which ADR-001 wants "detectable rather than silent". Any other value, including absence, carries no ecosystem meaning per ADR-001 and is not consulted. `category` never decides classification on its own; it can only confirm or contradict what `dataschema` already decided.

#### Resolving the existing execution

A delivery reaches the handler as an event and a **state function**. The mechanism does not hand over a record; it hands over the means to fetch one, and the handler decides what to fetch.

**The state function.** The mechanism MUST supply, alongside the event, an operation that takes an `execution_id` and yields the record stored under it, or nothing where none is. It may take time and may fail, since a store is behind it; how a language expresses that — a promise, a future, a coroutine, a blocking call — is that language's own choice (ADR-004). What is fixed is the input — one `execution_id`, together with the delivery's telemetry ([ADR-006](./006-arvoeventhandler-protocol.md), **Observability**) so the read is logged and traced as part of this delivery, and the delivery's attempt number ([ADR-009](./009-execution-bounds.md), **Retry**) so the mechanism knows whether this read is the first or a retry of one that already failed; the output, a record or its absence; and the rules below. Telemetry and attempt are read-only context for the mechanism to record against and to tune its own read by — a longer timeout, a different replica — not information that changes which record it returns.

The mechanism behind it validates nothing beyond parsing: what it yields MUST be absence or a parsed JSON object, and whether that object is a record, belongs to this event, or is still resumable is the handler's to judge (**Entry validation**, steps 4, 5 and 12). It MUST read the store on every call rather than yield a value captured earlier, which is what makes a retry re-read the record by construction ([ADR-009](./009-execution-bounds.md), **Retry**). It MUST NOT be given the event or the classification, and it MUST NOT branch on anything but the key.

**The handler chooses the key.** It is the only party that knows which delivery this is, so it is the only party that can. After classification (**`dataschema` decides it**) and before any gate step that reads the record, the handler calls the state function exactly once:

| Delivery | Key passed |
|---|---|
| init | the `execution_id` derived from the event by the rule under [ADR-006](./006-arvoeventhandler-protocol.md), **Execution identity** |
| followup | the event's own `executionid`, which a completion carries as its caller's identity — this handler's own `execution_id` |

This is why the mechanism need know nothing about init and followup, and why a store shared by several handlers causes no confusion: the handler always asks for its own key.

**The handler judges the result, and the two cases are strict.**

| Delivery | The record MUST be | Otherwise |
|---|---|---|
| init | `null` | non-retryable fault, `record_unexpected` |
| followup | present | non-retryable fault, `record_expected` |

A record under an init's derived key means an execution with this identifier already exists, and a redelivered init MUST NOT open a second one. A followup with no record names an execution this handler has no memory of; the only ways to arrive here are a record that was never committed, which obligation 1 rules out, or one that was deleted, which is a deployment's own doing. Neither is repaired by redelivery, which is why both are non-retryable. Both are checked at gate step 4.

**A failing state function is a retry-safe fault.** Where the operation fails, however the language signals it, the handler MUST NOT catch and reinterpret it. The failure surfaces as an execution fault of kind `state_resolution_failed`, retry safe, because a store that is unreachable now may be reachable a moment later. It is, with dependency resolution ([ADR-006](./006-arvoeventhandler-protocol.md), **Dependencies**), one of only two entry-path faults whose outcome may legitimately differ on retry, and for the same reason: both reach outside the handler.

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
| 6 | followups | **The record's version is still declared.** The handler MUST still declare an executor for `state.version`; a version withdrawn from a deployed handler strands its in-flight executions ([ADR-007](./007-execution-record.md), **Version authority**), and this is where that surfaces. The fault carries the abandonment event, and its `handler_error_domain` resolves with the version side unset — the version is gone — so the handler's value applies ([ADR-006](./006-arvoeventhandler-protocol.md), **Options**). | fault, `version_not_declared` | yes | no |
| 7 | followups | **`data` satisfies the owning version's schema.** Validated against the schema the version confirmed at step 6 declares — placed here, and not at step 5, because that schema cannot be chosen until the version is known and confirmed ([ADR-007](./007-execution-record.md), **Hydration**). Where the version declares no schema, `data` MUST be `null`. | fault, `record_invalid` | yes | no |
| 8 | every delivery | **The event is below the version's maximum depth.** `event.depth < max depth` for the version resolution selected — the event's on an init, the record's on a followup ([ADR-009](./009-execution-bounds.md), **Depth**). Placed here because it is the first point at which that version is known and confirmed declared. | fault, `max_depth_event_received` | yes | no |
| 9 | followups | **Already seen.** The delivered event's `id` is already in `event_ids` as `received`, so this delivery has been processed. | discard | yes | n/a |
| 10 | followups | **Lifecycle admits the delivery.** A record at `success`, `error`, `cancelled` or `failure` accepts nothing further. A record at `waiting` or `idle` accepts a followup. | fault, `lifecycle_terminal` | yes | no |
| 11 | every delivery | **The execution has not outlived its execution timeout.** Where the version sets one, the time from the init event's `time` — the delivered event's on an init, `state.init_event`'s on a followup — to now is below it ([ADR-009](./009-execution-bounds.md), **Timeouts**). Where the version sets none, this step passes. Placed after the lifecycle check so that a late event reaching a finished execution is refused for its lifecycle, not abandoned for time; and before the checks on the event itself, because an execution past its bound has nothing further to do with the event whatever it carries. | fault, `execution_timeout` | yes | no |
| 12 | `event.to` on every delivery; the rest on followups | **Record, handler and event agree.** `event.to == handler's self contract type`; and on a followup `state.source == handler's self contract type`, `state.execution_id == event.executionid`, `state.subject == event.subject`. `to` is authoritative, so an event carrying none is invalid here. | fault, `event_unaddressed` or `addressing_mismatch` | no — all applicable comparisons are reported together | no |
| 13 | every delivery | **The type is one the resolved contract can send here.** For the self contract, its own `type`. For a service contract, one of that version's `outputs` or its handler error type. | fault, `type_not_receivable` | yes | no |
| 14 | every delivery | **Payload satisfies its schema**, as declared by the contract and version step 1 resolved. | fault, `event_schema_rejected` | no | no |
| 15 | followups | **Awaited.** The response's `initid` names a key of `in_flight_event_map` whose value is still outstanding. | fault, `response_unawaited` | yes | no |
| 16 | every delivery | **Dependencies resolve.** Where a factory was supplied, it is called exactly once with the delivered event, the hydrated record or absence, and the attempt number, and yields the executor's dependencies ([ADR-006](./006-arvoeventhandler-protocol.md), **Dependencies**). Last, because it is the one step that reaches outside the handler and it should not be paid for a delivery any earlier step refuses. | fault, `dependency_resolution_failed` | yes | **yes** |

An init delivery has no record, so the steps that read one do not apply to it — which is most of what the **applies to** column records. Only step 12 is split: `event.to` is on the event and is checked either way, while the three comparisons against the record are followups only.

#### Three ways out: proceed, discard, fault

A delivery leaves the gate one of three ways. **Proceed**: every applicable step passed, the execution context is built ([ADR-006](./006-arvoeventhandler-protocol.md), **The execution context**), and the executor is entered — or, under the default join, the response is recorded and the delivery ends without entering it ([ADR-009](./009-execution-bounds.md), **Collection**). **Discard**: step 9 recognised a duplicate; nothing is written and nothing is raised. **Fault**: a step failed, and an execution fault is raised carrying every check that failed ([ADR-008](./008-execution-faults-and-abandonment.md), **Failure protocol**).

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

Inside the executor code, the developer can leverage two values the protocol already guarantees as idempotency keys. The delivered event's `id` is globally unique (ADR-001) and identical on every retry of the same delivery, so it keys a side effect that must happen once per delivery. The execution's `execution_id` is derived deterministically ([ADR-006](./006-arvoeventhandler-protocol.md), **Execution identity**) and identical on every delivery to the same execution, so it keys a side effect that must happen once per execution. Both are on the execution context ([ADR-006](./006-arvoeventhandler-protocol.md), **The execution context**). An executor that keys its external writes on one of them has a stable idempotency key on every repeat; whether that yields exactly-once effects depends on the external system honouring the key, which is outside the protocol and the executor's to verify.

#### What the gate asks of a mechanism

Because the handler fetches the record itself under a key it chooses, a mechanism need not classify, derive, or compare anything before dispatch. What the gate asks is that the state function answer honestly (**Resolving the existing execution**), and that a redelivered init find the record its first delivery wrote — which follows from committing the record durably under `execution_id` (obligation 1) and nothing else. A redelivered init then fetches a record at step 3 and faults at step 4 with `record_unexpected`, and a mechanism MAY treat that kind as a signal to stop redelivering rather than as an error to escalate.

### One delivery, in order

Every rule in this ADR and its companions applies at a definite point inside one delivery. The points are listed here in the order they occur, so that an implementation assembles the sequence from the specification rather than from inference. Each step is defined where the reference says; this list adds only the order.

1. **Receive.** The mechanism hands the handler the delivered event, the state function, dependencies as a value or a factory, the attempt number, the delivery's OpenTelemetry context, and hooks or an empty object (**Required of infrastructure adapters**).
2. **Open the delivery span**, continuing the delivered event's trace ([ADR-006](./006-arvoeventhandler-protocol.md), **Observability**). Everything after this records against it.
3. **Run the gate**, steps 1 through 16 in sequence (**Entry validation**). Dependency resolution is its last step, so nothing outside the handler is reached for a delivery an earlier step refuses. A fault at any step ends the delivery at step 10 below; a discard at step 8 ends it with nothing to do.
4. **Resolve every option** for the version the gate confirmed ([ADR-006](./006-arvoeventhandler-protocol.md), **Options**). Before step 6 of the gate only the handler level was available; from here the version's declarations apply.
5. **Build the execution context** for this delivery and nothing else ([ADR-006](./006-arvoeventhandler-protocol.md), **The execution context**).
6. **Start the run clock and enter the executor** ([ADR-009](./009-execution-bounds.md), **Timeouts**). Nothing before this step is timed by it.
7. **On return, stop the run clock.** Where it expired, evaluate the execution clock before reporting, so the broader verdict wins ([ADR-009](./009-execution-bounds.md), **Where both expire in one attempt**). Where the executor returned in time, evaluate the execution clock anyway, since a return after the bound is a fault at return.
8. **Validate everything returned**, whole: each event's type, schema, depth and structure; the batch's composition; the value written through `set state` against the declared schema and for a JSON round trip ([ADR-006](./006-arvoeventhandler-protocol.md), **What an executor returns**; [ADR-007](./007-execution-record.md), **A mixed batch completes**). A failure anywhere rejects the batch.
9. **Build the outputs.** On success, the emitted events and the next record, `cas_version` set, lifecycle decided by the batch ([ADR-007](./007-execution-record.md), **The execution record**). On a fault at any step above, the fault with its contingencies — the abandonment event where the caller can be addressed, the record at `failure` where one exists or can be built ([ADR-008](./008-execution-faults-and-abandonment.md), **Abandonment**).
10. **Record the outcome on the span and return** the produced pair, the discard, or the fault to the mechanism ([ADR-006](./006-arvoeventhandler-protocol.md), **Instrumenting the protocol itself**). The handler retains nothing.

Two things the order settles that are otherwise stated only in passing: the run clock covers the executor alone, because it starts at step 6 and stops at step 7 with the gate — dependency resolution included — and return validation outside it; and a version's options are never consulted before step 4, because until the gate has confirmed the version there is no version to consult.

## Consequences

### Gained

**Resumption is one keyed read, and the mechanism needs to understand nothing.** The state function takes `execution_id` and returns what is under it. A mechanism does not classify, does not derive, does not know what a record is, and never authors one. Everything it stores and forwards was built by the handler, so the model's data has one author everywhere.

**Every refusal has a name and a place.** Sixteen steps, each with one fault kind, mean a mechanism reading a fault knows which precondition failed without parsing a message, and a test suite has one case per row.

### Paid for

**The gate is paid on every delivery.** Sixteen checks, a record fetch, hydration of every stored event, and dependency resolution run before any business code, including on a delivery step 8 will discard. The ADR chooses that so a corrupt record or a misrouted event fails once, at entry, with its cause named.

## Considered Alternatives

### Having the mechanism classify the delivery and resolve the record

Considered, not chosen. A draft had the mechanism read `dataschema`, decide init from followup, derive or read the key, and hand the handler a record or nothing. It removes a call from the handler's entry path. It also puts classification — the first and most consequential step of the gate — in code this ADR does not govern, so a mechanism that got it wrong would hand the handler a plausible record for the wrong execution, and the handler's every later check would be validating the wrong thing. The state function (**Resolving the existing execution**) keeps the mechanism classification-blind: it receives a key and returns what is under it, and every judgement about what came back is the handler's.

### Checking the delivered event before fetching the record

Considered, not chosen. Steps 12 through 15 compare the event against the handler and the record, and could run before the fetch at step 3 for the parts that need no record. It would refuse a mis-addressed event without a store round trip. It was rejected because the comparisons that need the record and those that do not would then be split across two places in the sequence, and a fault at step 12 would sometimes have a record in hand and sometimes not, which the abandonment rules under [ADR-008](./008-execution-faults-and-abandonment.md) would have to distinguish. One fetch, one place where every comparison runs, and a uniform answer to what a fault carries.

## Conformance to ADR-000

### Effect on AAM

This ADR adds nothing to the AAM membership list. It refines "handler interfaces and lifecycle semantics", which ADR-006 already places inside the model, with the classification and the gate.

### Invariants depended on

- **Explicit Contracts and Runtime Validation.** Every step is a runtime check against a contract, a record, or a value derived from one; none trusts a type.
- **Infrastructure Independence.** The gate reaches the store only through the state function the mechanism supplies, and asks nothing else of it.

### Invariants strained

None beyond those ADR-006 records.

### Required of infrastructure adapters

Nothing beyond ADR-006's five obligations. Obligation 2, the state function answered live, is the one step 3 depends on.

### Left deferred

Nothing of its own. Delivery ordering across executions is deferred under **Left deferred**.
