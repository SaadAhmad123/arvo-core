# Tasks

**No test is run in this change.** Every test is written first, as each task says, but "run red" and "verify with the spec" mean `pnpm typecheck` and `pnpm lint` on the task's files. The tests run, and coverage is judged, once the next change brings the SQLite outbox and the conformance kit up to the interface.

## 1. Options and defaults

- [ ] 1.1 Move `tests/ArvoOutboxDriver/helpers/check-against-schema.spec.ts` to `tests/utils/check-against-schema.spec.ts`. Write the option checks in `tests/outbox/inmemory/outbox.spec.ts`, **replacing** the `maxEvents` checks under "how many events it holds": each buffer's default; a size that is zero, negative or fractional, and a tolerance below zero or above one, each naming its path, the value and the rule; a retention that is negative or fractional; a clock that is not a function; an unknown key; every problem named at once in one `ArvoMemoryOutboxValidationError` carrying `issues`. Write `tests/outbox/inmemory/errors.spec.ts`: the error carries a frozen copy of every issue, its tag and its name, and a message naming each issue. Run red.
- [ ] 1.2 In `src/outbox/inmemory/types.ts` **replace** `maxEvents` with `buffers` and `retentionMs`, adding `ArvoMemoryOutboxBuffer`, with TSDoc stating that the buffers count items, not bytes, and that each retention must outlast the queue's redelivery time. Add `src/outbox/inmemory/errors.ts` with `ArvoMemoryOutboxValidationError`, shaped as `ArvoDispatcherValidationError` is. In `src/outbox/inmemory/helpers/defaults.ts` **replace** `defaultMaxEvents` with the buffer and retention defaults. **Move** `src/ArvoOutboxDriver/helpers/check-against-schema.ts` to `src/utils/check-against-schema.ts`, updating the driver's imports, and rename its private `pathSegmentForKey` to `pathSegmentForSchemaKey`, since `src/utils/issue-path.ts` already exports a `pathSegmentForKey` that quotes map keys. Check the whole options object with one zod schema, built in the constructor of `src/outbox/inmemory/outbox.ts` and run through it. Export the new type and the error from `src/outbox/inmemory/index.ts`, beside the options. Verify with `pnpm typecheck` and `pnpm lint`.

## 2. Capacity

- [ ] 2.1 Write `tests/outbox/inmemory/helpers/buffer-capacity.spec.ts`: `available` at or below the size, `tolerating` past it, `exhausted` past the limit, `tolerating` while the steady flag is set, a tolerance of zero never `tolerating`, and `held`, `size` and `limit` in each answer. Add to `outbox.spec.ts`: capacity for a first revision and a later one; the overall status the worst; asking changes nothing; the answer staying `tolerating` until drained to `size × (1 − tolerance)`. Run red.
- [ ] 2.2 Add `src/outbox/inmemory/helpers/buffer-capacity.ts`, the steady flags to the store, their update after every write, and `capacity` to `src/outbox/inmemory/outbox.ts`. Verify with `pnpm typecheck` and `pnpm lint`.

## 3. Refusing at commit

- [ ] 3.1 Add to `outbox.spec.ts`: each commit refused as `capacity_exhausted` past a limit, writing nothing; a later revision not refused by a full states buffer; past the size but within the limit committed; an event held or carried twice counted once; `commitEvents` answering `{ committed: true }`. Run red.
- [ ] 3.2 In `src/outbox/inmemory/outbox.ts` check both buffers before the first write, **remove** `countEventsToDrop` and `dropSeenEvents`, and make `commitEvents` answer its outcome. Update the class TSDoc. Verify with `pnpm typecheck` and `pnpm lint`.

## 4. Retention and the sweep

- [ ] 4.1 Add to `outbox.spec.ts`, with time from `options.clock` and ticks fired by Vitest's fake timers: a seen event deleted once past its retention, a more recent one kept, an unseen one never; a deleted event committed again stored as unseen; a terminal state deleted once past its retention, its events kept; a `waiting` state never; retention counted from the last commit; the interval from the shorter retention with a floor of one second; no sweep once closed; the timer unref'd; a clock failing during a tick deleting nothing, warning once, and the next tick running. Run red.
- [ ] 4.2 Add `seenAtMs` to `StoredEvent`, `terminalStatesByExecution` to the store, the frozen list of terminal lifecycles, the sweep, and the timer started in `open` and cleared in `close`, in `src/outbox/inmemory/outbox.ts`. Verify with `pnpm typecheck` and `pnpm lint`.

## 5. Close out

- [ ] 5.1 Run `pnpm lint`, and verify `pnpm typecheck` reports errors only under `src/outbox/sqlite/`, `src/outbox/conformance/` and `tests/outbox/`, outside `tests/outbox/inmemory/`.
- [ ] 5.2 Check every new and changed file against `openspec/project.md`: **Documentation in source**, **Naming** and **Module-level state**. Verify with `node_modules/.bin/openspec validate inmemory-outbox-capacity --strict`.

## Workflow follow-up

- Each group is shown for review and committed once approved.
- The next change brings the SQLite outbox and the conformance kit up to the interface and runs every test. Archive this one with `/opsx:archive`.
