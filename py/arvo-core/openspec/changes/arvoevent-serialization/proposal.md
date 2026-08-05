## Why

No ADR governs this change directly. It composes two already-built primitives — `ArvoEvent`'s own JSON-safe shape (ADR-001) and the `arvoevent-cloudevent-transformation` capability (ADR-003) — into one convenience surface at the wire-string boundary, without introducing any new wire-format decision. ADR-003 leaves canonical, byte-for-byte wire serialization deferred; this is not that. It is ordinary `json.loads`/Pydantic's own JSON serialization of two already-defined shapes.

Today, a Python consumer who wants to put an `ArvoEvent` on a wire has to make the same two decisions a TypeScript consumer would: which of the two valid wire shapes to use (`ArvoEvent`'s own JSON, or the CloudEvent-shaped JSON `to_cloud_event` produces), and handle the JSON boundary by hand around whichever call they need. This capability packages both together as a small module rather than a class — Python's own JSON boundary functions (`json.loads`, Pydantic's `model_dump_json`) don't need an object to hold state the way `ts/arvo-core`'s `ArvoEventSerializer` does, since this package's `arvo_core.cloudevent` has no configurable-converter analog to hold either. `mode` is a per-call parameter, not constructor state -- an intentional divergence from `ts/arvo-core`'s class shape, permitted by ADR-004's Idiomatic Freedom since no ADR fixes the mechanism.

## What Changes

- New functions `serialize(event, *, mode="cloudevent") -> str` and `deserialize(wire, *, mode="cloudevent", **foreign_fallback) -> ArvoEvent`, supporting the same two wire formats `ts/arvo-core`'s `ArvoEventSerializer` does: the event's own default JSON shape (`"arvoevent"`), and the CloudEvent-shaped JSON `to_cloud_event` produces (`"cloudevent"`, the default).
- New exception `ArvoEventSerializerError` (`cause: Exception`, following this package's own "raises, wraps the original cause" idiom already settled by `arvo-event` and `arvoevent-cloudevent-transformation`): wraps a failure this module's own boundary work originates -- `json.JSONDecodeError`, a non-mapping parsed value, or an `ArvoEventValidationError` from constructing the result. A `CloudEventTransformationError` from `arvo_core.cloudevent` is always passed through unwrapped, matching `ts/arvo-core`'s own distinction between "this module's own boundary failed" and "the underlying transformation failed."
- `deserialize` accepts `**foreign_fallback` unconditionally but only consults it in `"cloudevent"` mode, matching `arvo_core.cloudevent.from_cloud_event`'s own fallback semantics; `"arvoevent"` mode ignores it, since that mode has no foreign-event concept.
- `serialize` is total for a well-formed `ArvoEvent` in both modes -- this package has no enrichment-stage mechanism whose output could produce a non-JSON-safe value the way `ts/arvo-core`'s custom `CloudEventConverter` stages can, so there is no realistic serialize-time failure to wrap. This is a genuine, narrower error surface than `ts/arvo-core` provides for the same capability, not a gap: nothing in ADR-001 or ADR-003 requires `serialize` to be fallible.

## Capabilities

### New Capabilities

- `arvoevent-serialization`: converting an `ArvoEvent` to and from a wire string, in either of two selectable formats, with the format-appropriate boundary handling (JSON encode/decode, CloudEvent construction) owned by the capability rather than left to the caller.

### Modified Capabilities

None. `arvo-event`'s own structural validity and `arvoevent-cloudevent-transformation`'s own field mapping are unchanged and unextended -- this capability only calls into both through their existing, unmodified public surface (`ArvoEvent(**kwargs)`, `to_cloud_event`, `from_cloud_event`).

## Impact

**Affected code**

- `src/arvo_core/serializer/` (new) -- `serialize`, `deserialize`, `ArvoEventSerializerError`.
- `src/arvo_core/__init__.py` -- new public exports for this capability.
- `tests/serializer/` (new, mirroring `src/arvo_core/serializer/`).

**Not touched**

- `src/arvo_core/event/` -- no change to `ArvoEvent`'s structural validity, class, or validators.
- `src/arvo_core/cloudevent/` -- no change to `to_cloud_event`, `from_cloud_event`, or `CloudEventTransformationError`. This capability consumes them as-is.

**Release**: additive, new-capability work with no existing behavior to break.

## Out of Scope

- Canonical, byte-for-byte wire serialization for hashing or signing -- still ADR-003's own deferred concern, unaffected by this change.
- Any transport binding (HTTP, a queue, a broker) -- this change stops at producing and consuming a JSON string.
- Auto-detecting which wire format a string was serialized with -- a consumer picks a mode per call and uses it consistently on both ends; there is no format-sniffing.
- Matching `ts/arvo-core`'s `ArvoEventSerializer` class shape, its `trySerialize`/`serialize` `Result`-pair convention, or its generic type-parameter narrowing -- only the ADR-001/ADR-003-derived behavior is shared, per ADR-004's Idiomatic Freedom.
