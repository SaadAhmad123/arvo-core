# Proposal

## Why

The in-memory and SQLite outboxes are checked for correctness by the unit tests and the conformance kit, but nothing has run them under load, for long, or through the failures production brings: a killed process, a full disk, a clock that jumps, many writers on one file. Their defaults were chosen without a measurement. Before a release, both need a load suite that proves they lose nothing, double nothing and fail cleanly, and that measures how fast they go.

## What Changes

- A load suite in `ts/sandbox`, which uses `arvo-core` as a consumer does: through its built, public entry points.
- Two commands, `pnpm load:inmemory` and `pnpm load:sqlite`, each running every check that applies to its outbox, inside Docker. `--soak` adds a run of about an hour.
- **Everything runs in Docker, nothing on the machine itself.** The host only starts and stops containers and writes the report. Each container is capped in CPU, memory and processes, has no network and no privilege, sees no host folder but its own results folder, and is removed when it stops, even when a run is interrupted.
- One Docker image, from `ts/sandbox/infra/load.Dockerfile`, on a glibc Linux base so `better-sqlite3` and `libfaketime` install cleanly. Each check that needs special conditions runs in a container started for it: a size-capped disk, a memory cap, a read-only mount, a faked clock.
- Eight groups of checks: speed; filling up and recovering; cleaning up; things happening at once; never losing or doubling anything; failures forced on purpose; resources over time; size limits.
- Groups two to six pass or fail. Groups one, seven and eight print measurements and write them, with the machine and the build they ran on, to `ts/sandbox/load-results/`, compared with the last run on the same machine.
- Where a run shows a default or a limit is wrong, the fix is a later change to `arvo-core`, not to the suite.

## Capabilities

### New Capabilities

- `outbox-load-tests`: what the load suite checks of each outbox, how it is run, and what it reports.

### Modified Capabilities

None.

## Impact

- Governed by [ADR-019](../../../../../docs/adr/019-outbox.md), whose rules each check holds an outbox to, and [ADR-020](../../../../../docs/adr/020-outbox-driver.md), for the checks run through the driver. No ADR changes.
- Code: `ts/sandbox/src/load/`, `ts/sandbox/tests/load/`, `ts/sandbox/infra/load.Dockerfile`, `ts/sandbox/package.json` scripts, and `ts/sandbox/README.md`. **No code under `ts/arvo-core/src` changes.**

### Deliberately not in scope

- **CI.** The suite runs by hand; a nightly job is a later change.
- **Fixing what it finds.** A failure or a poor number becomes its own change to `arvo-core`.
- **Fixed speed targets.** Numbers depend on the machine; the suite compares a run with the last on the same machine, and asserts no speed.
- **A network file system,** which the SQLite outbox does not support.
