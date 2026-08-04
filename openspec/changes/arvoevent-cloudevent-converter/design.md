## Context

See `proposal.md` — Why, for motivation, and `specs/arvoevent-cloudevent-transformation/spec.md` for the exact behavioral obligations this design must satisfy. `src/ArvoEvent/` already provides a stable, unmodified surface this design builds on: the `ArvoEvent` class, `validateArvoEvent` (the same non-throwing structural-validation entry point ADR-003 requires reuse of), and `ArvoEventValidationIssue`/`ArvoEventValidationError` for diagnostics. Nothing here changes any of that; this change only consumes it.

There is a textual signal already in the codebase against placing this transformation inside `src/ArvoEvent/`: `ArvoEvent.tryParse`'s own doc comment states "This checks structure only. It is not a wire-format or CloudEvent decoder." That line predates this change and reads as a deliberate fence.

## Goals / Non-Goals

**Goals:**

- Implement exactly what ADR-003 defines — the forward mapping, the two reverse cases, and the discriminator between them — with no independent reinterpretation of the ADR's field placement, encodings, or behavioral distinctions.
- Give the transformation an extensibility point for a consumer to append their own CloudEvent-to-CloudEvent stages (e.g. custom enrichment), without that extensibility reaching past the abstract CloudEvent into wire-format territory ADR-003 assigns elsewhere.
- Reuse `ArvoEventValidationIssue` and the existing non-throwing validation entry point for every diagnostic this boundary produces, rather than inventing a second, incompatible issue vocabulary.

**Non-Goals:**

- Binary/structured content mode, protocol bindings, or canonical wire serialization — ADR-003 assigns these to infrastructure adapters; this change stops at the abstract CloudEvent object.
- A general-purpose, wire-format-agnostic serialization pipeline (e.g. one whose output type is `string` or an arbitrary `Record`) — considered during design discussion and rejected as reaching past what ADR-003 has decided; see **Considered Alternatives**.
- Revisiting any ADR-003 decision — this design implements the ADR; it does not reopen it.

## Decisions

### Module lives at `src/cloudevent/`, a new top-level sibling of `src/ArvoEvent/` and `src/factory/` — not nested inside `ArvoEvent/`

Existing precedent splits directories by whether they're centered on one class or on a concern: `ArvoEvent/` is PascalCase because it *is* the `ArvoEvent` class; `factory/` is lowercase because it names a concern (building events with lineage) with no single matching class. This transformation is squarely a concern, not a class-shaped noun the way `ArvoEvent` is — so it gets its own lowercase, no-hyphen directory, `src/cloudevent/`, matching `factory/`'s casing exactly. Nesting it inside `ArvoEvent/` was rejected: beyond the casing mismatch, `tryParse`'s own doc comment already disclaims this responsibility for that module.

File layout, mirroring `ArvoEvent/`'s existing split-by-concern pattern (thin class shell in `index.ts`, real logic pulled into named files):

- `src/cloudevent/index.ts` — the public `CloudEventConverter` class, thin, matching `ArvoEvent/index.ts`'s relationship to `validator.ts`.
- `src/cloudevent/interface.ts` — both stage contracts: `ICloudEventConverter` (an enrichment stage) and `IArvoEventTransformer` (the base stage), kept together since both are "the shape a stage must have," not general supporting types.
- `src/cloudevent/default/` — the base field-placement mapping, `ArvoToCloudEventConverter`, implementing `IArvoEventTransformer`. Split by concern the way `default.ts` grew too large to stay one file: `constants.ts` (fixed protocol values), `codecs/` (`ICodec<T, E>` plus `DepthCodec`/`ExecutionUnitsCodec`), `content-type.ts` (`datacontenttype` parsing), `encode.ts` (the forward mapping), `decode/` (the discriminator plus `strict.ts`/`foreign.ts`, the two reverse cases), and `index.ts` tying them together.
- `src/cloudevent/types.ts` — supporting types: the foreign-adaptation fallback shape, the strict/foreign discriminant, and re-exports of `cloudevents`' own `CloudEvent`/`CloudEventV1` (see **`cloudevents`'s actual TypeScript surface**, below).
- `src/cloudevent/errors.ts` — mirrors `ArvoEvent/errors.ts`'s depth; see its own decision below.

