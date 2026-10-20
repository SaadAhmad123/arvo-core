# Running the same handlers under three mechanisms

ADR-006 says a handler is written once and any mechanism can run it. This
is the attempt to find out whether that is true, by running one set of
handlers under two frameworks nobody here wrote and one loop with no
framework at all, and asserting ADR-006's five obligations of each.

It is a conformance exercise, not a compatibility exercise. The rubric is
**Required of infrastructure adapters**, obligation by obligation.

## What is here

| | |
|---|---|
| `handler/` | Seven handlers. Nothing under here may import a framework, a store, or a pool — a check enforces it, and it is what keeps the handlers the constant. |
| `temporal/` | Temporal. Keeps its records *in Temporal*: a record is a workflow, a revision is one update to it, and nothing of the mechanism is in a database. |
| `dbos/` | DBOS. Keeps its records in Postgres, where a revision is a row and its outbox rows, committed in one transaction. |
| `replay/` | No framework at all — one queue and a table. The control the other two are read against, and the tape recorder §12 replays with. |
| `shared/` | Configuration, telemetry, health, the record store, and the two rules required of whoever sends an event in. Also the layers every mechanism supplies with a delivery, and the switch that injects a failure through one. |
| `handler/middleware/` | The layers every handler declares (ADR-016): one shared, resolving the tenant every executor requires, and one made per execution, timing it. |

## Prerequisites

Docker, Node 22, pnpm 11. Then:

```sh
pnpm distributed:up        # the stack: Temporal, two Postgres, collector, Tempo, Prometheus, Loki, Grafana
pnpm distributed:migrate   # the record schema, and DBOS's own database
```

Both are required. Nothing here skips when infrastructure is missing — a
skipped conformance test proves nothing, so a suite run without the stack
fails and says what it could not reach.

## Commands

```sh
pnpm distributed              # every suite, all three mechanisms
pnpm distributed:temporal     # Temporal, obligation by obligation
pnpm distributed:dbos         # DBOS, the same obligations
pnpm distributed:replay       # replay, and the run that changes mechanism half way
pnpm distributed:purity       # the handlers import no framework

# layers with failures injected, under each mechanism
pnpm vitest run tests/distributed/replay/middleware.spec.ts
pnpm vitest run tests/distributed/dbos/middleware.spec.ts
pnpm vitest run tests/distributed/temporal/middleware.spec.ts
pnpm distributed:probe        # traces, metrics and logs reach the backends
```

To watch one run rather than assert anything:

```sh
pnpm distributed:temporal:worker   # in one terminal
pnpm distributed:temporal:run      # in another
pnpm distributed:dbos:run          # DBOS needs no second terminal
```

Grafana is at `http://localhost:3000`, the Temporal UI at
`http://localhost:8080`. A run prints its trace id; paste it into Tempo.

**If a Temporal suite hangs**, run `pnpm distributed:temporal:clear`.
Record workflows from an earlier build stay open, and a worker that
cannot replay them against current workflow code retries for ever and
starves the new run.

## What this found

### The claim holds

One set of handlers, unchanged, runs under all three. §12.6 is the
strongest form of it: a run taken under Temporal to where it waits on a
person, its records moved into Postgres, and **DBOS finishes it** — the
orchestrator comes to rest on a record Temporal wrote. Nothing moved but
the records.

No handler needed changing for either framework. The purity check would
have caught it.

### The same defect appeared in both mechanisms, independently

Two deliveries answering one execution race, and all but one lose the
compare-and-swap. Losing takes two forms that look identical and are not:
where a revision names this delivery's triggering event it **already
succeeded**, and where none does it was **never carried out**. Reporting
"nothing" for both drops the second kind, and the run then waits for ever
holding answers that never arrived.

Written twice, got it wrong twice, in two unrelated adapters. This is the
subtlest thing an adapter must get right, and nothing in the protocol
makes it hard to get wrong.

### Compare-and-swap does not stop the work happening twice

Both racing executors ran. One record was committed; whatever the other
did outside Arvo was done anyway. The protocol says so, and both suites
now say it out loud rather than hiding it. What makes it safe is the
executor passing an idempotency key (ADR-014) — demonstrated against real
Postgres, where the stock moves once under two racing deliveries and
moves again under a different key.

### The record graph is walkable with no index

Nothing maps a workflow to the executions under it. It does not need to:
an execution's identity is derived from the event that opened it, so
every child is reachable from the events its parent committed. That is
what makes moving a run between mechanisms possible at all, and it is a
property of the derivation rather than of either store.

### Where the two frameworks genuinely differ

**Temporal's loop cannot see the handlers.** Workflow code is bundled for
an isolate with no Node built-ins, so the loop must be told as data
whether an address is implemented. DBOS runs a workflow as an ordinary
function, so the same question is a map lookup — at the cost of a rule
instead of a check: everything outside a step must be deterministic and
nothing enforces it.

**Temporal needs two task queues; DBOS needs none.** Under Temporal a
delivery is dispatched through a queue and a wide fan-out can starve the
execution waiting on it. Under DBOS deliveries are steps inside the run.

**Writes are serialized differently.** One workflow per execution *is* a
lock, so under Temporal the revision counter is a consistency check
rather than the thing doing the work. Under DBOS every delivery is a
writer against one table, so both halves are constraints in the schema.
Redundant for ordering is not redundant for saying which write this was.

**Terminal records are read-only by construction under Temporal**, and
retention expires only closed workflows — so a workflow-code change can
make old records unreadable, which a table cannot.

### Observability was silently broken, in a way nothing could catch

Only a tracer resolves itself. `metrics.getMeter` and `logs.getLogger`
answer from whatever provider is registered *when they are called*, and a
worker registers its SDK inside a function while modules are evaluated at
import. Every handler metric and every handler log line went into a
no-op, for the life of every process, with nothing failing.

The pipeline probe could not have caught it: it proves the collector
works using telemetry it builds directly, not the telemetry a handler
reaches. The gap sat between two things that each looked covered.

### What the protocol should perhaps say

- **No ordering guarantee** — written up as
  [ADR-015](../../../../docs/adr/015-no-ordering-guarantee.md), which
  closes a deferral three ADRs name.
- **The outbox has no emission order**, and nothing promised one. Worth
  knowing before someone adds an ordinal to recover it.
- **Losing a compare-and-swap has two meanings.** The protocol leaves an
  adapter to work that out, and two adapters here did not. A sentence in
  ADR-007 naming the two cases would have saved both.

## What is not done

- **§14 chaos** — the worker is packaged as a container
  (`pnpm distributed:worker:build`) so it can be killed rather than
  asked to stop, which is the part that needed doing. The specs that
  kill it are not written.
- **§15 limits** — the fan-out and depth at which each mechanism stops
  carrying one execution, and what the protocol costs against workflow
  code written inline. Measurement work, none of it started.
- **§6.1 and §6.7** — five hundred wide, and several whole runs at once.
  Everything here runs narrow.
