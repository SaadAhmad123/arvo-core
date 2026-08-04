## Why

`openspec/project.md` now records the Result-type / `try`-prefix convention: every fallible operation is implemented once, as `tryX`, returning a `Result`/`AsyncResult`; `X` is a thin throw/unwrap wrapper with no logic of its own. `ArvoEvent`'s public surface predates that convention and doesn't follow it — `new ArvoEvent(...)` throws and contains the actual validation logic, and `ArvoEvent.safeParse` is a second, independently-built success/failure branch reaching the same `validateArvoEvent` core through a hand-rolled `{ success, event } | { success: false, issues }` shape rather than a real `Result`. Two names, two implementations of "did this succeed," which is exactly the two-mechanisms-doing-the-same-job problem the convention exists to rule out.

No ADR governs this. It is a TypeScript API-shape decision, not a decision about the Arvo model — ADR-000 states Arvo "avoids letting TypeScript details become model requirements," and this change makes no claim that binds a Go or Rust implementation of AAM.

## What Changes

- **BREAKING**: `ArvoEvent.safeParse` is removed. Replaced by `ArvoEvent.tryParse`, returning `Result<ArvoEvent, ArvoEventValidationError>`.
- The constructor is unchanged: `new ArvoEvent(...)` still performs validation directly and throws `ArvoEventValidationError` on failure, exactly as today. It is where structural validity is established — the constructor already has the natural shape of `X` (throw-or-succeed), so it holds the real logic, same as it would with no `Result`-returning sibling at all.
- Adds `ArvoEvent.parse`, a thin static delegate to `new ArvoEvent(...)`, for symmetry with `tryParse` and so a consumer scanning static methods finds both without needing to know `new` already is the throwing entry point.
- Adds `ArvoEvent.tryParse`, built entirely on top of the constructor: calls `new ArvoEvent(...)` inside a try/catch, returns `Ok(event)` on success and `Err(error)` when the constructor throws `ArvoEventValidationError`. Any other thrown error is not a `Result` failure and is re-thrown rather than swallowed.
- Adds `Result<R, E>` and `AsyncResult<R, E>` (`= Promise<Result<R, E>>`) to `src/types.ts`, built on a Result-type library (library choice and reuse-check in `design.md`).
- No change to any structural rule, field, default, or validation behavior, and no change to `validateArvoEvent`'s shape — it is called from exactly one place (the constructor), same as today. This is an API-surface addition, not a behavior change; every existing test's *assertions* should still hold, only `safeParse` call sites need rewriting.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `arvo-event`: the "Validity Of Events Arriving As Data" requirement changes from describing `safeParse`'s `{ success, ... }` shape to describing `tryParse`'s `Result` shape and `parse`'s throw/unwrap relationship to it. "Construction-Time Validity" is clarified to describe `parse` rather than the constructor as the entry point where validity is established.

## Impact

**Affected code**

- `src/types.ts` — new `Result`/`AsyncResult` aliases
- `src/ArvoEvent/index.ts` — adds `ArvoEvent.parse` and `ArvoEvent.tryParse`; removes `ArvoEvent.safeParse` and the now-unneeded `ArvoEventParseResult` type. The constructor and its body are untouched.
- `src/index.ts` — export surface: `ArvoEventParseResult` removed, `Result`/`AsyncResult` added
- `tests/ArvoEvent/index.spec.ts` — `ArvoEvent.safeParse` call sites are rewritten against `tryParse`; tests already using `new ArvoEvent(...)` to trigger a throw are unaffected
- `package.json` — a new dependency for the Result-type implementation (see `design.md`)

**Not affected**

`src/ArvoEvent/validator.ts` and `src/ArvoEvent/json.ts` — `validateArvoEvent`'s shape, and everything it calls, is unchanged. It is still called from exactly one place, the constructor.

**Consequence to accept**

`ArvoEvent.safeParse` call sites break under this change (there are none outside this package's own tests yet — nothing has shipped, this branches off `v4`, undeployed). `new ArvoEvent(...)` call sites are entirely unaffected.

## Out of Scope

- `src/factory/`'s own breakage and eventual fix — separate, already-tracked work.
- Applying the `tryX`/`X` convention to any other class (`ArvoContract`, `ArvoEventHandler`) — those do not exist yet in this rebuild.
- Any change to `json.ts`'s `JSONWalkResult` shape. It is internal (never exported) and not part of `arvo-core`'s public surface the convention governs; converting it is optional follow-up, not required by this change.
