## 1. The lifecycle helper

- [x] 1.1 Write `tests/outbox/helpers/outbox-lifecycle.spec.ts`: the resources are reached only while open; before opening, `resourcesFor` throws naming the outbox and the operation and saying to open it; opening twice acquires once; a failed `acquire` leaves it unopened and may be retried; closing releases once, and closing again, or closing unopened, releases nothing; once closed, `resourcesFor` throws saying to build a new one, and `open` throws the same. Run red.
- [x] 1.2 Add `src/outbox/helpers/outbox-lifecycle.ts`, the class generic in the resources an outbox holds. Verify with the spec at 100% coverage.

## 2. `ArvoMemoryOutbox` opened and closed

- [x] 2.1 Update `tests/outbox/inmemory/outbox.spec.ts` so every outbox it builds is opened, and add: every operation throws before opening; opening twice keeps what it holds; closing frees what it holds, and every operation throws once closed; opening once closed throws; closing unopened throws nothing and leaves it closed. Update `tests/outbox/inmemory/broken-outboxes.ts` and `tests/outbox/inmemory/conformance.spec.ts` to open what they build. Run red.
- [x] 2.2 Replace the fields of `src/outbox/inmemory/outbox.ts` with a store acquired on `open()` and dropped on `close()` through the helper, with TSDoc on both. Verify with the in-memory and conformance specs at 100% coverage.

## 3. `ArvoSqliteOutbox` opened and closed

- [x] 3.1 Update `tests/outbox/sqlite/outbox.spec.ts`, `tests/outbox/sqlite/racer.mts` and `tests/outbox/sqlite/conformance.spec.ts` so every outbox is opened, and replace the tests that expected `new` to throw on a bad file with ones expecting `open()` to. Add: building touches no file; every operation throws before opening; opening twice keeps the connection; a failed open leaves it unopened and closes what it opened; opening once closed throws. Run red.
- [x] 3.2 **Replace** the constructor's opening in `src/outbox/sqlite/outbox.ts`: the constructor checks options only, and `open()` creates the file, configures the connection, checks the version and creates the tables, through the helper. Update its TSDoc and `@example` to open and close. Verify with the SQLite specs at 100% coverage.

## 4. The interface and the kit

- [ ] 4.1 Update `tests/ArvoOutbox/interface.types.spec.ts`: both classes implement `open` and `close`; an outbox missing either does not satisfy the interface. Run red with `pnpm typecheck`.
- [ ] 4.2 Write `tests/outbox/conformance/run-case.spec.ts`: a case runs against an outbox opened first; it is closed after a check that passes, after a check that throws, and after an `open` that throws; the check's failure is what is thrown. Update `tests/outbox/conformance/describe.spec.ts` so its stub opens and closes. Run red.
- [ ] 4.3 Add the lifecycle cases to `src/outbox/conformance/cases/` (open again, close again, every operation throws once closed), and to `tests/outbox/inmemory/broken-outboxes.ts` an outbox breaking each. Run red against the case spec.
- [ ] 4.4 Add `open()` and `close()` to `src/ArvoOutbox/interface.ts` with TSDoc stating the interface's rule; add `src/outbox/conformance/run-case.ts`; make `describe.ts` use it; **replace** the TSDoc on `ArvoOutboxConformanceParam` that tells a developer to close outboxes themselves with one saying the kit opens and closes them; restore both outboxes' `conformance.spec.ts` to the one call. Verify with `pnpm typecheck` and the whole outbox suite at 100% coverage.

## 5. Close out

- [ ] 5.1 Run the whole suite with coverage, lint, typecheck and build from `ts/arvo-core`.
- [ ] 5.2 Validate the change with `node_modules/.bin/openspec validate outbox-lifecycle --strict`.

## Workflow follow-up

- Each group is shown for review and committed once approved.
- Archive the change with `/opsx:archive`, syncing `specs/outbox/spec.md` into `openspec/specs/outbox/`.
