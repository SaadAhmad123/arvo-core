## 1. Shared types

- [x] 1.1 `src/serializer/index.ts` (or a sibling `types.ts` if the file grows past a single concern) — define `ArvoEventSerializerMode = { type: 'arvoevent' } | { type: 'cloudevent'; converter?: CloudEventConverter }`
- [x] 1.2 New `ArvoEventSerializerError` class (`src/serializer/errors.ts` or co-located with the mode type, matching whichever file-layout decision task 1.1 lands on): `extends Error`, `readonly cause: Error` (general `Error`, deliberately not narrowed to a closed union — see `design.md`), constructor accepts that `cause` and sets both `.cause` and a human-readable `.message`. `trySerialize`/`tryDeserialize` wrap every failure they themselves originate (a `JSON.parse` `SyntaxError`, a `JSON.stringify` `TypeError`, an `ArvoEvent.tryParse` `ArvoEventValidationError`) in this class; a `CloudEventTransformationError` from `CloudEventConverter` is always passed through unwrapped, never nested inside `ArvoEventSerializerError`. `CloudEventTransformationError` itself is not modified anywhere in this change

## 2. `ArvoEventSerializer` — construction and forward direction

- [x] 2.1 `ArvoEventSerializer`'s constructor accepts an optional `ArvoEventSerializerMode`, defaulting to `{ type: 'cloudevent', converter: new CloudEventConverter() }` when no mode (or no `converter` within a supplied `cloudevent` mode) is given
- [x] 2.2 `trySerialize(event: ArvoEvent): AsyncResult<string, CloudEventTransformationError | ArvoEventSerializerError>` — `arvoevent` mode: `JSON.stringify(event)`; `cloudevent` mode: `JSON.stringify(await converter.convert(event))`. Delegates entirely to `CloudEventConverter.tryConvert` for the `cloudevent` case's own stage failures, passed through as `CloudEventTransformationError` unwrapped — never throws itself, and reports only what `tryConvert` itself would report for those
- [x] 2.3 `trySerialize` additionally wraps its own `JSON.stringify` call (not `tryConvert`'s result before stringifying — the stringify step itself) in a try/catch, folding a thrown `TypeError` (a circular reference or a `BigInt` a custom stage introduced after the base mapping's own JSON-safety guarantee no longer applies, verified directly against `cloudevents` v10.0.0) into `new ArvoEventSerializerError(thrownTypeError)` rather than letting it escape uncaught. `arvoevent` mode is exempt — `ArvoEvent`'s own construction-time payload walk already forecloses this
- [x] 2.4 `serialize(event: ArvoEvent): Promise<string>` — a throwing convenience with no logic of its own beyond unwrapping `trySerialize`, mirroring `ArvoEvent.parse`'s relationship to `ArvoEvent.tryParse`

## 3. `ArvoEventSerializer` — reverse direction

- [x] 3.1 `tryDeserialize<T, D>(data: string, foreignFallback?: ForeignCloudEventFallback): AsyncResult<ArvoEvent<T, D>, CloudEventTransformationError | ArvoEventSerializerError>` — catches `JSON.parse(data)`'s own thrown `SyntaxError` and (in `arvoevent` mode) `ArvoEvent.tryParse`'s `ArvoEventValidationError`, folding both into `ArvoEventSerializerError`; `cloudevent` mode's `specversion` guard and `CloudEventConverter.tryRevert` already return `CloudEventTransformationError` directly and are passed through unwrapped
- [x] 3.2 `cloudevent` mode's `tryDeserialize` constructs `new CloudEvent(JSON.parse(data), false)` before handing it to `converter.tryRevert` — `strict: false`, so `cloudevents`' own conformance check never runs and never pre-empts `tryRevert`'s own, more informative discriminator
- [x] 3.3 `cloudevent` mode's `tryDeserialize` rejects a parsed value with no `specversion` string field before calling `converter.tryRevert` at all — verified necessary directly (`new CloudEvent(x, false)` never throws for any input, and foreign adaptation does not itself require `specversion`, so without this guard, `arvoevent`-mode wire JSON deserialized in `cloudevent` mode does not fail cleanly). Reported via a directly-constructed `CloudEventTransformationError({ kind: 'foreign', issues: [{ path: 'specversion', message: 'is required' }] })` — the existing type's own public constructor, no new class, no change to `CloudEventConverter`. Passed through unwrapped, not folded into `ArvoEventSerializerError` — it names a transformation-shape defect, not a boundary failure this class introduced
- [x] 3.4 `foreignFallback` is accepted unconditionally on the signature but only read in `cloudevent` mode; `arvoevent` mode ignores it silently — documented explicitly in this method's own TSDoc, per `project.md`'s "Documentation in source" convention
- [x] 3.5 `deserialize<T, D>(data: string, foreignFallback?: ForeignCloudEventFallback): Promise<ArvoEvent<T, D>>` — a throwing convenience with no logic of its own beyond unwrapping `tryDeserialize`

## 4. Public exports

- [x] 4.1 `src/index.ts` — export `ArvoEventSerializer`, `ArvoEventSerializerMode`, and `ArvoEventSerializerError`

