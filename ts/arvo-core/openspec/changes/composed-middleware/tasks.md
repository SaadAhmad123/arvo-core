Every group starts with its tests, ends at 100% coverage with lint and typecheck clean, and is its own commit. Every change under `src/` is shown for review before its commit. New files go under `src/ArvoEventHandler/version/composed-middleware/`, one concern per file, with tests mirrored under `tests/ArvoEventHandler/version/composed-middleware/`.

## 1. The two errors

- [x] 1.1 Write `tests/.../composed-middleware/errors.spec.ts`. The validation error carries its fault kind and every issue, freezes the issues, builds its message from them, and carries a `_tag`. The resolution error carries the position, keeps what was thrown as its `cause`, names both in its message, always has the fault kind for a failed instantiation, and carries a `_tag`.
- [x] 1.2 Add `ArvoComposedMiddlewareValidationError`, following `ArvoEventValidatorError`, and `ArvoComposedMiddlewareResolutionError`, both in `src/.../composed-middleware/errors.ts`.

## 2. Resolution that only resolves

- [x] 2.1 Write `tests/.../composed-middleware/resolve.spec.ts`: each factory is called once and replaced by what it returned; layers pass through untouched; resolution stops at the first factory that throws, returning the resolution error naming its position; supplied middleware that is not a list passes through untouched; omitted and empty both resolve to empty lists.
- [x] 2.2 Move `resolveMiddleware` into `src/.../composed-middleware/resolve.ts` as `tryResolveMiddleware`, returning an `AsyncResult` of `{ supplied, declared }`, built through neverthrow and `fromNeverthrow`. **Replaces** today's `resolveMiddleware` in `src/ArvoEventHandler/version/middleware.ts`: its shape check, identifier check and list check leave it for group 3.

## 3. The composite

- [x] 3.1 Write `tests/.../composed-middleware/validation.spec.ts` for the constructor's two passes: every bad entry in one refusal as a failed instantiation, each issue blocking; supplied middleware that is not a list blocks only its own positions while declared entries are still checked; every repeated identifier in one refusal as a conflict, naming both positions; no identifier check while any entry is not a layer.
- [x] 3.2 Write `tests/.../composed-middleware/before.spec.ts`: order, layers without a before part skipped, a throw reaching the caller unchanged with no further part run, the entered and returned marks with `middleware.id` and `middleware.aborted`, and no part started once the signal is aborted while a part already running is still marked.
- [x] 3.3 Write `tests/.../composed-middleware/after.spec.ts`: reverse order, a frozen array emission, a failing part marked and passed over with the rest still run, `after` never throwing, marks made after the signal is aborted carrying `middleware.aborted` true, and no part started once it is aborted.
- [x] 3.4 Write a type test in `tests/.../composed-middleware/index.types.spec.ts`: the composite satisfies `IArvoEventHandlerMiddleware`, and nothing new is exported from `src/index.ts`.
- [x] 3.5 Add `ArvoComposedMiddleware` in `src/.../composed-middleware/index.ts`, implementing the layer interface with the fixed `id` `arvo.composed`, using `layerShapeIssues` from `src/ArvoEventHandler/helpers/check-middleware.ts`. Its TSDoc records the two rules: never exported, never placed in a layer list.

## 4. The factory

- [x] 4.1 Write `tests/.../composed-middleware/factory.spec.ts`: a resolution failure comes back as the resolution error without calling the constructor; a constructor refusal comes back as the validation error; anything else the constructor throws goes up as thrown; success returns the composite.
- [x] 4.2 Add `tryCreateArvoComposedMiddleware` in `src/.../composed-middleware/factory.ts`, returning an `AsyncResult`.

## 5. The version on the composite

- [ ] 5.1 Write the new behaviour into `tests/ArvoEventHandler/middleware/`, through the public surface: each row of the design's table of what a caller could notice, a refusal naming every bad entry, and late marks carrying `middleware.aborted`.
- [ ] 5.2 Update `tests/ArvoEventHandler/middleware/telemetry.spec.ts` and every other assertion on exact mark attributes for the new `middleware.aborted` attribute, and `tests/ArvoEventHandler/middleware/clocks.spec.ts` for the removed progress object.
- [ ] 5.3 Write `tests/ArvoEventHandler/version/middleware-refusal.spec.ts`, then add `refusalFrom` in `src/ArvoEventHandler/version/middleware-refusal.ts`: each error becomes a refusal with its own fault kind and message, the validation error's issues as the violations, and the resolution error's position and cause.
- [ ] 5.4 In `src/ArvoEventHandler/version/index.ts`, build the layers with one call to `tryCreateArvoComposedMiddleware`, turn its `Err` into the fault through `refusalFrom` and `#faultFor`, and run before, the executor and after inside one function raced against the run clock, aborting the signal on expiry. **Replaces** `#enterExecutor`'s executor wrapper and `readRecordAtExecutorReturn`. The duration metrics read the version's own timings, and the middleware one is recorded only where the resolved lists hold a layer.
- [ ] 5.5 **Delete** `runMiddleware`, `ArvoMiddlewareProgress` and `createArvoMiddlewareProgress`, and with them `src/ArvoEventHandler/version/middleware.ts`. `describeThrown`, used by both the composite and `refusalFrom`, moves to `src/ArvoEventHandler/helpers/describe-thrown.ts`.
- [ ] 5.6 **Delete** `tests/ArvoEventHandler/version/middleware.spec.ts`, after confirming each of its cases has a counterpart in groups 2 to 4.
- [ ] 5.7 Every other test under `tests/ArvoEventHandler/` passes without edits beyond 5.1 and 5.2.

## 6. Proof

- [ ] 6.1 Full suite with coverage at 100% bar the guards already uncovered, lint and typecheck clean, `pnpm build` clean.
- [ ] 6.2 The sandbox, built against the new package: typecheck, lint and the whole suite, the Temporal and DBOS tests included.
