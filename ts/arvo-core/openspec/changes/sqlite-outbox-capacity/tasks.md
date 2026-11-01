# Tasks

Until group 5, "run red" and "verify" mean `pnpm typecheck` and `pnpm lint` on the task's files: the package does not compile until groups 1 to 4 are done. From group 5 every test runs.

## 1. SQLite options, error and factories

- [x] 1.1 Write `tests/outbox/sqlite/errors.spec.ts`, `tests/outbox/sqlite/helpers/resolve-options.spec.ts` and `tests/outbox/sqlite/factory.spec.ts`, as for the in-memory outbox, and **replace** the `RangeError` checks in `tests/outbox/sqlite/outbox.spec.ts` with validation error checks: a wait or retention negative or fractional, `Infinity` accepted for a retention, an unknown key, every problem at once, no file touched. Run red.
- [x] 1.2 Add `src/outbox/sqlite/errors.ts`, `helpers/check-options.ts`, `helpers/resolve-options.ts` and `factory.ts`; **replace** `retainSeenEventsForMs` with `retentionMs` in `src/outbox/sqlite/types.ts`; remove the option defaults from `helpers/defaults.ts`; make the constructor `resolveOptions(checkOptions(options))`. Export the error and factories from `src/outbox/sqlite/index.ts`. Verify.

## 2. Capacity and the events outcome

- [x] 2.1 Add to `tests/outbox/sqlite/outbox.spec.ts`: capacity answering `available` with no buffers for any request, throwing once closed; `commitEvents` answering committed. Run red.
- [x] 2.2 Add `capacity` and the `commitEvents` outcome to `src/outbox/sqlite/outbox.ts`, and say in its TSDoc that it limits nothing. Verify.

## 3. Version 2 and terminal states

- [x] 3.1 Add to `tests/outbox/sqlite/outbox.spec.ts`: a version 1 file refused; a terminal state deleted once past its retention, its events kept; a `waiting` state kept; `Infinity` keeping everything; marking seen deleting a bounded batch of each; `deleteExpired()` answering how many of each. Run red.
- [x] 3.2 In `src/outbox/sqlite/schema.ts` move to version 2, add `committed_at` and the partial index; stamp it in `src/outbox/sqlite/statements.ts`; extend `deleteExpiredBatch` and **rename** `deleteExpiredEvents` to `deleteExpired`, answering `ArvoSqliteOutboxDeletedCounts`, in `src/outbox/sqlite/outbox.ts`; **rename** `expiredEventsDeletedPerMarking` to `expiredRowsDeletedPerMarking`, since it bounds states too. Verify.

## 4. The conformance kit

- [x] 4.1 Add to `tests/outbox/inmemory/broken-outboxes.ts` an outbox breaking each capacity check, and bring its existing outboxes up to the interface. Run red.
- [x] 4.2 Add `src/outbox/conformance/cases/capacity-is-answered.ts`, register it in `cases/index.ts`, and update any case relying on `commitEvents` answering nothing. Verify with `pnpm typecheck` clean across the package.

## 5. The whole suite

- [ ] 5.1 Run `pnpm test:coverage`. Fix every failure, in the files of `outbox-capacity`, `inmemory-outbox-capacity` and this change, and show each fix for review before it is committed. Verify the whole suite passes at 100% coverage.

## 6. Close out

- [ ] 6.1 Run `pnpm lint`, `pnpm typecheck` and `pnpm build`, all clean.
- [ ] 6.2 Check every new and changed file against `openspec/project.md`: **Documentation in source**, **Naming**, **Module-level state** and **Code style**. Verify with `node_modules/.bin/openspec validate sqlite-outbox-capacity --strict`.

## Workflow follow-up

- Each group is shown for review and committed once approved.
- Archive `outbox-capacity`, `inmemory-outbox-capacity` and this change with `/opsx:archive`, in that order.
