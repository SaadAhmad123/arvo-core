# ADR-005: ArvoContract Structure

- **Status:** Proposed
- **Date:** 2026-08-07
- **Scope:** Arvo ecosystem
- **Amends:** AAM 1 membership (ADR-000)
- **Addresses, in part:** ADR-000 Deferred Decision — "ArvoContract structure, dependency declaration, event capabilities, resolution, and version compatibility" (structure and per-version isolation are settled here; dependency declaration, capability resolution, and binding remain deferred — see **Scope**)

Conformance language is as defined in [ADR-000](./000-arvo-system-identity-and-architectural-principles.md).

## Scope

This ADR defines what an ArvoContract *is*: its fields, their types and defaults, the versioning model, the grammar a contract may use for the identifiers it declares, the handler error convention every contract carries, and the canonical, language-independent representation every implementation must be able to produce and consume.

Several things are deliberately not defined here:

- **Error taxonomy beyond handler failure.** This ADR fixes the shape and naming of exactly one standardized emit — the handler error, covering a handler's own code failing or being unable to fulfill its contract. It does not define any other kind of error or its handling mechanism; that belongs to a dedicated, future error-handling ADR.
- **Handler and orchestration behavior.** How a handler declares which contracts it depends on, resolves and binds to a contract at runtime, or decides which permitted event to emit and when belongs to the handler-protocol ADR ADR-000 already names as a separate, dedicated decision. This ADR states what a contract permits; it does not state how a handler uses that permission.
- **Domain resolution.** `domain`, as a field on this contract, is a static default value only (see **Domain**). Any inheritance, override, or context-dependent resolution strategy — including anything resembling per-emission domain-routing logic — is handler-execution behavior, not contract structure, and is left to the handler-protocol ADR.
- **Automated compatibility checking.** This ADR states that each contract version is fully isolated (see **Versioning**). It does not define or mandate a tool that classifies a schema change as breaking or non-breaking; that remains implementation guidance, not an ADR-enforced mechanism.
- **Dereferencing `dataschema` at runtime.** `ArvoEvent.dataschema` is already constructed from a contract's `uri` and version (ADR-001). Whether that value is ever mechanically fetched to retrieve a live schema is a transport and tooling question for a later decision, not something this ADR commits to.

Once accepted, this structure changes only by a superseding ADR.

## Context

ADR-000 already treats **ArvoContract** as a first-class AAM concept — "a versioned capability and interface declaration describing the events a node accepts and emits... the boundary through which independently implemented participants compose" — and lists "ArvoContract identities, versions, and declared event capabilities" among the things that must remain consistent across every implementation. It also names "ArvoContract structure, dependency declaration, event capabilities, resolution, and version compatibility" as a Deferred Decision requiring its own ADR. Until now, nothing has settled the first half of that list.

Every implementation to date has defined a contract entirely as executable code native to one language: `accepts` and `emits` as that language's own schema-validation objects, embedded directly in source. That has never been separated from what a contract *is* — "the contract" and "a schema object in one specific validation library" have been the same thing. With more than one language implementation now governed by ADR-004, that conflation stops being incidental: an ADR that described ArvoContract in terms of any one language's validation library would be making that library a model requirement, exactly what ADR-000 says Arvo "avoids letting... become model requirements." This ADR separates the two — it defines what a contract structurally is, independent of any validation library, so that a contract authored in one language is the same contract when read in another.

## Decision

### One contract shape

There is exactly one ArvoContract structure. A naming convention that pre-fills part of this shape — for a simple request/response service, for an orchestrator's initialization/completion pair — is authoring sugar built on top of this shape, not a distinct kind of contract. No implementation is required to offer such presets, and none is standardized here.

### Canonical representation

An ArvoContract's canonical form is a plain object, representable as JSON, in which every schema-bearing position — a version's `accepts` and each entry in a version's `emits` — is expressed as [JSON Schema, 2020-12](https://json-schema.org/draft/2020-12) specifically, not as any language-specific validation library's native representation.

The handler error (see **Handler error**) is deliberately not one of these stored positions: its type, `dataschema`, and payload are each fully determined by `type` and the producing version, so every implementation computes it identically rather than storing a copy of something a fixed rule already determines.

The dialect is pinned, not left as "JSON Schema" generically, for the same reason ADR-002 and ADR-003 pin CloudEvents to 1.0.2 rather than to whatever CloudEvents says at a given time: dialects are not interchangeable. Draft-07 and 2020-12 differ in ways that change validation outcomes for the identical document — `$ref` alongside sibling keywords, `items`/`prefixItems`, `dependencies` versus `dependentSchemas` — so a canonical form produced by one language against 2020-12 and read by another assuming draft-07 can validate differently even when the JSON bytes are identical, defeating the sameness this canonical form exists to guarantee. Every schema-bearing position in the canonical form MUST declare `"$schema": "https://json-schema.org/draft/2020-12/schema"` explicitly, so a reader never has to assume a dialect it cannot verify. This ADR's meaning does not move if a future JSON Schema release changes dialect semantics; adopting a newer dialect requires a superseding ADR, the same discipline governing any other change here.

