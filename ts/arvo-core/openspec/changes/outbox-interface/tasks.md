Built in this order: the interface, then the conformance kit, then the in-memory outbox proven by the kit, then the SQLite outbox proven by the kit. Every group starts with its tests, ends at 100% coverage with lint and typecheck clean, and is its own commit. Every change under `src/` is shown for review before its commit. Every rule that does not need a controlled clock is tested once, as a conformance case, and those cases run against both of Arvo's outboxes.

## 1. The interface and its types

- [ ] 1.1 Write `tests/ArvoOutbox/types.types.spec.ts`: an empty filter is a compile error and each of the three filter shapes compiles; a committed event record is an event record with `committedAt` and `seen`; a commit outcome narrows on `committed` to a refusal of exactly `state_exists` or `revision_stale`; every field of every type is read-only.
- [ ] 1.2 Write `tests/ArvoOutbox/interface.types.spec.ts`: a class implementing every operation satisfies `IArvoOutbox`; one missing any operation does not; an operation returning its value directly and one returning a promise both satisfy it.
- [ ] 1.3 Add `src/ArvoOutbox/types/event-record.ts`, `src/ArvoOutbox/types/commit.ts` and `src/ArvoOutbox/types/read.ts`, with library-grade TSDoc on every type and field.
- [ ] 1.4 Add `src/ArvoOutbox/interface.ts`, `IArvoOutbox`, with TSDoc on the interface and on each method stating the rule an implementer meets, and an `@example` implementing it.
- [ ] 1.5 Export the interface and every type from `src/index.ts`.

## 2. The conformance kit

- [ ] 2.1 Write `tests/outbox/conformance/describe.spec.ts`, against a stub outbox and a stub list of cases: `describeArvoOutboxConformance` registers one test per case under one suite, calls `createOutbox` once per case and awaits it, and hands each case the outbox it was given.
- [ ] 2.2 Add `src/outbox/conformance/types.ts`, the case type and the suite's param, and `src/outbox/conformance/describe.ts`.
- [ ] 2.3 Add the cases under `src/outbox/conformance/cases/`, one file per requirement of `specs/outbox/spec.md` that does not need a controlled clock, each case named for the rule it checks, using unique identifiers.
- [ ] 2.4 Add `src/outbox/conformance/index.ts`, exporting the suite function and the list of cases, with TSDoc a developer reads to run the kit, including that each call of `createOutbox` must return a fresh, empty outbox.
- [ ] 2.5 In `package.json`, add `./outbox/conformance` to `exports`, and vitest to `peerDependencies` with its `peerDependenciesMeta` entry marked optional.

## 3. `ArvoMemoryOutbox`, proven by the kit

- [ ] 3.1 Write `tests/outbox/inmemory/conformance.spec.ts`: exactly the one call a developer writes, `describeArvoOutboxConformance` with `createOutbox: () => new ArvoMemoryOutbox()`.
- [ ] 3.2 Write `tests/outbox/inmemory/broken-outboxes.ts` and `tests/outbox/conformance/cases.spec.ts`: one outbox per case, each wrapping `ArvoMemoryOutbox` and breaking exactly that case's rule, such as caching reads, accepting a skipped revision, throwing on a refusal, rewriting a payload or listing seen events; every case fails against its broken outbox, with a message naming the rule.
- [ ] 3.3 Write `tests/outbox/inmemory/helpers/refusal-for.spec.ts`: the first revision with nothing stored is accepted; the first revision with something stored is `state_exists`; the next revision is accepted; the stored revision, a revision skipping ahead, and a later revision with nothing stored are each `revision_stale`.
- [ ] 3.4 Write `tests/outbox/inmemory/outbox.spec.ts` for what only an outbox with a set clock can be held to, and for production grade: the clock is called once per commit; the cut-off includes an event exactly that age; ties keep commit order; two commits racing under `Promise.all` leave exactly one committed; a read overlapping a commit sees all or none; changing what was committed or read changes nothing stored; an input that cannot be copied throws before anything is written; every operation returns a promise; reading one delivery's events from an outbox holding many does not look through the others.
- [ ] 3.5 Add `src/outbox/inmemory/helpers/refusal-for.ts`, `src/outbox/inmemory/types.ts`, `src/outbox/inmemory/outbox.ts` and `src/outbox/inmemory/index.ts`, with TSDoc whose first sentence says it holds everything in process memory, and an `@example` building and using it.
- [ ] 3.6 In `package.json`, add `./outbox/inmemory` to `exports`.

## 4. `ArvoSqliteOutbox`, proven by the kit

- [ ] 4.1 Add `better-sqlite3` and `@types/better-sqlite3` as development dependencies, and `better-sqlite3` to `peerDependencies` with its `peerDependenciesMeta` entry marked optional.
- [ ] 4.2 Write `tests/outbox/sqlite/conformance.spec.ts`: the one call a developer writes, with `createOutbox` opening a new SQLite outbox on a fresh temporary file per case, and closing each afterwards.
- [ ] 4.3 Write `tests/outbox/sqlite/outbox.spec.ts`: a new file is created with everything it needs; a file used before keeps what was committed; closing and opening again reads back the state, the events and which are seen; two outboxes on one file racing for one revision leave exactly one committed; a writer holding the file beyond the wait makes the operation throw with nothing stored; every event of one commit carries one time, in an event's time form; closing twice throws nothing and any operation after closing throws; every operation returns a promise.
- [ ] 4.4 Add `src/outbox/sqlite/schema.ts`, `src/outbox/sqlite/statements.ts`, `src/outbox/sqlite/types.ts`, `src/outbox/sqlite/outbox.ts` and `src/outbox/sqlite/index.ts`, with TSDoc whose first sentence says it is an outbox in a SQLite file for one machine, and an `@example` opening, using and closing it.
- [ ] 4.5 In `package.json`, add `./outbox/sqlite` to `exports`.

## 5. Close out

- [ ] 5.1 Write `tests/entry-points.spec.ts`: after a build, the main entry point and `outbox/inmemory` import neither vitest nor `better-sqlite3`; `outbox/sqlite` imports `better-sqlite3` and not vitest; `outbox/conformance` imports vitest and not `better-sqlite3`; every entry point exists in `dist/`.
- [ ] 5.2 Run the whole suite with coverage, lint, typecheck and build from `ts/arvo-core`.
- [ ] 5.3 Validate the change with `node_modules/.bin/openspec validate outbox-interface --strict`.
