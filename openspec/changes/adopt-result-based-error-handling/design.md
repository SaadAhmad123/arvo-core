## Context

See `proposal.md` — Why, for motivation, and `openspec/project.md`'s "Result types and the `try`-prefix convention" for the standing rule this change is the first to apply.

`ArvoEvent` did not exist when that convention was written in the abstract; this change is where its shape for a class with a validating constructor was worked out for real, and `project.md` was updated in step as each piece was settled here. Nothing below is `ArvoEvent`-specific in intent — it is the general pattern, exercised on the first class that needed it. The general statement is canonical in `project.md`; what follows is why it says what it now says.

Two things were corrected during that process, at different points, and they should not be conflated:

- **The constructor holds the logic; it is never derived from `tryX`.** A constructor cannot be `tryX` — it cannot return a `Result`, only build the instance or throw — but that does not mean its logic moves elsewhere. Throw-or-succeed is already exactly `X`'s shape, so the constructor is the natural `X` and keeps the real logic; `tryParse` is what gets built on top of it. An early draft had this backwards, treating the constructor as a stripped internal primitive that `tryParse` called after validating independently. Corrected before any code was written. This part has not moved since.
- **`parse` wraps `tryParse`, not the constructor.** That same early draft also had `parse` reduced to an unwrap around `tryParse`, rejected at the time alongside the constructor point above — but on its own, this one doesn't share that point's problem, and was later reconsidered and adopted. See "Reconsidered, and adopted" under Decisions, below, for why revisiting it doesn't reopen the first point.

## Goals / Non-Goals

**Goals:**

- `ArvoEvent`'s public surface follows the `tryX`/`X` convention without duplicating validation logic between the two names
- Settle the convention's shape for a class with a validating constructor precisely enough that `project.md` states it generally and correctly, so the next class (`ArvoContract`, `ArvoEventHandler`, whatever needs it next) applies a finished rule rather than re-deriving one
- Zero behavior change to any structural rule — this is an API-surface addition, not a revalidation of ADR-001/ADR-002

**Non-Goals:**

- Converting `validator.ts` or `json.ts` internals to `Result`. Neither is called from more than one place today (both feed the constructor alone), so there is nothing for a `Result` type to unify there yet. Revisit if that stops being true.
- Applying this convention to another class in this change. None exists yet to apply it to — but the pattern below is written, and `project.md` states it, as the general rule, not as something scoped to `ArvoEvent`.

## Decisions

### The constructor keeps the logic; `tryParse` wraps it; `parse` wraps `tryParse`

`new ArvoEvent(param, options)` keeps the real logic: it still calls `validateArvoEvent` directly and throws `ArvoEventValidationError` on failure. `tryParse` wraps the constructor directly — it remains the one primitive both static methods ultimately rest on.

```
static tryParse(input, options) {
  try {
    return ok(new ArvoEvent(input, options));
  } catch (error) {
    if (error instanceof ArvoEventValidationError) return err(error);
    throw error;
  }
}

static parse(param, options) {
  const result = tryParse(param, options);
  if (result.ok) return result.value;
  throw result.error;
}
```

`parse` wraps `tryParse`, not the constructor, so the two are an exact matched pair — identical `(input: unknown, options?)` signature, `parse` carrying no logic beyond the unwrap. It also inherits `tryParse`'s non-`ArvoEventValidationError` re-throw for free, below, rather than needing its own copy of that check.

This costs something real: `parse`'s parameter was `ArvoEventParam<T, D>` in the first draft, giving compile-time field-name checking at the call site — the common case, a developer constructing an event whose shape they already know. `unknown` gives that up; every call now leans on the same runtime validation `tryParse` already required for its genuinely-untyped use case (replay, foreign producers). Accepted because the convention's point is that `parse` and `tryParse` are one operation exposed two ways, and two different parameter types only half delivered on that.

The non-`ArvoEventValidationError` re-throw in `tryParse` is deliberate: a `Result`'s error channel represents an expected, typed failure mode — a malformed event — not an arbitrary bug. Swallowing every exception into `Err` would make `tryParse` lie about what kind of failure occurred, and would hide a real defect (a `TypeError` from a caller's own broken `toJSON`, for instance) behind the same channel as an ordinary validation failure.

**Alternative rejected, and still rejected:** the constructor calling `tryParse` internally and throwing on `Err`. This is the one piece of the original first draft that still doesn't hold — it requires either a second, non-validating constructor path or a validation pass structured to run before the constructor can use it, when the constructor already validates perfectly well on its own. It fights the shape of what a constructor already is, rather than using it. The constructor remains untouched and is still where `validateArvoEvent` actually runs.

**Reconsidered, and adopted:** `parse` built as an unwrap around `tryParse`, rather than an independent direct wrapper around the constructor. The first draft rejected this bundled with the constructor question above, but the reasoning that rejects the constructor question doesn't apply here — the constructor is untouched either way, and `parse`/`tryParse` were already behaviorally identical, both ultimately just constructing and observing whether it throws. The only real question was which of the two thin wrappers depends on the other, and exact signature symmetry settled it in favor of `parse` depending on `tryParse`.

