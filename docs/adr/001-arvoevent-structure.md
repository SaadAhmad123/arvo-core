# ADR-001: ArvoEvent Structure

- **Status:** Proposed
- **Date:** 2026-07-31
- **Scope:** Arvo ecosystem
- **Amends:** AAM 1 membership (ADR-000)

Conformance language is as defined in [ADR-000](./000-arvo-system-identity-and-architectural-principles.md).

## Scope

This ADR defines the fields of an ArvoEvent: their types, defaults, structural constraints, semantics including how each is intended to propagate, and the reasoning for each.

It does not define handler behaviour. How `executionid` is derived, how an incoming event is classified, which value a handler places in a field when it emits, how `depth` is assigned, and how failures are routed belong to the handler protocol ADR.

It does not define contract validation of `data`. This ADR defines structural validity — that an event is well formed. Whether an event's payload satisfies the schema its `dataschema` names is a separate check performed at handler trust boundaries, and belongs to the contract and handler protocol ADRs.

It does not define the CloudEvent transformation, nor deserialization. ADR-000 binds transformability to AAM 1; the transformation and the wire format are separate decisions.

Once accepted, this structure changes only by a superseding ADR. It is not amended in place.

## Context

The event is the only artifact every participant in an Arvo application shares. A handler sees it, a human task queue sees it, an external system's boundary proxy sees it, every infrastructure adapter carries it, and every observability pipeline reads it. ADR-000 makes it the sole medium of inter-node interaction, which means the event structure is the highest-leverage decision in the model: a field that is missing cannot be worked around at the application layer, and a field that is wrong is carried by everything.

Production use of earlier versions surfaced a specific class of problem. Coordination concerns — which workflow is this, which execution does it belong to, what answers what — were being reconstructed from fields that were never meant to carry them, or smuggled through payloads. The structure below separates those concerns into distinct fields rather than overloading a small set.

The structure is also deliberately broad. Carrying a field that goes unused costs a null on the wire; needing a field that does not exist costs a workaround, and in an event system a workaround means overloading a field that meant something else or smuggling the value through `data` — the failure described above. Because this structure changes only by a superseding ADR, those two costs are not symmetric, and the design favours the cheaper error. It is not an attempt to enumerate every field an Arvo application will ever want, but a refusal to constrain the envelope to what is knowable today.

Breadth is applied in two tiers. Fields exist for concerns whose shape is knowable even where their content is not: `category`, `domain`, and `executionunits` are slots with deliberately thin semantics, reserved so that meaning can arrive later without a new envelope. `extensions` and `baggage` absorb what cannot be named in advance at all, which is what keeps the approach from requiring foresight it cannot have. The constraints placed on those open fields — flat, scalar-only, size-bounded, written once — limit depth and volume rather than expressiveness, so that a generous field does not become a second payload channel.

## Decision

An ArvoEvent has the following fields and no others.

| Field | Type | Required | Default |
|---|---|---|---|
| `id` | `string` | yes | generated UUIDv7 |
| `parentid` | `string \| null` | no | `null` |
| `initid` | `string \| null` | no | `null` |
| `subject` | `string` | yes | — |
| `executionid` | `string` | yes | `subject` |
| `category` | `string \| null` | no | `null` |
| `depth` | `number` | no | `0` |
| `source` | `string` | yes | — |
| `to` | `string \| null` | no | `null` |
| `domain` | `string \| null` | no | `null` |
| `type` | `string` | yes | — |
| `data` | `JSONRecord` | yes | — |
| `dataschema` | `string` | yes | — |
| `extensions` | `Record<string, JSONPrimitive>` | no | `{}` |
| `baggage` | `Record<string, JSONPrimitive>` | no | `{}` |
| `time` | `string` | yes | now |
| `traceparent` | `string \| null` | no | `null` |
| `tracestate` | `string \| null` | no | `null` |
| `executionunits` | `number \| null` | no | `null` |

An event constructed with only the required fields and all defaults is a well-formed root event.

### Identity and causal lineage

