# ADR-007: Execution Record

- **Status:** Accepted
- **Date:** 2026-09-28
- **Scope:** Arvo ecosystem
- **Amends:** AAM 1 membership (ADR-000) — places the execution record's field names inside the model as a durable format
- **Depends on:** [ADR-006](./006-arvoeventhandler-protocol.md), which defines the handler this record belongs to, the gate that validates it, and the mechanism obligations that preserve it
- **Addresses, in part:** ADR-000 Deferred Decisions — "Handler state serialization, persistence, migration, and recovery" (settled here, migration by prohibiting it)
- **Left deferred:** a bound on fan-out. See **Left deferred**
- **Amended by:** **Addendum 1 — the `contracts` snapshot is removed**, at the end of this ADR. The field table and **`contracts` is informational only** below describe the record as originally accepted; read them with that addendum.

Conformance language is as defined in [ADR-000](./000-arvo-system-identity-and-architectural-principles.md).

## Scope

### What this ADR defines

This ADR defines the **execution record**: the one durable object that is an execution's entire memory between deliveries. It fixes the record's fields and their types, the lifecycle values an execution rests at and how each is reached, the format version the envelope carries, how the record may change in later ADRs, the compare-and-swap counter a mechanism serializes writes with, which contract version owns a record for its whole life, and how a stored record is validated and restored to live values on the next delivery.

It is one of five ADRs that together specify the ArvoEventHandler protocol. [ADR-010](./010-delivery-classification-and-entry-validation.md) defines how a delivery is classified and the gate it passes. [ADR-006](./006-arvoeventhandler-protocol.md) defines the handler, its declaration, its execution context, how an incoming event is classified and gated, and what the handler requires of the mechanism that runs it. [ADR-008](./008-execution-faults-and-abandonment.md) defines the two failure categories and the fault object. [ADR-009](./009-execution-bounds.md) defines the execution bounds — depth, retry, timeouts and collection — whose effects this record stores. The five were written as one and split for size; where one refers to a heading in another, the reference names the ADR.

### What this ADR deliberately does not define

