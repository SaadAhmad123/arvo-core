Every group starts with its tests, ends at 100% coverage with lint and typecheck clean, and is its own commit. Every change under `src/` is shown for review before its commit. New dispatcher files go under `src/ArvoDispatcher/`, one concern per file, with tests mirrored under `tests/ArvoDispatcher/`. The `mutate-event` change is implemented and archived before group 6, which uses `mutateArvoEvent`.

## 1. One copy of the identifier grammar

- [x] 1.1 Write `tests/ArvoContract/identifier.spec.ts`: the predicate accepts lowercase alphanumeric segments joined by single underscores, and refuses uppercase, a leading, trailing or doubled underscore, a dot, a hyphen and the empty string.
- [x] 1.2 Add `src/ArvoContract/identifier.ts` holding the grammar and the predicate. **Replaces** the private `IDENTIFIER_GRAMMAR` in `src/ArvoContract/validator.ts`, which imports the predicate instead. Every existing `tests/ArvoContract/` test passes unedited.

## 2. `handler_not_found` through the fault factory

- [x] 2.1 Extend `tests/ArvoEventHandler/fault/` with the handler-less branch: the fault's kind is `handler_not_found`, its `retry`, `abandonmentEvent`, `abandonmentState` and `executionId` are `null`, its `subject`, `eventId` and `attempt` come from the event and the call, and it is recorded on the span, the counter and the log as every fault is. Add a type test that the compiler refuses `contracts: null` with any other kind.
- [x] 2.2 Add `'handler_not_found'` to `ArvoFaultKind` and the third branch to `ArvoHandlerFaultFactoryParam` in `src/ArvoEventHandler/fault/types.ts`, with TSDoc stating the rule, not its origin.
- [x] 2.3 Build the branch in `src/ArvoEventHandler/fault/factory.ts`, checked before anything reads a contract or options. Every existing fault test passes unedited.

## 3. The dispatcher's error, options and types

- [ ] 3.1 Write `tests/ArvoDispatcher/errors.spec.ts`: the validation error carries every issue, freezes them, builds its message from them, and carries its `_tag` and `name`.
- [ ] 3.2 Write `tests/ArvoDispatcher/typing.types.spec.ts`: `HandlersOf` flattens nested dispatchers in order; `DependenciesOf` keys each entry by the handler's literal self contract `type` and types it to that handler's dependencies; a handler declaring none contributes an entry whose dependency type is empty; `HooksOf` is the intersection, and `never` where two handlers' hooks cannot both be met; a large, deeply nested set still typechecks.
- [ ] 3.3 Add `ArvoDispatcherValidationError` in `src/ArvoDispatcher/errors.ts`, following `ArvoEventHandlerValidationError`.
- [ ] 3.4 Add `ArvoDispatcherOptions`, `ArvoDispatcherExecuteParam` and the member constraint in `src/ArvoDispatcher/types.ts`, and `HandlersOf`, `DependenciesOf`, `HooksOf` in `src/ArvoDispatcher/typing.ts`.

## 4. Flattening and the declaration rules

- [ ] 4.1 Write `tests/ArvoDispatcher/helpers/flatten.spec.ts`: handlers and layers flatten in order; a dispatcher among the handlers contributes handlers only, among the layers its layers only, at its position.
- [ ] 4.2 Write one spec per rule under `tests/ArvoDispatcher/helpers/`: `check-empty`, `check-repeated-handlers`, `check-shared-types` (same `uri` and different `uri`), `check-service-versions` (an undeclared version, a different `uri`, an accepted version, a service nobody implements, two handlers calling each other, a handler calling itself). Each issue names the handlers by self contract `type` and the rule broken.
- [ ] 4.3 Add `src/ArvoDispatcher/helpers/flatten.ts` and the four checks, `check-empty.ts`, `check-repeated-handlers.ts`, `check-shared-types.ts`, `check-service-versions.ts`, each returning its issues.

## 5. The class: declaration and the reads of the set

