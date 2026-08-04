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

- `src/cloudevent/index.ts` — the public class, thin, matching `ArvoEvent/index.ts`'s relationship to `validator.ts`.
- `src/cloudevent/interface.ts` — the per-stage converter contract.
- `src/cloudevent/default.ts` — ADR-003's actual field-placement mapping: the Mapping Table, the wrapper, the canonical encodings, the discriminator logic. The substantial file, analogous to `validator.ts`.
- `src/cloudevent/types.ts` — supporting types: the foreign-adaptation fallback shape, the strict/foreign discriminant, and whatever type represents a CloudEvent in this boundary (see **Open Questions**).
- `src/cloudevent/errors.ts` — mirrors `ArvoEvent/errors.ts`'s depth; see its own decision below.

### The transformation is a class taking an ordered list of paired converters, not a pair of plain functions

```ts
interface IConverter<I, O> {
  convert(data: I): Promise<O>;
  revert(data: O): Promise<I>;
}

class CloudEventConverter {
  constructor(converters?: [IConverter<ArvoEvent, CloudEvent>, ...IConverter<CloudEvent, CloudEvent>[]]);
  async tryConvert(data: ArvoEvent): AsyncResult<CloudEvent, CloudEventTransformationError>;
  async convert(data: ArvoEvent): Promise<CloudEvent>;
  async tryRevert(data: CloudEvent, foreignFallback?: ForeignCloudEventFallback): AsyncResult<ArvoEvent, CloudEventTransformationError>;
  async revert(data: CloudEvent, foreignFallback?: ForeignCloudEventFallback): Promise<ArvoEvent>;
}
```

`new CloudEventConverter()` with no arguments wires in the single ADR-003-defined stage as the default — most consumers never need to know the extensibility exists. A consumer who wants to append a CloudEvent-to-CloudEvent enrichment stage supplies their own converter list; `tryConvert` runs consumer-appended stages forward, in order, after the base mapping's own `convert`; `tryRevert` unwinds them in reverse order before the base mapping's own `revert` runs.

Both directions get the full `tryX`/`X` pair, not just the reverse one. An earlier version of this design gave `convert` no `Result`-returning sibling at all, reasoning that ADR-003 makes the forward direction total. That reasoning holds for ADR-003's own base mapping, but not for `CloudEventConverter` as a class: the constructor accepts an arbitrary consumer-supplied stage list, and `convert` runs every stage in that list, not just the base one. A stage is opaque, third-party code — today's only implemented stage is total, but nothing about the class's own contract can assume that of a stage that doesn't exist yet, and baking "convert can't fail" into the public signature now would force a breaking change the first time it does. So `tryConvert` is the primitive — runs every stage, fails at the first one that throws — and `convert` is the throwing unwrap built on top of it, exactly the same relationship `tryRevert`/`revert` already has, and exactly what `ArvoEvent.tryParse`/`ArvoEvent.parse` established as the pattern in `project.md`.

`IConverter` requires both `convert` and `revert` — neither is optional. This is a deliberate guardrail, not an arbitrary symmetry: it makes a one-way-only stage structurally impossible to construct, which is what preserves reversibility of the whole chain once a consumer appends their own links. It also gives the composite object itself the same shape as one of its own parts (`CloudEventConverter` reads as an `IConverter<ArvoEvent, CloudEvent>`), a composite pattern that falls out of the interface rather than being separately designed.

Losslessness is scoped accordingly. ADR-003's lossless guarantee — ArvoEvent → CloudEvent → ArvoEvent, field for field identical — applies to arvo-core's own default, single-stage pipeline; that much is the ADR's own non-negotiable requirement. Once a consumer stacks their own stages on top, the *combined* pipeline's round-trip fidelity depends on whether the consumer's own `convert`/`revert` pair is itself lossless. The mandatory-pair interface enforces that a reverse exists; it cannot enforce that a consumer's own implementation of it is correct.

**Alternative considered:** async (`Promise`) on every method, even though the default stage itself does no I/O. Kept anyway — not for the default stage's sake, but because a consumer-appended stage plausibly does need I/O (a schema-registry lookup before emitting to a broker is a realistic case), and the interface has to accommodate that from the start rather than forcing a breaking signature change later to add it.

### Both `tryConvert` and `tryRevert` are non-throwing and return a result, not a bare `Promise`

ADR-003 requires the CloudEvent → ArvoEvent hop specifically to be non-throwing and to distinguish behaviorally different outcomes, not merely succeed-or-throw. A bare `Promise<ArvoEvent>` that throws on a malformed or unrecoverable CloudEvent collapses strict-success, foreign-success, and malformed-rejection into one binary "worked or didn't" — precisely the heuristic collapse ADR-003's own Considered Alternatives already rejects ("One undifferentiated reverse behavior"). The same reasoning now applies to `tryConvert` once the class is understood as a pipeline runner rather than a single total mapping: a consumer-appended stage failing is a real, distinguishable outcome from success, not something to collapse into a throw.

