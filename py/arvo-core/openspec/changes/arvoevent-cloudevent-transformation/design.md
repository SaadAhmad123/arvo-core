## Context

See `proposal.md` for motivation. This design implements [ADR-003](../../../../docs/adr/003-arvoevent-cloudevent-transformation.md)'s field placement, discrimination, and losslessness requirements, consuming the already-built `arvo-event` capability without modifying it.

## Goals / Non-Goals

**Goals:**

- Every ADR-003 rule satisfied: total forward transformation, lossless Arvo-native round trip, correctly distinct strict/foreign reverse behavior.
- Reuse the official `cloudevents` package's own CloudEvents-conformance guarantees wherever they actually hold, rather than re-validating what it already validates.
- Idiomatic Python: no class or pipeline mechanism that has nothing to hold state for.

**Non-Goals:**

- CloudEvent-to-CloudEvent enrichment stages — see `proposal.md`'s Out of Scope.
- Wire serialization to a JSON string — a later capability's job.
- Matching `ts/arvo-core`'s `CloudEventConverter` API shape — only the ADR-003 behavior is shared.

## Decisions

### Free functions, not a class — there is no state to hold

`ts/arvo-core`'s `CloudEventConverter` is a class specifically because it holds a mutable, caller-appendable list of enrichment stages. This capability has no such list (see **What Changes**'s Out of Scope), and therefore nothing to justify a class's existence — a class with no state and no polymorphism is ceremony, not design. Two free functions:

- `to_cloud_event(event: ArvoEvent) -> CloudEvent` — the forward direction. Total, per ADR-003's **Transformability**; cannot fail for structural reasons given an already-valid `ArvoEvent`.
- `from_cloud_event(ce: CloudEvent, **foreign_fallback: Any) -> ArvoEvent` — the reverse direction. Internally discriminates whether `ce` is Arvo-shaped (per every condition ADR-003's **Discriminating Arvo-shaped events** section lists) and branches to strict or foreign handling accordingly — mirroring `ts/arvo-core`'s own single-entry-point `revert`, which does the same internal branching rather than exposing two separate public methods. `**foreign_fallback` is only consulted on the foreign path; ADR-003 requires `dataschema` among it and permits the rest.

Raises `CloudEventTransformationError` (see below) on any failure, per this package's own already-settled error-handling idiom (raises, not `tryX`/`Result` — decided in `arvo-event`'s own `design.md` and now `openspec/project.md`, and applying here as the same governing decision, not re-litigated per capability).

### Reusing `cloudevents`'s Pydantic v2 `CloudEvent` class, verified directly

`cloudevents.v1.pydantic.v2.event.CloudEvent` is a genuine `pydantic.BaseModel` (confirmed empirically): it accepts arbitrary extension attributes via `**kwargs`, has every CloudEvents 1.0.2 core attribute ADR-003 names, and delegates CloudEvents-conformance validation to a real, maintained implementation — the same reuse discipline `ts/arvo-core` applied to the `cloudevents` npm package, and consistent with `openspec/project.md`'s *Dependencies and reuse* convention.

### `time` requires a hand-managed wire representation — the SDK's own `datetime` coercion is not lossless, verified empirically

This is the one real correctness risk found while drafting this design, checked directly rather than assumed:

```python
ce = CloudEvent(..., time="2026-01-01T00:00:00.123Z")
ce.time            # datetime.datetime(2026, 1, 1, 0, 0, 0, 123000, tzinfo=TzInfo(0))
ce.model_dump_json()["time"]  # "2026-01-01T00:00:00.123000+00:00"
```

The SDK's `time` field is typed `datetime.datetime`, not `str`, in **every** CloudEvent class the package offers (the Pydantic variant and the non-Pydantic `cloudevents.core.v1.event` class alike — both were checked). Constructing a CloudEvent from an ArvoEvent's `time` string round-trips it through a `datetime` object, and re-serializing that object does not reproduce the original string: `Z` becomes `+00:00`, and sub-second precision is always padded to six digits regardless of the source string's own precision. This is exactly the class of bug `ts/arvo-core` found in its own CloudEvents SDK (`toJSON()` there always forces UTC `Z`) — the same failure mode, a different mechanism.

ADR-003's **Losslessness** clause is unconditional — "ArvoEvent → CloudEvent → ArvoEvent yields an ArvoEvent identical, field for field, to the original" — not scoped to only the package's own default-generated `time`. Unlike `ts/arvo-core`'s fix (aligning `createTimestamp()`'s default output with the CloudEvents SDK's own canonical form, which closed the gap for the overwhelmingly common case but left an explicitly-supplied non-default time only instant-equal, not string-equal, after a round trip — an accepted, documented limitation there), Python's SDK canonical form (`+00:00`, six-digit microseconds) doesn't even match `arvo_core.event.util.now_iso()`'s own default output (`Z`, three-digit milliseconds) — so aligning the default wouldn't close this gap the way it did for TS.

**Decision:** the transformation manages `time`'s wire representation itself, rather than trusting the SDK's own `datetime`-based (de)serialization for this one field. The exact mechanism — a custom field serializer on a `CloudEvent` subclass, constructing/reading the wire JSON dict directly for this one key, or another approach — is implementation-phase work to verify empirically (see `tasks.md`), not decided here in the abstract; what's decided is the requirement itself: **the original `ArvoEvent.time` string MUST survive a round trip byte-for-byte, for any valid RFC 3339-with-offset input, not only the package's own default.** This is a stronger guarantee than `ts/arvo-core` ended up providing for this same field, made possible because the loss here is a Python object-model artifact this package's own code can route around, not an external dependency's `toJSON()` running at the one place JS serialization is triggered automatically.

