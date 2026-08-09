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
- **Automated compatibility checking.** This ADR states that each contract version is fully isolated (see **Isolation**, under **`versions`**). It does not define or mandate a tool that classifies a schema change as breaking or non-breaking; that remains implementation guidance, not an ADR-enforced mechanism.
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

**Annotation keywords enforce nothing.** JSON Schema 2020-12 makes checking some keywords optional — `format` is the main one: a validator may check `"format": "email"` or ignore it, and both are conformant, so two implementations could disagree about the same payload. In a canonical form that choice does not exist. Any keyword the dialect defines as an annotation rather than an assertion is documentation only: an implementation MUST NOT enforce it, MUST NOT enable a validator's optional, off-by-default checking for it, and MUST NOT reject a schema for carrying a keyword it does not recognize. An author who needs such a check actually enforced puts it in the native validation object, where it is authoring-time richness the canonical form does not carry — see the best-effort rule below.

This is the form every language implementation MUST be able to produce from its own natively-authored contract, and MUST be able to construct a working contract object from, given a canonical form produced elsewhere — including one authored in a different language. A language's own idiomatic validation object — whatever native schema representation that language's own ecosystem favors — is a materialization of the canonical form for that language's own ergonomics. It is not the source of truth; the canonical JSON form is.

**Producing the canonical form is best-effort, not a semantic-equivalence guarantee.** A native validation object may express a constraint JSON Schema 2020-12 cannot — a custom predicate, a transform, a refinement checked by arbitrary code — and this ADR does not restrict that authoring-time richness; it governs the canonical form, not what a language's own validation library is allowed to express while authoring one. When a native construct has no JSON Schema 2020-12 equivalent, the canonical export MUST omit it rather than approximate it. The exported schema becomes a true, if weaker, subset of what the native validator actually enforces — never a fabricated stand-in implying a check the schema doesn't actually perform. Two implementations MUST NOT invent different heuristic approximations for the same unrepresentable construct; omission is the only permitted response to inexpressibility.

**Optional fields are materialized, not omitted.** A contract's canonical form MUST include every field defined in **Fields**, including an optional field left at its default — `"description": null` and `"metadata": {}` appear explicitly even when a contract author never set them, rather than being absent keys a reader resolves from the default table. Two contracts that differ only in whether a field was explicitly set to its default value or never touched at all are the same contract, and the canonical form MUST NOT let that distinction produce a different JSON shape. This does not by itself make two canonical forms byte-identical — key ordering and number/string formatting are a separate, unaddressed question; see **Left deferred**.

A machine-readable JSON Schema describing what a well-formed ArvoContract-as-JSON looks like — the shape of the container itself, not the `accepts`/`emits` schemas inside a particular contract — SHOULD be developed alongside this ADR's implementation and published, the same discipline [ADR-003](./003-arvoevent-cloudevent-transformation.md) already applies to the CloudEvent data-wrapper schema.

### Fields

| Field | Type | Required | Default |
|---|---|---|---|
| `uri` | string | yes | derived from `type` — see **`uri`** |
| `type` | string | yes | — |
| `versions` | object (semantic version → version definition) | yes | — |
| `description` | string or null | no | null |
| `domain` | string or null | no | null |
| `metadata` | object | no | empty |

A contract with only `type` and a non-empty `versions` supplied, taking every other default, is well formed.

### `type`

The event type a handler bound to this contract accepts. The primary identity anchor: version-independent, so that participants running different versions of the same contract remain reachable under one stable name.

`uri` and version are deliberately not folded into `type` as a single combined string. `event.type` must stay usable for routing independent of which contract version a given participant currently implements — collapsing version into `type` would make every version bump also a routing change, which the field is specifically designed not to be.

### `uri`

Identifies this contract, forming the base of every `ArvoEvent.dataschema` this contract's versions produce. ADR-001 states only that `dataschema` "identifies the exact contract URI and version this event relates to," without fixing how the two combine; this ADR settles that concretely as `{uri}/{version}`. `uri` MUST be present as a concrete, resolved value in a contract's canonical form — it is never optional at the model level, whatever ergonomic omission a given language's authoring surface allows.

`uri` MUST be a non-empty, valid RFC 3986 URI-reference (non-emptiness must be said explicitly — the empty string is itself a grammatically valid URI-reference — and it is the same word ADR-002 already applies to `dataschema`), in the same canonical form ADR-002 already requires of `dataschema` — non-canonical percent-encoding, wrong case, or an unresolved dot-segment is rejected, not normalized. This is necessary, not merely consistent: `dataschema` is built by appending `/{version}` to `uri`, and ADR-002 already requires `dataschema` to be canonical, so `uri` must be canonical for that guarantee to hold on every event a contract's versions produce.

