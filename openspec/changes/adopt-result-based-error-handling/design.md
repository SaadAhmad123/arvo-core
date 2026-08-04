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

### `neverthrow` supplies `Result`/`AsyncResult`, not a hand-rolled type

Checked against *Dependencies and reuse* before deciding to add a dependency. A `Result`/`Either` type is a textbook instance of the heuristic that governs this: "if the code you are about to write would make sense in a package that knows nothing about Arvo, it probably already exists in one." A tagged `Ok`/`Err` union with `map`/`match`/`andThen` combinators is general-purpose functional-programming machinery, not an Arvo concern, and getting the combinator set right (safe narrowing, no silently-wrong `.map` over an `Err`) is exactly the kind of thing worth not re-deriving.

`neverthrow` specifically: TypeScript-native (not a port from another language's idioms the way some alternatives read), synchronous `Result` and a matching `ResultAsync` that composes with `Promise`-returning code without manual wrapping — which is what `AsyncResult<R, E> = Promise<Result<R, E>>` needs to compose against. Zero runtime dependencies of its own.

**Alternatives considered:**
- **Hand-rolled `Result` type.** Rejected for the same reason `json.ts`'s bespoke code was justified the opposite way in the previous change: bespoke is right when the semantics are genuinely Arvo's or the library cannot express what's needed. Neither holds here — `Result` is a solved, generic problem, and hand-rolling it means owning combinator correctness ourselves for no benefit.
- **`fp-ts`'s `Either`.** More powerful, but brings a much larger surface (the full `fp-ts` ecosystem's conventions — pipe-based composition, its own `TaskEither` rather than a `Promise`-compatible async type) for a package that needs exactly one type and a handful of combinators. `AsyncResult` as a plain `Promise<Result<R, E>>` alias composes with ordinary `async`/`await`; `TaskEither` would not, without adopting more of `fp-ts` alongside it.
- **`ts-results`.** Smaller and closer in spirit, but less actively maintained and without `ResultAsync`'s `Promise` interop, which `AsyncResult` needs.

`Result<R, E>` and `AsyncResult<R, E>` are exported from `src/types.ts` as thin aliases over `neverthrow`'s types, so the library is named in exactly one file rather than imported ad hoc wherever a `Result` is needed.

## Risks / Trade-offs

- **A new runtime dependency** → `neverthrow` has zero dependencies of its own and is small; the cost is one entry in the dependency tree, accepted per the reuse convention's own counterweight that a *new* dependency needs real justification, which the "generic, non-Arvo, solved problem" test above provides.
- **Two static methods that are easy to assume are more than they are** → `parse` looks like it could diverge from `new ArvoEvent(...)` over time if someone adds logic to it later without realizing the convention forbids that. Mitigated by the convention's own text in `project.md` stating this plainly, and by `parse`'s test coverage asserting field-for-field equality with a direct construction, not just "does not throw."

## Migration Plan

No data migration — this is a type-level and API-surface change with no persisted state. `ArvoEvent.safeParse` has no consumers yet outside this package's own tests (nothing has shipped from `v4`), so there is no external deprecation window to manage. Existing `new ArvoEvent(...)` call sites, including this package's own (broken, out-of-scope) `src/factory/`, are entirely unaffected — only `safeParse` call sites need rewriting to `tryParse`.