This is the form every language implementation MUST be able to produce from its own natively-authored contract, and MUST be able to construct a working contract object from, given a canonical form produced elsewhere — including one authored in a different language. A language's own idiomatic validation object — whatever native schema representation that language's own ecosystem favors — is a materialization of the canonical form for that language's own ergonomics. It is not the source of truth; the canonical JSON form is.

A machine-readable JSON Schema describing what a well-formed ArvoContract-as-JSON looks like — the shape of the container itself, not the `accepts`/`emits` schemas inside a particular contract — SHOULD be developed alongside this ADR's implementation and published, the same discipline [ADR-003](./003-arvoevent-cloudevent-transformation.md) already applies to the CloudEvent data-wrapper schema.

### Fields

| Field | Type | Required | Default |
|---|---|---|---|
| `uri` | string | yes | derived from `type` — see **URI** |
| `type` | string | yes | — |
| `versions` | object (semantic version → version definition) | yes | — |
| `description` | string or null | no | null |
| `domain` | string or null | no | null |
| `metadata` | object | no | empty |

A contract with only `type` and `versions` supplied, taking every other default, is well formed.

### `type`

The event type a handler bound to this contract accepts. The primary identity anchor: version-independent, so that participants running different versions of the same contract remain reachable under one stable name.

`uri` and version are deliberately not folded into `type` as a single combined string. `event.type` must stay usable for routing independent of which contract version a given participant currently implements — collapsing version into `type` would make every version bump also a routing change, which the field is specifically designed not to be.

### `uri`

Identifies this contract, forming the base of every `ArvoEvent.dataschema` this contract's versions produce (`{uri}/{version}`, per ADR-001). `uri` MUST be present as a concrete, resolved value in a contract's canonical form — it is never optional at the model level, whatever ergonomic omission a given language's authoring surface allows.

`uri` MUST be a valid RFC 3986 URI-reference, in the same canonical form ADR-002 already requires of `dataschema` — non-canonical percent-encoding, wrong case, or an unresolved dot-segment is rejected, not normalized. This is necessary, not merely consistent: `dataschema` is built by appending `/{version}` to `uri`, and ADR-002 already requires `dataschema` to be canonical, so `uri` must be canonical for that guarantee to hold on every event a contract's versions produce.

**Derivation.** When a language's authoring surface allows `uri` to be omitted, it MUST be derived from `type` by replacing **every** occurrence of `_` with `/`, then prepending `#/`:

```
uri = "#/" + (type with every "_" replaced by "/")
```

This is deliberately stated as "every occurrence," not as a call to a language's own `replace`-like function — `replace` alone is exactly the kind of notation that silently diverges between languages (some replace only the first match by default, some replace all), which is precisely the failure mode this algorithm exists to prevent. Given `com_payment_process`, the derived `uri` MUST be `#/com/payment/process` — every underscore becomes a slash, not just the first.

This is total and unambiguous given `type`'s own grammar (see **Contract-declared identifier grammar**): `type` contains no character other than `_`, lowercase letters, and digits, so replacing every `_` with `/` cannot collide with any other separator. Every language implementation offering this convenience MUST implement exactly this algorithm, so that the same `type` yields the same `uri` regardless of which language authored the contract. An explicitly supplied `uri` always wins over derivation and is stored as given, subject only to the canonical-form requirement above.

### `versions`

A map from semantic version string to a version definition:

| Field | Type | Required |
|---|---|---|
| `accepts` | schema | yes |
| `emits` | object (event type → schema) | yes |

Each key of `versions` MUST be a valid semantic version in `MAJOR.MINOR.PATCH` form.

**Isolation.** Each version is a complete, standalone contract. Nothing about version `1.1.0` is implied by, inherited from, or required to be compatible with version `1.0.0` — they coexist as entirely separate interfaces sharing only `uri`, `type`, `domain`, and `description`. A handler bound to this contract implements every declared version's `accepts`/`emits` fully and independently; nothing here defines partial or inherited implementation.