**`id`** identifies this event and serves as its deduplication key. ADR-000 requires applications to tolerate duplicate and replayed delivery; `id` is what makes that tolerable, so a producer MUST NOT reuse an identifier. Uniqueness is a producer obligation and a probabilistic property of the identifier, not something the ecosystem can prove.

`id` is a UUIDv7. Version 7 embeds a millisecond timestamp, which gives approximate chronological ordering and index locality — useful for lineage reconstruction, storage layout, and debugging. It establishes no causal, delivery, or strict creation order: identifiers minted within the same millisecond, on different hosts, or across a clock adjustment may sort arbitrarily among themselves. Ordering by `id` is best effort and MUST NOT be relied on for correctness.

**`parentid`** is the `id` of the event that directly caused this one. One hop, no more. It is `null` on a root event and non-null everywhere else.

**`initid`** is the `id` of the init event that opened the execution this event completes. It exists because `parentid` cannot answer the same question.

A handler that receives a request, emits a downstream event, suspends, resumes on a response, and then completes produces a completion whose `parentid` is the response it last received — not the request it is answering. `parentid` tracks construction causality, which is correct and useful, but it degrades to noise across suspension boundaries. `initid` survives arbitrarily many suspensions.

This matters concretely when a caller has several requests outstanding to the same downstream handler. Every completion returns carrying the caller's `executionid`, so execution identity cannot disambiguate them, and `parentid` will not either. `initid` is the only field that answers *which request is this the answer to*.

`initid` is non-null exactly when `category === 'io.arvo.complete'`. The relationship is biconditional: a completion without it defeats the reason the field exists, and a non-completion carrying it presents a correlation that means nothing.

### Workflow and execution identity

**`subject`** identifies the workflow. It is minted once on the root event and carried unchanged across every event in that workflow, at every hop and every depth. It is the query key: give me everything that happened in this business process.

`subject` is deliberately inert. It does not change, it encodes nothing, and nothing is derived from it by inspection. Earlier designs chained subjects to carry coordination state, which made the field simultaneously the workflow key and the coordination mechanism, and it served neither well. Those are now separate fields.

**`executionid`** identifies a specific durable, resumable execution of a handler. It is what allows a redelivered trigger to resolve to the same execution rather than forking a new one, and a multi-step handler to resume under the identity it started with.

At the event layer `executionid` is an opaque non-empty string. How it is derived, when it is derived versus reused, and which value an emitted event carries are handler protocol concerns.

On a root event, `executionid` equals `subject`. One value is minted and serves as both the workflow identifier and the root execution's identity; every descendant execution derives from that pair transitively.

`executionid === subject` does not by itself mean an event is root. The root execution's own outbound events also carry it, at depth 1 and with a non-null `parentid`. Rootness is the conjunction defined under **Structural validity**.

**`depth`** is the event's stack depth within its workflow — `0` on a root event, `1` or greater otherwise. It exists for operational comprehension: ADR-000 imposes no architectural limit on composition depth, which makes runaway or unexpectedly deep nesting an operational risk rather than a structural impossibility, and `depth` is what makes it visible without traversing the graph.

How `depth` is assigned is an implementation concern and is not decided here.

### Classification

**`category`** carries the event's execution role. Two values are recognized across the ecosystem:

- `'io.arvo.init'` — this event is intended to trigger a new execution.
- `'io.arvo.complete'` — this event is the final response of an execution.

The field is an open string rather than a closed enum, so a domain may classify events for its own purposes without the model growing a value for each one. Arvo does not interpret those values, and as of this ADR any value other than the two above — including `null` — carries no ecosystem meaning.

Arvo's own values are namespaced under `io.arvo.` and Arvo will only ever use that namespace. This puts the burden of avoiding collisions on Arvo rather than on every domain that uses the field: a domain may choose any value that is not `io.arvo.`-prefixed and be safe against every category Arvo adds in future. Collisions between two domains are those domains' concern; Arvo makes no claim over the rest of the value space.

Beyond being a non-empty string or `null`, `category` is structurally unvalidated. Which values are legitimate for a given event, and who is permitted to set them, are contract and handler protocol concerns.

### Routing

