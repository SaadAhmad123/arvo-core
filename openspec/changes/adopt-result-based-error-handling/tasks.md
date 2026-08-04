## 1. Dependency

- [x] 1.1 Add `neverthrow` to `package.json` (dependency, not peer — internal to how `arvo-core` is implemented, not something a consumer needs to install themselves unless they use `Result`-typed exports directly)

## 2. Shared types and the `neverthrow` boundary

- [x] 2.1 In `src/types.ts`, add `Result<R, E>` and `AsyncResult<R, E>` as `arvo-core`'s own plain, structural types — `{ ok: true; value: R } | { ok: false; error: E }` and `Promise<Result<R, E>>`. No import from `neverthrow` in this file.
- [x] 2.2 Consumer-facing TSDoc on both, per the Documentation in source convention — state the shape, no provenance
- [x] 2.3 Add `src/result.ts`: internal only, not exported from `src/index.ts`. Exports `fromNeverthrow`, converting a `neverthrow` `Result`/`ResultAsync` into `arvo-core`'s plain `Result`/`AsyncResult`. The only file besides itself permitted to import `neverthrow`.
- [x] 2.4 Confirm `neverthrow` does not appear in `src/types.ts`, `src/index.ts`, or any TSDoc on a publicly exported symbol

## 3. `ArvoEvent.parse` and `ArvoEvent.tryParse`

- [x] 3.1 In `src/ArvoEvent/index.ts`, add `static parse<T, D>(param, options): ArvoEvent<T, D>` — a one-line delegate to `new ArvoEvent(param, options)`, no logic of its own
- [x] 3.2 Add `static tryParse<T, D>(input, options): Result<ArvoEvent<T, D>, ArvoEventValidationError>` — internally builds a `neverthrow` `Result` from a try/catch around `new ArvoEvent(input, options)` (`Ok` on success, `Err` when the thrown error is `ArvoEventValidationError`, re-throws anything else), then converts it to the public shape through `fromNeverthrow` before returning
- [x] 3.3 **DELETE** `static safeParse` and the `ArvoEventParseResult` type — fully superseded by `tryParse`'s `Result`
- [x] 3.4 **Superseded by 5.5.** True at the time this was ticked — the constructor was genuinely unchanged when `parse`/`tryParse` were added. `tryParse`'s tests then routed malformed top-level input through the real constructor for the first time and surfaced a pre-existing bug there, fixed in §5. The constructor is no longer byte-identical to before this change; see 5.5 for what changed and why.
- [x] 3.5 TSDoc for `parse`/`tryParse`, consumer-facing, describing the throw/`Result` relationship without restating the design rationale (that stays in `design.md`) and without naming `neverthrow`

## 4. Exports

- [x] 4.1 In `src/index.ts`, export `Result` and `AsyncResult` type-only
- [x] 4.2 **REMOVE** the `ArvoEventParseResult` export
- [x] 4.3 Confirm the public surface has no remaining reference to `safeParse` or `ArvoEventParseResult`

## 5. Tests

- [x] 5.1 In `tests/ArvoEvent/index.spec.ts`, rewrite the `ArvoEvent.safeParse` describe block against `tryParse`: success returns `{ ok: true, value }` carrying a real `ArvoEvent` instance, failure returns `{ ok: false, error }` carrying `ArvoEventValidationError` with populated `issues`, non-object top-level input fails cleanly
- [x] 5.1a Add a test asserting the returned `Result` is `arvo-core`'s plain shape, not a `neverthrow` instance — e.g. `result.constructor === Object`, or that `.isOk`/`.match`/`._unsafeUnwrap` are not present on it. Confirms the boundary conversion actually happens rather than a `neverthrow` value leaking through
- [x] 5.2 Add a `parse` describe block: succeeds identically to `new ArvoEvent(...)` (field-for-field equality, not just "does not throw"), throws `ArvoEventValidationError` on invalid input with the same issues a direct construction would produce
- [x] 5.3 Add a test asserting `parse` and `tryParse` agree — same input, `parse`'s return value equals `tryParse`'s unwrapped `Ok` value, and `parse`'s thrown error equals `tryParse`'s `Err` value
- [x] 5.4 Add a test confirming `tryParse` re-throws a non-`ArvoEventValidationError` exception rather than wrapping it in `Err` — verified against a genuine `RangeError` forced through a throwing getter on `subject`, not simulated
- [x] 5.5 **FOUND A REAL BUG, not just "unaffected."** `ArvoEvent.tryParse('not an object')` produced 19 spurious issues instead of one clean "must be an object." The constructor destructured `param` unconditionally before validating it; destructuring a string or array spreads its characters/elements as field names (`{...'abc'}` → `{0:'a',1:'b',2:'c'}`). `safeParse` never hit this because it called `validateArvoEvent` directly, bypassing the constructor's destructure — `tryParse` correctly routes all input through the real constructor, per this change's own design, and surfaced a bug that predates this change entirely. Fixed in `src/ArvoEvent/index.ts`'s constructor: the destructure is now skipped for non-object/array/null input, which is passed through unchanged to `validateArvoEvent`'s own existing top-level guard rather than duplicating that check. A dedicated `malformed top-level input` block tests `new ArvoEvent(...)` directly against a string, an array, a number, and `null`.
- [x] 5.6 Add `tests/result.spec.ts` for `src/result.ts`, direct — not only exercised indirectly through `ArvoEvent.tryParse`: `fromNeverthrow` on `Ok`/`Err`, `fromNeverthrowAsync` on `okAsync`/`errAsync`, confirming both produce `arvo-core`'s plain shape (`constructor === Object`, no `neverthrow` methods present) and that the async result is a genuine `Promise` (has `.catch`/`.finally`), not merely `PromiseLike`
- [x] 5.7 In `tests/utils.spec.ts`, add coverage for `truncate` — currently untested entirely: text shorter than, equal to, and longer than `maxLength`; the truncated result's exact length; an empty string; `maxLength` of `0`

## 6. Close out

- [ ] 6.1 `pnpm lint`, `pnpm test`, `pnpm build` — `src/factory/`'s pre-existing, out-of-scope failure is the only expected non-clean result, same as the prior change
- [ ] 6.2 `openspec validate adopt-result-based-error-handling --strict`