### `Result`/`AsyncResult` are `arvo-core`'s own types; `neverthrow` is used internally, never exported

Two separate questions, easy to conflate: what builds a `Result` internally, and what type a consumer of `arvo-core` actually receives. The first draft of this decision answered only the first and let the answer leak into the second — `export type Result<R, E> = NeverthrowResult<R, E>` — which makes the public export `neverthrow`'s own type. That breaks the swappability *Dependencies and reuse* is supposed to buy: a consumer calling `.map()`/`.match()`/`.isOk()` on the returned value is coupled to `neverthrow`'s API, and "which library supplies `Result`" stops being an implementation detail the moment it is.

So the two are answered separately:

**Public type — `arvo-core`'s own, structural, no methods:**
```ts
export type Result<R, E> =
  | { readonly ok: true; readonly value: R }
  | { readonly ok: false; readonly error: E };

export type AsyncResult<R, E> = Promise<Result<R, E>>;
```
TypeScript narrows `result.ok` natively — `if (result.ok) { result.value } else { result.error }` — with no library code needed to consume it. A consumer never needs to know `neverthrow` exists, and swapping the internal library later touches only the conversion at each boundary, never this type.

**Internal implementation — `neverthrow`.** Checked against *Dependencies and reuse* before adding the dependency: a `Result`/`Either` type is a textbook instance of the heuristic that governs this — general-purpose FP machinery, not an Arvo concern, and getting the combinator set right (safe narrowing, no silently-wrong `.map` over an `Err`) is worth not re-deriving. `neverthrow` specifically: TypeScript-native, a `ResultAsync` that composes with `Promise`-returning code without manual wrapping, zero runtime dependencies of its own.

**Alternatives considered for the library itself:**
- **Hand-rolled internal `Result`.** Rejected for the same reason `json.ts`'s bespoke code was justified the opposite way in the previous change: bespoke is right when the semantics are genuinely Arvo's or the library cannot express what's needed. Neither holds — owning combinator correctness for a solved problem is pure cost.
- **`fp-ts`'s `Either`.** More powerful, but brings a much larger surface (pipe-based composition, `TaskEither` rather than a `Promise`-compatible async type) for a package that needs one type and a handful of combinators.
- **`ts-results`.** Smaller and closer in spirit, but less actively maintained and without `ResultAsync`'s `Promise` interop.

**The boundary.** A shared internal adapter, `fromNeverthrow`, converts a `neverthrow` `Result`/`ResultAsync` into `arvo-core`'s plain `Result`/`AsyncResult` at the one place each fallible operation crosses into public API — `ArvoEvent.tryParse`, and any future `tryX`. One conversion point per operation, not duplicated ad hoc. Lives in a new `src/result.ts`: internal only, never exported from `src/index.ts`, the only file besides itself permitted to import `neverthrow` directly. `src/types.ts` stays free of the dependency entirely, since it is reached by every consumer through the public export surface.

Adopted now rather than deferred until a genuinely multi-step pipeline needs it, for consistency: the pattern (build internally with `neverthrow`, convert at the boundary with `fromNeverthrow`) is established and exercised end-to-end by this change, so the next capability that needs real chaining extends a working pattern instead of introducing the dependency and the adapter for the first time under its own pressure.

## Risks / Trade-offs

- **A new runtime dependency** → `neverthrow` has zero dependencies of its own and is small; the cost is one entry in the dependency tree, accepted per the reuse convention's own counterweight that a *new* dependency needs real justification, which the "generic, non-Arvo, solved problem" test above provides.
- **`tryParse` has nothing to chain — one `try`/`catch` around one constructor call — so routing it through `neverthrow` internally exercises the library without gaining anything from its combinators here.** Accepted deliberately: the point of adopting now is proving `fromNeverthrow` and the internal-`neverthrow`/public-plain-type split work end-to-end on a genuinely simple case, before the next change leans on it for something that actually chains. If a future change never arrives to justify it, this is the one place the dependency is used for less than it costs — a known, bounded cost, not an open-ended one.
- **Two static methods that are easy to assume are more than they are** → `parse` looks like it could grow its own logic over time if someone forgets it is meant to be an unwrap around `tryParse` and nothing more. Mitigated by the convention's own text in `project.md` stating this plainly, and by test coverage asserting `parse` and `tryParse` agree on the same input — success and failure alike, not just "does not throw."
- **`parse` now takes `unknown`, matching `tryParse`, instead of the compile-time-checked `ArvoEventParam<T, D>` it started with** → the common case — constructing an event whose shape a developer already knows — loses field-name checking at the call site. Accepted for exact signature symmetry between the two; see the Decisions section above.

## Migration Plan

No data migration — this is a type-level and API-surface change with no persisted state. `ArvoEvent.safeParse` has no consumers yet outside this package's own tests (nothing has shipped from `v4`), so there is no external deprecation window to manage. Existing `new ArvoEvent(...)` call sites, including this package's own (broken, out-of-scope) `src/factory/`, are entirely unaffected — only `safeParse` call sites need rewriting to `tryParse`.