**`source`** identifies the producer of the event. It is required so that every event records where it came from. Its format is unconstrained, so what `source` establishes is only as strong as the convention a deployment adopts.

**`to`** names the intended recipient. It is always carried, including across a boundary between processing lattices.

**`domain`** marks an event that cannot be fulfilled within the lattice currently holding it. `null` — the default and the ordinary case — means the event belongs where it is. A non-null value, set by the emitter, means the event must be lifted out and fulfilled elsewhere: by a human participant, an external system, or a separate Arvo deployment.

The value is relative to the lattice reading it, not a global address. Inside any lattice, ordinary traffic carries `domain: null`; a non-null `domain` exists only while an event is in transit across a boundary.

Events are immutable, so a boundary does not rewrite `domain`. It consumes the event it lifted out and emits a new one carrying `domain: null` into the destination lattice, and the same on the return path. The original event is preserved as the record of what crossed. Adapters never mutate a field.

Both fields are hints the application supplies to infrastructure. ADR-000 makes routing an infrastructure responsibility, so this ADR requires only that they be carried unchanged where an event is carried at all. What a boundary does — including how it tracks an event it lifted out and correlates the result back — is outside AAM.

### Payload

**`type`** names the event. It is the lookup key from which a receiving participant resolves behaviour.

**`data`** is the event's payload: contract-typed and JSON-serializable. JSON-serializability is required rather than preferred, because ADR-000's first claim is that no participant is second-class. A human task queue, a foreign system, or a service someone stands up in an afternoon must be able to produce and consume events without codegen, a schema registry, or a shared runtime. Any heavier encoding makes participation conditional on adopting Arvo's toolchain.

**`dataschema`** identifies the exact contract URI and version this event relates to. It is required and non-null.

`type` and `dataschema` support each other. `dataschema` locates the agreement — which contract, at which version. `type` names which of that contract version's declared events this one is. Neither is sufficient alone: `type` is version-blind, since participants running different versions of the same contract emit identical `type` values, and ADR-000's premise of independently deployed participants makes that skew normal rather than exceptional. Contract validation needs both — the contract version to know which schemas apply, and the type to know which of them this event must satisfy. Both are Arvo identifiers and are self-identifying only within the Arvo ecosystem; they name an Arvo contract, not a shape an arbitrary external reader can resolve.

`dataschema` is required because there is no legitimate class of ArvoEvent that lacks a contract. Every inter-node interaction is contract-governed, so an event that could not name its contract version could not be validated by any receiver, and version skew would become undetectable rather than merely awkward. Events from foreign systems enter through a boundary that declares a contract on their behalf; the boundary supplies the value.

### Open metadata

Two open maps exist, and they are not interchangeable. Both are flat and scalar-only. Nesting is prohibited so that a reader can consume either without knowing its shape, and so that neither becomes an untyped alternative to `data`.

**`extensions`** describes this event to systems outside Arvo. It is scoped to the single event and set by its producer; it is not propagated to events derived from this one. Keys MUST NOT collide with the name of any known ArvoEvent field.

**`baggage`** carries ambient context for an entire workflow. It is written exactly once, on the root event, and carried unchanged by every event in that workflow. Handlers read it. No handler may add a key, remove a key, or change a value.

Write-once at the root is what makes baggage genuinely workflow-global rather than merely inherited. Because there is only one writer, every event in the workflow carries an identical map, no two branches can diverge, no fan-in requires a merge rule, and no collision is possible. Its size is fixed when the workflow begins and cannot grow.

The restriction also selects for the right content. A root minter — an API gateway, a scheduler, a webhook receiver — knows ambient request context: tenant, actor, locale, a correlation token to a foreign system, a feature flag set. It cannot know anything computed later in the workflow. So baggage carries what is true of the whole workflow from the outset, and anything a handler discovers travels through a contract instead.

That is deliberate rather than an inconvenience. When a downstream node needs a value an upstream node produced, it has a real dependency on that node's output, and a contract is where such a dependency belongs — declared, versioned, and validated. Baggage previously allowed that coupling to remain invisible.

### Observability