### The transformation is a class taking a base transformer plus an ordered list of enrichment stages, not one uniform stage list

```ts
interface ICloudEventConverter {
  convert(data: CloudEvent): Promise<CloudEvent>;
  revert(data: CloudEvent): Promise<CloudEvent>;
}

interface IArvoEventTransformer {
  convert(data: ArvoEvent): Promise<CloudEvent>;
  revert(data: CloudEvent, foreignFallback?: ForeignCloudEventFallback): Promise<ArvoEvent>;
}

class CloudEventConverter {
  constructor(transformer?: IArvoEventTransformer, converters?: ICloudEventConverter[]);
  async tryConvert(data: ArvoEvent): AsyncResult<CloudEvent, CloudEventTransformationError>;
  async convert(data: ArvoEvent): Promise<CloudEvent>;
  async tryRevert<T extends string = string, D extends Record<string, any> = Record<string, any>>(
    data: CloudEvent,
    foreignFallback?: ForeignCloudEventFallback,
  ): AsyncResult<ArvoEvent<T, D>, CloudEventTransformationError>;
  async revert<T extends string = string, D extends Record<string, any> = Record<string, any>>(
    data: CloudEvent,
    foreignFallback?: ForeignCloudEventFallback,
  ): Promise<ArvoEvent<T, D>>;
}
```

`tryRevert`/`revert` take `T`/`D` type parameters, exactly matching `ArvoEvent.parse`/`ArvoEvent.tryParse`'s own shape — a caller who already knows which contract a CloudEvent belongs to asserts it at the call site (`converter.revert<'order.created', OrderPayload>(ce, fallback)`) rather than always getting back the unnarrowable default `ArvoEvent<string, Record<string, any>>`. This is a compile-time assertion only, identical in kind to `ArvoEvent.parse<T, D>()`'s own — nothing here validates that the resulting event's `data` actually matches `D`; a caller asserting the wrong type gets a wrongly-typed but still structurally-valid `ArvoEvent`, the same trade-off `ArvoEvent.parse` already makes. Real, contract-backed validation of `data` against `D` remains `ArvoContract`'s job, applied after `revert` returns — this only removes the friction of the default being unnarrowable even when the caller already knows better. `convert`/`tryConvert` stay non-generic: their input is already a caller-typed `ArvoEvent`, and their output type is `CloudEvent`, which has no equivalent `T`/`D` to narrow.

`new CloudEventConverter()` with no arguments wires in the base field-placement mapping as `transformer` and an empty enrichment list — most consumers never need to know the extensibility exists. A consumer who wants to append a CloudEvent-to-CloudEvent enrichment stage supplies `converters`; `tryConvert` runs `transformer.convert` first, then every appended stage forward, in order; `tryRevert` unwinds appended stages in reverse order, then runs `transformer.revert` last.

