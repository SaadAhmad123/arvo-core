## Context

See `proposal.md` — Why, for motivation, and `specs/arvoevent-serialization/spec.md` for the exact behavioral obligations this design must satisfy. This design builds on two already-stable surfaces without modifying either: `ArvoEvent.tryParse`/`ArvoEvent`'s own default `JSON.stringify` output, and `CloudEventConverter.tryConvert`/`tryRevert`. Nothing here changes either; this change only consumes them.

## Goals / Non-Goals

**Goals:**

- Own the wire-string boundary (`JSON.stringify`/`JSON.parse`) for both valid `ArvoEvent` wire shapes, so a consumer building or receiving a wire payload does not need to know either mechanism's own boundary requirements.
- Make the `cloudevent`-format's known boundary trap (`developer-usage-findings.md` Finding 1 — a plain object needs `new CloudEvent(data, false)` before `tryRevert`/`revert` will accept it) something this class handles internally, not something every caller has to independently discover.
- Follow the `tryX`/`X` convention exactly as already established, with no new result shape.

**Non-Goals:**

- Restructuring `CloudEventTransformationError`. Considered directly during this design's own discussion and declined — it is a deliberate, already-settled shape from the `arvoevent-cloudevent-converter` change, and reopening it was explicitly out of scope for this one.
- Canonical wire serialization, transport bindings, or format auto-detection — see `proposal.md`'s Out of Scope.

## Decisions

### One class, a constructor-time mode, not a generic parameter

```ts
type ArvoEventSerializerMode =
  | { type: 'arvoevent' }
  | { type: 'cloudevent'; converter?: CloudEventConverter };

class ArvoEventSerializer {
  constructor(mode?: ArvoEventSerializerMode);
  async trySerialize(event: ArvoEvent): AsyncResult<string, CloudEventTransformationError | ArvoEventSerializerError>;
  async serialize(event: ArvoEvent): Promise<string>;
  async tryDeserialize<T extends string = string, D extends Record<string, any> = Record<string, any>>(
    data: string,
    foreignFallback?: ForeignCloudEventFallback,
  ): AsyncResult<ArvoEvent<T, D>, CloudEventTransformationError | ArvoEventSerializerError>;
  async deserialize<T extends string = string, D extends Record<string, any> = Record<string, any>>(
    data: string,
    foreignFallback?: ForeignCloudEventFallback,
  ): Promise<ArvoEvent<T, D>>;
}

class ArvoEventSerializerError extends Error {
  readonly cause: Error;
  constructor(cause: Error);
}
```

Every failure this class itself can report is exactly one of two shapes: something `CloudEventConverter` already reports as `CloudEventTransformationError` (passed through untouched, never re-wrapped), or anything else that surfaces at this class's own boundary. `ArvoEventSerializerError` exists to give that second group one exported, catchable identity — `instanceof ArvoEventSerializerError` reliably distinguishes "this class's own boundary failed" from "the underlying converter's transformation failed." `cause` is typed as the general `Error`, not narrowed to the three concrete types this design currently knows how to produce (`JSON.parse`'s `SyntaxError`, `JSON.stringify`'s `TypeError`, `ArvoEvent.tryParse`'s `ArvoEventValidationError`) — narrowing the union would silently go stale the moment a new boundary-level failure mode is added (a future mode, a future native API swapped in) and would buy a caller nothing, since distinguishing the three today already requires their own runtime `instanceof` check on `.cause`, which works identically whether the declared type is a 3-way union or `Error`. The original error is never discarded — it is always inspectable via `.cause`, using the platform's own `Error.cause` convention rather than a bespoke field name.

`new ArvoEventSerializer()` with no arguments defaults to `{ type: 'cloudevent', converter: new CloudEventConverter() }` — `cloudevent`, not `arvoevent`, is the default, because interoperability beyond Arvo is the standard ADR-000/ADR-003 already commit this package to, not an opt-in a caller has to reach for. A caller who genuinely only ever talks to other Arvo participants and has no reason to pay the CloudEvent shape's extra structure opts into `{ type: 'arvoevent' }` explicitly.

The mode is fixed at construction, not per call — a consumer picks one wire format and uses it consistently on both the producing and consuming end, same as choosing a serialization format with any other library. There is no auto-detection between the two shapes.

**Alternative considered:** making the class generic over its own mode (`ArvoEventSerializer<M extends ArvoEventSerializerMode>`), so `trySerialize`'s declared error type could narrow to exclude `CloudEventTransformationError` entirely in `arvoevent` mode (where it can never actually occur). Rejected: the type-safety gained is real but small — a consumer types one instance, is used to seeing an error variant that a call will not actually produce for the mode chosen — and the added generic surface is a real, ongoing cost against `arvoevent-cloudevent-converter`'s own established preference for the simplest thing that is still honest. The wider type is an accepted looseness, not an oversight — see **Risks / Trade-offs**.