- **Any storage technology.** A mechanism stores and returns this record; how is its own (ADR-006, **Required of infrastructure adapters**).
- **Migration of a record between versions.** Decided against, not deferred (**A record belongs to one version for its whole life**).
- **Rules for how a version's state schema may change.** The schema is the version author's; this ADR states the one obligation and the consequence (**Changing a deployed version's state schema**).

### How this ADR changes

Once accepted, this record changes only by a superseding ADR, and its field names are pinned more tightly than the rest: any change reinterprets data already in a store. The rules under **How this record may change later** say what a later ADR may add without superseding this one.

## Context

ADR-000 forbids relying on any live implementation dependency across a suspension and forbids a handler requiring a continuously running process while awaiting events. A handler that emits an event and later continues therefore reconstructs its continuation from durable data. That data has to have one shape everywhere, because a record written by one language MUST be readable by another (ADR-004), and something has to guarantee it survives between deliveries. The shape is this ADR; the guarantee is ADR-006's first adapter obligation.

ADR-006 settles what a handler is and how a delivery reaches its executor; every delivery after the first reads this record at gate step 3 and validates it at steps 5 through 7. Nothing in ADR-006 defines the record's contents, and nothing here defines the gate — each refers to the other.

## Decision

### The execution record

#### One record, representable as JSON

An execution's entire memory is one record. It MUST be representable as JSON, so that no mechanism has to understand any language's object model to store it, and it MUST carry the fields below under these names. The **Type** column gives each field's JSON shape, and is as normative as the names: a record whose field holds a value of another shape is `record_invalid` at gate step 5. The names are normative — the record is a durable format, and a record written by one language MUST be readable by another (ADR-004). A mechanism stores and returns it; it never authors one ([ADR-010](./010-delivery-classification-and-entry-validation.md), **Resolving the existing execution**).

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
| `cas_version` | integer ≥ 0 | Non-negative integer. **`0` on the first record of an execution**, the one an init delivery produces; on every later record, **exactly one greater than the record the delivery read**, including the `abandonment_state` a fault prepares against being given up on ([ADR-008](./008-execution-faults-and-abandonment.md), **Abandonment**). A mechanism commits records but never authors one, so it never sets or increments this itself. Exists so a mechanism can compare-and-swap (**Required of infrastructure adapters**, obligation 5). |
| `lifecycle` | `idle` \| `waiting` \| `success` \| `error` \| `cancelled` \| `failure` | `idle`, `waiting`, `success`, `error`, `cancelled`, or `failure`. |
| `lifecycle_description` | string \| `null` | Free text explaining how the execution reached its current `lifecycle`, or `null`. |
| `event_ids` | array of `{ id: string, direction: "received" \| "emitted" }` | Every event the execution has touched, each as an `id` and a `direction` of `received` or `emitted`, relative to this handler. |
| `init_event_id` | string | The `id` of the init event. |
| `init_event_source` | string | The `source` of the init event — the caller a completion returns to. |
| `init_event` | ArvoEvent as JSON; materialized as an ArvoEvent during hydration | The event that began the execution. |
| `triggering_event` | ArvoEvent as JSON; materialized as an ArvoEvent during hydration | The event that caused the most recent delivery. |
| `in_flight_event_map` | object: emitted event `id` string → ArvoEvent as JSON \| `null`; each non-null value materialized as an ArvoEvent during hydration | Keyed by the `id` of each event emitted to a service in the current round. The value is the collected response, or `null` while outstanding — the key MUST be present either way, because the key set is what the execution is waiting for. |
| ~~`contracts`~~ | ~~object: `{ self: canonical contract, services: canonical contract[] }`~~ | **Removed by Addendum 1.** As accepted: the handler's `self` and `services` contracts, in their canonical form (ADR-005), carried for a reader's benefit only. |
| `data` | JSON value \| `null`; validated against this version's declared schema during hydration | The executor's own business state, governed by the schema that executor declared, or `null` where none is declared or nothing has been written. |

`execution_id` identifies a record uniquely and `subject` groups the records of one workflow; a mechanism MAY use them as its record and grouping keys, and both are inside the record so that it is self-describing.

#### `direction`: received or emitted

`direction` is `received` or `emitted` rather than `input` or `output`, deliberately. Those two words already name something else in this model — ADR-005's declared shapes, and a version's `outputs` — and a service's reply is `received` here while being that service's output. Two axes sharing a vocabulary is how a reader ends up confidently wrong.

#### `contracts` is informational only

**Withdrawn by Addendum 1, which removes the field.** What follows is the reasoning as accepted, kept because the addendum argues against it.

`contracts` is informational by construction, and an implementation MUST NOT resolve, bind, or validate against it. It exists so that a record found in a store years later can be understood without the code that wrote it, which is the same reason the identifying fields are inside the record rather than only in the keys. A reader should be aware it is a snapshot: a contract that has since changed will not match a live one, and that discrepancy carries no meaning at execution time. Whether it should be compared against the live contract as a drift warning is left deferred (**Left deferred**).

#### `lifecycle`: where an execution rests

`lifecycle` records where an execution **rests**, not how it was entered. How a delivery was classified is a property of that delivery ([ADR-010](./010-delivery-classification-and-entry-validation.md), **Classification**) and MUST NOT be conflated with this field.

#### The six lifecycle values

| Value | Terminal | When an execution rests here |
|---|---|---|
| `idle` | no | Alive, with nothing outstanding and nothing completed. |
| `waiting` | no | One or more responses are outstanding. |
| `success` | yes | An own `outputs` event was emitted, whether alone or alongside service emissions in the same batch (**A mixed batch completes**); or, for a version with empty `outputs` in a handler with no service contracts, the executor returned nothing (**A sink version completes by returning nothing**). |
| `error` | yes | The handler error event was emitted because the executor failed. |
| `cancelled` | yes | The executor marked the execution cancelled and returned an own `outputs` event. |
| `failure` | yes | The mechanism abandoned the execution after a fault, and committed the record the handler prepared for that ([ADR-008](./008-execution-faults-and-abandonment.md), **Abandonment**). |

A terminal record accepts no further delivery ([ADR-010](./010-delivery-classification-and-entry-validation.md), **Entry validation**, step 10). `failure` is the one value no handler reaches under its own steam: a fault writes no record, so only the mechanism, acting on the fault's `abandonment_state`, can put an execution there ([ADR-009](./009-execution-bounds.md), **Retry**).

#### Marking an execution `cancelled`

**An executor MUST be able to mark its own execution `cancelled`**, through the **cancel** member of the execution context ([ADR-006](./006-arvoeventhandler-protocol.md), **The execution context**), and doing so is terminal. It is how a cooperative wind-down records *why* an execution ended rather than leaving it indistinguishable from an ordinary completion ([ADR-006](./006-arvoeventhandler-protocol.md), **Cancellation**).

Marking cancelled does not excuse an execution from answering its caller. Cancelling is a reason to stop, not a way out of the protocol, and the protocol never lets a cancel end in silence of the handler's making. The three ways a cancelling executor can leave are decided as follows:

| The executor marks cancelled and… | The handler |
|---|---|
| returns an own-`outputs` event, alone or with service emissions | emits everything; the record rests at `cancelled`, with the executor's reason in `lifecycle_description`. An explicit statement of why an execution ended outranks what is inferred from what it emitted. Service emissions beside the completion are the compensating work [ADR-006](./006-arvoeventhandler-protocol.md), **Cancellation** describes — a refund, a release, a notification — sent fire-and-forget, exactly as in any mixed batch (**A mixed batch completes**): the execution is finished when it answers, and their responses will find a terminal record. |
| returns nothing, or only service emissions | raises a non-retryable execution fault, `execution_cancelled`. Nothing is emitted and no record is written by the handler. The fault carries the handler error event and the record at `failure` as its abandonment pair ([ADR-008](./008-execution-faults-and-abandonment.md), **Abandonment**), with the executor's reason in the fault's `message` and the record's `lifecycle_description`, so a mechanism that abandons can tell the caller and record why. Service emissions without a completion are refused because they would leave the execution at `waiting` for responses a cancelled execution has no business processing, with the caller still unanswered. It is the missing answer that is refused, not the compensation. |
| throws | the throw wins: the handler error event is emitted and the record rests at `error`, because a failure after a cancellation is still a failure and the caller should hear it as one. |

An implementation SHOULD make the first row the easy path. The second exists so that a developer who forgets to answer is caught by the protocol rather than by a caller that waits forever, and it uses no machinery the fault does not already have. One consequence follows: the `cancelled` lifecycle appears in a store only where the execution also answered its caller. An execution that cancelled without answering rests at `failure`, with its reason preserved in `lifecycle_description`, where the mechanism abandons it, and stays as the fault found it where the mechanism does something else.

#### `lifecycle_description`

`lifecycle_description` carries free text explaining how the execution reached its `lifecycle`, and is `null` wherever nothing explains it — which is every `idle`, `waiting` and `success`. It is populated on `cancelled`, with whatever reason the executor gives; on `error`, with the executor's failure message; and on `failure`, with the message of the fault the mechanism gave up on. It is diagnostic only: nothing in the protocol reads it, and no behaviour may depend on its contents.

#### Emitting nothing: `waiting` or `idle`

**An executor that returns nothing rests at `waiting` or `idle`, depending on what is still outstanding** ([ADR-006](./006-arvoeventhandler-protocol.md), **What an executor returns**). Returning nothing says only "no new events"; it does not say the execution has nothing to wait for. Under the per-version override that enters the executor on each response ([ADR-009](./009-execution-bounds.md), **Collection**), returning nothing on a partial collection is the ordinary case — responses remain outstanding, so the execution stays at `waiting`. Where nothing is outstanding and nothing terminal was emitted, it rests at `idle` — except for a sink version, which rests at `success` (below).

#### A mixed batch completes

A batch may carry service emissions and an own `outputs` event together, and the rule for it is simple: **every event in the batch is emitted, and the execution rests terminal.** The lifecycle a batch produces depends only on whether a completion is among its events:

| The batch carries | The execution rests at |
|---|---|
| service emissions only | `waiting`, with each recorded in `in_flight_event_map` ([ADR-009](./009-execution-bounds.md), **Collection**) |
| one own `outputs` event only | `success` — or `cancelled`, where the executor marked it so |
| service emissions and one own `outputs` event | `success` — or `cancelled` — and the service emissions are emitted and recorded exactly as in the first row |
| nothing | `waiting`, `idle`, or `success` for a sink version (**Emitting nothing: `waiting` or `idle`**) |
| more than one own `outputs` event | nothing; the batch is a fault, `emission_not_permitted` ([ADR-006](./006-arvoeventhandler-protocol.md), **What an executor returns**) |

The completion wins because it is what the caller is waiting for, and the caller awaits exactly one answer to its request. An execution that has answered is finished, whatever else it set in motion on the way out. The service emissions are not suppressed and not deferred: an executor that answers its caller and in the same batch asks a service to do something has said, in one decision, "here is my answer, and also start this" — and both halves are honoured.

**The consequence is that the service's response has nowhere to go.** It arrives carrying this execution's identity, finds a record at `success`, and is refused at gate step 10 as `lifecycle_terminal`, a fault whose abandonment pair is `null` by rule ([ADR-008](./008-execution-faults-and-abandonment.md), **`lifecycle_terminal` yields neither**). The mechanism handles it as it handles any fault it will not retry. This is accepted, not accidental: a completing execution that emits to a service is emitting fire-and-forget work, and an implementation SHOULD say so where the pattern is likely to be met, because an author who expected to process that response has misunderstood what completing means. An executor that needs the response completes *after* it arrives, not alongside asking for it.

#### A sink version completes by returning nothing

There is one version shape for which returning nothing is the only possible completion: a version whose `outputs` is empty — which ADR-005 permits — belonging to a handler that declares no service contracts. Such a version's executor can legitimately return nothing at all: no own output exists to return, and no service exists to call. It does its work by side effect and is done.

For that shape, and only that shape, an executor returning nothing MUST rest the execution at `success`, not `idle`. The two conditions are both required: with a service declared, the executor could have called it; with an output declared, it could have answered. Where either is present, returning nothing means the executor had a choice and did not take it, and `idle` is the correct and honest state.

The caller receives no completion event, but the contract said so in advance by declaring no outputs, and the handler error event remains available so that failure still reaches it. The condition is a property of the declaration, so an implementation can determine it once, at declaration time, and need not re-derive it per delivery.

#### `idle` is legal and almost always a defect

Outside the sink shape above, `idle` is named for the state rather than for how it was reached, because it can be reached two ways: an executor that returned nothing on the delivery that created the execution, and one that returned nothing after its last response came in. Both leave an execution that is alive, waiting for nothing, and finished with nothing — so nothing will ever deliver to it again and it rests there forever. It is a legal state, it is almost always a defect, and an implementation SHOULD make it visible rather than silent: on the delivery span ([ADR-006](./006-arvoeventhandler-protocol.md), **Observability**), and in whatever protocol-level metrics it publishes. Because the sink shape rests at `success` instead, `idle` is reachable only where the executor had something it could have returned, which is what makes it a reliable defect signal.

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

After the first delivery, the record is the only place the handler's own version survives — a followup response's `dataschema` names the *service's* contract and version, not this handler's. That is why a followup's executor is chosen by `state.version` ([ADR-010](./010-delivery-classification-and-entry-validation.md), **Resolution, and which executor runs**), and why the record's version must still be one the handler declares ([ADR-010](./010-delivery-classification-and-entry-validation.md), **Entry validation**, step 6). If it is not, the delivery is a fault and the execution is not resumed.

#### A record belongs to one version for its whole life

**An execution record belongs to one contract version for its whole life.** It MUST NOT be resumed under another version, and it MUST NOT be migrated to one. This is not a conservative default awaiting a better answer; it follows from ADR-005, where each version is fully isolated and "no two versions are ever compatible by construction". A migration would need a defined mapping from one version's state to another's, and isolation is precisely the statement that no such mapping exists — a `data` shape is governed by the schema its own executor declared, and a neighbouring version's schema has no claim on it. Silently running one version's executor over another version's state would corrupt an execution rather than report one.

#### Removing a version strands its executions

Removing a version from a deployed handler's self contract — and with it, under [ADR-006](./006-arvoeventhandler-protocol.md), **One executor per version**, its executor — therefore strands that version's in-flight executions, permanently. Each will fault at gate step 6 on its next delivery and, being non-retryable, will never be redelivered; whether it is then abandoned or held is the mechanism's policy, and either way it never resumes. A version is drained before it is removed, and that is the whole of the migration story.

#### Hydration

On a followup delivery, a handler MUST validate the whole record and MUST restore every event the record holds to an event value before any executor code runs. This happens in three consecutive steps of the gate ([ADR-010](./010-delivery-classification-and-entry-validation.md), **Entry validation**): step 5 validates the fixed envelope, hydrates the events, and checks the record against its own init event (**The record must agree with itself**), treating `data` as an opaque JSON value; step 6 confirms `state.version` is declared; step 7 validates `data` against that version's schema. The split exists because the schema for `data` is chosen by a field the gate cannot read until the envelope has passed. A record that fails any of it is a fault. Validating eagerly costs every stored event on every delivery; the ADR chooses that so a corrupt record fails once, at entry, with its cause named, rather than surfacing from inside business logic where it cannot be attributed.

#### The record must agree with itself

A record can be well-shaped and still contradict itself. Several of its fields are copies or derivations of values inside `init_event`, kept as their own fields so that addressing a completion never depends on restoring an event ([ADR-006](./006-arvoeventhandler-protocol.md), **`init_event_id` and `init_event_source`**). A copy that has diverged from its source misroutes the completion that is built from it, and a shape check cannot see that. So step 5, once the envelope has passed and `init_event` has been restored, MUST check that the record agrees with itself, and any disagreement is `record_invalid`:

| Field | MUST equal |
|---|---|
| `init_event_id` | `init_event.id` |
| `init_event_source` | `init_event.source` |
| `subject` | `init_event.subject` |
| `parent_execution_id` | `init_event.executionid` |
| `depth` | `init_event.depth` ([ADR-006](./006-arvoeventhandler-protocol.md), **Depth of this execution**) |
| `execution_id` | the derivation over `init_event.dataschema` and `init_event.id` ([ADR-006](./006-arvoeventhandler-protocol.md), **The derivation of `execution_id`**) |
| `source` | `init_event.to` — the self contract type the init was addressed to |
| `version` | the version named by `init_event.dataschema` |
| `event_ids` | contains `init_event.id` as `received` |
| `in_flight_event_map` | every key appears in `event_ids` as `emitted` |

These are the relationships this ADR itself defines, stated once at the point they are enforced. They are checked here rather than at step 12 because step 12 compares the record against the *delivered* event, and these compare the record against *its own* init event — a corrupt record should fail as corrupt, with that diagnosis, before it is compared against anything outside it. How an implementation performs the check is its own; that a disagreement is `record_invalid` is not.

#### The cost of eager hydration

**This is an accepted trade-off, and its cost scales with fan-out.** An execution awaiting a thousand responses restores a thousand events on each of them, and the record grows with the collection. Eager hydration is the rule regardless: a handler that reasons about a record it has only partly validated is worse than a handler that is slow. Nothing here bounds fan-out, and how to bound it — a cap, lazy restoration for entries an executor never reads, or something else — is left to a later decision rather than guessed at now (**Left deferred**).

#### Changing a deployed version's state schema

The state schema is enforced on every entry, at gate step 7, against the schema the version declares *today*. That creates an obligation the protocol cannot enforce for the author, and it is stated here so the consequence is not discovered in production.

**Once a version has been deployed and has records in a store, any change to its declared state schema MUST be compatible with the `data` those records already hold.** That is the whole of the obligation. The schema is the version author's, not the protocol's — the protocol validates `data` against it and does nothing else with it — so *how* compatibility is kept is the author's affair, and this ADR places no rule on it. The rules the record envelope holds itself to under **How this record may change later** are one way to keep it and are offered as such, not imposed.

The consequence of breaking them is exact. Every in-flight execution of that version fails step 7 on its next delivery with `record_invalid`, which is non-retryable, so none is ever redelivered, and a mechanism that abandons them tells each caller the work will not be done. Nothing can rescue them: migration is prohibited (**A record belongs to one version for its whole life**).

A change the author cannot make compatibly is a new version. It is declared alongside the old one, the old one is drained, and then the old one is removed — the same story as any other version change, and the only one the protocol supports.

#### Serializability of `data`

A handler MUST verify that `data` survives a JSON round trip when an executor returns, and report a non-retryable fault (`state_not_serializable`) if it does not. This is the executor author's obligation and cannot be prevented by a declared schema, which will not catch a native date or class instance passed through a permissive schema position. Checking at return keeps the failure attributable to the executor that caused it, and it is part of return validation alongside the checks on returned events ([ADR-006](./006-arvoeventhandler-protocol.md), **What an executor returns**).

The schema at `data` is the version author's, not the protocol's. The protocol validates stored `data` against whatever that schema declares at the time of a delivery, and nothing more. Keeping a change to that schema safe for the `data` already in a store, after the handler's first production deployment, is therefore the author's responsibility, and this ADR places no rule on how it is done.

## Consequences

### Gained

**Records and faults are durable formats, readable across languages.** Both carry normative field names and survive JSON, and the record carries its own format version. A record written by one implementation is resumed by another, a fault dead-lettered by one is read by another, and a future change to either has a defined place to announce itself.

### Paid for

**Eager hydration costs every stored event on every delivery.** A handler awaiting many responses pays that repeatedly, and the ADR chooses it so that a corrupt record fails once at entry with its cause named.

**Removing a version strands its executions, by design.** There is no migration path, so deployment acquires a drain step it did not previously have, and an operator who skips it leaves every in-flight execution of that version unresumable, faulting non-retryably on its next delivery, to be abandoned or held as the mechanism's policy decides.

**A state schema, once deployed, is a contract with the store.** Its author must keep every change compatible with the `data` already written, or take the same drain-and-remove path as any other breaking change. The protocol cannot check this for them.

## Considered Alternatives

### Keeping the revision outside the record

Considered, not chosen. It keeps a storage concern out of a model-level format. But the handler is the only party that knows a write has occurred, and a mechanism that must invent its own revision cannot check it against what the handler intended. Putting `cas_version` in the record makes incrementing it part of the handler's defined behaviour rather than a convention a mechanism supplies (**`cas_version`**).

### Defining a migration path for an execution record

Considered, not chosen. It is the obvious answer to the drain cost under **Paid for**, and every durable-execution system eventually grows one. It cannot be built on ADR-005's foundation: per-version isolation means there is no compatibility relation between two versions to migrate along, so any mapping would be one an implementation invented, applied to state whose meaning only the original executor knows. An honest prohibition is better than a mechanism that silently reinterprets state, and draining is a cost a deployment can see and plan for (**A record belongs to one version for its whole life**).

### Defining compatibility rules for a version's state schema

Considered, not chosen. A draft wrote a rule set for how `data`'s schema may change after deployment — which fields may be added, which constraints tightened — mirroring the rules the record envelope holds itself to. It was withdrawn because the schema is the version author's, not the protocol's: the protocol composes it into validation and does nothing else with it, and a rule set it cannot enforce would be advice dressed as a requirement. What remains is the one fact the protocol can state, that an incompatible change fails every in-flight execution at gate step 7, and the one obligation that follows from it (**Changing a deployed version's state schema**).

