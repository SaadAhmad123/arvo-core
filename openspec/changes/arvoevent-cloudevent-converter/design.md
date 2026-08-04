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
  async convert(data: ArvoEvent): Promise<CloudEvent>;
  async tryRevert(data: CloudEvent, foreignFallback?: ForeignCloudEventFallback): AsyncResult<ArvoEvent, CloudEventTransformationError>;
  async revert(data: CloudEvent, foreignFallback?: ForeignCloudEventFallback): Promise<ArvoEvent>;
}
```

`new CloudEventConverter()` with no arguments wires in the single ADR-003-defined stage as the default — most consumers never need to know the extensibility exists. A consumer who wants to append a CloudEvent-to-CloudEvent enrichment stage supplies their own converter list; `tryRevert` unwinds consumer-appended stages in reverse order before the base mapping's own `revert` runs.

`convert` needs no `Result`-returning sibling: ADR-003 makes the forward direction total, so there is no expected failure mode for a `tryConvert` to report — a genuinely non-fallible operation sits outside the `tryX`/`X` convention entirely, the same way `ArvoEvent`'s own field accessors do. The reverse direction is where a `tryX`/`X` pair belongs, per `project.md`'s general convention: `tryRevert` is the primitive returning `Result`, `revert` is the throwing convenience built on top of it, exactly mirroring `ArvoEvent.tryParse`/`ArvoEvent.parse`.

`IConverter` requires both `convert` and `revert` — neither is optional. This is a deliberate guardrail, not an arbitrary symmetry: it makes a one-way-only stage structurally impossible to construct, which is what preserves reversibility of the whole chain once a consumer appends their own links. It also gives the composite object itself the same shape as one of its own parts (`CloudEventConverter` reads as an `IConverter<ArvoEvent, CloudEvent>`), a composite pattern that falls out of the interface rather than being separately designed.

Losslessness is scoped accordingly. ADR-003's lossless guarantee — ArvoEvent → CloudEvent → ArvoEvent, field for field identical — applies to arvo-core's own default, single-stage pipeline; that much is the ADR's own non-negotiable requirement. Once a consumer stacks their own stages on top, the *combined* pipeline's round-trip fidelity depends on whether the consumer's own `convert`/`revert` pair is itself lossless. The mandatory-pair interface enforces that a reverse exists; it cannot enforce that a consumer's own implementation of it is correct.

**Alternative considered:** async (`Promise`) on every method, even though the default stage itself does no I/O. Kept anyway — not for the default stage's sake, but because a consumer-appended stage plausibly does need I/O (a schema-registry lookup before emitting to a broker is a realistic case), and the interface has to accommodate that from the start rather than forcing a breaking signature change later to add it.

### `tryRevert`'s boundary-crossing hop is non-throwing and returns a result, not a bare `Promise<ArvoEvent>`

ADR-003 requires the CloudEvent → ArvoEvent hop specifically to be non-throwing and to distinguish behaviorally different outcomes, not merely succeed-or-throw. A bare `Promise<ArvoEvent>` that throws on a malformed or unrecoverable CloudEvent collapses strict-success, foreign-success, and malformed-rejection into one binary "worked or didn't" — precisely the heuristic collapse ADR-003's own Considered Alternatives already rejects ("One undifferentiated reverse behavior"). `tryRevert` therefore returns `arvo-core`'s own `AsyncResult<ArvoEvent, CloudEventTransformationError>` — a `Promise` resolving to `{ ok: true, value }` or `{ ok: false, error }` — the asynchronous counterpart of the same `Result` shape `ArvoEvent.tryParse` already uses elsewhere in this package, per the `tryX`/`X` convention in `project.md` — an application of the established pattern, not a new one.

`revert`, the throwing counterpart, exists purely as convenience: an unwrap around `tryRevert`, with no logic of its own — mirroring `ArvoEvent.parse`'s own relationship to `ArvoEvent.tryParse` exactly. See **Errors**, below.

### The reverse-direction discriminator is three-valued, not boolean

An earlier version of this design proposed a boolean `isArvoShapedCloudEvent` predicate. Re-reading ADR-003's exact text corrected this: *"A value matching either the Arvo media type or the Arvo wrapper-schema URI but failing any other condition is a malformed Arvo-shaped event"* — meaning the real decision has three outcomes, not two:

- **Neither** `datacontenttype` nor `dataschema` claims Arvo shape → foreign.
- **Either** marker present, and every other condition holds → strict, success.
- **Either** marker present, but some other condition fails → malformed, rejected — and critically, this MUST NOT be retried as foreign.

A boolean predicate cannot represent the difference between the second and third outcomes. `tryRevert`'s internal logic checks the OR-of-markers first, to decide whether a subsequent failure is "malformed" (attempted as strict, rejected) or genuinely "foreign" (attempted as foreign, on its own terms). There is no separate exported `isArvoShapedCloudEvent` boolean in the public surface for this reason — a boolean answer to "is this Arvo-shaped" is exactly the question that produces a wrong answer for the malformed case.

### Errors: reuse `ArvoEventValidationIssue`; add one new throwing error, no new issue type

ADR-003 states plainly: *"Deserialization MUST NOT define a second ArvoEvent validity rule set."* Taken to its natural conclusion for diagnostics: a mapping-level problem (a missing `arvoexecutionid` extension, a malformed `arvodepth` encoding, a foreign `data` that isn't an object, a missing caller-supplied `dataschema` fallback) is reported through the exact same `{ path, message, received }` shape as an ordinary ArvoEvent structural-validity issue — imported from `ArvoEvent/errors.ts`, not redefined. A caller handling a failed `tryRevert`'s `result.error.issues` never needs to know or care which layer produced a given entry.

The one new thing `src/cloudevent/errors.ts` adds is `CloudEventTransformationError extends Error` — thrown by `revert` and carried as `tryRevert`'s `Err` value, carrying `kind: 'strict' | 'foreign'` (which reverse case was attempted) and `issues: readonly ArvoEventValidationIssue[]`. There is no third `'malformed'` kind on this type: a malformed Arvo-shaped event is discovered *while attempting the strict path* (`kind: 'strict'`, with issues explaining exactly what was missing or wrong), not a separate code path with its own kind.

Deliberately not added: a `source: 'mapping' | 'structural'` tag on individual issues. A reader can already tell which layer an issue came from by its `path` — `arvoexecutionid` or `data.arvoeventbaggage` reads as a CloudEvent-boundary problem, `subject` or `dataschema` reads as ArvoEvent's own field rule — so a redundant tag would duplicate information the path already carries.

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
