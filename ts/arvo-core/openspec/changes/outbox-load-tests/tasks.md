# Tasks

All work is in `ts/sandbox`; no file under `ts/arvo-core/src` changes. Each group is verified by running what it adds in Docker, and ends with `pnpm lint` and `pnpm typecheck` clean in `ts/sandbox`.

## 1. The image, the runner and the report

- [x] 1.1 Add `ts/sandbox/infra/load.Dockerfile`, building `arvo-core` and the sandbox from `ts/` on `node:22-bookworm-slim`, with `libfaketime`, running as `node`. Verify it builds.
- [x] 1.2 Add `src/load/run.ts`, `src/load/containers.ts` and `src/load/report.ts`, the `load:inmemory` and `load:sqlite` scripts in `ts/sandbox/package.json`, `--soak` and `LOAD_SOAK_MINUTES`, and `load-results/` to the sandbox's `.gitignore`. Start every container as **Nothing runs on the host** in the design says. Verify with one trivial check per outbox: the run fails fast without Docker, and with it writes a report naming the check and the machine; `docker inspect` of a running container shows the caps, no network, no privilege and the one mount; a check that allocates past its memory cap stops only its container; interrupting a run leaves no container behind; and nothing is written on the host outside `load-results/`.

## 2. The harness

- [ ] 2.1 Add `src/load/harness/`: the fake queue, the workers and sweeper driving the handlers in `src/distributed/handler` with an in-memory catalogue, the invariant ledger, measuring, results and forked processes. Verify each with a small test under `tests/load/harness/`, run in the `main` container: the ledger fails on a lost event and a doubled revision, and the workers drive a real dispatcher and driver to committed, published and seen.

## 3. The in-memory checks

- [ ] 3.1 Add `tests/load/inmemory/`, one file per spec group: speed; filling up and recovering; cleaning up, with the clock moved through the outbox's option; things at once; failures forced through broken outboxes and the driver; size limits. Every committing check ends on the invariants. Verify `pnpm load:inmemory` passes, and the report gives every measurement.

## 4. The SQLite checks

- [ ] 4.1 Add `tests/load/sqlite/`, one file per spec group, using forked processes for several on one file, a killed child and a writer holding the lock; and the full disk and faked clock checks in their own containers. Verify `pnpm load:sqlite` passes, and the report gives every measurement and names any check skipped, with why.

## 5. The soak

- [ ] 5.1 Add the soak for both outboxes and its container. Verify `LOAD_SOAK_MINUTES=10 pnpm load:inmemory --soak` and the same for SQLite pass, with the samples in the report.

## 6. Close out

- [ ] 6.1 Describe the load suite in `ts/sandbox/README.md`: what it checks, how to run it, how long it takes, and how to read a report.
- [ ] 6.2 Run `pnpm load:inmemory` and `pnpm load:sqlite` once more from a clean build, and the soak for each at its full length where time allows. Record in this change's `design.md`, under a new **Findings** section, every check that failed in a way that points at `arvo-core`, and every measurement worth a later change, each for its own change to `arvo-core`; fix none of them here. Verify with `node_modules/.bin/openspec validate outbox-load-tests --strict` from `ts/arvo-core`.

## Workflow follow-up

- Shown for approval before any work starts; then run through without stopping, committing each group.
- Archive with `/opsx:archive` once the findings are read.
