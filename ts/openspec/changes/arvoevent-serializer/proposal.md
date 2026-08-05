## Why

No ADR governs this change directly. It composes two already-settled primitives — `ArvoEvent`'s own JSON-safety guarantee (ADR-001) and the `arvoevent-cloudevent-transformation` capability (ADR-003) — into one convenience surface at the wire-string boundary, without introducing any new wire-format decision. ADR-003 leaves "canonical wire serialization" deferred (byte-for-byte reproducibility for hashing or signing); this change is not that. `JSON.stringify`/`JSON.parse` of an already-well-defined object shape is ordinary serialization, already proven lossless for both shapes it wraps — the `arvoevent-cloudevent-converter` change's own developer-usage exercise verified this for the CloudEvent path, and the same is true, unassisted, for `ArvoEvent`'s own default `JSON.stringify` output.

Today, a consumer who wants to actually put an `ArvoEvent` on a wire has to make two decisions themselves every time: which of the two valid wire shapes to use (`ArvoEvent`'s own JSON, or the CloudEvent-shaped JSON `CloudEventConverter` produces), and handle the `JSON.stringify`/`JSON.parse` boundary by hand around whichever `CloudEventConverter`/`ArvoEvent.tryParse` call they need. Neither decision is hard once you know both mechanisms exist, but nothing today packages them together, and the CloudEvent path in particular has real, non-obvious correctness requirements at that exact boundary (a plain deserialized object needs `new CloudEvent(data, false)` before `tryRevert` will accept it — `arvoevent-cloudevent-converter`'s own `developer-usage-findings.md` Finding 1 records this as the single most likely first mistake).

This change adds `ArvoEventSerializer`: one class, two selectable wire formats, owning the string boundary so a consumer doesn't have to rediscover either mechanism's own boundary requirements themselves.

## What Changes

- New class `ArvoEventSerializer`, constructed with an optional mode: `{ type: 'arvoevent' }` (the event's own default JSON shape, no CloudEvent involved) or `{ type: 'cloudevent'; converter?: CloudEventConverter }` (defaults to a bare `new CloudEventConverter()` when no mode, or no `converter`, is supplied — `cloudevent` is the default mode outright, since interoperability beyond Arvo is the standard this package already commits to, not an opt-in).
- New class `ArvoEventSerializerError` (`cause: Error`, following the platform's own `Error.cause` convention): wraps any failure `trySerialize`/`tryDeserialize` themselves originate at their own boundary (`JSON.parse`'s `SyntaxError`, `JSON.stringify`'s `TypeError`, `ArvoEvent.tryParse`'s `ArvoEventValidationError`). A `CloudEventTransformationError` from `CloudEventConverter` is always passed through unwrapped — never nested inside `ArvoEventSerializerError` — so a caller can distinguish "this class's own boundary failed" from "the underlying transformation failed" with one `instanceof` check on each.
- `tryDeserialize`/`deserialize` are generic over `<T, D>`, mirroring `CloudEventConverter.revert`'s own shape, for a caller who already knows which contract a given wire payload belongs to.
- Follows the `tryX`/`X` convention throughout: `trySerialize`/`serialize`, `tryDeserialize`/`deserialize` — no bespoke result shape invented for this class.
- **BREAKING**: none. Entirely new, additive surface.

## Capabilities

### New Capabilities

- `arvoevent-serialization`: converting an `ArvoEvent` to and from a wire string, in either of two selectable formats, with the format-appropriate boundary handling (JSON parse/stringify, CloudEvent wrapping) owned by the capability rather than left to the caller.

### Modified Capabilities

None. `arvo-event`'s own structural validity and `arvoevent-cloudevent-transformation`'s own field mapping are unchanged and unextended — this capability only calls into both through their existing, unmodified entry points (`ArvoEvent.tryParse`, `CloudEventConverter.tryConvert`/`tryRevert`).

## Impact

**Affected code**

- `src/serializer/` (new directory) — the `ArvoEventSerializer` class and its supporting mode type.
- `src/index.ts` — new public exports for this capability.
- `tests/serializer/` (new directory, mirroring `src/serializer/`).

**Not touched**

- `src/ArvoEvent/` — no change to structural validity, the class, or its validator.
- `src/cloudevent/` — no change to `CloudEventConverter`, `CloudEventTransformationError`, or any of the base mapping. This change is an explicit, deliberate decision from this proposal's own design discussion: `CloudEventTransformationError`'s existing shape (a single class with a nested `detail` discriminated union) stays exactly as it is. `ArvoEventSerializer` consumes it as-is.

**Release**: additive, new-capability work with no existing behavior to break.

## Out of Scope

- Any change to `CloudEventTransformationError`'s own shape — considered during this proposal's own design discussion (whether to restructure it into multiple exported error classes for consistency with this change's own error-union approach) and explicitly declined; it is good as built and stays untouched.
- Canonical, byte-for-byte wire serialization for hashing or signing — still ADR-003's own deferred concern, unaffected by this change.
- Any transport binding (HTTP, a queue, a broker) — this change stops at producing and consuming a JSON string; what carries that string is infrastructure's concern, per ADR-003's own established boundary.
- Auto-detecting which wire format a string was serialized with — a consumer picks a mode at construction time and uses it consistently on both ends; there is no format-sniffing.
