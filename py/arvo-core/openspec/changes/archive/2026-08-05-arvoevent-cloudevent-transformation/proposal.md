## Why

[ADR-003](../../../../docs/adr/003-arvoevent-cloudevent-transformation.md) requires every `ArvoEvent` to be transformable into a CloudEvent, losslessly in the forward+reverse direction for Arvo-produced events, with a distinct, non-throwing-away foreign-adaptation path for CloudEvents Arvo didn't produce. This is the second capability in `py/arvo-core`, and the second in the parity roadmap `arvo-event`'s own `proposal.md` named: `arvo-event` had to exist first since this capability transforms *to and from* it.

Per [ADR-004](../../../../docs/adr/004-multi-language-implementation-governance.md)'s Idiomatic Freedom, this is not a port of `ts/arvo-core`'s `CloudEventConverter` class, its enrichment-stage pipeline, or its `tryX`/`X` method pairs. It is a fresh, idiomatic-Python answer to what ADR-003 actually requires — which, per `ts/arvo-core`'s own `arvoevent-cloudevent-converter` design.md, is deliberately silent on *mechanism* ("Whether a conforming implementation performs the mapping through a class, a pipeline of per-field transformers, or a single function is implementation... That belongs to OpenSpec and `design.md`").

## What Changes

- New capability `arvoevent-cloudevent-transformation`: converts an `ArvoEvent` to a CloudEvent (total, per ADR-003's **Transformability**), and reverts a CloudEvent to an `ArvoEvent` via two distinct paths — **strict** (an Arvo-shaped CloudEvent, validated against every ADR-003 discriminator, structurally-authoritative) and **foreign** (any other CloudEvent, adapted with caller-supplied fallback values for fields the mapping can't recover).
- Reuses the official `cloudevents` PyPI package (2.2.0) — specifically its Pydantic v2-native `CloudEvent` class (`cloudevents.v1.pydantic.v2.event.CloudEvent`) — rather than hand-rolling CloudEvents conformance, the same reuse discipline `ts/arvo-core` applied to the `cloudevents` npm package. Verified directly (not assumed from documentation): it is a genuine `pydantic.BaseModel`, accepts arbitrary extension attributes via `**kwargs`, and has all the CloudEvents 1.0.2 core attributes ADR-003 names.
- Does **not** include `ts/arvo-core`'s enrichment-stage pipeline (`converters` appended to `CloudEventConverter`). ADR-003 doesn't require it, `ts/arvo-core`'s own design.md treats it as that implementation's own extensibility choice, not a capability requirement, and adding it now with no concrete consumer would be exactly the premature abstraction `openspec/project.md`'s conventions warn against. Revisit only if a real, specific need for CloudEvent-to-CloudEvent enrichment surfaces later.

## Capabilities

### New Capabilities

- `arvoevent-cloudevent-transformation`: the ArvoEvent↔CloudEvent mapping ADR-003 defines, in both directions.

## Impact

**Affected code**

- `py/arvo-core/src/arvo_core/cloudevent/` (new) — the transformation itself and its supporting error type.
- `py/arvo-core/tests/cloudevent/` (new, mirroring `src/arvo_core/cloudevent/`).
- `py/arvo-core/pyproject.toml` — adds `cloudevents` to `[project.dependencies]`.

**Not touched**

- `arvo-event` capability itself — this change consumes `ArvoEvent`, it doesn't modify it.
- The wire serializer, `ArvoContract`, `ArvoEventHandler` — later capabilities, not this one.
- `ts/arvo-core/` — entirely unaffected.
- Any ADR — this change implements ADR-003 as already accepted; it proposes no new or amended ADR.

## Out of Scope

- CloudEvent-to-CloudEvent enrichment stages (see **What Changes** above) — not required by ADR-003, deliberately deferred.
- Wire serialization to/from a JSON string — the (not-yet-proposed) Python equivalent of `ts/arvo-core`'s `ArvoEventSerializer` capability, which depends on this one.
- Structured/binary content mode, transport bindings, canonical wire serialization — ADR-003's own stated Left Deferred items; this change doesn't newly decide them either.
- Any change to ADR-003's field placement, discrimination rules, or losslessness guarantee. This change implements those rules; it does not renegotiate them.