`tryConvert` and `tryRevert` therefore both return `arvo-core`'s own `AsyncResult<CloudEvent, CloudEventTransformationError>` / `AsyncResult<ArvoEvent, CloudEventTransformationError>` — a `Promise` resolving to `{ ok: true, value }` or `{ ok: false, error }` — the asynchronous counterpart of the same `Result` shape `ArvoEvent.tryParse` already uses elsewhere in this package, per the `tryX`/`X` convention in `project.md` — an application of the established pattern, not a new one.

`convert` and `revert`, the throwing counterparts, exist purely as convenience: an unwrap around `tryConvert`/`tryRevert` respectively, with no logic of their own — mirroring `ArvoEvent.parse`'s own relationship to `ArvoEvent.tryParse` exactly. See **Errors**, below.

### Pipeline execution is sequential and fail-fast, with stage provenance carried in the error, built internally with `neverthrow`'s combinators

Unlike the base mapping's own structural-validation issues, which are collected exhaustively and reported together (see **Errors**, below), a stage pipeline cannot be aggregated: stage *N*'s input is stage *N − 1*'s output, so a failing stage means every later stage never runs — there is at most one stage failure per call, never a batch. `tryConvert` runs stages forward, starting at index 0 (arvo-core's own base mapping); `tryRevert` unwinds in reverse, running the last-appended stage's `revert` first and the base mapping's own `revert` last. The first stage to fail stops the pipeline immediately; the error carries which stage index failed and which direction was running, not just the raw thrown value, so a consumer with several appended stages can tell where in their own chain the break happened.

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

### `cloudevents` is a peer dependency, not a plain dependency

Its type flows through this transformation's own public API — the converter's input/output types on the reverse direction, and whatever type represents `CloudEvent` throughout `src/cloudevent/`. This is the same reasoning that makes `zod` and `@opentelemetry/api` peer dependencies rather than plain ones: a plain dependency would risk a consumer's own separately-installed copy of `cloudevents` diverging in version from arvo-core's, which matters for a package whose conformance checks and `instanceof`-style behavior depend on structural or nominal identity. `fast-uri` remains exactly as it is (internal, plain dependency, not re-exported) — nothing about this change touches that decision; nothing in this transformation's public API takes or returns a `fast-uri` value.

Per ADR-003's explicit mandate — *"Validation is delegated, not reimplemented... the responsibility of a conformant CloudEvents implementation"* — `cloudevents` is the mechanism by which CloudEvents-level conformance is established for produced and consumed values, not a bespoke reimplementation of the CloudEvents specification's own validity rules.

## Risks / Trade-offs

**The exact type this boundary uses to represent a CloudEvent is not yet settled** (the `cloudevents` SDK's own type, or a hand-written structural interface) → deferred to `tasks.md` as real, empirical work: the SDK's actual exports and behavior must be verified directly (parsing, serialization, validation surface), not assumed from its documentation, the same discipline this package already applied when adopting `fast-uri` for URI-reference validation. See **Open Questions**.

**A consumer-supplied stage could be non-lossless, silently weakening the combined pipeline's round-trip guarantee** → accepted, not mitigated: the mandatory-pair interface guarantees a reverse exists, and arvo-core's own default stage is independently guaranteed lossless by ADR-003; a consumer's own stage being correct is the consumer's responsibility, the same boundary any pluggable-middleware design draws.

**Getting the three-way discriminator wrong (treating "malformed" as either "strict success" or "foreign") is a correctness-critical mistake ADR-003 explicitly forbids** → mitigated by exhaustive, individual test coverage of every condition in the Arvo-Shaped Discrimination requirement, plus explicit tests asserting a partial-marker-match case is rejected and is distinguishable from a genuine foreign-adaptation attempt — not a representative sample, matching the bar this package already holds bespoke, correctness-critical logic to.

**`arvoexecutionunits`' RFC 8785 round-trip check and `arvodepth`'s grammar check are new, bespoke parsing/encoding logic** → held to the same higher bar as any other bespoke code in this package: every boundary case (canonical vs. non-canonical percent-case-of-hex-digit-style variations, leading zeros, signs, exponents for depth; non-canonical numeric spellings for execution units) gets its own individual test, following the same round-trip-equality technique this package already uses and has already proven out for `source`/`dataschema`'s canonical-form check.

## Open Questions

- Does `src/cloudevent/types.ts` re-export the `cloudevents` SDK's own `CloudEvent`-shaped type, or define its own structural interface? Resolve during implementation, once the SDK's actual TypeScript surface has been read and verified directly — this does not change the spec, the chosen approach, or the task breakdown, only which concrete type declaration task 1 produces.
- Whether `cloudevents` exposes a validation/parsing entry point precise enough to satisfy ADR-003's "conformance delegated, not reimplemented" requirement directly, or whether it only offers a constructor that throws on invalid input, shapes how `default.ts` calls into it — again, empirical, and deferred to implementation rather than guessed here.
