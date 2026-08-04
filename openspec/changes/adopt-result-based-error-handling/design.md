## Context

See `proposal.md` — Why, for motivation, and `openspec/project.md`'s "Result types and the `try`-prefix convention" for the standing rule this change is the first to apply.

The constraint that shapes this change: the convention states a constructor cannot be `tryX`, since it cannot return a `Result` — but that does not mean its logic moves elsewhere. Throw-or-succeed is already exactly `X`'s shape, so the constructor is the natural `X` and keeps the real logic. `tryParse` is what gets built on top of it, not the reverse. An earlier draft of this proposal had this backwards — treated the constructor as a stripped internal primitive `tryParse` called after validating independently, with `parse` reduced to an unwrap around `tryParse`. Corrected before any code was written; see the corresponding fix in `project.md` and this change's own history.

## Goals / Non-Goals

**Goals:**

- `ArvoEvent`'s public surface follows the `tryX`/`X` convention without duplicating validation logic between the two names
- Zero behavior change to any structural rule — this is an API-surface addition, not a revalidation of ADR-001/ADR-002

**Non-Goals:**

- Converting `validator.ts` or `json.ts` internals to `Result`. Neither is called from more than one place today (both feed the constructor alone), so there is nothing for a `Result` type to unify there yet. Revisit if that stops being true.
- Applying this convention anywhere outside `ArvoEvent`. No other public class exists in this rebuild yet.

## Decisions

### The constructor keeps the logic; `tryParse` wraps it

`new ArvoEvent(param, options)` is unchanged: it still calls `validateArvoEvent` directly and throws `ArvoEventValidationError` on failure. It is not touched by this change at all beyond its call sites gaining two static siblings.

```
static parse(param, options) {
  return new ArvoEvent(param, options);
}

static tryParse(input, options) {
  try {
    return ok(new ArvoEvent(input, options));
  } catch (error) {
    if (error instanceof ArvoEventValidationError) return err(error);
    throw error;
  }
}
```

`parse` is a one-line delegate, kept only so a consumer scanning `ArvoEvent`'s static methods finds `parse`/`tryParse` as a matched pair without needing to already know `new` is the real throwing entry point.

The non-`ArvoEventValidationError` re-throw in `tryParse` is deliberate: a `Result`'s error channel represents an expected, typed failure mode — a malformed event — not an arbitrary bug. Swallowing every exception into `Err` would make `tryParse` lie about what kind of failure occurred, and would hide a real defect (a `TypeError` from a caller's own broken `toJSON`, for instance) behind the same channel as an ordinary validation failure.

**Alternative rejected:** making `tryParse` the primitive, with the constructor calling it internally and throwing on `Err`, `parse` degraded to an unwrap around `tryParse`. This was the first draft. Rejected because it requires either a second, non-validating constructor path (added complexity for no behavioral gain) or a validation pass structured to run before the constructor can use it, when the constructor already validates perfectly well on its own. It also fights the shape of what a constructor already is, rather than using it.

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
- **Two static methods that are easy to assume are more than they are** → `parse` looks like it could diverge from `new ArvoEvent(...)` over time if someone adds logic to it later without realizing the convention forbids that. Mitigated by the convention's own text in `project.md` stating this plainly, and by `parse`'s test coverage asserting field-for-field equality with a direct construction, not just "does not throw."

## Migration Plan

No data migration — this is a type-level and API-surface change with no persisted state. `ArvoEvent.safeParse` has no consumers yet outside this package's own tests (nothing has shipped from `v4`), so there is no external deprecation window to manage. Existing `new ArvoEvent(...)` call sites, including this package's own (broken, out-of-scope) `src/factory/`, are entirely unaffected — only `safeParse` call sites need rewriting to `tryParse`.