**Derivation.** When a language's authoring surface allows `uri` to be omitted, it MUST be derived from `type` by replacing **every** occurrence of `_` with `/`, then prepending `#/`:

```
uri = "#/" + (type with every "_" replaced by "/")
```

This is deliberately stated as "every occurrence," not as a call to a language's own `replace`-like function — `replace` alone is exactly the kind of notation that silently diverges between languages (some replace only the first match by default, some replace all), which is precisely the failure mode this algorithm exists to prevent. Given `com_payment_process`, the derived `uri` MUST be `#/com/payment/process` — every underscore becomes a slash, not just the first.

This is total and unambiguous given `type`'s own grammar (see **Contract-declared identifier grammar**): `type` contains no character other than `_`, lowercase letters, and digits, so replacing every `_` with `/` cannot collide with any other separator. That grammar also guarantees the derived `uri` is well-formed as a path: since `type` can never start or end with `_`, or contain two or more consecutive underscores, the derived `uri` can never end up with a leading, trailing, or doubled `/` beyond the single one `#/` itself contributes. Every language implementation offering this convenience MUST implement exactly this algorithm, so that the same `type` yields the same `uri` regardless of which language authored the contract. An explicitly supplied `uri` always wins over derivation and is stored as given, subject only to the canonical-form requirement above.

### `versions`

A map from semantic version string to a version definition:

| Field | Type | Required |
|---|---|---|
| `accepts` | schema | yes |
| `emits` | object (event type → schema) | yes |

Each key of `versions` MUST be a bare `MAJOR.MINOR.PATCH` triple — three dot-separated non-negative integers without leading zeros, with no pre-release suffix (`1.0.0-beta`) and no build metadata (`1.0.0+build`). The exclusion is not stylistic: semantic versioning excludes build metadata from ordering, so admitting it would allow two distinct keys (`1.0.0+a`, `1.0.0+b`) that compare equal, breaking the total order **Isolation** below names as a reason the semver shape is required at all. `versions` MUST contain at least one entry — a contract declaring none has no schema for any handler to implement and nothing for `uri` or `type` to attach to, so it is not well formed.

**Isolation.** Each version is a complete, standalone contract. Nothing about version `1.1.0` is implied by, inherited from, or required to be compatible with version `1.0.0` — they coexist as entirely separate interfaces sharing only `uri`, `type`, `domain`, `description`, and `metadata`. A handler bound to this contract implements every declared version's `accepts`/`emits` fully and independently; nothing here defines partial or inherited implementation.

Isolation means semantic versioning's usual job — letting a consumer reason about compatibility from the number alone, the way a dependency range like `^1.2.0` does — has nothing to compute here: no two versions are ever compatible by construction, so no MAJOR/MINOR/PATCH boundary is more or less breaking than any other. The `MAJOR.MINOR.PATCH` shape is required anyway, for two narrower reasons: it gives every implementation the same well-defined total order for free, which version resolution needs; and it remains a familiar magnitude signal for a reader reading a version list, even though nothing here enforces that the signal is accurate. That last property is informational, not a guarantee this ADR makes or a rule an implementation checks.

**Totality of `emits`.** A version's `emits` MUST enumerate every event type a handler bound to it may produce for that version — there is no wildcard emission. ADR-000 already requires that "every event type [a handler] may emit must be permitted by its own contract or a declared dependency"; an `emits` that did not enumerate its possibilities exhaustively would make that requirement unenforceable.

An empty `emits` (`{}`) is permitted, for a handler that produces no declared response of its own. This does not mean the handler can never emit anything at all: the handler error (**Handler error**) exists independent of `emits` and remains available to every version regardless of what it declares.

**Object-shaped payloads.** A version's `accepts` schema, and every schema in its `emits`, MUST carry the literal keyword `"type": "object"` at its top level. The keyword itself is required, not merely its effect: a rule stated as "must not permit a non-object" cannot be checked mechanically — a schema built from `allOf` composition can permit only objects while carrying no top-level `type` at all, and two implementations could then disagree about whether the same contract is declarable. Requiring the keyword makes the check a lookup every implementation performs identically; richer composition remains available inside the schema's own `properties`. The rule exists because `ArvoEvent.data` is always an object of JSON values, per ADR-001 — a schema permitting anything else describes a shape `data` can never actually take, making the contract unsatisfiable by any real event. A schema without the keyword MUST be rejected at declaration, not discovered later at validation time.

