## Why

[ADR-003](../../../docs/adr/003-arvoevent-cloudevent-transformation.md) was accepted on 2026-08-03 and settles the question ADR-000 raised and ADR-001 explicitly declined to answer: how an ArvoEvent maps to and from a CloudEvent, and what a conforming transformation must guarantee in both directions. [ADR-002](../../../docs/adr/002-arvoevent-field-domain-constraints.md), which this ADR depends on for its totality guarantee, is already implemented and merged. Nothing in `arvo-core` currently performs this transformation — ArvoEvent has no CloudEvent-facing code at all, and `ArvoEvent.tryParse`'s own doc comment says so explicitly: "This checks structure only. It is not a wire-format or CloudEvent decoder."

This change implements ADR-003: the forward mapping (always total), the reverse mapping (partial, with two behaviorally distinct cases — strict Arvo-shaped deserialization and best-effort foreign-event adaptation), and the discriminator that tells them apart. It is scoped to exactly what ADR-003 defines. The transformation mechanism itself — whether the mapping is exposed as a class, a pipeline, or plain functions — is implementation, deferred to this change's own `design.md`, not the ADR.

## What Changes

- New capability: an ArvoEvent ↔ CloudEvent transformation, conforming to [CloudEvents 1.0.2](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md).
- Forward direction (ArvoEvent → CloudEvent) is total for arvo-core's own base mapping: every structurally valid ArvoEvent produces a conforming CloudEvent, and the round trip ArvoEvent → CloudEvent → ArvoEvent is lossless, field for field. The public `CloudEventConverter` class built on top of this mapping is extensible with consumer-supplied stages, so both directions expose a `tryX`/`X` pair (`tryConvert`/`convert`, `tryRevert`/`revert`) — a consumer-appended stage can fail even though the base mapping itself never does.
- Reverse direction (CloudEvent → ArvoEvent) is partial and has two distinct, non-interchangeable cases:
  - **Strict Arvo-shaped deserialization**, for a CloudEvent produced by this transformation (or one claiming to be): decodes every native attribute, extension, and the `data` wrapper, and validates the assembled candidate. A CloudEvent that partially matches Arvo's markers but fails any other required condition is **malformed** and MUST be rejected — it MUST NOT silently fall back to foreign-event handling.
  - **Foreign-event adaptation**, for a CloudEvent that claims no Arvo shape at all: maps what CloudEvents' own native attributes and the established tracing extension provide, and requires the caller to supply `dataschema` (never inherited from the foreign CloudEvent's own `dataschema`, which describes a different schema) and any other field the mapping can't recover.
- Both reverse cases pass their assembled candidate through the existing, unchanged `validateArvoEvent` entry point — no second ArvoEvent validity rule set is introduced.
- A consumer-appended pipeline stage failing (in either direction) is reported as a third, distinct failure shape alongside the reverse direction's `strict`/`foreign` structural failures — see `design.md`'s Errors section.
- Adds `cloudevents` (the CNCF-maintained CloudEvents JS SDK) as a new **peer dependency**, alongside the existing `zod` and `@opentelemetry/api` peers — its type flows through this transformation's own public API, and ADR-003 requires CloudEvents conformance to be delegated to a conformant implementation rather than reimplemented.
- **BREAKING**: none. This is new code with no prior behavior to break; nothing existing changes shape.

## Capabilities

### New Capabilities

- `arvoevent-cloudevent-transformation`: the bidirectional mapping between an ArvoEvent and a CloudEvent that ADR-003 defines — field placement, the `data` wrapper, canonical numeric encodings for `arvodepth` and `arvoexecutionunits`, the Arvo-shaped discriminator, and the two reverse-direction behaviors.

### Modified Capabilities

None. `arvo-event`'s own structural-validity rules are unchanged; this change only adds a transformation that produces and consumes ArvoEvent-shaped values through the existing, unmodified validation entry point.

## Impact

**Affected code**

- `src/cloudevent/` (new directory) — `index.ts` (the public transformation entry point), `interface.ts` (the per-stage converter contract), `default.ts` (ADR-003's actual field-placement mapping), `types.ts` (supporting types), `errors.ts` (reusing `ArvoEventValidationIssue` for the reverse direction's structural failures, plus one new throwing error type also covering pipeline-stage failures in either direction)
- `src/index.ts` — new public exports for this capability
- `package.json` / `pnpm-lock.yaml` — `cloudevents` added as a peer dependency (and dev dependency, for the package's own tests)
- `tests/cloudevent/` (new directory, mirroring `src/cloudevent/`) — exhaustive coverage of the forward mapping's correctness and every condition the reverse direction's strict and foreign cases can fail on, individually, not by representative sample

**Not touched**

- `src/ArvoEvent/` — no change to ArvoEvent's own structural-validity rules, its class, or its validator. This change only consumes the existing, unmodified `validateArvoEvent` entry point.
- `src/factory/` — event construction with lineage is unrelated to this transformation.
- Binary or structured content mode, wire-format/protocol bindings, or canonical byte-for-byte wire serialization — ADR-003 explicitly assigns these to infrastructure adapters, not this package.

**Release**: this is additive, new-capability work with no existing behavior to break. `arvo-core` remains pre-stability under ADR-000, but nothing here requires that allowance — there is nothing prior for this change to be incompatible with.

## Out of Scope

Bounded by ADR-003's own scoping:

- Binary content mode and any CloudEvents protocol binding (HTTP, AMQP, Kafka, etc.) — ADR-003 defines only the abstract CloudEvent, not how it is subsequently carried.
- Canonical, byte-for-byte wire serialization — ADR-003 guarantees attribute-value equivalence, not identical serialized bytes.
- Contract validation of `data` against `dataschema` — unaffected, still a handler-trust-boundary concern per ADR-001, unchanged by this ADR.
- How a boundary decides which contract, subject, or execution identity to assign to a foreign event — handler protocol, not this ADR.
- Publishing an actual machine-readable schema document at `https://www.arvo.land/schemas/cloudevent-data/v1` — ADR-003 says one SHOULD be developed alongside implementation, but authoring and hosting it is separate work, not this change.
- Any amendment to ADR-003 itself. This change's mechanism-level design (how the mapping is exposed, whether it is extensible) fits entirely within what ADR-003 already delegates to implementation. If implementation reveals a genuine gap requiring an ADR change, that is flagged as its own follow-up, not settled here in passing.