**Revised from an earlier version of this design**, which had one generic `IConverter<I, O>` interface, gave the base stage the instantiation `IConverter<ArvoEvent, CloudEvent>`, and passed both the base stage and every appended one through a single tuple-typed `converters` parameter — `constructor(converters?: [IConverter<ArvoEvent, CloudEvent>, ...IConverter<CloudEvent, CloudEvent>[]])`, index 0 implicitly meaning "the base one." That fell apart the moment `foreignFallback` needed to reach the base stage's `revert` specifically: a generic `IConverter<O, I>.revert(data: O): Promise<I>` only ever declares one parameter, so the implementation had to reach for `(stage.revert as SomeWiderType)(value, foreignFallback)` at the call site — a cast asserting a contract the generic interface never actually stated. Nothing stopped a consumer from supplying their own `IConverter<ArvoEvent, CloudEvent>` as index 0 whose `revert` didn't accept a second parameter at all; the cast would still compile, the call would still run (JS silently drops an argument a function doesn't declare), and `foreignFallback` would vanish with no error — a caller who passed one would have it silently ignored by a substituted base stage without ever finding out.

Splitting into two purpose-built interfaces closes that hole by giving the base stage its own honest contract instead of forcing it through a generic shape. `IArvoEventTransformer`'s `revert(data: CloudEvent, foreignFallback?: ForeignCloudEventFallback): Promise<ArvoEvent>` is a real, checked signature, not a cast — a consumer substituting their own `transformer` is typed against this from the start, with no ambiguity about whether `foreignFallback` is meaningful to it. `ICloudEventConverter` is what the old generic `IConverter<CloudEvent, CloudEvent>` instantiation already was, just no longer generic, since a CloudEvent-to-CloudEvent enrichment stage is the only thing it's ever used for — and it never had any business with `foreignFallback` in the first place.

The two-parameter constructor is a direct consequence, not an independent choice: `transformer` and `converters` play genuinely different roles (the ArvoEvent↔CloudEvent boundary vs. CloudEvent-to-CloudEvent enrichment), so naming them separately states that difference at the call site instead of relying on a reader to know "index 0 of this tuple is special."

**Given up, and accepted:** the previous design's observation that `CloudEventConverter` "reads as an `IConverter<ArvoEvent, CloudEvent>` itself, being built from parts of that same shape" no longer holds — `IArvoEventTransformer` is a sibling interface, not an instantiation of `IConverter`. Nothing depended on that self-similarity; it was a nice consequence of the old shape, not a requirement anything else in this design relies on.

Both `ICloudEventConverter` and `IArvoEventTransformer` still require both directions — neither has an optional method. That guardrail is unchanged: it makes a one-way-only stage structurally impossible to construct, preserving reversibility of the whole chain once a consumer appends their own links.

Both directions get the full `tryX`/`X` pair, not just the reverse one. An earlier version of this design gave `convert` no `Result`-returning sibling at all, reasoning that ADR-003 makes the forward direction total. That reasoning holds for ADR-003's own base mapping, but not for `CloudEventConverter` as a class: the constructor accepts an arbitrary consumer-supplied `transformer` and enrichment list, and `convert` runs every stage in that chain, not just the base one. A stage is opaque, third-party code — today's only implemented stages are total, but nothing about the class's own contract can assume that of a stage that doesn't exist yet, and baking "convert can't fail" into the public signature now would force a breaking change the first time it does. So `tryConvert` is the primitive — runs every stage, fails at the first one that throws — and `convert` is the throwing unwrap built on top of it, exactly the same relationship `tryRevert`/`revert` already has, and exactly what `ArvoEvent.tryParse`/`ArvoEvent.parse` established as the pattern in `project.md`.

Losslessness is scoped accordingly. ADR-003's lossless guarantee — ArvoEvent → CloudEvent → ArvoEvent, field for field identical — applies to arvo-core's own default, single-stage pipeline; that much is the ADR's own non-negotiable requirement. Once a consumer stacks their own stages on top, the *combined* pipeline's round-trip fidelity depends on whether the consumer's own `convert`/`revert` pair is itself lossless. The mandatory-pair interfaces enforce that a reverse exists; they cannot enforce that a consumer's own implementation of it is correct.

**Alternative considered:** async (`Promise`) on every method, even though the default stage itself does no I/O. Kept anyway — not for the default stage's sake, but because a consumer-appended stage plausibly does need I/O (a schema-registry lookup before emitting to a broker is a realistic case), and the interface has to accommodate that from the start rather than forcing a breaking signature change later to add it.

### Both `tryConvert` and `tryRevert` are non-throwing and return a result, not a bare `Promise`

ADR-003 requires the CloudEvent → ArvoEvent hop specifically to be non-throwing and to distinguish behaviorally different outcomes, not merely succeed-or-throw. A bare `Promise<ArvoEvent>` that throws on a malformed or unrecoverable CloudEvent collapses strict-success, foreign-success, and malformed-rejection into one binary "worked or didn't" — precisely the heuristic collapse ADR-003's own Considered Alternatives already rejects ("One undifferentiated reverse behavior"). The same reasoning now applies to `tryConvert` once the class is understood as a pipeline runner rather than a single total mapping: a consumer-appended stage failing is a real, distinguishable outcome from success, not something to collapse into a throw.

`tryConvert` and `tryRevert` therefore both return `arvo-core`'s own `AsyncResult<CloudEvent, CloudEventTransformationError>` / `AsyncResult<ArvoEvent, CloudEventTransformationError>` — a `Promise` resolving to `{ ok: true, value }` or `{ ok: false, error }` — the asynchronous counterpart of the same `Result` shape `ArvoEvent.tryParse` already uses elsewhere in this package, per the `tryX`/`X` convention in `project.md` — an application of the established pattern, not a new one.

`convert` and `revert`, the throwing counterparts, exist purely as convenience: an unwrap around `tryConvert`/`tryRevert` respectively, with no logic of their own — mirroring `ArvoEvent.parse`'s own relationship to `ArvoEvent.tryParse` exactly. See **Errors**, below.

### Pipeline execution is sequential and fail-fast, with stage provenance carried in the error, built internally with `neverthrow`'s combinators

Unlike the base mapping's own structural-validation issues, which are collected exhaustively and reported together (see **Errors**, below), a stage pipeline cannot be aggregated: stage *N*'s input is stage *N − 1*'s output, so a failing stage means every later stage never runs — there is at most one stage failure per call, never a batch. `stageIndex` numbers `transformer` as `0` and each entry of `converters` as `1, 2, …` in array order — one continuous index across both constructor parameters, even though they're supplied separately. `tryConvert` runs `transformer.convert` first, then every `converters` entry forward, in order; `tryRevert` unwinds `converters` in reverse, then runs `transformer.revert` last. The first stage to fail stops the pipeline immediately; the error carries which stage index failed and which direction was running, not just the raw thrown value, so a consumer with several appended stages can tell where in their own chain the break happened.

Internally this is built with `neverthrow`'s `ResultAsync`, not a hand-rolled loop: each stage invocation is wrapped with `ResultAsync.fromPromise(stage.convert(data), mapStageError)` (or `.revert(...)` on the reverse path), chained across the stage list with `.andThen(...)`, which gives fail-fast short-circuiting for free — the next stage's `fromPromise` call is never constructed once an earlier link is `Err`. This is heavier use of `neverthrow` than `ArvoEvent.tryParse`'s single try/catch needed, but it is the same internal-only boundary already established in `src/result.ts`: the chain is built entirely with neverthrow's own types and converted to arvo-core's plain `AsyncResult` only at the very end, via `fromNeverthrowAsync`, exactly where `tryConvert`/`tryRevert` return. `src/cloudevent/` becomes a second call site into `src/result.ts` — today only `ArvoEvent/index.ts` uses it — which is itself evidence the boundary generalizes rather than being an `ArvoEvent`-specific one-off.

### The reverse-direction discriminator is three-valued, not boolean

An earlier version of this design proposed a boolean `isArvoShapedCloudEvent` predicate. Re-reading ADR-003's exact text corrected this: *"A value matching either the Arvo media type or the Arvo wrapper-schema URI but failing any other condition is a malformed Arvo-shaped event"* — meaning the real decision has three outcomes, not two:

- **Neither** `datacontenttype` nor `dataschema` claims Arvo shape → foreign.
- **Either** marker present, and every other condition holds → strict, success.
- **Either** marker present, but some other condition fails → malformed, rejected — and critically, this MUST NOT be retried as foreign.

A boolean predicate cannot represent the difference between the second and third outcomes. `tryRevert`'s internal logic checks the OR-of-markers first, to decide whether a subsequent failure is "malformed" (attempted as strict, rejected) or genuinely "foreign" (attempted as foreign, on its own terms). There is no separate exported `isArvoShapedCloudEvent` boolean in the public surface for this reason — a boolean answer to "is this Arvo-shaped" is exactly the question that produces a wrong answer for the malformed case.

### Errors: reuse `ArvoEventValidationIssue` for structural issues; add a distinct stage-failure shape; no new issue type

ADR-003 states plainly: *"Deserialization MUST NOT define a second ArvoEvent validity rule set."* Taken to its natural conclusion for diagnostics: a structural problem produced by arvo-core's own base mapping (a missing `arvoexecutionid` extension, a malformed `arvodepth` encoding, a foreign `data` that isn't an object, a missing caller-supplied `dataschema` fallback) is reported through the exact same `{ path, message, received }` shape as an ordinary ArvoEvent structural-validity issue — imported from `ArvoEvent/errors.ts`, not redefined.