**No collisions.** A version's `emits` MUST NOT use `type` as one of its own keys. It also MUST NOT use the handler error type (`handler_{type}_error`, see **Handler error**) as one of its own keys.

The first is ambiguous by itself: an event carrying this contract's `type` could then mean either "the request this handler accepts" or "one of its own declared responses," and nothing about the event says which. The second is a real duplicate, not just confusing wording: the handler error's `dataschema` matches the same version that produced it, so an `emits` entry reusing that key would give one exact `type` + `dataschema` pair two different schemas — the version's own, and the fixed handler-error shape — with nothing left to tell them apart. Both MUST be rejected when a contract is declared, not discovered later at validation time.

### Contract-declared identifier grammar

`type`, every key of a version's `emits`, the generated handler error type (see **Handler error**), and `domain` (when not `null`) MUST match `^[a-z0-9]+(_[a-z0-9]+)*$` — one or more lowercase ASCII letters or digits, optionally followed by any number of further such groups, each separated by exactly one underscore. Concretely: the identifier MUST start and end with a lowercase letter or digit, never an underscore, and MUST NOT contain two or more consecutive underscores — an underscore is only ever a separator between two alphanumeric segments, never a character with meaning on its own. `com_payment_process` is valid; `_com_payment`, `com_payment_`, and `com__payment` are not.

Uppercase is excluded, not merely unneeded: allowing it would just relocate the same casing-inconsistency problem this grammar exists to remove — two contracts could otherwise name what's meant to be the same style of identifier `Com_Payment_Process` and `com_payment_process` and be silently different strings.

This is deliberately more restrictive than CloudEvents itself requires. A dotted identifier (`com.user.register`) is a natural CloudEvents `type` value but a poor one to use as a symbolic key — a state-machine transition name, a dispatch-table entry, a dict or object key — the way event-driven handlers, orchestrators, and agents routinely do. Every consumer that wants to use a contract-declared type value this way must otherwise sanitize or translate between dotted and identifier-safe form itself. Fixing the grammar once, at declaration time, removes the need for that translation layer to exist anywhere downstream.

This constrains only what an ArvoContract may declare. It does not alter `ArvoEvent.type`'s or `ArvoEvent.domain`'s own domain as ADR-001 and ADR-002 define them: an event from a foreign producer, adapted through the CloudEvent-transformation's foreign path, keeps whatever `type` or `domain` value it arrived with, dots included. The grammar above binds Arvo-authored contracts, not every value `ArvoEvent.type`/`domain` can ever hold.

**Scope within the contract itself.** This grammar governs Arvo-defined protocol-level identifiers only — `type`, `emits` keys, the handler error type, `domain`. It does not reach into the payload data a version's `accepts`/`emits` schemas define for their own business data. The handler error payload (**Handler error**, below) or any other payload definition declared by Arvo package(s) follows the same `snake_case` convention because Arvo itself authors that shape; a contract author's own payload key names SHOULD follow the same convention, for the same cross-language ergonomics this grammar exists for, but this ADR does not mandate or validate it. Payload data modeling is the contract author's own concern, not a protocol-level identifier this ADR controls.

### Handler error

Every version of a contract carries a standardized handler error event, in addition to that version's own declared `accepts`/`emits`. It represents exactly one thing: the handler bound to this contract failed to execute its own logic, or could not do what it was declared to do. It is not a general system- or infrastructure-failure channel and does not attempt to cover every way an execution can fail — the broader taxonomy of error kinds in Arvo, and the mechanisms for each, is left to a dedicated, future ADR.

Because it is an ordinary emit like any other, a handler error can be caught and acted on at the workflow level — by an orchestrator, another node, or a human — the same as any other event this contract permits. It carries no privileged, out-of-band handling path, consistent with ADR-000's Event-Only Communication.

