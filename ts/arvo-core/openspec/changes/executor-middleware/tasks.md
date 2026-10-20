## 1. The type and the fault kind

Tests first, as every step from here. Each group is one commit, and every edit under `src/` is shown for review before its commit.

- [ ] 1.1 Add `tests/ArvoEventHandler/types/middleware.spec.ts`: a layer with only `before`, only `after`, both, and neither all satisfy `IArvoEventHandlerMiddleware`; `id` infers as a literal; both parts may be sync or async.
- [ ] 1.2 Add `src/ArvoEventHandler/types/middleware.ts`: `IArvoEventHandlerMiddleware<TId extends string = string>` with `readonly id: TId`, optional `before(ctx)` and `after(ctx, emission)`, both returning `PromiseAble<void>`. TSDoc per `project.md`: what each part may do, that nothing it returns is read, that a layer holds nothing per delivery, and where the ADR is.
- [ ] 1.3 Extend `tests/ArvoEventHandler/fault/` for `middleware_conflict`: present in the vocabulary, non-retryable at every attempt, carries the abandonment pair when built after the gate.
- [ ] 1.4 Add `middleware_conflict` to `ArvoFaultKind` in `src/ArvoEventHandler/fault/types.ts`, in the "what it returned, and what it wrote" group. Nothing in `fault/retry.ts` changes.
- [ ] 1.5 Export `IArvoEventHandlerMiddleware` from `src/index.ts`.

## 2. Middleware data on the context

- [ ] 2.1 Extend `tests/ArvoEventHandler/context/`: `ctx.middleware` is a present empty object where nothing was written; a write is readable; a second write of one key faults `middleware_conflict` and leaves the first value; the read member is frozen and assigning through it throws; the data is not on the record exported at the end; a fresh context has fresh data.
- [ ] 2.2 Add `#middleware`, the `middleware` getter (frozen shallow copy) and `async setMiddleware(key, value)` to `ArvoExecutionContext` in `src/ArvoEventHandler/context/index.ts`, faulting through `this.fault` with a message naming the key. TSDoc mirrors `setState`'s and says what is not persisted.

## 3. Declaring layers on a handler

- [ ] 3.1 Extend `tests/ArvoEventHandler/declaration.spec.ts` and `build.spec.ts`: a handler with no `middleware` holds `null`; with `[]` holds `null`; with two layers holds both in order; two layers with one `id` is refused with an issue at `middleware[1].id` naming the identifier, reported alongside any other declaration issue.
- [ ] 3.2 Add `middleware?: readonly IArvoEventHandlerMiddleware[]` to `ArvoEventHandlerSetupParam` in `src/ArvoEventHandler/types/setup.ts`, carried through `ArvoEventHandlerSetup`.
- [ ] 3.3 Add `src/ArvoEventHandler/helpers/check-middleware.ts`: the duplicate-identifier rule as `ErrorIssue[]`, one concern per file like the other `check-*` helpers.
- [ ] 3.4 In `ArvoEventHandler` (`src/ArvoEventHandler/index.ts`): run the check with the others; normalize to `readonly middleware: readonly IArvoEventHandlerMiddleware[] | null`; pass it to every `new ArvoEventHandlerVersion`. Add `middleware` to `ArvoEventHandlerVersionParam` in `src/ArvoEventHandler/version/types.ts`.

## 4. Supplying layers per execution

- [ ] 4.1 Extend `tests/ArvoEventHandler/execute.spec.ts`: `execute` with no `middleware`, with `[]`, and with layers; a supplied `id` matching a declared one faults `middleware_conflict` before any part runs; two supplied with one `id` the same.
- [ ] 4.2 Add `middleware?` to `ArvoEventHandlerExecuteParam` in `src/ArvoEventHandler/types/execute.ts`; normalize to `| null` in `ArvoEventHandler#dispatch`; add `middleware` to `ArvoVersionExecuteCommon` in `src/ArvoEventHandler/version/types.ts`.
- [ ] 4.3 In `ArvoEventHandlerVersion`, before the first before part, check supplied identifiers against each other and the declared set; fault `middleware_conflict` through `#faultFor` naming the identifier.

## 5. Running the chain

- [ ] 5.1 Add `tests/ArvoEventHandler/version/middleware.spec.ts` against the new module directly: order of before parts (supplied, declared, executor); reverse order of after parts; a before part's `setState` seen by the executor; a before part writing middleware data read by an inner before part and by the executor; a before that throws stops everything and reports `raised`; a before that faults reports `raised` with the fault; after parts run only on `returned`; an after that throws is recorded and the rest still run; the after part's argument is frozen; a layer with neither part is a no-op; `null` layers run the executor alone.
- [ ] 5.2 Add `src/ArvoEventHandler/version/middleware.ts`: one function taking the ordered layers, the context, the executor and the telemetry, producing `ArvoExecutorRun` plus a timestamp for when the executor returned, and recording the span marks by identifier. Freeze the return before any after part sees it.
- [ ] 5.3 Add the new stage names to `ARVO_EXECUTION_STAGES` in `src/ArvoEventHandler/version/telemetry.ts`: layer before entered/returned, after entered/returned, after failed, after cut by the clock.
- [ ] 5.4 In `ArvoEventHandlerVersion#enterExecutor` (`src/ArvoEventHandler/version/index.ts`): run the chain inside the `running` promise; where the clock fires after the executor returned, proceed with the return, mark the cut, and skip remaining after parts; read both clocks at the executor's return timestamp. `markExecutorRan` measures the executor alone.
- [ ] 5.5 Extend `tests/ArvoEventHandler/execute.spec.ts` end to end: a slow before part is `run_timeout`; a slow after part leaves the result standing and marks the cut; an after part that runs past the execution clock does not refuse the execution; after parts see a return that validation then refuses; a partial collection under the default join enters no layer; one span per execution however many layers; marks carry identifiers.

## 6. Scenarios, docs, and the bar

- [ ] 6.1 Extend `tests/ArvoEventHandler/scenarios/` with one scenario file exercising layers across the three-version fixture: a tenant layer writing middleware data the executors branch on, a duration layer, and a supplied layer from the harness.
- [ ] 6.2 Confirm every scenario in both delta specs has a test that would fail without the implementation.
- [ ] 6.3 Coverage, lint, typecheck, build: `pnpm test:coverage`, `pnpm lint`, `pnpm typecheck`, `pnpm build`. 100% on every new file; no regression elsewhere.
- [ ] 6.4 Sync the delta specs into `openspec/specs/` and archive the change.