Isolation means semantic versioning's usual job — letting a consumer reason about compatibility from the number alone, the way a dependency range like `^1.2.0` does — has nothing to compute here: no two versions are ever compatible by construction, so no MAJOR/MINOR/PATCH boundary is more or less breaking than any other. The `MAJOR.MINOR.PATCH` shape is required anyway, for two narrower reasons: it gives every implementation the same well-defined total order for free, which version resolution needs; and it remains a familiar magnitude signal for a reader reading a version list, even though nothing here enforces that the signal is accurate. That last property is informational, not a guarantee this ADR makes or a rule an implementation checks.

**Totality of `emits`.** A version's `emits` MUST enumerate every event type a handler bound to it may produce for that version — there is no wildcard emission. ADR-000 already requires that "every event type [a handler] may emit must be permitted by its own contract or a declared dependency"; an `emits` that did not enumerate its possibilities exhaustively would make that requirement unenforceable.

### Contract-declared identifier grammar

`type`, every key of a version's `emits`, the generated handler error type (see **Handler error**), and `domain` (when not `null`) MUST match `^[0-9a-z_]+$` — non-empty, lowercase ASCII letters, digits, and the underscore only. Uppercase is excluded, not merely unneeded: allowing it would just relocate the same casing-inconsistency problem this grammar exists to remove — two contracts could otherwise name what's meant to be the same style of identifier `Com_Payment_Process` and `com_payment_process` and be silently different strings.

This is deliberately more restrictive than CloudEvents itself requires. A dotted identifier (`com.user.register`) is a natural CloudEvents `type` value but a poor one to use as a symbolic key — a state-machine transition name, a dispatch-table entry, a dict or object key — the way event-driven handlers, orchestrators, and agents routinely do. Every consumer that wants to use a contract-declared type value this way must otherwise sanitize or translate between dotted and identifier-safe form itself. Fixing the grammar once, at declaration time, removes the need for that translation layer to exist anywhere downstream.

This constrains only what an ArvoContract may declare. It does not alter `ArvoEvent.type`'s or `ArvoEvent.domain`'s own domain as ADR-001 and ADR-002 define them: an event from a foreign producer, adapted through the CloudEvent-transformation's foreign path, keeps whatever `type` or `domain` value it arrived with, dots included. The grammar above binds Arvo-authored contracts, not every value `ArvoEvent.type`/`domain` can ever hold.

**Scope within the contract itself.** This grammar governs Arvo-defined protocol-level identifiers only — `type`, `emits` keys, the handler error type, `domain`. It does not reach into the payload data a version's `accepts`/`emits` schemas define for their own business data. The handler error payload (**Handler error**, below) or any other payload definition declared by Arvo package(s) follows the same `snake_case` convention because Arvo itself authors that shape; a contract author's own payload key names SHOULD follow the same convention, for the same cross-language ergonomics this grammar exists for, but this ADR does not mandate or validate it. Payload data modeling is the contract author's own concern, not a protocol-level identifier this ADR controls.

### Handler error

Every version of a contract carries a standardized handler error event, in addition to that version's own declared `accepts`/`emits`. It represents exactly one thing: the handler bound to this contract failed to execute its own logic, or could not do what it was declared to do. It is not a general system- or infrastructure-failure channel and does not attempt to cover every way an execution can fail — the broader taxonomy of error kinds in Arvo, and the mechanisms for each, is left to a dedicated, future ADR.

Because it is an ordinary emit like any other, a handler error can be caught and acted on at the workflow level — by an orchestrator, another node, or a human — the same as any other event this contract permits. It carries no privileged, out-of-band handling path, consistent with ADR-000's Event-Only Communication.

- **Type:** `type` joined into the pattern `handler_{type}_error` — e.g. `type = com_payment_process` yields `handler_com_payment_process_error`. The joined result MUST itself satisfy the grammar in **Contract-declared identifier grammar**; since `type` already does and the literal segments `handler`/`error` are drawn from that same alphabet, this holds automatically.
- **`dataschema`:** the same version as whichever declared version's handler produced the error — `{uri}/{version}`, exactly as for any other event of that version. There is no separate reserved version for it; a handler error belonging to version `1.0.0` is versioned `1.0.0`, and one belonging to `1.1.0` is versioned `1.1.0`, preserving which declared version was actually in effect when the failure occurred.
- **Payload:** an object with `error_name` (string), `error_message` (string), and `error_stack` (string or null) — this shape does not vary by version, even though `dataschema` does.

The handler error is never part of a contract's stored canonical form (see **Canonical representation**): its type, `dataschema`, and payload are each a fixed function of `type` and the producing version alone, with no per-contract variation possible, so every implementation computes it identically rather than storing a copy of something a fixed rule already determines.

### `description`, `metadata`

`description` is an optional, human-readable string, uninterpreted by Arvo. `metadata` is an optional, open object, uninterpreted by Arvo — a slot for producer- or tooling-specific information whose shape this ADR does not constrain, in the same spirit ADR-001 reserves `category` and `baggage` as thin, uninterpreted slots rather than growing the model a field per concern.