## 5. Tests — construction and mode selection

- [x] 5.1 No-argument construction defaults to `cloudevent` mode with a default-constructed `CloudEventConverter`
- [x] 5.2 A caller-supplied `CloudEventConverter` (including one carrying custom enrichment stages) is the one actually used by both `serialize` and `deserialize`
- [x] 5.3 `{ type: 'arvoevent' }` mode never touches `CloudEvent` at any point — verify no CloudEvent-shaped fields (`specversion`, `datacontenttype`, etc.) appear in `serialize`'s output

## 6. Tests — serialize / trySerialize

- [x] 6.1 `arvoevent` mode: `JSON.parse(await serialize(event))` matches `ArvoEvent`'s own default `JSON.stringify(event)` output exactly
- [x] 6.2 `cloudevent` mode: `JSON.parse(await serialize(event))` matches `JSON.stringify(await converter.convert(event))` exactly, including the real wire path (not the in-memory object), per the precedent `arvoevent-cloudevent-converter`'s own `default.spec.ts` established
- [x] 6.3 `trySerialize` never rejects/throws in either mode's default configuration
- [x] 6.4 A custom `converters` stage that throws during `convert` is reported by `trySerialize` as the same `CloudEventTransformationError` (`kind: 'stage'`) `CloudEventConverter.tryConvert` itself would report — no re-wrapping in `ArvoEventSerializerError`
- [x] 6.5 `serialize` throws that same error when the stage fails
- [x] 6.6 A custom `converters` stage that succeeds but produces a CloudEvent containing a circular reference is reported by `trySerialize` as `ArvoEventSerializerError`, with the thrown `TypeError` available via `.cause`
- [x] 6.7 `serialize` throws that same `ArvoEventSerializerError` for the same circular-reference case

## 7. Tests — deserialize / tryDeserialize

- [x] 7.1 Full round trip: `deserialize(await serialize(event))` reconstructs `event` field for field, in both modes
- [x] 7.2 `cloudevent` mode: a plain object produced by `JSON.parse` (not a real `CloudEvent` instance) deserializes correctly with no caller-side wrapping — the exact case `developer-usage-findings.md` Finding 1 named as the first mistake `CloudEventConverter` alone invites
- [x] 7.3 Non-JSON input (`"not json at all"`) is reported through `tryDeserialize`'s `Result` as `ArvoEventSerializerError`, with the original `SyntaxError` available via `.cause`, not thrown uncaught
- [x] 7.4 `deserialize` throws that same `ArvoEventSerializerError` for the same input
- [x] 7.5 `arvoevent` mode: a structurally invalid parsed object reports `ArvoEventSerializerError` through the `Result`, with the original `ArvoEventValidationError` available via `.cause`
- [x] 7.6 `cloudevent` mode: a CloudEvent-shaped-but-invalid parsed object reports `CloudEventTransformationError` (`kind: 'strict'`) through the `Result`, unwrapped, matching `CloudEventConverter.tryRevert`'s own behavior for the identical input
- [x] 7.7 `cloudevent` mode: a foreign-shaped parsed object with a supplied `foreignFallback` adapts correctly
- [x] 7.8 `cloudevent` mode: a `foreignFallback` supplied in `arvoevent` mode has no effect — the parsed object either succeeds or fails exactly as it would with no fallback supplied at all
- [x] 7.9 `deserialize<T, D>`/`tryDeserialize<T, D>` with explicit type parameters compiles and returns the asserted `ArvoEvent<T, D>` type — a compile-time-only assertion, not a runtime check (verify no runtime validation of `D` occurs beyond what the underlying `tryParse`/`tryRevert` already performs)
- [x] 7.10 `cloudevent` mode: a parsed value with no `specversion` field is reported through `tryDeserialize`'s `Result` as `CloudEventTransformationError` (`kind: 'foreign'`, naming `specversion`), unwrapped, without attempting foreign adaptation on the rest of the value
- [x] 7.11 `cloudevent` mode: JSON produced by an `arvoevent`-mode `serialize` call, passed into a `cloudevent`-mode `deserialize`, fails via the `specversion` guard (task 7.10) rather than producing a plausible-looking but incorrect `ArvoEvent`

## 8. Close out

- [x] 8.1 `pnpm lint` clean
- [x] 8.2 `pnpm test` — full suite green, 100% statement/branch/function/line coverage of `src/serializer/**`
- [x] 8.3 `pnpm exec openspec validate arvoevent-serializer --strict` passes
- [x] 8.4 Decide whether a changeset is needed, following the same reasoning already applied to `arvoevent-cloudevent-converter` (no changeset while `v4` is not being released imminently), and record the decision. **Decided: no changeset**, same reasoning as `arvoevent-cloudevent-converter` (commit `9ab0013`'s predecessor decision, and `rebuild-arvoevent-structure` before it) — this merges into `v4`, not being released imminently; the real changeset gets written once `v4` approaches release, covering everything merged into it by then
- [x] 8.5 A developer-usage pass, matching the discipline `arvoevent-cloudevent-converter` established — actually use `ArvoEventSerializer` as a consumer would in both modes before considering this change done, recording findings in a `developer-usage-findings.md`
