## Context

See `proposal.md` for motivation. No ADR governs this change directly; it composes `arvo-event` (ADR-001) and `arvoevent-cloudevent-transformation` (ADR-003) at the wire-string boundary without introducing a new wire-format decision.

## Goals / Non-Goals

**Goals:**

- A consumer can put an `ArvoEvent` on a wire and get it back, in either of the two formats this package already produces, without hand-rolling the JSON boundary themselves.
- This module's own boundary failures (`json.JSONDecodeError`, a non-mapping parsed value, an `ArvoEventValidationError`) are distinguishable from `arvo_core.cloudevent`'s own failures (`CloudEventTransformationError`) with one `isinstance` check each.

**Non-Goals:**

- Canonical wire serialization -- see `proposal.md`'s Out of Scope.
- Matching `ts/arvo-core`'s `ArvoEventSerializer` class, its `Result`-returning `tryX`/`X` pairs, or its generic type parameters.

## Decisions

### Free functions, not a class -- there is no state to hold

`mode` selects behavior but names no object worth holding between calls: unlike `ts/arvo-core`'s `ArvoEventSerializer`, which stores a caller-supplied `CloudEventConverter` instance (itself holding a mutable enrichment-stage list), this package's `arvo_core.cloudevent` has no analogous configurable object -- `to_cloud_event`/`from_cloud_event` are themselves free functions with no state. A class here would exist only to remember which string (`"arvoevent"` or `"cloudevent"`) a caller picked earlier, which a `mode` keyword argument on each call does exactly as well, with no constructor step a caller must remember to visit first. Two free functions:

- `serialize(event: ArvoEvent, *, mode: SerializationMode = "cloudevent") -> str`
- `deserialize(wire: str, *, mode: SerializationMode = "cloudevent", **foreign_fallback: Any) -> ArvoEvent`

where `SerializationMode = Literal["arvoevent", "cloudevent"]`.

This is a deliberate divergence from `ts/arvo-core`'s API shape, not an oversight -- `proposal.md`'s own `Why` section explains the mechanism difference, and ADR-004's Idiomatic Freedom permits it since no ADR fixes construction-time-vs-per-call mode selection as a requirement.

### `serialize` is total; no error type wraps it

`serialize`'s `"arvoevent"` path is `event.model_dump_json()`; its `"cloudevent"` path is `to_cloud_event(event).model_dump_json()`. `to_cloud_event` is already total for a structurally valid `ArvoEvent` (ADR-003's own **Transformability** guarantee, already verified by `arvoevent-cloudevent-transformation`'s test suite). Pydantic's `model_dump_json()` does not raise for a well-typed model's own fields -- verified directly: even a non-JSON-native value smuggled into `ArvoEvent.data` (which is typed `dict[str, Any]`, so nothing already validates every value inside it is JSON-safe) serializes without raising, because Pydantic's serializer coerces rather than rejecting (a Python `set` becomes a JSON array, for instance).

`ts/arvo-core`'s `trySerialize` can fail because a caller-supplied `CloudEventConverter` stage can hand back a CloudEvent containing a value `JSON.stringify` itself rejects (a circular reference, a `BigInt`). This package has no enrichment-stage mechanism (`arvoevent-cloudevent-transformation`'s own `design.md` declined one as premature abstraction), so that specific failure mode does not exist here. Adding a wrapping error type with no reachable failure to wrap would be dead code the same way `arvo-event`'s original `check_flat_scalar_map` nested-value check was found to be -- so `serialize` does not raise, and is not wrapped in a `try`/`except` that could never trigger.

### `deserialize` owns the JSON boundary itself, not `ArvoEvent`'s own JSON parsing

