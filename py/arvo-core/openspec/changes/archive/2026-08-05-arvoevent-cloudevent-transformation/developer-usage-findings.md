# Developer usage findings

Written after building `arvo_core.cloudevent`, by using it the way an actual
consumer would rather than through unit tests written against the spec.

Scenarios run, each actually executed against the committed code:

1. **Produce and route an Arvo-produced event**: `to_cloud_event`, serialize
   to a JSON wire string via `model_dump_json()`, reconstruct the CloudEvent
   from that JSON via `model_validate_json` (not the constructor), then
   `from_cloud_event` it back. Full round trip through an actual wire
   representation, not just the in-memory object.
2. **A causally linked root→child event chain**: an init event converted to
   a CloudEvent, and a separately-constructed CloudEvent (as a downstream
   worker would build one, referencing the init event's `id` as its own
   `arvoparentid`/`arvoinitid`) reversed back into an `ArvoEvent`, checking
   the causation fields actually line up after the round trip.
3. **A boundary receiving a raw third-party webhook** (a GitHub-shaped
   CloudEvent it did not produce): first confirmed adaptation genuinely
   fails without a `dataschema` fallback (raises, does not guess), then
   confirmed it succeeds once the boundary supplies `subject`/`dataschema`.
4. **A malformed producer bug**: a CloudEvent claiming the Arvo media type
   and wrapper schema, but with a non-canonical `arvodepth` ("007", a
   plausible off-by-one from a producer that zero-pads by habit). Confirmed
   it is rejected with `kind="strict"` and does **not** silently fall back
   to foreign adaptation, even when a plausible-looking fallback is
   supplied alongside it — the fallback is ignored, as the spec requires.

## No bugs found during this pass

Every scenario behaved exactly as `design.md`/`specs/arvoevent-cloudevent-transformation/spec.md`
describe. Unlike the `arvo-event` pass, this one didn't surface a design or
implementation gap — most likely because it consumes `ArvoEvent`'s own
already-hardened construction path rather than reimplementing validation.

## Verified working, not assumed

- **The JSON wire round trip preserves everything `to_cloud_event` itself
  guarantees** — `model_dump_json()` → `model_validate_json()` doesn't
  introduce any additional lossiness beyond what direct Python object
  round-tripping already has (i.e., `time`'s instant-equality, nothing else).
- **A downstream event's causation fields (`arvoparentid`, `arvoinitid`)
  survive being hand-constructed by something other than `to_cloud_event`
  itself** — confirming `from_cloud_event`'s strict path doesn't secretly
  depend on internal state only `to_cloud_event` sets up.
- **Foreign adaptation's fallback truly is ignored on the strict path**,
  not just "usually not needed" — passing an incorrect-looking `subject`
  fallback alongside a malformed Arvo-shaped event does not leak into the
  error or get silently used.
