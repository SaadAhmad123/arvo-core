# sandbox (TypeScript)

A playground for trying out `arvo-core` (ts) directly off disk, without publishing it to npm first. Not part of the published package — `private: true`, never built or shipped.

`arvo-core` is linked here via `"arvo-core": "file:../arvo-core"` in `package.json` — pnpm resolves that to a live link into `../arvo-core`, not a downloaded copy.

## Setup

```bash
cd ts/arvo-core && pnpm install && pnpm run build   # arvo-core must be built at least once
cd ../sandbox && pnpm install
```

## Use

```bash
pnpm run play              # every chapter, in order
pnpm run play contract     # only chapters whose title matches
pnpm run play 10           # only chapter 10
```

## The distributed sandbox

A second, much larger thing living under `src/distributed/`: the same handlers run under real distributed frameworks, against a real Temporal cluster, a real Postgres and a real telemetry stack. Nothing is mocked and nothing is skipped — a conformance test that silently skips proves nothing.

Everything that asserts lives under `tests/`, mirroring `src/`, and runs with vitest.

### Bring it up

Docker must be running.

```bash
pnpm run distributed:up        # nine containers, waits for every health check
pnpm run distributed:migrate   # the record store, the outbox, and what the handlers read
```

`:up` is idempotent. `pnpm run distributed:down` stops it and keeps the volumes; `pnpm run distributed:reset` throws the volumes away too, after which `:migrate` has to run again.

### Check it before trusting it

```bash
pnpm run distributed:probe     # sends one of each signal and reads each back out
pnpm run distributed:purity    # asserts no handler knows about any framework
```

The probe is worth running first. It proves traces reach Tempo, metrics reach Prometheus and logs reach Loki — without it, a missing signal later looks like a missing feature rather than a missing exporter.

### Run a whole run under Temporal

```bash
pnpm run distributed:temporal  # starts the workers in-process, runs one run end to end
```

That spec starts the same workers `worker.ts` deploys, opens one order, answers the review that leaves the lattice from outside, and asserts what landed in the database.

To watch one instead, run the workers yourself and leave them up:

```bash
pnpm run distributed:temporal:worker
```

It listens on both task queues, answers `/live` and `/ready` on `localhost:9464`, and stops cleanly on Ctrl-C — finishing what is in flight, flushing telemetry and closing its pool.

### Where to look

| what | where |
|---|---|
| workflows, histories, and what each execution is waiting on | Temporal UI, `localhost:8080` |
| traces, metrics, logs, and the run's own dashboard | Grafana, `localhost:3000` |
| records, the outbox, and what needs a person | Postgres, `localhost:5433`, database `arvo_records` |

Grafana comes up already provisioned — the datasources and the dashboard are files under `infra/grafana/`, not something clicked together.

Every setting has a default that matches the stack above, so nothing needs configuring to run locally. Each one can be overridden from the environment, and a process that cannot be configured refuses to start rather than running half-configured.

## The load suite

Load, odd use and forced failures for the in-memory and SQLite outboxes, driving the handlers in `src/distributed/handler` through a real dispatcher and `ArvoOutboxDriver`. **Everything runs inside Docker**: your machine only builds the image, starts and stops containers, and writes the report. Docker must be running; nothing else is needed.

```bash
pnpm run load:inmemory                 # every in-memory check
pnpm run load:sqlite                   # every SQLite check
pnpm run load:sqlite --soak            # adds about an hour of steady traffic
LOAD_SOAK_MINUTES=10 pnpm run load:inmemory --soak
pnpm run load:sqlite --only tests/load/sqlite/full-disk.load.ts   # one file, in the container it belongs to
```

A quick run takes about a minute for the in-memory outbox and two to three for SQLite, after an image build of a minute or two the first time and seconds after; most of it is the size limits. The soak adds what `LOAD_SOAK_MINUTES` says, sixty by default.

**What it checks.** Speed through the handlers at 1, 4, 16 and 64 workers, and straight at the driver over batch, payload and state sizes; filling up and recovering; cleaning up at volume, and while the clock jumps; races, leases and several processes on one SQLite file; forced failures — broken outboxes at volume, a killed process, a full disk, read-only, deleted, corrupted and newer files; size limits of a million events and a hundred thousand executions; and, with `--soak`, memory and file size over time. Every committing check ends by proving nothing committed was lost, no revision landed twice, payloads came back as committed and listings came oldest first. The suite's own first checks prove its container is what it should be.

**Where it runs.** Each container is capped in CPU, memory, swap and processes, runs as `node` with every capability dropped, has no network, sees no host folder but its own results folder, and is removed when it stops, even when you press Ctrl-C. SQLite files, child processes, the faked clock (`libfaketime`) and the 20 MB full disk all live inside their containers.

