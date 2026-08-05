# Developer usage findings

Written after building `ArvoEventSerializer`, by using it the way an actual consumer would rather than through unit tests written against the spec. Scenarios run: default construction and round trip in `cloudevent` mode; explicit `arvoevent` mode; error handling for a bad-shape payload and a non-JSON payload; adapting a foreign producer's raw wire JSON with a `foreignFallback`, with no manual `CloudEvent` construction; the sender/receiver mode-mismatch case the `specversion` guard exists for; a caller-supplied `CloudEventConverter` carrying a custom enrichment stage, threaded through the serializer; the `<T, D>` generics at a realistic call site; and `instanceof` discrimination between `ArvoEventSerializerError` and `CloudEventTransformationError` inside an ordinary `try`/`catch`.

Each scenario below was actually run against the committed code, not theorized.

## No functional defects found

Every scenario behaved exactly as `design.md`/`specs/arvoevent-serialization/spec.md` describe:

- Default construction (`new ArvoEventSerializer()`) round-trips a real event through `cloudevent` mode field-for-field, including through the actual wire (`serialize` on one instance, `deserialize` on a separate instance — not the same in-memory object).
- Explicit `{ type: 'arvoevent' }` mode round-trips identically, with no CloudEvent shape anywhere in the output.
- A bad-shape payload (`{"totally": "wrong shape"}`) in `cloudevent` mode is rejected by the `specversion` guard with a message naming the exact problem (`specversion: is required`), not a generic failure.
- A non-JSON payload (`"not json"`) reports as `ArvoEventSerializerError`, with `.cause` being the real `SyntaxError` and its message intact.
- A foreign producer's raw wire JSON (a plain string, as it would actually arrive over HTTP) adapts correctly via `deserialize(wire, foreignFallback)` with no caller-side `CloudEvent` construction at all — the exact workaround `arvoevent-cloudevent-converter`'s own Finding 1 named as the first mistake `CloudEventConverter` alone invites is fully absorbed by this class.
- The sender/receiver mode-mismatch scenario (`arvoevent`-mode `serialize` output fed into a `cloudevent`-mode `deserialize`) fails cleanly via the `specversion` guard, as `CloudEventTransformationError` — not a silently wrong `ArvoEvent`.
- A caller-supplied `CloudEventConverter` carrying a custom enrichment stage is genuinely the one used by both `serialize` and `deserialize` — the stage's own `convert`/`revert` both actually ran.
- The `<T, D>` generics compile and are usable at a realistic call site (`serializer.deserialize<'com.partner.order.shipped', OrderShipped>(wire)`), reading naturally rather than needing any unusual syntax.
- Catching the throwing convenience (`deserialize`) in an ordinary `try`/`catch` and discriminating `ArvoEventSerializerError` from `CloudEventTransformationError` via `instanceof` worked exactly as `design.md`'s class-shape decision intends — the two failure categories stayed genuinely distinguishable.

## Finding 1 — The class-level TSDoc example didn't demonstrate the two-error-type distinction

The one gap surfaced: the class's own `@example` showed only the happy-path round trip, not the `instanceof ArvoEventSerializerError` vs. `instanceof CloudEventTransformationError` discrimination that `design.md` treats as the whole point of not wrapping `CloudEventTransformationError` — a first-time reader skimming only the top-of-class doc (the same failure mode `arvoevent-cloudevent-converter`'s own Finding 6 noted for its `<T, D>` generics) would have no reason to know the distinction exists without reading `tryDeserialize`'s own doc individually.

**Resolved.** Added a second `@example` to the class doc showing exactly this `try`/`catch` pattern. Cheap, no code change, closed immediately rather than deferred.
