## Why

[ADR-005](../../../docs/adr/005-arvocontract-structure.md) was accepted on 2026-08-07 and settles the first half of the Deferred Decision ADR-000 raised about ArvoContract: what a contract *is* — its fields, defaults, versioning model, identifier grammar, handler error convention, and canonical representation. Nothing in `arvo-core` implements it. `ArvoContract` is named in `project.md` as one of this package's three application-tier primitives, and it is the only one with no code behind it: `ArvoEvent` is complete, the CloudEvent transformation and serializer are complete, and `ArvoSemanticVersion` — which a contract's `versions` keys are defined in terms of — landed with the error-issue refactor.

`ArvoEvent.dataschema` already carries "the exact contract URI and version this event relates to," and ADR-005 settles that as `{uri}/{version}`. Until a contract exists, that field is a string a caller assembles by hand with nothing to validate it against.

This change builds the contract structure ADR-005 defines. It deliberately stops short of the canonical form — see **Out of Scope**.

## What Changes

- New capability: `ArvoContract`, the versioned capability and interface declaration ADR-005 defines, as two classes.
- **`ArvoContract`** — the authoring container. Carries `uri`, `type`, `description`, `domain`, `metadata`, and `versions`. `uri` is derived from `type` by ADR-005's pinned algorithm when omitted. Version access is by indexing the `versions` map (`contract.versions['1.0.0']`); the literal version keys survive into the type, so an undeclared version is a compile error.
- **`VersionedArvoContract`** — what everything downstream actually holds. Construction of an `ArvoContract` explodes its `versions` map into one of these per version, each carrying the container's identity fields alongside that version's own `input` and `outputs`. This is ADR-005's **Isolation** made concrete: a version is a complete, standalone contract, so a handler bound to one never reaches back to a parent.
- **`dataschema`** on `VersionedArvoContract` only, computed as `{uri}/{version}`. The container has no version and so cannot have one.
- **Handler error**, computed rather than stored, exposed in the same shape as an ordinary emit so a handler can treat everything it may emit uniformly. Its type is `handler_{type}_error`; its payload is the fixed `error_name`/`error_message`/`error_stack` shape; its `dataschema` is the producing version's own.
- **Validation on construction, reporting every failure at once.** A new contract validator, built the same way as `src/ArvoEvent/validator.ts` — normalize first, then collect `ErrorIssue`s rather than throwing at the first fault — so a contract with a malformed `type`, two bad `outputs` keys, and an invalid version key reports all four in one error. Both classes validate in their constructor and throw; `VersionedArvoContract`'s own validation exists for the standalone case, where one is constructed directly rather than through a container.
- **`type` is a prerequisite, validated before anything derived from it.** When it fails, that issue is reported alone and the remaining rules do not run, with the error stating that they did not. `uri` derivation, the handler error type, and the `outputs`-must-not-reuse-`type` comparison are all computed from `type`, and each currently substitutes a placeholder when it is unusable — which is how a caller who supplied no `uri` is told their `uri` is empty. Validating first lets those three placeholders be deleted rather than guarded. This narrows the reporting promise below deliberately; see **Reporting every failure, narrowed**.
- **`uri` becomes a type parameter**, so a version's `dataschema` keeps its precise value instead of widening to plain `string`. Public type signatures on both classes change, which is free now and breaking once released — that timing, not the size of the win, is why it is here.
- Zod v4 is the native authoring surface for `input` and `outputs`. It is already a peer dependency; no dependency changes.
- **BREAKING**: none. New code with no prior behaviour to break, and nothing released.

## Reporting every failure, narrowed

Validating every rule and reporting all of them at once is this validator's headline property, and the `type` prerequisite deliberately reduces it: a declaration with a bad `type` and a bad version key now takes two attempts where it took one.

This is worth stating rather than burying because it changes a guarantee the spec already made. The findings being removed were computed against a placeholder rather than against the declaration — aggregation was presenting a guess next to a fact, and quoting values the caller never supplied. Fewer findings, all of them true.