- **Type:** `type` joined into the pattern `handler_{type}_error` — e.g. `type = com_payment_process` yields `handler_com_payment_process_error`. The joined result MUST itself satisfy the grammar in **Contract-declared identifier grammar**; this holds automatically. `type`'s own grammar already guarantees it starts and ends with a lowercase letter or digit, never an underscore, so wrapping it in a single literal underscore on each side can never produce a leading, trailing, or doubled underscore — and `handler`/`error` themselves contain only lowercase letters, drawn from the same alphabet.
- **`dataschema`:** the same version as whichever declared version's handler produced the error — `{uri}/{version}`, exactly as for any other event of that version. There is no separate reserved version for it; a handler error belonging to version `1.0.0` is versioned `1.0.0`, and one belonging to `1.1.0` is versioned `1.1.0`, preserving which declared version was actually in effect when the failure occurred.
- **Payload:** an object with `error_name` (string), `error_message` (string), and `error_stack` (string or null) — this shape does not vary by version, even though `dataschema` does.

The handler error is never part of a contract's stored canonical form (see **Canonical representation**): its type, `dataschema`, and payload are each a fixed function of `type` and the producing version alone, with no per-contract variation possible, so every implementation computes it identically rather than storing a copy of something a fixed rule already determines.

The `handler_{type}_error` pattern is deliberately not reserved across contracts. A different contract may declare a `type` or an `emits` key that happens to match another contract's handler error type, and nothing rejects it. This creates no ambiguity the model does not already carry: no ADR claims `type` is unique across contracts — two unrelated contracts can already declare the identical ordinary `type` — and ADR-001 resolves an event by `type` and `dataschema` together, neither alone. A collision on a `handler_*_error`-shaped name is the same situation as a collision on any other name, disambiguated the same way. Avoiding confusing name reuse across a deployment's contracts is that deployment's own naming discipline, not contract structure.

### `description`, `metadata`

`description` is an optional, human-readable string, uninterpreted by Arvo. `metadata` is an optional, open object of JSON values, in the sense ADR-001's **Value types** defines them, so that it always survives the canonical form's JSON representation. It is uninterpreted by Arvo: a slot for producer- or tooling-specific information whose shape this ADR does not otherwise constrain, in the same spirit ADR-001 reserves `category` and `baggage` as thin, uninterpreted slots rather than growing the model a field per concern.

### Domain

`domain` is an optional default value, `string | null`, `null` by default. It is exactly that — a value a contract carries so that events its factories construct can inherit a default without every call site repeating it — and nothing more. It carries no resolution logic, no inheritance chain, and no runtime context. When set, it follows the identifier grammar above, not the dotted form `ArvoEvent.domain` itself permits under ADR-001.

Anything richer — resolving a domain from the handler's own contract versus the contract of the event being emitted, from a triggering event, from orchestration parent/child context — is handler-execution behavior operating on top of this static value, not part of the contract's own structure. That belongs to the handler-protocol ADR.

## Consequences

**Gained.** A contract authored in one language is structurally the same contract when read in another, as far as the canonical form's own vocabulary can express: the canonical JSON+JSON-Schema form carries no library-specific representation to translate, and the `uri` derivation algorithm is pinned precisely enough that two languages never diverge on the same input. This is not a guarantee that two native materializations enforce identical runtime validation — see **Paid for**. Contract-declared identifiers become safe to use directly as symbolic keys everywhere they're likely to be consumed, eliminating a class of dot-to-identifier translation code this ADR judges not worth paying for at every consumer instead of once at declaration. `uri`'s required canonical form keeps every `dataschema` built from it canonical too, closing a gap that would otherwise sit between this ADR and ADR-002.

**Paid for.** Contract-declared identifiers give up the dotted, CloudEvents-familiar naming shown throughout existing documentation and examples — a real, visible departure from convention, even though CloudEvents itself never required it. Every language implementation now owns one more precise, cross-language-testable obligation: the `uri`-derivation algorithm must match exactly, not merely produce a "reasonable" result. And because an unrepresentable native construct is omitted from the canonical form rather than approximated, a contract exported from a language whose author used one validates more loosely everywhere else: the canonical form only ever guarantees the subset of validation JSON Schema can express, not whatever the richest native implementation happens to enforce.

## Considered Alternatives

**Leaving `uri` derivation to each language's own convention** — considered, not chosen. Two languages given the same `type` could then derive different `uri` values, breaking the premise that a contract's identity is language-independent — the exact failure mode this ADR exists to prevent.

**Permitting dots (or arbitrary punctuation) in contract-declared identifiers** — considered, not chosen. It matches CloudEvents' own convention more closely, but reintroduces the identifier-translation burden at every consumer this ADR is designed to remove it from.

