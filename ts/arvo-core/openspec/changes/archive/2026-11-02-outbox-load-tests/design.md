# Design

## Context

See proposal.md, **Why**. `ts/sandbox` already runs heavy suites against `arvo-core` by path, with Docker (`infra/docker-compose.yml`, `infra/worker.Dockerfile`, whose build context is `ts/` so both packages build together). The requirements are in `specs/outbox-load-tests/spec.md`. The suite uses only what `arvo-core` exports: `ArvoOutboxDriver`, the dispatcher and handler factories, and the `outbox/inmemory`, `outbox/sqlite` and `outbox/conformance` entry points.

## Goals / Non-Goals

**Goals:**

- Every check in the spec, for each outbox, in containers, with one command per outbox and a report a person can read and a later run can compare against.

**Non-Goals:**

- See proposal.md, **Deliberately not in scope**. Also: no change to `arvo-core`, and no check of an outbox written by anyone else.

## Decisions

### Layout

```
ts/sandbox/
  infra/load.Dockerfile          the one image
  src/load/
    run.ts                       host side: check Docker, build, run containers, write the report
    containers.ts                each container a run needs, with its Docker settings
    report.ts                    the report, and the comparison with the last run
    harness/
      fake-queue.ts              an in-process queue: deliver, redeliver, ack
      workers.ts                 workers driving dispatcher → driver → outbox, and a sweeper
      catalogue.ts               an in-memory catalogue, the one dependency the distributed handlers need
      invariants.ts              the ledger every check ends by verifying
      measure.ts                 timings, percentiles, event-loop delay, GC pauses, samples
      results.ts                 writes measurements and outcomes to /results
      processes.ts               forking committers, sweepers and killable children
  tests/load/
    inmemory/*.load.ts           one file per spec group
    sqlite/*.load.ts             likewise
  load-results/                  one folder per run, ignored by git
```

### The handlers

The suite drives the handlers in `src/distributed/handler`, through `HANDLERS`, rather than toy ones: an order that fans out to inventory, payment and fraud checks, a category walk that descends, and an audit write. That is the traffic shape a deployment sends: orchestrators that wait, services that answer, executions that finish. Their one dependency, `catalogue`, is backed in the distributed sandbox by Postgres; here `harness/catalogue.ts` holds it in memory, with the same idempotent `reserve`, so no database is needed and the outbox is the only storage under test. Their telemetry and log context are kept as they are, with no exporter configured.

### The image

`infra/load.Dockerfile`, built from `ts/` as `worker.Dockerfile` is, on `node:22-bookworm-slim`: glibc, so `better-sqlite3` installs from its prebuilt binary or builds with the toolchain the build stage adds, and `libfaketime` comes from Debian. It builds `arvo-core`, then installs the sandbox, and runs as the `node` user.

### Running

`pnpm load:inmemory` and `pnpm load:sqlite` run `src/load/run.ts` on the host with `tsx`. It:

1. stops at once where `docker info` fails;
2. builds the image, which builds `arvo-core` fresh;
3. runs each container in `containers.ts` for that outbox, one after another, each running `vitest run` over its own test files with long timeouts, and mounting a fresh `load-results/<run>/<container>/` at `/results`;
4. reads every `/results` folder, writes `load-results/<run>/report.md` and `report.json`, prints the report, compares measurements with the last run whose machine matches, and exits non-zero where any check failed.

`--soak` adds the soak container. `LOAD_SOAK_MINUTES` shortens it, sixty by default.

### Nothing runs on the host

`run.ts` is the only thing on the host, and it only calls the `docker` command: build the image, run a container, wait, stop it. Every container is started with:

```
docker run --rm --init
  --cpus=<cap> --memory=<cap> --memory-swap=<same cap> --pids-limit=512
  --user node --cap-drop=ALL --security-opt no-new-privileges
  --network none
  --mount type=bind,source=<sandbox>/load-results/<run>/<container>,target=/results
```

- `--rm` removes it when it stops; `--network none` gives it no network, so nothing is published or reached; the one bind mount is the run's own, empty results folder.
- The caps bound what a runaway check can take: `--memory-swap` equal to `--memory` stops it swapping onto the host, and `--pids-limit` stops a fork loop.
- The SQLite file, forked processes, the faked clock and the full disk all live inside the container: the 20 MB disk is a `--tmpfs` counted against the container's own memory cap, never the host's disk.
- `run.ts` names each container it starts, and on `SIGINT`, `SIGTERM` or its own exit stops and removes every one still running. A run started while an earlier one's containers are left over removes them first.
- The image is tagged `arvo-load:<build>` and replaced by the next build, so runs do not pile up images.

### Containers

| Container | Outbox | Docker settings | Runs |
|---|---|---|---|
| `main` | both | `--cpus=2`, `--memory=2g` | speed, filling up, cleaning up, at once, failures, size limits |
| `full-disk` | SQLite | `--tmpfs /data:size=20m` | the full disk check |
| `faked-clock` | SQLite | `LD_PRELOAD` of `libfaketime`, reading the time from a file the test rewrites | clock jumps for SQLite |
| `soak` | both | as `main` | resources over time |

The in-memory outbox's clock is an option, so its clock checks run in `main`. Processes for SQLite — several on one file, a killed child, a writer holding the lock — are forked inside `main` by `processes.ts`. A read-only, deleted, corrupted or newer file is made inside `main` by the test, so needs no container of its own.