### `serialize`/`deserialize` own the format-specific boundary internally

`arvoevent` mode:

```
serialize:   JSON.stringify(event)
deserialize: ArvoEvent.tryParse<T, D>(JSON.parse(data))
```

`cloudevent` mode:

```
serialize:   JSON.stringify(await converter.convert(event))
deserialize: converter.tryRevert<T, D>(new CloudEvent(JSON.parse(data), false), foreignFallback)
```

The `new CloudEvent(JSON.parse(data), false)` step is exactly the boundary `developer-usage-findings.md` Finding 1 named as the single most likely first mistake for anyone using `CloudEventConverter` directly — `ArvoEventSerializer` exists specifically so a consumer never has to know that step is required at all. `strict: false` is deliberate here, not merely a copy of the earlier finding's workaround: `cloudevents`' own conformance check (name-format and value-type checks, gated entirely behind its own `strict` flag) has nothing to do with whether a payload is Arvo-shaped, and running it here would reject a well-formed foreign CloudEvent for reasons `tryRevert`'s own discriminator is about to evaluate on its own, more informative terms.

### `trySerialize`'s error type never includes `ArvoEventValidationError`, but does include a `TypeError` wrapped in `ArvoEventSerializerError` — for a reason only found by testing the real dependency, not by reading its types

By the time a caller has an `ArvoEvent` instance to serialize, its structural validity was already settled at construction — `ArvoEventValidationError` is a construction-time failure, not a serialization-time one, and cannot recur here. `arvoevent` mode's `JSON.stringify(event)` cannot fail at all: every field is already guaranteed JSON-safe by `ArvoEvent`'s own structural validation, the same guarantee that makes the direct round trip (`JSON.parse(JSON.stringify(event))` straight back into `ArvoEvent.tryParse`) already work with no code in this package at all, verified during `arvoevent-cloudevent-converter`'s own developer-usage exercise. `cloudevent` mode's default configuration is similarly total for the reasons `converter.convert` itself is total.

A caller-supplied `converter` carrying custom `converters` stages breaks that totality in two distinct ways, not one. The first is already accounted for: a stage's own `convert` throwing is reported as `CloudEventTransformationError` (`kind: 'stage'`), exactly as `CloudEventConverter.tryConvert` itself already reports it. The second was found only by actually running it, not by reasoning about the types: a stage can hand back a `CloudEvent` that itself throws when `trySerialize` calls `JSON.stringify` on it *after* `convert` has already succeeded — a circular reference (`TypeError: Converting circular structure to JSON`) or a `BigInt` value (`TypeError: Do not know how to serialize a BigInt`), verified directly against `cloudevents` v10.0.0. Nothing in `CloudEventConverter`'s own contract promises a stage's *output* is JSON-safe, only that `convert`/`revert` themselves don't throw — `ArvoEvent`'s own construction-time payload walk is what guarantees this for the base mapping, and that guarantee stops applying the moment a custom stage touches the object afterward.

`trySerialize` therefore wraps its own `JSON.stringify` call — not `converter.convert`'s result before stringifying, only the stringify step itself — in a try/catch, folding a thrown `TypeError` into `new ArvoEventSerializerError(thrownTypeError)` rather than letting it escape uncaught. `arvoevent` mode is exempt: `ArvoEvent`'s own payload walk already guards `data`/`baggage` against cycles and non-JSON values at construction time, and nothing in this mode lets a caller touch the object afterward the way a `cloudevent`-mode enrichment stage can.

### `cloudevent`-mode `tryDeserialize` rejects input with no `specversion` at all, before attempting foreign adaptation — a mode-mismatch guard, verified necessary by testing, not assumed

Consider the scenario a sender/receiver mismatch actually produces: one side serializes in `arvoevent` mode, the other deserializes in `cloudevent` mode (or the reverse — see below, where the reverse turns out to already be safe). Two facts, both confirmed directly against `cloudevents` v10.0.0 rather than assumed, combine to make this dangerous in the `arvoevent`-into-`cloudevent` direction specifically:

- `new CloudEvent(x, false)` never throws, for *any* input — `null`, a number, a bare string, an array all construct successfully, silently fabricating a random `id` and the current `time` and spreading a string's characters or an array's elements as indexed properties. There is no "this clearly isn't a CloudEvent" rejection at this step, for any shape.
- `CloudEventConverter`'s foreign-adaptation path is *deliberately* lenient by design — ADR-003 requires it to accept whatever a real foreign producer sends, so it does not require `specversion` at all before attempting adaptation.