A consumer-appended stage failing is a different shape entirely — not a validation issue at all, but whatever that stage's own code threw, which this boundary cannot know in advance. `CloudEventTransformationError` stays a single `Error` subclass — one thing to `throw`, one `instanceof` check, matching `ArvoEventValidationError`'s own precedent — but the two distinct failure shapes live in a nested `detail` field typed as a real discriminated union, not flattened onto the class's own instance properties:

```ts
type CloudEventTransformationErrorDetail =
  | { kind: 'strict' | 'foreign'; issues: readonly ArvoEventValidationIssue[] }
  | { kind: 'stage'; direction: 'convert' | 'revert'; stageIndex: number; cause: unknown };

class CloudEventTransformationError extends Error {
  readonly detail: CloudEventTransformationErrorDetail;
  constructor(detail: CloudEventTransformationErrorDetail, options?: ErrorOptions);
}
```

Flattening the union's fields directly onto the class instead (`kind`, `issues?`, `direction?`, `stageIndex?`, `cause?` all optional on the instance) was considered and rejected: TypeScript cannot narrow a class's own optional fields the way it narrows a genuine union value, so a caller checking `error.kind === 'stage'` would still see `error.issues` typed as possibly-present rather than correctly excluded. Nesting the union in `detail` keeps `CloudEventTransformationError` itself a single class while `error.detail.kind === 'stage'` narrows `error.detail` fully, giving real compile-time safety on which fields exist for which failure.