### Domain

`domain` is an optional default value, `string | null`, `null` by default. It is exactly that — a value a contract carries so that events its factories construct can inherit a default without every call site repeating it — and nothing more. It carries no resolution logic, no inheritance chain, and no runtime context. When set, it follows the identifier grammar above, not the dotted form `ArvoEvent.domain` itself permits under ADR-001.

Anything richer — resolving a domain from the handler's own contract versus the contract of the event being emitted, from a triggering event, from orchestration parent/child context — is handler-execution behavior operating on top of this static value, not part of the contract's own structure. That belongs to the handler-protocol ADR.

## Consequences

**Gained.** A contract authored in one language is verifiably the same contract when read in another: the canonical JSON+JSON-Schema form carries no library-specific representation to translate, and the `uri` derivation algorithm is pinned precisely enough that two languages never diverge on the same input. Contract-declared identifiers become safe to use directly as symbolic keys everywhere they're likely to be consumed, eliminating a class of dot-to-identifier translation code this ADR judges not worth paying for at every consumer instead of once at declaration. `uri`'s required canonical form keeps every `dataschema` built from it canonical too, closing a gap that would otherwise sit between this ADR and ADR-002.

**Paid for.** Contract-declared identifiers give up the dotted, CloudEvents-familiar naming shown throughout existing documentation and examples — a real, visible departure from convention, even though CloudEvents itself never required it. Every language implementation now owns one more precise, cross-language-testable obligation: the `uri`-derivation algorithm must match exactly, not merely produce a "reasonable" result.

## Considered Alternatives

**Leaving `uri` derivation to each language's own convention** — considered, not chosen. Two languages given the same `type` could then derive different `uri` values, breaking the premise that a contract's identity is language-independent — the exact failure mode this ADR exists to prevent.

**Permitting dots (or arbitrary punctuation) in contract-declared identifiers** — considered, not chosen. It matches CloudEvents' own convention more closely, but reintroduces the identifier-translation burden at every consumer this ADR is designed to remove it from.

**Standardizing simple- and orchestrator-contract presets as part of this ADR** — considered, not chosen. Both are naming conventions layered on the shape this ADR defines, not structural decisions the shape itself needs to make. Settling them now would also require settling handler/orchestration concepts (`parentSubject$$`, initialization/completion event pairing) this ADR deliberately defers.

**Mandating an automated breaking-change classifier as part of this ADR** — considered, not chosen. Per-version isolation is the load-bearing guarantee; a tool that checks whether a proposed change to a version is compatible with practice is valuable but is tooling built on top of this structure, not part of the structure itself.

**A single reserved `0.0.0` dataschema shared across every version, for the handler error** — considered, not chosen. It was the one part of a contract not actually isolated per version, in tension with the isolation principle this ADR otherwise holds without exception, and it discarded which declared version was actually in effect when a handler failed — information `dataschema` exists specifically to carry.

## Conformance to ADR-000

**Effect on AAM.** This ADR amends the AAM membership list, replacing *"ArvoContract identities, versions, and declared event capabilities"* with the fields, versioning model, identifier grammar, handler error convention, and canonical representation defined above. It addresses the "structure... and version compatibility" portion of ADR-000's Deferred Decision naming ArvoContract; "dependency declaration, event capabilities, resolution" — how a handler declares, binds to, and is permitted to use a contract — remains deferred to the handler-protocol ADR.

**Invariants depended on.** *Explicit Contracts and Runtime Validation* — a contract expressible as portable JSON+JSON Schema is what lets "must not preclude cross-language participation" hold mechanically rather than by convention. *Event-Only Communication* — a contract's `emits` is the enumerated set of what a node bound to it may say.

**Invariants strained.** None. The identifier-grammar restriction narrows past what CloudEvents itself requires, the same kind of deliberate narrowing ADR-002 and ADR-003 already applied elsewhere for a concrete payoff.

**Required of infrastructure adapters.** None. This ADR governs contract authoring and structure, not adapters or transports.

**Left deferred.** Simple- and orchestrator-contract presets. Dependency declaration, contract resolution, and binding — handler-protocol concerns. Domain resolution, inheritance, and any orchestration-context-dependent routing strategy — also handler-protocol. Automated compatibility/breaking-change classification tooling. Whether and how `dataschema` is ever mechanically dereferenced at runtime. The specific hosting location and version-management process for the published ArvoContract meta-schema — to be developed alongside implementation, per the same pattern ADR-003 left for the CloudEvent data-wrapper schema. The broader taxonomy of error kinds beyond handler failure, and their handling mechanisms, is left to a dedicated future ADR.