**Reading a report.** Each run writes `load-results/<run>/report.md` and `report.json`, ignored by git, and prints the report. It lists every check passed, failed or skipped — a check that cannot run where it is says why, and never counts as passed — then every measurement beside the same one from the last run on a matching machine, marking a change of more than a fifth as worth a look. Numbers are Docker-on-this-machine numbers: compare them with each other, not with a server.

**Disk.** The image is labelled `arvo.load`, and each run removes the image it replaced and no other. Docker's own disk is shared with whatever else you build; if a run fails with `ENOSPC`, Docker's disk is full.

## Conventions

The tour is what a reader copies from, so it is written the way a consumer of the package should write it.

**Build things with the factories, never with `new`.** `createArvoEvent`, `createArvoContract` and `createArvoEventFactory` -- and their `tryCreate*` twins where a failure is worth handling as a value. The classes are exported because their types are part of the surface, not as an invitation to construct one directly.

| instead of | use |
|---|---|
| `new ArvoEvent({ ... })` | `createArvoEvent({ ... })` |
| `new ArvoContract({ ... })` | `createArvoContract({ ... })` |
| `new ArvoEventFactory(version)` | `createArvoEventFactory(version)` |

Three things still take `new`, because no factory exists for them and none is implied: `ArvoEventSerializer`, `ArvoContractSerializer` and `CloudEventConverter` are long-lived objects you configure once and reuse, and `CloudEvent` is a foreign type this package reads rather than one it produces.

There is no factory for a single contract version either. You read one off the contract -- `contract.versions["1.0.0"]` -- rather than building one.

**Pass `executionid` along explicitly when one event follows another.** It defaults to the event's own `subject`, which is right for the event that starts an execution and wrong for every event after it. [`10-building-events-from-a-contract.ts`](src/tour/10-building-events-from-a-contract.ts) shows both, and what the default does once a handler gives its output a subject of its own.

**The sandbox is formatted by `arvo-core`'s Biome config**, so `cd ../arvo-core && npx biome check ../sandbox/src` should be clean. There is no lint script here, and `pnpm lint` in `ts/arvo-core` does not reach this directory -- run it against the path when you have finished editing.

## The tour

`src/playground.ts` is a runner and nothing else. The material lives in `src/tour/`, one chapter per file, in the order they are worth reading:

| | |
|---|---|
| [`01-events.ts`](src/tour/01-events.ts) | building an event, what is defaulted, why `data` is frozen, what a rejected one tells you |
| [`02-throwing-vs-result.ts`](src/tour/02-throwing-vs-result.ts) | the `try`-prefixed twin every fallible operation has |
| [`03-serializing-events.ts`](src/tour/03-serializing-events.ts) | a round trip, and `cloudevent` mode versus `arvoevent` mode |
| [`04-cloudevents.ts`](src/tour/04-cloudevents.ts) | the CloudEvent boundary directly, and adapting a foreign one |
| [`05-semantic-versions.ts`](src/tour/05-semantic-versions.ts) | `ArvoSemanticVersion` as a type, a guard, and a `Result` |
| [`06-declaring-contracts.ts`](src/tour/06-declaring-contracts.ts) | what a contract holds, types per version, and broken declarations |
| [`07-contracts-as-json.ts`](src/tour/07-contracts-as-json.ts) | the canonical form, and what a crossing to JSON Schema costs |
| [`08-reading-a-foreign-form.ts`](src/tour/08-reading-a-foreign-form.ts) | JSON from elsewhere becoming a contract, and every way that fails |
| [`09-asserting-events.ts`](src/tour/09-asserting-events.ts) | judging an event against a contract, and narrowing to a typed payload |
| [`10-building-events-from-a-contract.ts`](src/tour/10-building-events-from-a-contract.ts) | the event factory: input, outputs, handler error |
| [`11-domains.ts`](src/tour/11-domains.ts) | where a domain comes from, including the `ArvoDomain` symbols |
| [`12-standalone-events-and-clones.ts`](src/tour/12-standalone-events-and-clones.ts) | an event no contract declares, and copying one |

Every chapter is standalone — it declares whatever contracts and events it needs, so you can read one on its own, or copy it into a file of your own and change it until it breaks. To add one, write it in `src/tour/` and list it in [`src/tour/index.ts`](src/tour/index.ts).

Spans go to the console via `ConsoleSpanExporter` ([`src/otel.ts`](src/otel.ts)), batched so they arrive at the end of the run rather than interrupting the chapter that made them.

If you change `ts/arvo-core/src/`, re-run `pnpm run build` there before the change shows up here — this sandbox imports the built `dist/` output, the same way a real consumer would, not `src/` directly.