- [ ] 5.1 Write `tests/ArvoDispatcher/declaration.spec.ts` through the constructor: each spec scenario under *A Dispatcher Is Declared From Handlers And Layers*, *What A Declaration Refuses* and *What A Declaration Does Not Refuse*; every broken rule in one error; the empty set blocking the rest.
- [ ] 5.2 Write `tests/ArvoDispatcher/reads.spec.ts`: `handles` for a handled type, an unhandled type and `null`; `longestRunTimeoutMs` over mixed, inherited and absent run timeouts.
- [ ] 5.3 Write `tests/ArvoDispatcher/caller-name.spec.ts` and `tests/ArvoDispatcher/helpers/check-caller-name.spec.ts`: an accepted name returned; a name breaking the grammar; a handler's own type; a service type; two rules broken together; `validateCallerName` throwing what `tryValidateCallerName` returns.
- [ ] 5.4 Add `src/ArvoDispatcher/helpers/check-caller-name.ts`, using the predicate from group 1, and `src/ArvoDispatcher/helpers/longest-run-timeout.ts`.
- [ ] 5.5 Add the `ArvoDispatcher` class in `src/ArvoDispatcher/index.ts`: the constructor, the type-keyed handler map, `handles`, `longestRunTimeoutMs`, `tryValidateCallerName` / `validateCallerName`, and the resolved telemetry. No `execute` yet.

## 6. Entering a dispatcher

- [ ] 6.1 Write `tests/ArvoDispatcher/execute.spec.ts`, through real handlers: each spec scenario under *Entering A Dispatcher*, *No Handler For The Event*, *A Dispatcher Raises Only Faults During A Call* and *A Dispatcher Leaves The Mechanism's Work To The Mechanism* — the right handler entered and no other; produced, discarded and a handler's fault returned unchanged; only the picked handler's dependency entry passed, an inherited key never taken; the set's layers supplied, outside the handler's own; no `middleware` passed when the set has none; `handler_not_found` for an unknown `to` and for none, at any attempt, with its span opened from the event's trace and ended; a non-fault thrown propagating as thrown; the state function only read; a retryable fault returned after one entry; two calls sharing nothing.
- [ ] 6.2 Write `tests/ArvoDispatcher/telemetry.spec.ts`, with an in-memory span exporter: each spec scenario under *A Dispatcher's Span* — one span per call, a child of the event's trace or a new root, ended on every path including a miss and a thrown non-fault; the handler's span a child of the dispatcher's and the handler's received event naming it with every other field equal; the given event unchanged; with a non-recording span the handler receives the given event itself; returned events keep the handler's trace context; the entered and picked marks; a handler's fault not recorded as the dispatcher's; `handler_not_found` recorded on the dispatcher's span.
- [ ] 6.3 Write `tests/ArvoDispatcher/execute.types.spec.ts`: the parameter is the handler's execute parameter less `middleware`, the result is the handler's result type, and `middleware` on a call is a compile error.
- [ ] 6.4 Add `tryExecute` and `execute` to `src/ArvoDispatcher/index.ts`: the span, the copy through `mutateArvoEvent` where the span records, the marks, the fault through the factory, the span ended in `finally`.

## 7. The factories and the public surface

- [ ] 7.1 Write `tests/factories/createArvoDispatcher.spec.ts`: `tryCreateArvoDispatcher` returns the dispatcher, returns the validation error as `Err`, and rethrows anything else; `createArvoDispatcher` returns or throws the same.
- [ ] 7.2 Add `src/factories/createArvoDispatcher.ts`, following `src/factories/createArvoContract.ts`.
- [ ] 7.3 Export `ArvoDispatcher`, `createArvoDispatcher`, `tryCreateArvoDispatcher`, `ArvoDispatcherValidationError`, `ArvoDispatcherOptions` and `ArvoDispatcherExecuteParam` from `src/index.ts`, with a test that each is reachable from the package entry.

## 8. Proof

- [ ] 8.1 Full suite with coverage at 100% bar the guards already uncovered, lint and typecheck clean, `pnpm build` clean.
- [ ] 8.2 The sandbox, built against the new package and left unedited, still typechecks; a failure there is reported, not fixed in this change.
