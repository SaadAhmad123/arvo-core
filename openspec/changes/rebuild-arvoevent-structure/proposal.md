## Why

[ADR-001](../../../docs/adr/001-arvoevent-structure.md) was accepted on 2026-08-01 and defines the ArvoEvent as eighteen fields and no others, with their types, defaults, and structural validity rules. The implementation in `src/ArvoEvent/` predates it and was written against the superseded design, so the package's central primitive does not match the decision that governs it.

The divergence is structural rather than cosmetic. The current implementation carries an open `extensions` map that ADR-001 considered and rejected by name; is missing `executionid`, `initid`, and `category`, the three coordination fields the ADR exists to introduce; carries `rootsubject`, a field the ADR does not define, while giving `subject` a per-execution meaning where the ADR makes it the workflow-wide constant; and determines rootness with a rule that rejects events the ADR explicitly declares valid.

ADR-000 records that `arvo-core` v4 is a deliberate rebuild unconstrained by earlier majors, so this is a clean redefinition rather than a migration.

## What Changes

- **BREAKING**: Remove the `extensions` field and its supporting type machinery. ADR-001 rejects an open per-event extension map because it becomes the second payload channel the envelope exists to prevent.
- **BREAKING**: Remove `rootsubject`. The workflow-wide constant becomes `subject`, and per-execution identity moves to the new `executionid`.
- **BREAKING**: Make `dataschema` required. No legitimate class of ArvoEvent lacks a contract.
- **BREAKING**: Reject input containing any unrecognised key, rather than silently ignoring it.
- Add `executionid`, `initid`, and `category`.
- Replace the rootness rule with the ADR's one-directional constraint keyed on `parentid`, and add the completion correlation constraint binding `initid` to `category`.
- Remove the sign constraint on `executionunits`; add a finiteness constraint covering every number in the event at any depth.
- Replace serializer-based payload checking with a JSON-domain walk that detects cycles and reports the path to an offending value.
- Treat `undefined` as absent rather than invalid, matching JSON serialization semantics, so payloads built from optional TypeScript properties construct without friction.
- Add a non-throwing parse entry point for events arriving as plain data.
- Add an explicit opt-out from full-depth payload validation for callers asserting trusted input.
- Freeze constructed events, including the contents of `data` and `baggage`.

## Capabilities

### New Capabilities

- `arvo-event`: The ArvoEvent primitive — its field set, defaults, and structural validity. Structural validity is a property of a single event, checkable without a contract, a store, or any other event. This change specifies the structural half of the capability; the propagation rules ADR-001 also defines are a later change against the same capability.

### Modified Capabilities

None. `openspec/specs/` is empty; this is the first specification of any capability in the package.

## Impact

**Affected code**

- `src/ArvoEvent/` — `index.ts`, `types.ts`, `validator.ts`, `errors.ts` rebuilt; `opentelemetry.ts` unchanged, since ADR-001 explicitly permits deriving trace context from a span at creation
- `src/types.ts` — the shared JSON value types the module depends on
- `src/index.ts` — the public export surface
- `tests/ArvoEvent/index.spec.ts` — rewritten rather than patched; its 542 lines target the superseded shape
- New module for the JSON-domain payload walk

**Not touched**

`src/factory/` contradicts ADR-001's propagation table in two places — it merges baggage where the ADR permits a single writer at the root, and increments `depth` on every derived event where the ADR increments only when an execution opens. Propagation is a separate concern and a separate change.

**Consequence to accept**: on landing, the package conforms to ADR-001's structural validity only. The propagation table remains unenforced anywhere in the package, so "conforms to ADR-001" will mean less than a reader might assume. This belongs in the release notes.

**Release**: a major version, which is also what makes the package's claim to implement AAM 1 true.

## Out of Scope

Bounded by ADR-001's own scoping, which defers each of these. None is settled here:

- Contract validation of `data` against the schema named by `dataschema` — requires the contract and happens at handler trust boundaries
- Derivation of `executionid`, classification of incoming events, and the conditions for routing a failure to the workflow root — all handler-protocol behaviour
- Propagation of any field from one event to another
- Assignment of `io.arvo.*` values to `category`, which ADR-001 assigns to contract event factories
- Wire format, deserialization format, and the CloudEvent transformation
- Any guarantee of authenticity. ADR-000 is explicit that successful validation establishes no identity, authenticity, or trust.