**`time`** is the RFC 3339 timestamp of when the event occurred, with a UTC offset. It is descriptive, not authoritative: ADR-000 assumes delayed, reordered, and replayed delivery, so `time` MUST NOT be used to establish ordering.

**`traceparent`** and **`tracestate`** carry W3C Trace Context. They are set explicitly by whoever creates the event, or derived from a span at creation. They are never populated automatically and never synthesized by an adapter. Automatic population produced trace context that looked authoritative while being wrong, which is worse than absent trace context.

Because these fields claim W3C semantics, they are held to W3C's syntax. `traceparent`, when non-null, MUST match the W3C `traceparent` form. `tracestate` MUST be `null` when `traceparent` is `null`, since W3C defines it as a companion and a standalone `tracestate` cannot be interpreted. `tracestate` content is otherwise opaque: it is deliberately vendor-extensible, and validating it would couple this structure to vendor conventions for no gain. Rejecting a malformed `traceparent` follows the same reasoning as refusing to auto-populate it — trace context that looks authoritative while being wrong is the failure being avoided.

ADR-000 requires the model to preserve correlation, causation, lineage, and trace context. `subject` provides correlation, `parentid` and `initid` provide causation, `executionid` provides lineage, `depth` measures it, and these two fields provide trace context.

### Accounting

**`executionunits`** is an opaque numeric value whose meaning is defined entirely by the emitting handler and its domain. Arvo carries it and interprets it in no way. It is not a measure of compute, resource consumption, or infrastructure cost, and this ADR places no constraint on its sign or magnitude beyond finiteness.

## Structural validity

The rules below define whether an ArvoEvent is well formed. They are properties of a single event, checkable without a contract, a store, or another event.

An `ArvoEvent` value is structurally valid by construction: an instance cannot exist unless these rules hold, so nothing that already holds one needs to recheck it. The same rules apply wherever an event enters a system as data rather than as an instance — deserialization from the wire, a replay tool, a fixture, a foreign producer's output. Where and how deserialization applies them is the wire-format ADR's concern; that they apply is settled here.

Contract validation is separate and is not defined here. Whether `data` satisfies the schema named by `dataschema` requires the contract, and is performed at handler trust boundaries — on entry and again on emission — per the contract and handler protocol ADRs.

**Required:** `id`, `subject`, `executionid`, `source`, `type`, `data`, `dataschema`, `time`.

**Non-empty:** `id`, `subject`, `executionid`, `source`, `type`, `dataschema`, and — when not `null` — `parentid`, `initid`, `category`, `to`, `domain`, `traceparent`, `tracestate`.

**Typed:** `id` is a UUIDv7. `depth` is a non-negative integer. `time` is RFC 3339 with an offset. `traceparent`, when non-null, matches the W3C `traceparent` form.

**JSON validity.** Every numeric value anywhere in an event MUST be finite: `NaN`, `Infinity`, and `-Infinity` are rejected, because none round-trips as a JSON number. This applies to `executionunits`, to values in `baggage` and `extensions`, and to numbers at any depth within `data`.

`data` is a JSON record, defined recursively: a string-keyed object whose values are JSON values, where a JSON value is a finite number, a string, a boolean, `null`, an array of JSON values, or a JSON record. Structural validity is defined by that domain rather than by whether a particular serializer happens not to throw.

`baggage` and `extensions` are flat records whose values are a finite number, a string, a boolean, or `null`.

**Root conjunction.** A root event is one where all three of the following hold:

```
executionid === subject     &&     parentid === null     &&     depth === 0
```

Either `depth === 0` or `parentid === null` is sufficient to make an event root, so if either holds, all three MUST hold. `executionid === subject` is necessary but not sufficient — the root execution's own outbound events carry it at depth 1 with a non-null `parentid` — so it does not on its own trigger the requirement.

**Correlation:** `initid` is non-null if and only if `category === 'io.arvo.complete'`.

**Trace companionship:** `tracestate` is `null` whenever `traceparent` is `null`.

**Collision:** no key in `extensions` may equal the name of a known ArvoEvent field.

**Size:** the serialized size of `baggage` SHOULD NOT exceed 8192 bytes, a recommendation rather than a hard limit. Any binding limit depends on transformation and transport constraints and is decided in the CloudEvent transformation ADR.