Put together: raw `ArvoEvent` JSON (`{ id, source, type, subject, parentid, depth, dataschema, baggage, ... }`) hitting a `cloudevent`-mode `tryDeserialize` does not fail at the `CloudEvent` construction step, and is not obviously rejected by the discriminator either — `id`/`source`/`type`/`subject`/`time` share their exact names with `ArvoEvent`'s own fields and map straight across, while `dataschema` (a real field on both, with an incompatible meaning on each side), `parentid`, `depth`, and `baggage` are silently dropped by foreign adaptation's own rules, which only look at native attributes and Arvo-prefixed *extensions* — a bare top-level `dataschema` on the wire object is not the CloudEvent-native `dataschema` foreign adaptation reads, so even that overlap doesn't help. The result is not a clean rejection; it's a plausible-looking but wrong `ArvoEvent`, assembled from a partial, coincidental field-name overlap, that could pass structural validation if the caller's `foreignFallback` happens to be permissive enough.

The mitigation is narrow and specific, not a general shape-sniffing mechanism: before calling `converter.tryRevert` at all, `cloudevent`-mode `tryDeserialize` checks that the parsed value has a `specversion` string — the one context attribute the CloudEvents specification itself requires unconditionally, on *every* CloudEvent, strict or foreign, that `CloudEventConverter`'s own foreign path doesn't currently re-check only because it trusts its caller to have already discriminated "is this even a CloudEvent" upstream. Its absence is reported through the existing `CloudEventTransformationError` type with no change to that class — `kind: 'foreign'` with a synthesized issue naming `specversion`, constructed directly (its constructor is already public) rather than routed through `CloudEventConverter` in any way that would require touching it. This one is a genuine `CloudEventTransformationError`, not wrapped in `ArvoEventSerializerError` — it names a transformation-shape defect, the exact category `CloudEventTransformationError` already exists to report, not a boundary failure this class introduced itself.

**The reverse direction — `cloudevent`-shaped JSON into an `arvoevent`-mode `deserialize` — needs no equivalent guard, confirmed rather than assumed.** `ArvoEvent`'s own structural validator already rejects any key it doesn't recognize (`'is not a field of ArvoEvent'`), and a real CloudEvent carries several: `specversion`, `datacontenttype`, and every `arvo`-prefixed extension (`arvoexecutionid`, `arvodepth`, ...) have no equivalent among `ArvoEvent`'s eighteen fields. This direction already fails loudly, with multiple specific, correct issues, using code that exists today — the two wrong-mode directions are not symmetric in how safely they fail, and only one of them needed a new guard.

**Alternative considered and rejected: a self-describing wire envelope instead of a heuristic.** Rather than inferring the mode from the payload's own shape, `ArvoEventSerializer` could wrap every `serialize` output in a small discriminated envelope — e.g. `{ mode: 'arvoevent' | 'cloudevent', payload: ... }` — and have `deserialize` check `mode` directly instead of guessing from `specversion`'s presence. This would close the gap completely, including the collision case the `specversion` guard cannot rule out (a wire payload that legitimately carries a `specversion` field for unrelated reasons while still being the wrong mode's output). Rejected anyway: it changes the wire format for both modes, breaking byte-compatibility with `ArvoEvent`'s own plain `JSON.stringify(event)` shape and with a real foreign CloudEvent producer's own JSON (neither wraps itself in an envelope for this package's benefit) — directly undoing two things this change already committed to: `arvoevent` mode's wire shape being identical to `ArvoEvent`'s own default JSON (see the class-shape decision above), and `proposal.md`'s Out of Scope commitment to no canonical wire-format change and no format auto-detection (a self-describing envelope is a form of auto-detection support, not the "caller picks a mode and uses it consistently" model this change is built on). A caller who wants that stronger guarantee already has the tool for it one layer up — an actual transport-level envelope or content-type header, which is infrastructure's concern per ADR-003's own established boundary, not this class's to reinvent. The `specversion` guard stays the accepted answer inside the constraints this change already set; loosening those constraints is a decision for whoever next revisits the wire-format question, not one this change makes unilaterally.

### `tryDeserialize` catches `JSON.parse`'s own thrown `SyntaxError`, and `ArvoEvent.tryParse`'s own `ArvoEventValidationError`, and folds both into `ArvoEventSerializerError`

`data` is untrusted wire input by definition — a truncated read, a wrong encoding, or a non-JSON payload entirely is exactly as expected a failure mode for a deserializer as a well-formed-JSON-but-wrong-shape one, not a caller bug to let escape as an uncaught exception. `JSON.parse`'s own `SyntaxError`, and (in `arvoevent` mode) `ArvoEvent.tryParse`'s own `ArvoEventValidationError`, are both real, already-well-typed failures with nothing this package needs to add to their shape — reusing them as `ArvoEventSerializerError`'s `.cause` rather than reinventing their content is exactly `project.md`'s *Dependencies and reuse* convention, applied to error types instead of logic. What `ArvoEventSerializerError` adds is not new failure detail, only one exported, `instanceof`-checkable identity for "this class's own boundary work failed," distinct from `CloudEventTransformationError`'s "the transformation itself failed" — see the class-shape decision above. Only the `JSON.parse` step and (in `arvoevent` mode) `ArvoEvent.tryParse`'s `Result` are consulted for this; `cloudevent` mode's `CloudEventConverter.tryRevert` and the `specversion` guard above already return `CloudEventTransformationError` directly and are passed through unwrapped.