### The invariants

Every committing check records in a ledger what it committed and what was handed out, published and marked seen. `invariants.ts` then reads the outbox back and fails, naming the check and the event, where an event was never handed out, a revision landed twice, a payload differs byte for byte, a listing was out of order, or an operation threw where it should have answered.

### Measuring

Each operation's time with `process.hrtime.bigint`; percentiles from the samples; event-loop delay with `perf_hooks.monitorEventLoopDelay`; GC pauses with a `PerformanceObserver` on `gc`; memory, file sizes, active timers and handles sampled each minute in the soak. Measurements are reported, never asserted, except that the soak fails where a sample keeps rising through its last quarter.

### The comparison

A run's machine is its CPU model, core count and memory, with the Docker limits. The report sets each measurement beside the same one from the newest earlier run on a matching machine, and marks a change past a fifth as worth a look, without failing.

## Risks / Trade-offs

- [Docker may run its containers in a virtual machine, so numbers are not bare-metal numbers] → They are compared only with runs on a matching machine.
- [A million events in memory may need more than the container allows] → `main` has two gigabytes; where a size check cannot fit, the report says skipped and why, and does not pass it.
- [`libfaketime` may not reach SQLite's clock in every build] → The faked-clock container checks first that SQLite's own time moved, and reports the check skipped where it did not.
- [The suite takes long] → The quick run is the default; the soak is asked for.

## Migration Plan

None. The suite is new and runs by hand.

## Findings

From the runs of 2026-11-01, each container capped as **Containers** says. Numbers are for comparing runs on a matching machine, not targets. None is fixed here; each points at a later change.

### Pointing at `arvo-core`

- **The driver builds a zod schema on every call that checks an answer.** A stack sampled during a run under pressure sat in `check-capacity.ts` building its schema, and every commit now asks capacity first, so every commit builds at least two schemas (capacity and outcome). Building a schema per call keeps `project.md`'s **Module-level state** rule, but the driver could build its schemas once, in its constructor, as it builds its serializer. A later change to `ArvoOutboxDriver`.
- **The in-memory outbox takes about 2.4 KB a held event.** A million held events, each with a 16-byte payload, brought the process to about 2.4 GB; at that size a read of one delivery took up to about 100 ms, the time of a major garbage collection. The buffers' TSDoc says they count events, not bytes; it should also say about how much memory an event takes, so a size can be chosen against a memory limit. A later docs change to `src/outbox/inmemory/types.ts`.
- **SQLite's `deleteExpired()` holds the thread for its whole run.** Deleting 50,000 expired events and 20,000 expired states took about 2.4 s, in batches each a transaction of its own, without yielding between them: a process calling it on its event loop stops for that long. Either its TSDoc says so, or it yields between batches. A later change to `src/outbox/sqlite/outbox.ts`.
- **A SQLite file made read-only leaves its side files read-only.** Opening fails cleanly, but SQLite creates `-wal` and `-shm` with the main file's permissions, so making only the main file writable again does not let it open. Worth one sentence in `ArvoSqliteOutboxOptions.filename`'s TSDoc: a repair covers all three files.

### Pointing at a mechanism, for the later ADR on mechanism policy

- **A worker that only retries when the outbox is full starves the in-memory outbox's sweep.** Every in-memory operation answers without yielding, so a worker loop that redelivers on `exhausted` and takes the next delivery at once never lets the sweep's timer run, and nothing ever frees room. A mechanism must back off, by any time at all, when it is refused for room.
- **Recovery must resend only what was never sent.** A repeated delivery that resends every event its first delivery committed makes each of those a repeat downstream, which recovers in turn, without end. A mechanism resends the events whose record says `seen: false`.
- **More workers than four make fan-in executions slower.** Through the order handler, which waits on many answers at once, orders per second fell from about 26 at four workers to about 17 at sixteen in memory, and from about 16 to about 11 on SQLite, while deliveries per second rose: answers to one order race, all but one is refused as `revision_stale`, and each refused one runs again. Serializing deliveries per execution, or a mechanism's own concurrency limit per subject, would recover it.

### The soak

- **SQLite passed its full hour**: about 39,000 orders, the heap held after collection level between 18 and 26 MB, the file flat. That is the result after fixing the suite's own leak: its timing wrapper kept every call's duration, which over a soak's millions of calls grew the heap steadily and looked like a leak in the outbox. It now keeps a fixed random sample.
- **The in-memory soak is unresolved.** Twice it stopped partway: one batch of orders made almost no progress for minutes, its commits refused again and again as `revision_stale`, until its deadline. Short runs never show it. The host was asleep around the first; the second is not explained. It may be the harness's own rerunning of stale commits, or a stall in the in-memory outbox under sustained contention. It needs its own look, starting from a soak that writes progress as it goes.

### Measured, worth keeping as a baseline

| | In memory | SQLite |
|---|---|---|
| Orders per second, 4 workers | about 26 | about 16 |
| One commit of a state, p99 | 0.06 ms | 2–3 ms |
| Commit of 10,000 events of 1 KB | about 93 ms | about 205 ms |
| Read of one delivery among a million events, p99 | about 100 ms (collection) | 1.4 ms |
| Memory holding a million events | about 2.4 GB | about 290 MB |
| Longest thread block, 64 workers | about 75 ms | about 100 ms |
| A commit while another writer holds the file, 200 ms wait | — | refused as `unavailable` after about 250 ms |
