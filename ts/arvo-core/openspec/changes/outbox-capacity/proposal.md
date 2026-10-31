# Proposal

## Why

ADR-019 now gives an outbox a seventh operation, `capacity`, and lets a full outbox refuse a commit as `capacity_exhausted` instead of throwing. ADR-020 has the driver offer `capacity`, ask it before every commit, and report a full outbox as its own kind. The TypeScript interface and driver do neither yet.

## What Changes

- **BREAKING** `IArvoOutbox` gains `capacity(request)`: asked with a number of events and, where a state comes with them, that state's `casVersion`; answers `available`, `tolerating` or `exhausted` overall, and per buffer (`events`, `states`) with optional `held`, `size` and `limit`.
- **BREAKING** A commit may refuse with `capacity_exhausted`. `commitStateAndEvents` gains it as a third refusal; `commitEvents` now answers the same commit outcome as `commitStateAndEvents`, where it answered nothing before.
- `ArvoOutboxDriver` gains `tryCapacity` / `capacity`, given what would be committed, or nothing. It passes only the facts to the outbox, checks the answer, and hands it back unchanged.
- Both driver commits ask the outbox's capacity first. `exhausted` stops the commit as the new kind `capacity_exhausted`, carrying the answer; a failed question fails the commit with that error. Nothing is written either way.
- `commitEvents` on the driver checks the outbox's new outcome, so it can now report `capacity_exhausted` and `malformed_response`.
- `ArvoOutboxDriverError` gains the kind `capacity_exhausted` and a `capacity` field.
- New public types are exported from the main entry point.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `outbox`: seven operations; a commit may refuse for lack of room; an outbox answers how much room it has.
- `outbox-driver`: the driver offers capacity, asks it before every commit, and reports `capacity_exhausted`.

## Impact

- Implements [ADR-019](../../../../../docs/adr/019-outbox.md) rules 18–24 and the `capacity_exhausted` refusal, and [ADR-020](../../../../../docs/adr/020-outbox-driver.md) **Capacity: asking, and asking before every commit**, at the interface and the driver.
- Code: `src/ArvoOutbox/` and `src/ArvoOutboxDriver/`, their tests, and the export lines in `src/index.ts`.

### Deliberately not in scope

- **Arvo's outboxes and the conformance kit.** `src/outbox/inmemory`, `src/outbox/sqlite` and `src/outbox/conformance` are not touched. **They stop compiling** against the new interface, and the full test suite and `pnpm typecheck` fail, until a following change gives them `capacity`, the new `commitEvents` outcome, retention and buffers. That change also brings the in-memory outbox's "throws where there is no room" requirement in line with ADR-019 rule 23, and adds conformance checks for the new rules.
- **What a caller does with an answer.** Pausing intake on `tolerating` or `exhausted` is the mechanism's policy, deferred by ADR-019.
- **Retention.** The deployment's, deferred by ADR-019.
