## Why

A contract version declares `accepts` and `emits`, and carries a derived `handlerError`. Those words describe what a *handler does* with the data. They are the wrong register for a structure that exists to describe the data itself, and one of them borrows vocabulary from a layer [ADR-005](../../../../docs/adr/005-arvocontract-structure.md) deliberately defers: handler behaviour.

`input`, `outputs` and `error` say what each position holds. The plural is not an inconsistency — a version declares exactly one accepted shape and may declare many emitted ones, so the number carries meaning. And the factory's methods finally read as the fields they build from: `createInput`, `createOutput`, `createError`.

Nothing is published, so the cost is bounded to this repository.

## What Changes

- **`accepts` → `input`, `emits` → `outputs`** — in a version definition, in the canonical JSON form, and in every TypeScript position that reads them.
- **`handlerError` → `error`** — the accessor on a version contract only. The handler error is derived rather than stored, so ADR-005 gives it no canonical key; this is API shape.
- **The assertion result's `scope` becomes `'input' | 'output' | 'error'`.** Singular `output`, because the value names the one event in hand rather than the map it came from.
- **`ArvoEventFactory.createAccepted` → `createInput`, `createEmitted` → `createOutput`**, with their `tryCreate` twins. `createError` is unchanged.
- **Issue paths and message labels follow**: `versions["1.0.0"].accepts` → `.input`, `.emits["k"]` → `.outputs["k"]`, and the payload-check labels a caller reads.
- **BREAKING**: none in effect. The canonical form's keys change, which would break a stored contract document — but none exists outside this repository's tests, and nothing is published.

### What does not change

- The handler error's own rules: the `handler_{type}_error` type pattern, its `{uri}/{version}` dataschema, and its `error_name` / `error_message` / `error_stack` payload keys. All three are model-level and none is renamed.
- The TypeScript names for that derived thing — `HandlerErrorContract`, `handlerErrorType`, `HANDLER_ERROR_SCHEMA`, `HandlerErrorPayload`, `HandlerErrorType`. They name the model concept, which ADR-005 still calls a handler error.
- Every other canonical key: `uri`, `type`, `versions`, `description`, `domain`, `metadata`.

## Governance

`accepts` and `emits` are canonical keys, not merely TypeScript identifiers. ADR-005 fixes them in its version-definition table, binds them to the canonical form in prose, states rules by name, and shows them in three example documents. Renaming them is a model-level change: a contract authored in one language must remain readable by another, so the keys are binding on Python and on every language that follows.

**ADR-005 is therefore amended in place**, and this is a deliberate departure from its own line 23 — *"Once accepted, this structure changes only by a superseding ADR."* No superseding ADR is written, no amendment note is added, and no record anywhere states that the keys were once named differently. Every document in this repository, current and archived, is normalized to the new vocabulary.

The reason that is acceptable here and would not be later: nothing is published, so no consumer holds a contract document or a compiled dependency that the change invalidates. The record being normalized is a reading experience, not a contract with anyone. Git retains the sequence in full — the commits that wrote `accepts` and `emits`, and the commit that moves every occurrence — so the history is recoverable by anyone who wants it, without every reader having to absorb it first.

## Capabilities

### Modified Capabilities

- `arvo-contract`: a version definition's two fields are renamed, and the handler error's accessor with them. Every requirement that names a field by name is reworded.
- `arvo-contract-serialization`: the canonical form's version-level keys are renamed, so the requirements describing production, reconstruction and form validity follow.
- `arvoevent-construction`: the builders are renamed, and the requirements naming what each one builds follow.

## Impact

**Affected code**

- `src/serializers/ArvoContractSerializer/` — `serialize.ts`, `deserialize.ts`, `form.ts`: the only place canonical keys are written and read.
- `src/ArvoContract/` — `types.ts`, `versioned/index.ts`, `versioned/types.ts`, `index.ts`, `validator.ts`, `assert.ts`.
- `src/factories/ArvoEventFactory/` — `factory.ts`, and `accepted.ts` / `emitted.ts` renamed to `input.ts` / `output.ts`.
- `tests/` — about 44 assertions across 14 files pin an issue path, a message label or a `scope` value verbatim. Those are updated, never loosened: they are what prove the rename reached the observable surface.

**Affected records**

- `docs/adr/005-arvocontract-structure.md`.
- `openspec/specs/arvo-contract/`, `arvo-contract-serialization/`, `arvoevent-construction/`.
- `openspec/changes/archive/**` — normalized in place, dated directory names unchanged.
- `ts/arvo-core/README.md`, `ts/sandbox/src/playground.ts`, and seven prose mentions under `py/arvo-core/`.

**Not touched**

- `src-v3/` — the pre-ADR implementation kept as reference. It is not a record of this model, and normalizing it would imply it implemented one it predates.

**Dependencies**: none added.

**Release**: nothing published.

## Out of Scope

- **Renaming any other canonical key.** `uri`, `type`, `versions`, `description`, `domain` and `metadata` keep their names; this change is about the two that describe a handler rather than the data.
- **The handler error's own model-level rules.** Its type pattern, dataschema rule and payload keys are untouched.
- **Any behavioural change.** Nothing about validation, assertion, construction or serialization changes except the words. The test suite's assertions move; its expectations do not.
- **Writing a superseding ADR.** Considered and rejected above.