The gate is one field. Every other position still collects and continues, and there is a scenario pinning that so the narrowing cannot quietly widen.

## Capabilities

### New Capabilities

- `arvo-contract`: the contract structure ADR-005 defines — fields and their defaults, `uri` derivation, the per-version isolation model, the contract-declared identifier grammar, the handler error convention, and what makes a contract declaration valid or rejected.

### Modified Capabilities

None. `arvo-event` is untouched: this change adds a declaration structure that produces a `dataschema` value, but changes no rule about events themselves, and does not modify the event validator or its entry point.

## Impact

**Affected code**

- `src/ArvoContract/` (new directory) — the two classes, their types, the validator, and the handler error derivation
- `src/index.ts` — new public exports
- `tests/ArvoContract/` (new directory, mirroring the source) — every rejection condition covered individually rather than by representative sample, matching how `arvo-event` and `cloudevent` are tested

**Not touched**

- `src/ArvoEvent/` — no change to event structure, validation, or the `validateArvoEvent` entry point
- `src/cloudevent/`, `src/serializer/` — a contract is a declaration; nothing about transforming or serializing an event changes
- `src/semver/` — consumed as-is for version-key validation
- `package.json` — `zod` is already a peer dependency at `^4.0.0`

**Reference only, not to be copied**

- `src/proposal/ArvoContract/` — a sketch written to communicate intent, superseded by this change's `design.md`
- `src-v3/ArvoContract/` — the pre-ADR implementation, retained for reference. It predates ADR-005 and diverges from it, notably in offering `version('latest' | 'any' | 'oldest')` resolution, which this change does not.

**Release**: additive new-capability work with nothing prior to be incompatible with.

## Out of Scope

**The canonical form, and this change's resulting conformance gap.** ADR-005's **Canonical representation** requires every implementation to be able to *produce* a contract's JSON+JSON-Schema-2020-12 form and to *construct* a working contract from one authored elsewhere. This change implements neither, so it does not by itself satisfy ADR-005 — the gap is deliberate and tracked for a follow-up change rather than quietly ignored. The constraint this change accepts in exchange: nothing here may make that follow-up harder. Concretely, the classes store exactly ADR-005's field set and nothing derived, optional fields are materialized at their defaults (`null`, `{}`) rather than left absent, and every schema-bearing position stays something JSON Schema 2020-12 can be produced from.

Also excluded, and why:

- **A `createArvoContract` factory and the simple/orchestrator presets.** ADR-005 calls presets "authoring sugar built on top of this shape, not a distinct kind of contract," and requires no implementation to offer them. The classes are the shape; a factory wraps them later.
- **`try*`/`Result` variants.** Contract declaration happens at module load, where throwing is the right failure mode. The package's `tryX`/`X` pairing exists for runtime boundaries, which this is not.
- **Version resolution helpers** — `latest`, `any`, `oldest`, or range matching. ADR-005 notes the semver triple gives a total order "which version resolution needs," but resolution itself is handler-protocol behaviour, not contract structure.
- **The published ArvoContract meta-schema.** ADR-005 marks it SHOULD, developed alongside implementation, and explicitly leaves its hosting and version-management deferred.

Bounded by ADR-005's own deferrals, and left deferred here rather than settled in passing:

- Dependency declaration, contract resolution, and binding — handler-protocol.
- How a handler decides which permitted event to emit, and when — handler-protocol.
- Domain resolution, inheritance, or any context-dependent routing strategy. `domain` here is a static default value and nothing more.
- Automated breaking-change or compatibility classification between versions.
- Whether `dataschema` is ever mechanically dereferenced at runtime.
- Any error kind beyond handler failure; the broader taxonomy belongs to a future dedicated ADR.
- Byte-level canonicalization — key ordering, number formatting, JCS — which ADR-005 leaves open even for the canonical form itself.