### `foreignFallback` is accepted uniformly, but only ever consulted in `cloudevent` mode

`arvoevent` mode has no foreign-event concept at all — a wire string either parses as a structurally valid `ArvoEvent` or it does not, with no caller-supplied fallback able to change that. `tryDeserialize`/`deserialize` accept the parameter unconditionally rather than making it a compile-time error to supply in `arvoevent` mode (which would require the class to be generic over its own mode — see the alternative rejected above); `arvoevent` mode simply ignores it. This is documented explicitly in the method's own TSDoc, not left for a reader to infer from behavior.

### Other edge cases considered, checked, and found to need no new handling

Recorded so the next reader doesn't re-derive them, and so "not handled" reads as "checked and safe," not "overlooked":

- **Prototype-pollution-shaped keys in wire input** (`__proto__`, `constructor`, `prototype`) — not a risk this class introduces or needs to guard against. `JSON.parse` assigns a `__proto__` key as an ordinary own property, never as an actual prototype mutation; this is a native `JSON.parse` guarantee, not something either mode's own logic has to enforce. It's also the reason hand-rolling any part of parsing was never on the table — consistent with `project.md`'s own *Dependencies and reuse* convention.
- **Concurrent reuse of one `ArvoEventSerializer` instance** — safe. The class holds nothing but its `mode`, itself holding nothing but an optional `CloudEventConverter`, whose own fields are `private readonly`. One instance constructed once and shared across concurrent calls has no shared mutable state to race on.
- **A bad value inside a caller-supplied `foreignFallback`** (non-JSON-safe `data`, a cyclic object, etc.) — already caught downstream, not a new gap. Every `cloudevent`-mode reverse path — `foreignFallback` included — still funnels its assembled candidate through `CloudEventConverter`'s own `assemble()`, which constructs a real `ArvoEvent`, re-running the exact same construction-time payload walk that already rejects this. It surfaces as an ordinary issue inside the existing `CloudEventTransformationError`, with nothing new needed here.
- **Deeply nested payloads causing a stack overflow** in `JSON.parse` or `ArvoEvent`'s own recursive payload walk — a pre-existing characteristic of both dependencies, inherited unchanged, not introduced or worsened by this class. Matches ADR-001's own explicit deferral of any size limit on `baggage`; out of scope for this change to newly decide.

## Risks / Trade-offs

**`trySerialize`'s and `tryDeserialize`'s declared error types are wider than any single configured instance will actually produce** — accepted, not mitigated. An `arvoevent`-mode instance's `trySerialize` result is always `Ok`, `arvoevent`-mode's `tryDeserialize` never actually produces `CloudEventTransformationError`, and so on. Narrowing this away needs the class generic over its own mode, rejected above as costing more in surface area than the precision is worth.

**A caller who wants to distinguish `SyntaxError` from `ArvoEventValidationError` (or any other future `.cause`) inside a caught `ArvoEventSerializerError` must inspect `.cause`'s own type** — accepted. `ArvoEventSerializerError` deliberately collapses every boundary-level failure into one exported identity so a caller can catch "this class's own boundary failed" in one `instanceof` check; a caller who needs finer discrimination than that already has it available one level down, at no cost this design has to pay for on their behalf. Typing `.cause` as the general `Error` rather than a closed union is itself part of this trade-off: it keeps the surface honest about not being an exhaustive, switch-on-me discriminated union.

**A consumer-supplied `converter` carrying its own enrichment stages can make this class's otherwise-total default behavior fallible** — inherited directly from `CloudEventConverter`'s own, already-accepted trade-off; not new here.

**The `specversion` mode-mismatch guard is a heuristic, not a proof** — accepted, scoped deliberately narrow. It catches the specific, confirmed-dangerous case (raw `ArvoEvent` JSON silently misread as a foreign CloudEvent) without attempting general "is this actually a CloudEvent" validation, which is `CloudEventConverter`'s own job, not this class's to duplicate. A wire payload that happens to carry a `specversion` field for unrelated reasons while still being the wrong mode's output is not caught by this guard — accepted, since manufacturing that collision is far less plausible than the case actually observed.

## Open Questions

- File layout: `src/serializer/index.ts` as a single file is proposed in `tasks.md`, given the class's small surface relative to `ArvoEvent/`'s or `cloudevent/`'s own split-by-concern layouts. Revisit if implementation reveals a natural second concern to separate out.