## Conformance to ADR-000

### Effect on AAM

This ADR places one durable format inside the model: the execution record's field names and types. ADR-005 placed the canonical contract form inside the model for the reason that applies here — durable data outlives the code that wrote it, and a record that means different things in two languages is not one model (ADR-004). The terminal `cancelled` lifecycle and `lifecycle_description` are the inside-the-model half of the cancellation decision ADR-006 records (ADR-006, **Effect on AAM**).

### Invariants depended on

- **Infrastructure Independence.** The record is JSON and names no store. A mechanism commits it and returns it, and every requirement on that is stated as a behaviour in ADR-006.
- **Explicit Contracts and Runtime Validation.** The record is validated on every followup delivery, against a fixed envelope and the owning version's declared schema, at runtime.
- **Nondeterminism Is Permitted.** Nothing here requires an executor to be deterministic; a record is what was committed, never what would be recomputed.

### Invariants strained

None beyond those ADR-006 records. The record is a format, and a format strains no invariant.

### Required of infrastructure adapters

Nothing beyond ADR-006's five obligations, three of which concern this record directly: obligation 1 preserves it with the events it accompanies, obligation 2 supplies the function that reads it, and obligation 5 serializes writes to it through `cas_version`.

### Left deferred

- **A bound on fan-out**, given that hydration is eager and its cost scales with `in_flight_event_map` — a cap, lazy restoration, or something else (**Hydration**).
- ~~**Whether the `contracts` snapshot should be compared against the live contract**~~ — **withdrawn by Addendum 1**, which removes the snapshot. There is nothing left to compare.