The first variant is the base mapping's own structural rejection, exactly as before: a caller handling a failed `tryConvert`/`tryRevert`'s `result.error.detail.issues` (after narrowing on `kind`) never needs to know or care which layer produced a given entry. The second is new: any stage in the pipeline throwing during `convert` or `revert` is captured with which stage index and which direction, and the thrown value itself preserved as `cause` rather than discarded or reshaped — this boundary has no way to know what a third-party stage's thrown value means, so it locates it rather than reinterpreting it.

This is a deliberate departure from `ArvoEvent.tryParse`'s catch-boundary rule (`project.md`: catch only the expected failure type, re-throw anything else). That rule works for `tryParse` because the constructor's failure modes are exhaustively known in advance — one class, one validator, one exception type. A pipeline stage is arbitrary, unknowable third-party code; there is no fixed exception type to filter for, so "a stage threw" is unconditionally the expected failure here — `tryConvert`/`tryRevert` catch every stage's thrown value, full stop, rather than type-checking it first. Worth stating explicitly rather than leaving a reader to assume the same re-throw rule applies uniformly across the package.

There is no third `'malformed'` kind alongside `'strict'`/`'foreign'`: a malformed Arvo-shaped event is discovered *while attempting the strict path* (`kind: 'strict'`, with issues explaining exactly what was missing or wrong), not a separate code path with its own kind. `CloudEventTransformationError` is thrown by `convert`/`revert` and carried as `tryConvert`/`tryRevert`'s `Err` value.

Deliberately not added: a `source: 'mapping' | 'structural'` tag on individual issues within the `'strict'`/`'foreign'` branch. A reader can already tell which layer an issue came from by its `path` — `arvoexecutionid` or `data.arvoeventbaggage` reads as a CloudEvent-boundary problem, `subject` or `dataschema` reads as ArvoEvent's own field rule — so a redundant tag would duplicate information the path already carries.

### `cloudevents`'s actual TypeScript surface, verified directly against v10.0.0

Both remaining Open Questions from an earlier draft of this design were resolved by reading the package's own `.d.ts`/`.js` output directly (`npm pack cloudevents`, inspected at v10.0.0), rather than assumed from its README, per this package's own discipline for adopting a new dependency:

