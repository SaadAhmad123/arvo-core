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
- [x] 3.4 Confirm the constructor itself is untouched — no diff inside `constructor(...)` beyond what's already there
- [x] 3.5 TSDoc for `parse`/`tryParse`, consumer-facing, describing the throw/`Result` relationship without restating the design rationale (that stays in `design.md`) and without naming `neverthrow`

## 4. Exports

- [x] 4.1 In `src/index.ts`, export `Result` and `AsyncResult` type-only
- [x] 4.2 **REMOVE** the `ArvoEventParseResult` export
- [x] 4.3 Confirm the public surface has no remaining reference to `safeParse` or `ArvoEventParseResult`

## 5. Tests

- [ ] 5.1 In `tests/ArvoEvent/index.spec.ts`, rewrite the `ArvoEvent.safeParse` describe block against `tryParse`: success returns `{ ok: true, value }` carrying a real `ArvoEvent` instance, failure returns `{ ok: false, error }` carrying `ArvoEventValidationError` with populated `issues`, non-object top-level input fails cleanly
- [ ] 5.1a Add a test asserting the returned `Result` is `arvo-core`'s plain shape, not a `neverthrow` instance — e.g. `result.constructor === Object`, or that `.isOk`/`.match`/`._unsafeUnwrap` are not present on it. Confirms the boundary conversion actually happens rather than a `neverthrow` value leaking through
- [ ] 5.2 Add a `parse` describe block: succeeds identically to `new ArvoEvent(...)` (field-for-field equality, not just "does not throw"), throws `ArvoEventValidationError` on invalid input with the same issues a direct construction would produce
- [ ] 5.3 Add a test asserting `parse` and `tryParse` agree — same input, `parse`'s return value equals `tryParse`'s unwrapped `Ok` value, and `parse`'s thrown error equals `tryParse`'s `Err` value
- [ ] 5.4 Add a test confirming `tryParse` re-throws a non-`ArvoEventValidationError` exception rather than wrapping it in `Err` — construct a case where something other than validation fails inside the constructor path, or assert this directly against the implementation's error-type check
- [ ] 5.5 Confirm every existing test using `new ArvoEvent(...)` to trigger a throw is unaffected — no changes needed, verify by running the full suite

## 6. Close out

- [ ] 6.1 `pnpm lint`, `pnpm test`, `pnpm build` — `src/factory/`'s pre-existing, out-of-scope failure is the only expected non-clean result, same as the prior change
- [ ] 6.2 `openspec validate adopt-result-based-error-handling --strict`