## Addendum 1 — the `contracts` snapshot is removed

- **Status:** Accepted
- **Date:** 2026-10-01
- **Amends:** this ADR's **The fields**, **`contracts` is informational only**, and **Left deferred**

### What changes

**The record no longer carries `contracts`.** The field, the subsection permitting it as informational, and the deferred question of comparing it against the live contract are all withdrawn. Nothing replaces it.

`record_format_version` stays at its accepted value. The rule under **How this record may change later** that a field MUST NOT be removed exists because removal reinterprets records already in a store, and no such record exists: nothing is published, no deployment has written one, so there is no data for this to reinterpret. That is the whole of the exemption, and it expires the moment a record is stored anywhere. After that point this field cannot come back out, and nor can any other, without a MAJOR bump by a superseding ADR.

### Why

**Nothing reads it.** The field was informational by construction, and this ADR already forbade resolving, binding or validating against it. A field that no part of the protocol may consult is carried on every write of every execution for a reader who may never arrive.

**It is derivable.** A handler holds its own contracts, and a record names the contract and version it belongs to through `source` and `version`. A reader with the handler has the contracts; a reader without it has an ADR-005 canonical form whose meaning they cannot check against anything.

**It is the one field no delivery can check.** Every other field is judged as a record is built: the identifiers, both counts, the lifecycle, both version fields, the two events. The snapshot could not be, because there was nothing to judge it against — this ADR says outright that a snapshot not matching a live contract "carries no meaning at execution time". So a record carrying a wrong snapshot was indistinguishable from one carrying a right one, which makes it a field that can rot silently for the whole life of an execution.

**The purpose it was given is better served elsewhere.** Understanding a record years later without the code that wrote it is a real need, and `source` and `version` already name what to go and find. A contract's own durable form is ADR-005's business, and a deployment that wants its contracts kept for posterity should keep them once, where they are declared, rather than once per execution.

### What this does not change

The identifying fields stay inside the record rather than only in its keys, for the reason this ADR gives: a record found in a store must be understandable on its own terms. `source` and `version` are what carry that, and neither moves.

Nothing about hydration, the lifecycle values, `cas_version`, or version authority is touched. This addendum removes one informational field and withdraws one deferred question about it.
