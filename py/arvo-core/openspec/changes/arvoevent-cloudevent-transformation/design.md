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

### `time` round-trips as the same instant, not necessarily the same string

`cloudevents`'s `CloudEvent` class types `time` as `datetime.datetime`, not `str`, in every variant checked (the Pydantic class and the non-Pydantic `cloudevents.core.v1.event` class alike). Constructing a CloudEvent from an ArvoEvent's `time` string and reading it back does not reproduce the original string — `Z` becomes `+00:00`, sub-second precision always pads to six digits:

```python
ce = CloudEvent(..., time="2026-01-01T00:00:00.123Z")
ce.model_dump_json()["time"]  # "2026-01-01T00:00:00.123000+00:00"
```

Same instant, different text. This is not treated as a losslessness violation. `time`'s entire meaning is the instant it names — ADR-001 itself calls it "descriptive, not authoritative" and forbids using it for ordering, i.e., nothing in the model depends on its exact textual form. Two RFC 3339 strings naming the same instant are the same value, the same way `1.0` and `1.00` are the same number; requiring byte-identical text for a field whose semantics are purely "which instant" would be holding a value type to an identifier's standard. ADR-003's own Losslessness clause already accepts this kind of equivalence for another field — `executionunits`' `-0`→`0` construction-time normalization is explicitly named as compatible with "identical, field for field," precisely because the two values are the same number.

`ts/arvo-core` already ships with exactly this same-instant (not same-string) guarantee for any non-default `time` — the CloudEvents npm SDK's own `toJSON()` forces UTC `Z` unconditionally, and the accepted fix there only aligned the *default* generator with that canonical form. Requiring stricter, byte-exact fidelity in Python than what's already accepted and shipped for the same field in TS would be inconsistent rigor for a field the model itself treats as non-authoritative — not a correctness requirement worth the added implementation complexity.

**Decision:** no custom wire handling for `time`. It's read from and written to the CloudEvent using whatever `cloudevents` does natively; the round-trip guarantee is instant-equality (parsing both strings yields the same instant), not string-equality.

### `depth`: canonical unsigned-decimal string — bespoke, justified

ADR-003 requires `arvodepth` to be a CloudEvents `String` in exactly the grammar `0|[1-9][0-9]*` (no sign, leading zero, decimal point, or exponent), parsed back as an arbitrarily large non-negative integer. Python's own `str(int)`/`int(str)` already produce and accept exactly this grammar for a non-negative integer — no library needed, and hand-rolling here is justified under *Dependencies and reuse*'s "genuinely Arvo's own semantics" exception, since nothing general-purpose validates this specific grammar as its own concern.

### `executionunits`: RFC 8785 canonical number string — candidate library, verification deferred to implementation

ADR-003 requires `arvoexecutionunits` to be an RFC 8785 (JSON Canonicalization Scheme) number serialization of the finite binary64 value, with deserialization rejecting any string that doesn't re-serialize to itself under the same scheme. This is a real, precise algorithm (not just "reasonable float formatting") — Python's own `repr(float)`/`json.dumps` do not implement RFC 8785's specific number-serialization rules. A candidate library needs identifying and empirically verifying against RFC 8785 test vectors during implementation, the same discipline already applied to `arvo-event`'s URI-canonicalization library choice; naming one here would be premature without that verification.

### Arvo-shaped discrimination: a private helper, checking every ADR-003 condition explicitly

A CloudEvent is Arvo-shaped only when `specversion`, `datacontenttype` (media type + exactly one `version=1` parameter), `dataschema` (the fixed wrapper URI), the required native attributes, the required extensions (`arvoexecutionid`, `arvodepth`), and the `data` wrapper shape all hold simultaneously — per ADR-003's own bulleted list. A value matching the media type or wrapper URI but failing any other condition is a malformed Arvo-shaped event and MUST be rejected, never silently treated as foreign — this is the one behavioral distinction ADR-003 requires every API shape to preserve regardless of mechanism, and it's enforced here as a single discrimination check run once, before branching, so the malformed-vs-foreign distinction can't be accidentally bypassed by calling strict/foreign logic directly out of order.

### `CloudEventTransformationError`: wraps the underlying cause, carries a `kind` discriminant

Mirroring `ArvoEventValidationError`'s already-established shape: a small exception type, human-readable message, original cause preserved via `raise ... from ...`. Adds one thing `ArvoEventValidationError` doesn't need — a `kind: Literal["strict", "foreign"]` attribute, since ADR-003 itself distinguishes these as two different failure categories a caller may reasonably want to branch on (a strict failure means an Arvo-shaped event was malformed; a foreign failure means adaptation couldn't be completed with the supplied fallback) — the same distinction `ts/arvo-core`'s own `CloudEventTransformationErrorDetail.kind` already draws, kept here because it's ADR-003's own distinction, not an implementation detail borrowed from TS.

## Risks / Trade-offs

**`time` is instant-equal but not always string-equal after a round trip** — accepted, deliberately, not a bug. See the decision above; a consumer that needs the exact original string for some reason outside this transformation's own scope (logging the raw producer input, say) should retain it separately before conversion, the same expectation `ts/arvo-core` already sets for the same field.

**No enrichment-stage extensibility** — accepted, see `proposal.md`. Revisit if a concrete need for CloudEvent-to-CloudEvent enrichment actually surfaces; nothing here forecloses adding it later.

## Considered Alternatives

**Hand-rolling CloudEvents conformance instead of reusing the `cloudevents` package** — considered, not chosen, for the same reason `ts/arvo-core` reused the npm package: CloudEvents conformance is exactly the kind of general-purpose, already-solved concern *Dependencies and reuse* says shouldn't be re-derived.

**A class mirroring `CloudEventConverter`, with an empty/unused stages list held for future extensibility** — considered, not chosen. Holding state for a feature that doesn't exist yet is speculative generality, not preparation — the exact pattern this repository's own conventions warn against. Adding a class later, if enrichment stages become a real need, is a small, backward-compatible change; carrying the unused ceremony now is not free in the meantime.

**A custom wire-serialization mechanism preserving `time`'s exact original string** — considered, drafted, then not chosen. Technically achievable (this package fully controls its own CloudEvent construction, unlike `ts/arvo-core`'s dependency-internal `toJSON()` hook), but the wrong trade: `time` is a value type whose meaning is the instant it names, not an identifier, and matching TS's own already-accepted instant-equality guarantee for the same field is more consistent than adding real implementation complexity to guarantee something ADR-001 itself says nothing depends on.

## Open Questions

- Which RFC 8785 library (if any adequate one exists) implements `executionunits`' canonical number serialization — implementation-phase, verified empirically, not decided here.
