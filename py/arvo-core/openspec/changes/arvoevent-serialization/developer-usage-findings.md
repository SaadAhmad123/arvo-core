# Developer usage findings

Written after building `arvo_core.serializer`, by using it the way an actual
consumer would rather than through unit tests written against the spec.

Scenarios run, each actually executed against the committed code:

1. **An event going onto a queue and back, `cloudevent` mode (the default)**:
   `serialize` → a wire string a broker would actually carry → `deserialize`
   → confirmed the round trip.
2. **`arvoevent` mode, for a purely-internal queue that never leaves Arvo**:
   confirmed this mode round-trips byte-for-byte on every field, including
   `time` -- no CloudEvent involved, no instant-vs-string exception the
   CloudEvent path has.
3. **A consumer accidentally reading with the wrong mode** (`arvoevent`-mode
   wire fed to `cloudevent`-mode `deserialize`): confirmed it fails clearly
   -- as a `CloudEventTransformationError` naming the actual missing field
   (`dataschema`), not a plausible-looking but wrong `ArvoEvent`.
4. **A boundary receiving a raw webhook string from an HTTP body** (not a
   pre-parsed object -- a real `str` off the wire): `deserialize` with a
   fallback handled it with no extra caller-side JSON handling.
5. **A truncated/corrupted message from a flaky network**: confirmed the
   failure is reported through `ArvoEventSerializerError` with the original
   `json.JSONDecodeError` as `.__cause__`, not an uncaught exception.
6. **Distinguishing this module's own failure from the transformation's**:
   confirmed a structurally-nonsensical parsed object (missing `source`/
   `type`, so it can't become a `CloudEvent` at all) raises
   `ArvoEventSerializerError`, while a parsed object that *does* become a
   `CloudEvent` but fails Arvo-shaped validation raises the underlying
   `CloudEventTransformationError` unwrapped -- the two are genuinely
   distinguishable with one `isinstance` check each, as designed.

## No bugs found during this pass

Every scenario behaved exactly as `design.md`/`specs/arvoevent-serialization/spec.md`
describe.

## One thing worth recording for future readers

**`ArvoEvent.model_validate_json` does not wrap a JSON-syntax failure**, only
a schema failure -- this was the actual reason `deserialize` owns `json.loads`
itself rather than delegating parsing to `ArvoEvent`. Recorded already in
`design.md`'s own Decisions section (not a new finding from this pass), but
worth restating here since it's exactly the kind of gap this pass is meant to
catch and didn't need to, because the design already accounted for it before
implementation started.