## Consequences

**Gained.** Coordination concerns are separated into distinct fields rather than overloaded onto `subject`, so each can be reasoned about and validated independently. An event carries enough to reconstruct correlation, causation, and lineage without consulting any store. `initid` makes concurrent requests to the same downstream handler distinguishable, which `parentid` alone cannot do, and the biconditional means a completion always carries it. A required `dataschema` makes contract version skew detectable rather than silent, and leaves no class of event that cannot be validated. Write-once baggage is genuinely workflow-global: identical on every event, immune to branch divergence, with no merge rule to define and no collision to debug. UUIDv7 ids give approximate chronological ordering and index locality for free.

**Paid for.** Breadth is bought rather than free. Every field is something a cross-language implementer must implement and every reader must understand, and a field with deliberately thin semantics becomes somewhere to put things. That discipline can be recommended here and cannot be enforced here. Identity is spread across five fields — `subject`, `executionid`, `parentid`, `initid`, `depth` — which can therefore disagree; only the root conjunction and the `initid` correlation are checked, so a structurally valid event can still be incoherent. Several fields carry meaning this ADR cannot enforce: `executionid` is opaque, `category` is unconstrained beyond shape, and `depth`'s assignment is defined elsewhere, so structural validity proves form rather than sense. Write-once baggage removes a capability that was being used: a handler that discovers something downstream nodes need must now thread it through contracts, which is more work in exchange for the coupling being declared. And a required `dataschema` means every producer, including a boundary standing in for a foreign system, must know which contract version it is speaking.

Factory methods and sensible defaults answer much of this for participants using Arvo's tooling: derived identity fields cannot drift from one another, `category` is assigned rather than chosen, and an author supplies a handful of fields rather than nineteen. That mitigation stops at the tooling boundary. ADR-000 deliberately invites participants that do not have it — cross-language implementations, external systems behind a proxy, replay tools, hand-written fixtures — and for those, the rules defined here check form rather than coherence. They will accept an event whose `depth` contradicts its `executionid`, or one whose `initid` names an event that never existed.

## Conformance to ADR-000

**Effect on AAM.** This ADR amends the AAM membership list, replacing the entry *"ArvoEvent identities, data, and CloudEvent transformability"* with the nineteen fields enumerated above, together with their types, structural constraints, and defaults. Every field is inside the model: an adapter MUST carry all of them unchanged and MUST NOT synthesize, mutate, or drop any. CloudEvent transformability remains a member as ADR-000 established it; this ADR does not touch it.

What remains outside the model: the routing behaviour an adapter or boundary derives from `to` and `domain`, and the meaning of the value carried in `executionunits`.

**Invariants depended on.** *Event-Only Communication* — the event is the sole medium, which is why the field set must be sufficient on its own. *Explicit Contracts and Runtime Validation* — a required `dataschema` is what makes contract validation possible at a trust boundary. *Observability by Default* — the correlation, causation, lineage, and trace context fields. *Nondeterminism Is Permitted* — nothing in the structure assumes deterministic production.

**Invariants strained.** None. `baggage` was considered against *Explicit Contracts and Runtime Validation*, since it carries data no contract types. Write-once-at-the-root settles it: no handler can place anything in baggage, so it carries ambient context established before any node ran rather than application data flowing between nodes. That places it alongside `source` and `time` — untyped by contracts, fixed by the event's origin — rather than alongside `data`.

**Required of infrastructure adapters.** Carry every field unchanged. Do not synthesize, mutate, or drop any field, and in particular do not populate `traceparent` or `tracestate`. A boundary that moves an event between lattices consumes it and emits a new event rather than editing the one it received. Do not depend on `time` or on `id` ordering for correctness.

**Left deferred.** `executionid` derivation. Event classification and who may set `category`. `depth` assignment. Field propagation from a received event to an emitted one. Failure event routing. Contract validation of `data`, and the trust boundaries at which it occurs. Deserialization and wire format. CloudEvent transformation, including any binding limit on `baggage` size. Ordering guarantees.