**Standardizing simple- and orchestrator-contract presets as part of this ADR** — considered, not chosen. Both are naming conventions layered on the shape this ADR defines, not structural decisions the shape itself needs to make. Settling them now would also require settling handler/orchestration concepts (`parentSubject$$`, initialization/completion event pairing) this ADR deliberately defers.

**Mandating an automated breaking-change classifier as part of this ADR** — considered, not chosen. Per-version isolation is the load-bearing guarantee; a tool that checks whether a proposed change to a version is compatible with practice is valuable but is tooling built on top of this structure, not part of the structure itself.

**A single reserved `0.0.0` dataschema shared across every version, for the handler error** — considered, not chosen. It was the one part of a contract not actually isolated per version, in tension with the isolation principle this ADR otherwise holds without exception, and it discarded which declared version was actually in effect when a handler failed — information `dataschema` exists specifically to carry.

**Approximating an unrepresentable native construct instead of omitting it** — considered, not chosen. Two implementations approximating the same construct could reasonably produce different JSON Schemas for what was logically the same rule, reintroducing exactly the cross-implementation divergence risk omission avoids — a subtler, harder-to-detect kind of drift than an honest omission.

**Requiring full semantic reproducibility — restricting contract authoring to only what JSON Schema 2020-12 can express, so nothing is ever lost on export** — considered, not chosen. This would force every language's authoring surface down to JSON Schema's own lowest common denominator, forbidding a native validator's own idiomatic richness purely so the canonical export could claim full fidelity. That trades away the Idiomatic Freedom ADR-004 already grants each language for a stronger guarantee than this ADR needs to make.

**Mandating that annotation keywords like `format` be enforced, rather than treating them as documentation** — considered, not chosen. It would let a canonical form carry checks like `"format": "email"` as real validation, but support for enforcing them is uneven across otherwise-conformant validators, and validators that do enforce them differ in how strictly (different email-checking rules, for instance) — so mandating enforcement would trade one source of cross-implementation divergence for a subtler one. Treating them as documentation matches the dialect's own default and the rule this ADR already holds elsewhere: the canonical form never implies a check it does not actually perform.

**Leaving annotation-keyword enforcement to each implementation's own choice** — considered, not chosen. The same contract would then accept a payload in one language and reject it in another, with both implementations able to call themselves conformant — precisely the divergence ADR-004's conformance boundary exists to make impossible to wave away, and one no reader of the canonical form could detect from the bytes.

**Reserving the `handler_*_error` name pattern across contracts, so no contract may declare a `type` or `emits` key matching another contract's handler error type** — considered, not chosen. Cross-contract name collisions are already possible for every ordinary `type` — no ADR makes `type` globally unique — and are already resolved by `type` and `dataschema` together. Reserving this one pattern would introduce the model's first cross-contract naming rule to prevent a collision no worse than ones the model already tolerates, and enforcing it would require every declaration site to know every other contract in existence, which nothing in Arvo requires or enables.

## Conformance to ADR-000

**Effect on AAM.** This ADR amends the AAM membership list, replacing *"ArvoContract identities, versions, and declared event capabilities"* with the fields, versioning model, identifier grammar, handler error convention, and canonical representation defined above. It addresses the "structure... and version compatibility" portion of ADR-000's Deferred Decision naming ArvoContract; "dependency declaration, event capabilities, resolution" — how a handler declares, binds to, and is permitted to use a contract — remains deferred to the handler-protocol ADR.

**Invariants depended on.** *Explicit Contracts and Runtime Validation* — a contract expressible as portable JSON+JSON Schema is what lets "must not preclude cross-language participation" hold mechanically rather than by convention. *Event-Only Communication* — a contract's `emits` is the enumerated set of what a node bound to it may say.

**Invariants strained.** None. The identifier-grammar restriction narrows past what CloudEvents itself requires, the same kind of deliberate narrowing ADR-002 and ADR-003 already applied elsewhere for a concrete payoff.

**Required of infrastructure adapters.** None. This ADR governs contract authoring and structure, not adapters or transports.

**Left deferred.** Simple- and orchestrator-contract presets. Dependency declaration, contract resolution, and binding, and a handler's own runtime decision of which permitted event to emit and when — all handler-protocol concerns. Domain resolution, inheritance, and any orchestration-context-dependent routing strategy — also handler-protocol. Automated compatibility/breaking-change classification tooling. Whether and how `dataschema` is ever mechanically dereferenced at runtime. The specific hosting location and version-management process for the published ArvoContract meta-schema — to be developed alongside implementation, per the same pattern ADR-003 left for the CloudEvent data-wrapper schema. The broader taxonomy of error kinds beyond handler failure, and their handling mechanisms, is left to a dedicated future ADR. Byte-level canonicalization of the canonical form itself — key ordering, number and string formatting, and any scheme (such as RFC 8785 JCS) for making two semantically identical contracts produce identical bytes — is not addressed here; **Canonical representation** settles only that optional fields are materialized, not that the result is byte-comparable.

