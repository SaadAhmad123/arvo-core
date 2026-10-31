# Tasks

**No test is run in this change.** Every test is written first, as each task says, but "run red" and "verify with the spec" mean `pnpm typecheck` and `pnpm lint` on the task's files. The tests run, and coverage is judged, in the next change.

## 1. The outbox interface

- [x] 1.1 Write `tests/ArvoOutbox/types.types.spec.ts` additions: `ArvoOutboxCapacityRequest` with and without a state; `ArvoOutboxCapacity` with no buffers, one, or both, each number optional; `ArvoOutboxRefusal` accepting `capacity_exhausted`. Write `tests/ArvoOutbox/interface.types.spec.ts` additions: an outbox with `capacity` is an `IArvoOutbox`, one without is not, and one whose `commitEvents` answers nothing is not. Run red with `pnpm typecheck`.
- [x] 1.2 Add `src/ArvoOutbox/types/capacity.ts`; in `src/ArvoOutbox/types/commit.ts` add `capacity_exhausted` to `ArvoOutboxRefusal`; in `src/ArvoOutbox/interface.ts` add `capacity` and **replace** `commitEvents`'s `void` answer with `ArvoOutboxCommitOutcome`, updating the interface's TSDoc and `@example`. Export the new types from `src/index.ts`. Verify with the two type specs (errors elsewhere in `src/outbox/` are expected, see design).

## 2. The driver's error

- [x] 2.1 Extend `tests/ArvoOutboxDriver/errors.spec.ts`: kind `capacity_exhausted` with its meaning in the message; `capacity` carried where given and `null` where not. Run red.
- [x] 2.2 In `src/ArvoOutboxDriver/errors.ts` add the kind, its meaning, the `capacity` param and field, with TSDoc. Verify with the spec at 100% coverage.

## 3. The capacity helpers

- [x] 3.1 Write `tests/ArvoOutboxDriver/helpers/check-against-schema.spec.ts`: a zod schema's output handed back with unknown keys dropped; each issue's path under the root, with a position in brackets and a key after a dot, and the value found there. Write `tests/ArvoOutboxDriver/helpers/build-capacity-request.spec.ts`: a commit with a record gives the event count and its `casVersion`; events alone give the count only; nothing gives one event and `casVersion` 0; a record missing a lifted field throws the validation error. Write `tests/ArvoOutboxDriver/helpers/check-capacity.spec.ts`: each well-formed answer accepted as given; an unknown status, overall or per buffer, `buffers` missing or not an object, and a number that is negative, fractional or not a number each answered with an issue naming its path. Run red.
- [x] 3.2 Add `ArvoOutboxDriverCapacityParam` to `src/ArvoOutboxDriver/types.ts`, which the request helper takes, and add `src/ArvoOutboxDriver/helpers/check-against-schema.ts`, `src/ArvoOutboxDriver/helpers/build-capacity-request.ts`, and `src/ArvoOutboxDriver/helpers/check-capacity.ts` with a zod schema, checked through `zod/v4/core`. Verify with both specs at 100% coverage.

## 4. Checking commit outcomes and committed records with zod

- [ ] 4.1 Extend `tests/ArvoOutboxDriver/helpers/check-commit-outcome.spec.ts`: `capacity_exhausted` accepted beside the other two refusals, an answer of nothing refused, and each refusal answered with one issue at its path. Keep `tests/ArvoOutboxDriver/helpers/check-committed-records.spec.ts` as it stands. Run red.
- [ ] 4.2 **Replace** the hand-written check in `src/ArvoOutboxDriver/helpers/check-commit-outcome.ts` with a zod schema run through `checkAgainstSchema`, accepting all three refusals. **Replace** the field-by-field readers in `src/ArvoOutboxDriver/helpers/check-committed-records.ts` with a zod schema the same way, keeping `malformed_response` for an answer that is no list and `malformed_event` for anything wrong inside it. Verify with both specs.

## 5. Spans that record the question

- [ ] 5.1 Extend `tests/ArvoOutboxDriver/helpers/run-in-span.spec.ts`: `run` is given the span opened for it. Run red.
- [ ] 5.2 Change `src/ArvoOutboxDriver/helpers/run-in-span.ts` to pass the span to `run`. Verify with the spec at 100% coverage.

## 6. The driver

- [ ] 6.1 Add a test fixture, `tests/ArvoOutboxDriver/capacity-outbox.ts`, wrapping `ArvoMemoryOutbox` with a `capacity` answer the test sets and the new `commitEvents` outcome, and move `tests/ArvoOutboxDriver/driver.spec.ts` onto it. Add to the spec: `tryCapacity` / `capacity` given each param, the request reaching the outbox, the answer handed back unchanged, `exhausted` not an error, `unavailable` and `malformed_response`, its own span; each commit asking first, with the request matching the commit; `exhausted` → `capacity_exhausted` with the answer and the commit not called; the question throwing or malformed → that kind for the commit, the commit not called; `tolerating` → committed; the outbox refusing either commit as `capacity_exhausted` → that kind with `capacity` `null`; `commitEvents` answering a malformed outcome → `malformed_response`; the question recorded on the commit's span with no span of its own. Run red.
- [ ] 6.2 Add `tryCapacity`, `capacity` and `#askCapacity` to `src/ArvoOutboxDriver/index.ts`. Ask before both commits, and check `commitEvents`'s outcome. Update the class and method TSDoc for the new kinds. Export the param from `src/index.ts`. Verify with `driver.spec.ts`, and with `driver.types.spec.ts` still passing.

## 7. Close out

- [ ] 7.1 Run `pnpm lint`, and verify `pnpm typecheck` reports errors only under `src/outbox/` and `tests/outbox/`.
- [ ] 7.2 Check every new and changed file against `openspec/project.md`: **Documentation in source**, **Naming**, **Module-level state**, and the `try`-prefix rules. Verify with `node_modules/.bin/openspec validate outbox-capacity --strict`.

## Workflow follow-up

- Each group is shown for review and committed once approved.
- The next change brings `src/outbox/inmemory`, `src/outbox/sqlite` and `src/outbox/conformance` up to the new interface and turns the full suite green. Archive this one with `/opsx:archive`.