- **The type.** `cloudevents` exports both a concrete `CloudEvent<T>` class and a plain `CloudEventV1<T>` structural interface (the class implements the interface). Both carry a `[key: string]: unknown` index signature — extension attributes are just ordinary properties, there is no separate extensions bag to unwrap. `src/cloudevent/types.ts` re-exports both directly rather than hand-writing a structural interface, but only `CloudEvent` (the class) is used as a type anywhere in this module's own signatures — forward output and reverse input alike — since constructing a real instance is literally how CloudEvents conformance gets delegated, per ADR-003's mandate, and a single type on both sides of the boundary is simpler than tracking which side accepts the wider shape. **Revised from an earlier version of this design**, which planned to type the reverse direction's input as `CloudEventV1` specifically, reasoning that it would accept a plain deserialized object (e.g. from a message transport's own `Deserializer`) without requiring the caller to first construct a real `CloudEvent`. That reasoning was sound but the class itself already provides the escape hatch it was solving for: `new CloudEvent(plainObject, false)` — `strict: false` skips `cloudevents`' own conformance check entirely — turns a plain object into a real instance cheaply, so a caller with only plain data still has a one-line path in, without this module needing to carry two input types through every signature and every internal helper. `CloudEventV1` remains exported from `src/cloudevent/types.ts` for a consumer who wants the looser type for their own code; nothing here still claims this module's own signatures use it.
- **The validation entry point.** `cloudevents` exposes no non-throwing conformance check at all. `new CloudEvent(data, strict = true)` validates by default and throws `ValidationError extends TypeError` (carrying `.errors: string[] | ErrorObject[]`, from its internal `ajv`-based schema) on nonconformance; `strict = false` skips validation entirely with no partial feedback. The instance method `.validate()` does not offer a boolean-only failure path either — despite its doc comment claiming to `@return boolean`, reading its implementation shows it only ever returns `true`; on failure it throws the identical `ValidationError`. There is no fourth option to reach for.

This settles how `default.ts` calls into the SDK: conformance delegation on both directions goes through a throwing constructor call wrapped in the same catch boundary already designed for pipeline stages (see **Pipeline execution...**, above) — not a separate mechanism. It also resolves a case the earlier error-shape design didn't yet consider: the base mapping's own `convert` is stage 0 of `CloudEventConverter`'s pipeline, so if `new CloudEvent(...)` inside it ever threw a `ValidationError` — which ADR-003's Forward Transformation Totality requirement and ADR-002's field-domain narrowing together guarantee it will not, for any structurally valid ArvoEvent — it would surface as an ordinary `kind: 'stage'` failure (`stageIndex: 0`, `direction: 'convert'`, `cause` the `ValidationError`), not a new fourth failure kind. The three-shape error design already covers this without modification.

(This finding is pinned to `cloudevents` v10.0.0's actual behavior; re-verify directly, the same way, before adopting a materially different major version.)

### `cloudevents` is a peer dependency, not a plain dependency

Its type flows through this transformation's own public API — the converter's input/output types on the reverse direction, and whatever type represents `CloudEvent` throughout `src/cloudevent/`. This is the same reasoning that makes `zod` and `@opentelemetry/api` peer dependencies rather than plain ones: a plain dependency would risk a consumer's own separately-installed copy of `cloudevents` diverging in version from arvo-core's, which matters for a package whose conformance checks and `instanceof`-style behavior depend on structural or nominal identity. `fast-uri` remains exactly as it is (internal, plain dependency, not re-exported) — nothing about this change touches that decision; nothing in this transformation's public API takes or returns a `fast-uri` value.

Per ADR-003's explicit mandate — *"Validation is delegated, not reimplemented... the responsibility of a conformant CloudEvents implementation"* — `cloudevents` is the mechanism by which CloudEvents-level conformance is established for produced and consumed values, not a bespoke reimplementation of the CloudEvents specification's own validity rules.

## Risks / Trade-offs

**A consumer-supplied stage could be non-lossless, silently weakening the combined pipeline's round-trip guarantee** → accepted, not mitigated: the mandatory-pair interface guarantees a reverse exists, and arvo-core's own default stage is independently guaranteed lossless by ADR-003; a consumer's own stage being correct is the consumer's responsibility, the same boundary any pluggable-middleware design draws.

**Getting the three-way discriminator wrong (treating "malformed" as either "strict success" or "foreign") is a correctness-critical mistake ADR-003 explicitly forbids** → mitigated by exhaustive, individual test coverage of every condition in the Arvo-Shaped Discrimination requirement, plus explicit tests asserting a partial-marker-match case is rejected and is distinguishable from a genuine foreign-adaptation attempt — not a representative sample, matching the bar this package already holds bespoke, correctness-critical logic to.

**`arvoexecutionunits`' RFC 8785 round-trip check and `arvodepth`'s grammar check are new, bespoke parsing/encoding logic** → held to the same higher bar as any other bespoke code in this package: every boundary case (canonical vs. non-canonical percent-case-of-hex-digit-style variations, leading zeros, signs, exponents for depth; non-canonical numeric spellings for execution units) gets its own individual test, following the same round-trip-equality technique this package already uses and has already proven out for `source`/`dataschema`'s canonical-form check.