## Appendix: Illustrative canonical-form examples

These examples are illustrative only. They do not replace the published, authoritative meta-schema **Canonical representation** and **Left deferred** require; they exist to make the rules above concrete, not to define them. Where prose and an example ever appear to disagree, the prose governs.

### Example 1: Minimal contract

Only `type` and `versions` are supplied. `uri` is derived (`com_payment_process` → `#/com/payment/process`), and both optional fields are materialized at their defaults rather than omitted.

```json
{
  "uri": "#/com/payment/process",
  "type": "com_payment_process",
  "description": null,
  "domain": null,
  "metadata": {},
  "versions": {
    "1.0.0": {
      "accepts": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
          "amount": { "type": "number", "exclusiveMinimum": 0 },
          "currency": { "type": "string", "minLength": 3, "maxLength": 3 }
        },
        "required": ["amount", "currency"]
      },
      "emits": {
        "com_payment_process_completed": {
          "$schema": "https://json-schema.org/draft/2020-12/schema",
          "type": "object",
          "properties": {
            "transaction_id": { "type": "string" },
            "status": { "enum": ["completed", "pending"] }
          },
          "required": ["transaction_id", "status"]
        }
      }
    }
  }
}
```

### Example 2: Fully-populated contract with an explicit `uri` override

`uri` is author-supplied and does not match what derivation from `type` would have produced (`#/com/user/register`) — an explicit value always wins. `description`, `domain`, and `metadata` are all set; `domain` follows the same identifier grammar as `type`.

```json
{
  "uri": "#/services/identity/user/registration",
  "type": "com_user_register",
  "description": "Handles user registration for the identity service",
  "domain": "identity_priority",
  "metadata": {
    "owner": "team_identity"
  },
  "versions": {
    "1.0.0": {
      "accepts": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
          "email": { "type": "string", "format": "email" },
          "username": { "type": "string", "minLength": 3 }
        },
        "required": ["email", "username"]
      },
      "emits": {
        "com_user_registered": {
          "$schema": "https://json-schema.org/draft/2020-12/schema",
          "type": "object",
          "properties": {
            "user_id": { "type": "string" },
            "email": { "type": "string" }
          },
          "required": ["user_id", "email"]
        }
      }
    }
  }
}
```

### Example 3: Multi-version, isolated

Two versions of the same contract, kept as two complete, independent definitions rather than one inheriting from the other — `1.1.0`'s `accepts` adds a new required field `1.0.0` doesn't have, and its `com_order_created` emit carries a different payload shape under the same event type name. Neither version's presence constrains or is derived from the other's.

Note what is absent: no `handler_com_order_create_error` key appears anywhere, in either version. The handler error is never part of the stored canonical form (see **Handler error**) — every implementation computes it identically from `type` and the producing version, so it has no position to occupy here.

```json
{
  "uri": "#/com/order/create",
  "type": "com_order_create",
  "description": null,
  "domain": null,
  "metadata": {},
  "versions": {
    "1.0.0": {
      "accepts": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
          "items": { "type": "array", "items": { "type": "string" } },
          "address": { "type": "string" }
        },
        "required": ["items", "address"]
      },
      "emits": {
        "com_order_created": {
          "$schema": "https://json-schema.org/draft/2020-12/schema",
          "type": "object",
          "properties": {
            "order_id": { "type": "string" }
          },
          "required": ["order_id"]
        }
      }
    },
    "1.1.0": {
      "accepts": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
          "items": { "type": "array", "items": { "type": "string" } },
          "address": { "type": "string" },
          "shipping_tier": { "enum": ["standard", "express"] }
        },
        "required": ["items", "address", "shipping_tier"]
      },
      "emits": {
        "com_order_created": {
          "$schema": "https://json-schema.org/draft/2020-12/schema",
          "type": "object",
          "properties": {
            "order_id": { "type": "string" },
            "estimated_delivery": { "type": "string", "format": "date-time" }
          },
          "required": ["order_id", "estimated_delivery"]
        }
      }
    }
  }
}
```