`ArvoEvent.model_validate_json` was considered as the whole `"arvoevent"`-mode implementation, since it already exists and (per `arvo-event`'s own `developer-usage-findings.md`) wraps a *schema*-validation failure into `ArvoEventValidationError` correctly. It does not, however, wrap a JSON *syntax* failure the same way -- verified directly: `ArvoEvent.model_validate_json("not json {{{")` raises a bare `pydantic.ValidationError` naming a `json_invalid` error type, not `ArvoEventValidationError`, because that failure never reaches `ArvoEvent.__init__`'s own wrapping (Pydantic's JSON parsing happens before construction, inside `model_validate_json` itself). This is a real gap in the already-archived `arvo-event` capability, but fixing `ArvoEvent`'s own JSON-parsing entry point is out of this change's scope -- doing so would reopen an archived capability for a concern this change doesn't actually depend on fixing there.

Instead, `deserialize` parses the wire string itself with the standard-library `json.loads`, wraps any `json.JSONDecodeError` in `ArvoEventSerializerError` at its own boundary, and only then hands the already-parsed value to `ArvoEvent(**parsed)` (or, in `"cloudevent"` mode, `CloudEvent.model_validate(parsed)`). This mirrors `ts/arvo-core`'s own architecture exactly: `ArvoEventSerializer` owns `JSON.parse` itself rather than delegating parsing to `ArvoEvent.tryParse`, for the identical reason -- the wire-string boundary and the already-parsed-value boundary are different concerns, and this capability is specifically the one that owns the former.

### `"cloudevent"`-mode deserialization: constructing a `CloudEvent` from a plain parsed dict needs no workaround, unlike `ts/arvo-core`

`ts/arvo-core`'s own `developer-usage-findings.md` (from `arvoevent-cloudevent-converter`) records that a plain deserialized object needs `new CloudEvent(data, false)` -- bypassing the CloudEvents npm SDK's own construction-time conformance check -- before `tryRevert` will accept it. `cloudevents.v1.pydantic.v2.event.CloudEvent.model_validate(parsed)` has no equivalent construction-time conformance gate to bypass; it is an ordinary Pydantic model accepting any mapping matching its field types, deferring all Arvo-shape discrimination to `from_cloud_event` as already designed. No parallel workaround is needed in Python, and none is added.

### `"cloudevent"`-mode deserialization does not special-case a missing `specversion`

`ts/arvo-core`'s spec requires rejecting, before attempting foreign adaptation, an input with no `specversion` at all -- the one context attribute every CloudEvent must carry. `cloudevents.v1.pydantic.v2.event.CloudEvent`'s own `specversion` field has a default (`"1.0"`), so a parsed value missing `specversion` does not fail to become a `CloudEvent` at all; it silently defaults, the same way it already does for any hand-constructed `CloudEvent` (verified directly during `arvoevent-cloudevent-transformation`'s own build). A value missing everything else CloudEvents actually requires (`source`, `type`, both still non-defaulted on this SDK's model) still fails clearly at `CloudEvent.model_validate`, wrapped in `ArvoEventSerializerError` the same as any other malformed input. This is a real, verified difference in the underlying CloudEvents SDK each language uses, not a Python implementation choice -- ADR-003 fixes `specversion` as this transformation's own *output*, not as a required-presence check on arbitrary deserialization input, so no ADR is strained by this divergence.

### Foreign fallback: passed straight through to `from_cloud_event`, ignored in `"arvoevent"` mode

`deserialize` accepts `**foreign_fallback` unconditionally (so a caller doesn't need a different call shape per mode) but only forwards it to `from_cloud_event` in `"cloudevent"` mode. `"arvoevent"` mode has no foreign-event concept -- a value in that mode is either a valid `ArvoEvent`'s own JSON or it is rejected -- so a supplied fallback there is silently unused, matching `ts/arvo-core`'s own behavior for the same case.

### `ArvoEventSerializerError`: wraps this module's own boundary failures, never `CloudEventTransformationError`

Mirrors `CloudEventTransformationError`'s already-established shape: a small exception type, human-readable message, original cause preserved via `raise ... from ...`. Wraps `json.JSONDecodeError`, a non-mapping parsed JSON value (a JSON array or scalar where an object was required), and `ArvoEventValidationError`. Never wraps `CloudEventTransformationError` -- that error already names a transformation-shape defect, a distinct category `from_cloud_event` already reports correctly on its own, and re-wrapping it would hide which layer actually failed from a caller who wants to `isinstance`-check for the two independently, the same distinction `ts/arvo-core`'s own spec draws.

## Risks / Trade-offs

**No generic type-parameter narrowing on `deserialize`**, unlike `ts/arvo-core`'s `deserialize<T, D>`. Accepted: Python's `ArvoEvent` is not itself generic over a contract type the way `ts/arvo-core`'s is (this package's `data` field is `dict[str, Any]` throughout), so there is nothing for a type parameter here to narrow. Nothing is lost that this package's own `ArvoEvent` ever had.

**`serialize` cannot fail, `deserialize` can** -- an asymmetry `ts/arvo-core` does not have (both of its `tryX` functions return a `Result`). Accepted as an honest reflection of where each function's real failure surface actually is, rather than forcing symmetry `ts/arvo-core`'s own design happens to have for reasons (custom enrichment stages) that don't exist in this package.

## Considered Alternatives

**A class mirroring `ArvoEventSerializer`, storing `mode` (and, in `"cloudevent"` mode, nothing else) at construction time** -- considered, not chosen. With no configurable converter object to hold alongside `mode`, the class would exist solely to remember a two-value string between calls -- the same "no state, no polymorphism, ceremony not design" reasoning `arvoevent-cloudevent-transformation`'s own `design.md` already applied to its own free-function choice.

**Fixing `ArvoEvent.model_validate_json`'s JSON-syntax-error gap as part of this change** -- considered, not chosen. Real, but belongs to the already-archived `arvo-event` capability's own spec, and this change does not depend on it: owning `json.loads` itself here is the same architecture `ts/arvo-core` already uses, not a workaround for the gap. Worth a follow-up change against `arvo-event` on its own merits, tracked separately, not bundled here.

**Raising `ArvoEventSerializerError` for `serialize` failures preemptively, for symmetry with `deserialize`** -- considered, not chosen. No reachable failure exists to wrap; a `try`/`except` around a call that cannot raise is dead code this package's own 100%-coverage discipline would immediately flag, the same category of finding `arvo-event`'s `check_flat_scalar_map` simplification already set a precedent for.

## Open Questions

None.