### `depth`: canonical unsigned-decimal string — bespoke, justified

ADR-003 requires `arvodepth` to be a CloudEvents `String` in exactly the grammar `0|[1-9][0-9]*` (no sign, leading zero, decimal point, or exponent), parsed back as an arbitrarily large non-negative integer. Python's own `str(int)`/`int(str)` already produce and accept exactly this grammar for a non-negative integer — no library needed, and hand-rolling here is justified under *Dependencies and reuse*'s "genuinely Arvo's own semantics" exception, since nothing general-purpose validates this specific grammar as its own concern.

### `executionunits`: RFC 8785 canonical number string — candidate library, verification deferred to implementation

ADR-003 requires `arvoexecutionunits` to be an RFC 8785 (JSON Canonicalization Scheme) number serialization of the finite binary64 value, with deserialization rejecting any string that doesn't re-serialize to itself under the same scheme. This is a real, precise algorithm (not just "reasonable float formatting") — Python's own `repr(float)`/`json.dumps` do not implement RFC 8785's specific number-serialization rules. A candidate library needs identifying and empirically verifying against RFC 8785 test vectors during implementation, the same discipline already applied to `arvo-event`'s URI-canonicalization library choice; naming one here would be premature without that verification.

### Arvo-shaped discrimination: a private helper, checking every ADR-003 condition explicitly

A CloudEvent is Arvo-shaped only when `specversion`, `datacontenttype` (media type + exactly one `version=1` parameter), `dataschema` (the fixed wrapper URI), the required native attributes, the required extensions (`arvoexecutionid`, `arvodepth`), and the `data` wrapper shape all hold simultaneously — per ADR-003's own bulleted list. A value matching the media type or wrapper URI but failing any other condition is a malformed Arvo-shaped event and MUST be rejected, never silently treated as foreign — this is the one behavioral distinction ADR-003 requires every API shape to preserve regardless of mechanism, and it's enforced here as a single discrimination check run once, before branching, so the malformed-vs-foreign distinction can't be accidentally bypassed by calling strict/foreign logic directly out of order.

### `CloudEventTransformationError`: wraps the underlying cause, carries a `kind` discriminant

Mirroring `ArvoEventValidationError`'s already-established shape: a small exception type, human-readable message, original cause preserved via `raise ... from ...`. Adds one thing `ArvoEventValidationError` doesn't need — a `kind: Literal["strict", "foreign"]` attribute, since ADR-003 itself distinguishes these as two different failure categories a caller may reasonably want to branch on (a strict failure means an Arvo-shaped event was malformed; a foreign failure means adaptation couldn't be completed with the supplied fallback) — the same distinction `ts/arvo-core`'s own `CloudEventTransformationErrorDetail.kind` already draws, kept here because it's ADR-003's own distinction, not an implementation detail borrowed from TS.

## Risks / Trade-offs

**The `time` fidelity fix adds real implementation complexity** (bypassing/overriding the SDK's own field serialization for one field) that a simpler "trust the SDK" implementation wouldn't need. Accepted: the alternative is silently violating ADR-003's unconditional losslessness guarantee for any ArvoEvent whose `time` isn't already in the SDK's own canonical string form — a correctness bug, not a simplification worth making.

**No enrichment-stage extensibility** — accepted, see `proposal.md`. Revisit if a concrete need for CloudEvent-to-CloudEvent enrichment actually surfaces; nothing here forecloses adding it later.

## Considered Alternatives

**Hand-rolling CloudEvents conformance instead of reusing the `cloudevents` package** — considered, not chosen, for the same reason `ts/arvo-core` reused the npm package: CloudEvents conformance is exactly the kind of general-purpose, already-solved concern *Dependencies and reuse* says shouldn't be re-derived.

**A class mirroring `CloudEventConverter`, with an empty/unused stages list held for future extensibility** — considered, not chosen. Holding state for a feature that doesn't exist yet is speculative generality, not preparation — the exact pattern this repository's own conventions warn against. Adding a class later, if enrichment stages become a real need, is a small, backward-compatible change; carrying the unused ceremony now is not free in the meantime.

**Accepting only instant-equality for `time`, matching `ts/arvo-core`'s own final disposition** — considered, not chosen. That was an accepted limitation there because the loss happens inside a third-party library's own automatic serialization hook (`cloudevents` npm's `toJSON()`), triggered the moment `JSON.stringify` runs, with no seam this package's own code could intercept without patching that library. Python's version of the same problem is a `datetime` object-model artifact inside code this package fully controls the construction and serialization of — a strictly stronger guarantee is achievable here at a real but bounded implementation cost, so weakening the guarantee to match a different language's different constraint isn't the right trade in this case.

## Open Questions

- The exact mechanism for `time`'s custom wire handling (subclass field serializer vs. hand-built wire dict) — implementation-phase, verified empirically, not decided here.
- Which RFC 8785 library (if any adequate one exists) implements `executionunits`' canonical number serialization — same treatment.
