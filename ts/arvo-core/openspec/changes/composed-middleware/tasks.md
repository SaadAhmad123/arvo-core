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

- [x] 5.1 Write the new behaviour into `tests/ArvoEventHandler/middleware/`, through the public surface: each row of the design's table of what a caller could notice, a refusal naming every bad entry, and late marks carrying `middleware.aborted`.
- [x] 5.2 Update `tests/ArvoEventHandler/middleware/telemetry.spec.ts` and every other assertion on exact mark attributes for the new `middleware.aborted` attribute, and `tests/ArvoEventHandler/middleware/clocks.spec.ts` for the removed progress object.
- [x] 5.3 Write `tests/ArvoEventHandler/version/middleware-refusal.spec.ts`, then add `refusalFrom` in `src/ArvoEventHandler/version/middleware-refusal.ts`: each error becomes a refusal with its own fault kind and message, the validation error's issues as the violations, and the resolution error's position and cause.
- [x] 5.4 In `src/ArvoEventHandler/version/index.ts`, build the layers with one call to `tryCreateArvoComposedMiddleware`, turn its `Err` into the fault through `refusalFrom` and `#faultFor`, and run before, the executor and after inside one function raced against the run clock, aborting the signal on expiry. **Replaces** `#enterExecutor`'s executor wrapper and `readRecordAtExecutorReturn`. The duration metrics read the version's own timings, and the middleware one is recorded only where the resolved lists hold a layer.
- [x] 5.5 **Delete** `runMiddleware`, `ArvoMiddlewareProgress` and `createArvoMiddlewareProgress`, and with them `src/ArvoEventHandler/version/middleware.ts`. `describeThrown` stays beside the composite, its only user: `refusalFrom` needs the thrown value as text, not as span attributes.
- [x] 5.6 **Delete** `tests/ArvoEventHandler/version/middleware.spec.ts`, after confirming each of its cases has a counterpart in groups 2 to 4.
- [x] 5.7 Every other test under `tests/ArvoEventHandler/` passes without edits beyond 5.1 and 5.2.

## 6. Proof

- [x] 6.1 Full suite with coverage at 100% bar the guards already uncovered, lint and typecheck clean, `pnpm build` clean.
- [x] 6.2 The sandbox, built against the new package: typecheck, lint and the whole suite, the Temporal and DBOS tests included.

## 7. Breaking it on purpose

Every case asserts what the protocol promises, whatever is thrown at it: a before failure reaches the caller unchanged, an after failure never changes the outcome and never escapes, a refusal is a fault rather than a raw error, and nothing is left as an unhandled rejection.

- [x] 7.1 Write `tests/ArvoEventHandler/version/composed-middleware/hostile-layers.spec.ts`: layers whose `id`, `before` or `after` getters throw, or return something different on a second read; Proxies that throw on every access; frozen, sealed and null-prototype layers; ids such as `__proto__`, `constructor`, empty and very long; parts that return thenables, never settle, or settle after the clock; thrown values that cannot be printed, such as null-prototype objects, objects whose `toString` throws, Symbols, `undefined`, and Errors whose `message` getter throws.
- [x] 7.2 Write `tests/ArvoEventHandler/version/composed-middleware/hostile-lists.spec.ts` for resolution and the factory: sparse arrays, arrays whose element getters throw, Proxy arrays, array subclasses, frozen arrays, factories that return thenables or functions or another entry's instance, a factory that throws a value that cannot be printed, and lists of many thousands of entries.
- [x] 7.3 Write `tests/ArvoEventHandler/middleware/chaos.spec.ts` through the public surface: seeded random stacks of layers with random parts, failures, delays, middleware-data writes including conflicts, state writes in either part and run clocks, run many executions at once, and check every invariant above on each, plus that the record produced is the one at the executor's return and that each layer a factory made served one execution.
- [x] 7.4 Fix whatever 7.1 to 7.3 break, each fix test-first, every change under `src/` shown for review before its commit.
- [ ] 7.5 In `ts/sandbox`, chaos under Temporal, DBOS and the plain loop: many workflows at once with random injected middleware failures, factories failing intermittently, slow and hanging after parts against the run clock, retryable before faults recovering through retries, and workers stopped mid-chain. Every workflow ends where the protocol says, and the records and published events agree across mechanisms.
- [ ] 7.6 Proof again: full suite with coverage, lint, typecheck, build, and the whole sandbox suite.
