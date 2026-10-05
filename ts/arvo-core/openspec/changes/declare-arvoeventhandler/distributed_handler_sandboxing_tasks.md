# Running the handler under mechanisms nobody here wrote

Everything proven so far was proven against a mechanism written to be proven against. The lattice, the brokers, the threaded harness — each is a mechanism in [ADR-006](../../../../../docs/adr/006-arvoeventhandler-protocol.md)'s sense, and each was written by the same hand as the thing it tests. That is the limit of what any of them can say.

**Temporal and DBOS are mechanisms.** Not analogies for one — mechanisms in exactly the sense ADR-006 means: they run the handler, they carry what it produces, and ADR-006 places five obligations on one. So this is a conformance exercise rather than a compatibility exercise, run against two implementations nobody here wrote, and the rubric is **Required of infrastructure adapters**, obligation by obligation.

What makes it worth doing is that those obligations were written with neither framework in mind. Where a durable-execution framework satisfies one naturally, the obligation is the right one. Where satisfying it takes contortion, the obligation is wrong or under-specified — and that is a finding about the ADR rather than about the framework.

## Nothing here is a demonstration

This is the standard the whole exercise is held to, and it is the reason the exercise is worth anything at all.

**Real servers.** A Temporal cluster and Postgres instances, in containers, brought up by a compose file that is checked in, with pinned images, health checks and volumes. No in-memory test server standing in for a cluster, no SQLite standing in for Postgres, and no time-skipping unless time is the thing under test.

**Real dependencies.** The frameworks' own published SDKs at pinned versions, installed into the sandbox, used the way their own documentation says to use them.

**Written as production code.** Not a script that proves a point. Worker processes with lifecycle and graceful shutdown, configuration read from the environment and validated at boot, declared retry policies rather than inherited defaults, versioned workflow code, migrations, connection pooling, structured logs, metrics, health and readiness, back-pressure, poison-message handling. Where a framework has an opinion about how production code is written in it, that opinion is followed. **If following it is awkward against Arvo, that awkwardness is the finding** — and it only counts as a finding if the production path was the one taken.

**Real observability.** All three signals — traces, metrics and logs — through a real collector into real backends, viewable in Grafana and *asserted* by querying those backends. ADR-006 puts the OpenTelemetry API inside the model and requires a handler to be observable without an executor writing any instrumentation, so whether that still holds under a framework with telemetry of its own is a conformance question rather than a nicety.

A shortcut anywhere makes the result worthless, because the question being asked is whether this composes *in earnest*.

## What is settled before any of it is written

**The record is the memory.** It is what makes a handler work under any mechanism at all: another language, another runner, or a person reading a store years later can pick an execution up from it. A framework's history is that framework's private bookkeeping for replaying its own code, and nothing else can read it. So the record is not duplication to be optimised away — it is the thing being tested, and every mechanism here is judged on whether it carries it faithfully.

**A replay is only another mechanism.** A framework replaying its history is re-delivering events that were already delivered. Nothing about that is special, which is exactly why it is worth running: a handler that comes out somewhere else on a replay is a handler whose record was not its memory after all. Replay is therefore a mechanism under test (§12), not a feature of one.

**Every mechanism here commits under the outbox.** The record and the events it accompanies are preserved as one unit or neither; no event is published before that commit succeeds; and anything re-sent is **what was committed**, byte for byte, rather than produced again. That is obligation 1, it applies to Temporal, to DBOS and to the tape recorder in §12 alike, and it is asserted of each rather than assumed.

## The two shapes

An Arvo handler is already two things. Across one delivery it is a pure function — an event, a way to reach a store, an attempt number, and what it produces. Across many it is an orchestrator: it issues events, stops, and continues when answers arrive. Arvo and a durable-execution framework are two answers to the same problem: Arvo cuts an orchestrator into separate pure deliveries held together by a record, a framework keeps it as one function held together by a replayed history.

**Shape A — the record is the memory.** One `execute` per activity or step. The framework supplies transport, durability, retry and the clock; the record is authoritative and `in_flight_event_map` is what an execution is waiting for. Conformant today, and what §7 through §11 test.

**Shape B — the history is the memory.** The executor is workflow code awaiting each service call inline, with the framework remembering where it got to.

**Shape B is written as a cost, not as a candidate, and nothing is conceded to it.** It trades the one property that makes the model portable for pleasanter-looking code, and buys a hard dependency on one vendor's replay. It also requires a deterministic executor, which ADR-000 deliberately does not. The protocol cannot express it in any case — `ctx.build` returns an event rather than sending one, and a mechanism hook may not alter what is returned — and that is correct rather than a gap. §15 builds it only so the loss is demonstrated in code rather than argued about.

## Layout

```
src/distributed/
  handler/<input_type>/      the handlers, knowing nothing of any framework
    contract.ts              the ArvoContract
    index.ts                 the ArvoEventHandler
  temporal/                  activities, workflows, the store, the worker, the client
  dbos/                      steps, workflows, the store, the worker
  scenario/                  what one run begins with, and what is asserted of it
  replay/                    the mechanism that is only a tape recorder
  shared/                    config, telemetry, the store, the invariants every run is held to
infra/
  docker-compose.yml         every service, pinned and health-checked
  temporal/                  dynamic config, search attributes
  postgres/                  migrations for the record store and the outbox
  otel/                      the collector's pipelines
  grafana/                   provisioned datasources and dashboards
  tempo/ prometheus/ loki/   each backend's own configuration
```

One directory per handler, named for what it takes in. Every framework directory imports the same handlers and adds nothing to them. **If either framework needs a handler changed, that is a finding**, and it is recorded in §17 rather than worked around.

## 1. Infrastructure, real and checked in

- [ ] 1.1 `infra/docker-compose.yml` bringing up a real Temporal cluster: the server with explicit setup, its own Postgres, and the Temporal UI. Images pinned to exact tags, never `latest`.
- [ ] 1.2 A second Postgres for DBOS and the record store, separate from Temporal's, because sharing one would hide whichever of them caused a problem.
- [ ] 1.3 Health checks on every service, and dependency ordering that waits for health rather than for a port to open.
- [ ] 1.4 Named volumes, so a run survives a restart and §12's replay has something to replay from.
- [ ] 1.5 One network, with ports published only where a host process needs them.
- [ ] 1.6 `infra/temporal/` holding dynamic config — the search attributes the workflows need registered, and any namespace defaults a run depends on.
- [ ] 1.7 `infra/postgres/` holding the schema as migrations rather than a dump: the execution-record store, the outbox table, and their indexes.
- [ ] 1.8 The namespace registered and the search attributes created as part of bringing the stack up, not by hand.
- [ ] 1.9 One documented command to bring it up, one to tear it down, one to reset it to nothing. A run that needs a human to remember a step is a run that is not reproducible.

## 2. The observability stack, also real

- [ ] 2.1 An **OpenTelemetry Collector** (`otel/opentelemetry-collector-contrib`) as the one place every signal is sent. Workers know nothing but an OTLP endpoint, which is what lets a backend change without a line of application code changing.
- [ ] 2.2 **Tempo** for traces, **Prometheus** for metrics, **Loki** for logs. Each pinned, each with a volume.
- [ ] 2.3 **Grafana**, with datasources and dashboards **provisioned from files** rather than clicked together, so it comes up already showing the run. The dashboard carries what ADR-006 names: deliveries by outcome, faults by kind, executor duration, collection size.
- [ ] 2.4 Collector pipelines wired explicitly in `infra/otel/`: OTLP in; traces to Tempo; metrics to Prometheus; logs to Loki. Its own health and its own metrics exposed, because a telemetry pipeline that fails silently is worse than no pipeline.
- [ ] 2.5 Temporal's own Prometheus endpoint scraped as well, so the framework's view and Arvo's view of one run sit side by side and can be compared.
- [ ] 2.6 Trace-to-log and trace-to-metric correlation configured in Grafana, so one execution can be followed from a span into the lines it wrote.

## 3. Dependencies, real and pinned

- [ ] 3.1 `@temporalio/client`, `@temporalio/worker`, `@temporalio/workflow`, `@temporalio/activity` — the real SDK, exact versions.
- [ ] 3.2 `@temporalio/interceptors-opentelemetry`, which is how Temporal carries trace context into workflows and activities. Without it the two traces never meet, and §4.3 is what proves they do.
- [ ] 3.3 `@temporalio/testing` as well, but only for §12.5, where Temporal's own replay checker is the thing under test. It stands in for nothing.
- [ ] 3.4 `@dbos-inc/dbos-sdk` at an exact version, and whatever it needs to run against Postgres.
- [ ] 3.5 The OpenTelemetry SDK for Node, the three OTLP exporters — traces, metrics, logs — the logs API, and the resource and semantic-convention packages.
- [ ] 3.6 Instrumentation for Postgres, so the store's own queries appear beneath the span that caused them.
- [ ] 3.7 A Postgres driver and a migration tool, chosen once and used by the DBOS side and the store alike.
- [ ] 3.8 All of it in `ts/sandbox`, which is private and never published, so `arvo-core`'s own dependency list is untouched. A check asserts that.

## 4. Observability, end to end

ADR-006 places the OpenTelemetry API inside the model: a handler must be observable without an executor writing any instrumentation, every execution produces a span continuing the event's trace, and a fault is recorded on that span before it is raised. Under a framework with telemetry of its own, the question is whether those two views become one trace or two — and a workflow whose spans and Arvo's spans do not join is a workflow nobody can debug at three in the morning.

- [ ] 4.1 One place that builds the SDK: resource attributes naming the service and its version, OTLP exporters for all three signals, and a shutdown that **flushes** rather than dropping what was buffered. Built once per worker process and handed down.
- [ ] 4.2 A real `tracer`, `meter` and `logger` handed to `setupArvoEventHandler` — the last through an adapter from the package's own logger shape onto the OpenTelemetry logs API. No no-ops anywhere: a missing signal means nothing produced it.
- [ ] 4.3 **The traces join.** Temporal's interceptors carry context into the workflow and the activity; Arvo continues the event's own `traceparent`. One trace must hold the workflow span, the activity span and Arvo's execution span nested inside it — **across a suspension and across workflows**, which is where a trace usually breaks. Asserted by fetching the trace from Tempo and walking its parentage, not by looking at a screenshot.
- [ ] 4.4 **The stages are visible.** ADR-006 asks that entry validation, hydration, classification, collection, executor entry, return validation and emission each be distinguishable, so a delivery refused at the gate and one refused on what it returned can be told apart from telemetry alone. Assert both produce traces differing in exactly that way.
- [ ] 4.5 **Every fault is on its span before it is raised**, with its kind and whether a retry is in prospect as attributes — the only place a retried-away failure is ever visible, since a fault writes no record. Assert a run that retried and then succeeded still shows its failures in Tempo.
- [ ] 4.6 **The metrics mean something.** Query Prometheus for the four ADR-006 names and assert each moved as the scenario says: deliveries by outcome against what the run did, faults by kind against the faults raised, collection size against the fan-out width.
- [ ] 4.7 **Logs are correlated.** Assert a line an executor wrote carries the trace and span id of the execution that wrote it, by querying Loki and matching it against the trace in Tempo.
- [ ] 4.8 **An execution is findable by what identifies it.** The span carries `subject`, the execution's identity, the contract type and version, the entry kind and the attempt. Assert one execution of a five-hundred-wide run can be found from its subject alone, which is the only thing an operator would have.
- [ ] 4.9 **Telemetry failing does not fail the work.** Stop the collector mid-run and assert executions still complete and records still commit — nothing lost but the recording, which is what the package promises and what a real deployment will eventually test for us.
- [ ] 4.10 The dashboard shows one run end to end, and the README says which panel answers which question.

## 5. The handlers, knowing nothing of any mechanism

- [ ] 5.1 `handler/com_order_fulfil/` — the orchestrator. Fans out wide, delegates a recursive walk, asks for a review it cannot do itself, and answers its caller once everything is in. Two versions, so a rolling upgrade is reachable.
- [ ] 5.2 `handler/com_inventory_check/` — the fan-out leaf. Answers at once, and there are hundreds of executions of it per run.
- [ ] 5.3 `handler/com_category_walk/` — declares itself as its own service, descends a tree, and unwinds. Depth, recursion and `max_depth` in one handler.
- [ ] 5.4 `handler/com_payment_charge/` — fails for the first few attempts and then succeeds, keyed on `attempt` so every mechanism agrees on what it does.
- [ ] 5.5 `handler/com_fraud_check/` — raises a fault no attempt can fix. Must stop a mechanism retrying, and must be abandoned with the pair.
- [ ] 5.6 `handler/com_manual_review/` — a contract carrying a `domain`, so its events leave the lattice and only something outside can answer them.
- [ ] 5.7 `handler/com_audit_write/` — no outputs and no services: the one shape that completes by returning nothing. Proves a sink works where a framework expects a return value.
- [ ] 5.8 Every handler takes its dependencies through the factory — a real Postgres-backed catalogue and stock lookup, not a literal — so §10.2 has something genuine to resolve.
- [ ] 5.9 A check asserts no file under `handler/` imports either framework. The handlers are the constant; the mechanisms are what vary.

## 6. The scenario

One run that does everything at once, because nothing here is interesting in isolation.

- [ ] 6.1 A root order fans out to **five hundred** inventory checks under `collect: 'all'`, so the executor is entered once with a complete collection and the record carries the whole of it.
- [ ] 6.2 One branch walks a category tree **deep**, each level a child execution of the same contract, with `max_depth` set so the boundary is respected in one variant and crossed on purpose in another.
- [ ] 6.3 One branch asks for a manual review, which **leaves the lattice** and is answered from outside — a signal in Temporal, an awaited event in DBOS. Until it is, the execution rests at `waiting`, which is what waiting means.
- [ ] 6.4 A payment that **fails and then does not**, so the attempt number has to cross the mechanism boundary intact.
- [ ] 6.5 A fraud check that **never succeeds**, so a mechanism has to stop and abandon.
- [ ] 6.6 An audit write that answers nobody, emitted in the same batch as the completion — the only way a sink can be asked for anything without its caller waiting forever.
- [ ] 6.7 Several whole runs at once, so nothing depends on being the only thing happening.

## 7. Obligation 1 — the outbox

> The emitted events and the next execution record MUST be preserved together, and the events MUST reach their destinations once the record is committed.

- [ ] 7.1 Implement it for real in each: the record and the outbox rows in one Postgres transaction, published from the outbox afterwards. Not events held in memory and hoped for.
- [ ] 7.2 Assert nothing is published before the commit succeeds — a commit made to fail leaves no event anywhere.
- [ ] 7.3 Assert recovery sends **what was committed**, byte for byte, rather than re-running the delivery to produce it again. Kill the worker between commit and publish and compare the bytes that arrive against the bytes in the outbox.
- [ ] 7.4 Assert the re-sent copy is **discarded** at the receiver rather than processed twice, which is what makes an abandonment event's `id` matter.
- [ ] 7.5 Assert the negative continuously: at no point in any run does a record exist without the events committed with it, or an event get published without that commit having succeeded. Checked against the database, not against a transcript.

## 8. Obligation 2 — the state function, answered live

> The mechanism MUST supply the state function, and MUST answer it live.

- [ ] 8.1 Supply it in each mechanism as a real query against Postgres, without classifying, deriving or filtering: one identifier in, what is under it out, parsed and nothing more.
- [ ] 8.2 Assert it is asked **on every delivery**, including every retry, and never answered from something read earlier. Change a record behind the mechanism's back and watch the next attempt see the change.
- [ ] 8.3 Assert it is never given the event or the classification — by construction, since the signature cannot carry them.
- [ ] 8.4 Assert it validates nothing: a row that is not a record reaches the handler and is refused *there*, not rejected by the mechanism on the handler's behalf.
- [ ] 8.5 Take the database away mid-run and assert `state_resolution_failed` reaches the mechanism as retry-safe and is retried under the declared policy.

## 9. Obligation 3 — abandonment, exactly as handed

> A mechanism that abandons an execution MUST do so with the fault's `abandonment_state` and `abandonment_event`, together, and with nothing of its own.

- [ ] 9.1 Assert a fault whose `retry` is null is **never redelivered** — which means mapping it onto a non-retryable failure rather than letting a retry policy run its course. In Temporal an application failure marked non-retryable; in DBOS the equivalent.
- [ ] 9.2 Assert that where a mechanism abandons, it commits the record and publishes the event **together**, under the outbox, and composes neither.
- [ ] 9.3 Assert the three shapes separately: a fault carrying both halves, one carrying only the event, and one carrying neither. A mechanism acts on every contingency a fault carries and on nothing it does not.
- [ ] 9.4 Assert an opening event for an execution that already exists is **not** read as a failure. ADR-008 names this as the case a mechanism is most likely to get wrong, and both of ours get a chance to.
- [ ] 9.5 A fault nothing will retry lands somewhere a person could find it — §13.12's poison path — rather than vanishing into a log.

## 10. Obligation 4 — every retry a fresh delivery

> The mechanism re-invokes the handler with the same event and the incremented attempt number.

- [ ] 10.1 Map the attempt number across the boundary and assert it: Temporal counts from one and Arvo from zero, and a mechanism that forgets has a retry budget off by one.
- [ ] 10.2 Assert dependencies are **re-resolved** through the factory on every attempt, never carried forward — against a real pooled connection, so a leak shows up as exhaustion.
- [ ] 10.3 Assert the record is re-read on every attempt, with nothing cached behind the state function.
- [ ] 10.4 Assert only the attempt number carries forward, by changing the record between attempts and watching the retry see the change.
- [ ] 10.5 Assert the delay a fault asks for is honoured by the declared policy, or that ignoring it is a visible choice rather than an accident.

## 11. Obligation 5 — writes serialized

> Writes to one execution record MUST be serialized. A mechanism MUST commit at `cas_version` `0` only where no record exists.

- [ ] 11.1 State how each gets it, and where that makes `cas_version` redundant: one workflow per execution *is* a lock, so the counter becomes a consistency check rather than the mechanism. Whether a redundant guarantee is a cost or a defence is one of the questions this answers.
- [ ] 11.2 Assert create-if-absent against the real schema — a unique constraint, not a read-then-write — with two opening events for one execution and exactly one record created.
- [ ] 11.3 Assert a record whose revision is not exactly one greater is refused by the database rather than by the application.
- [ ] 11.4 Deliver two answers to one execution at the same moment: one commits, the loser publishes nothing, re-reads, and converges.
- [ ] 11.5 Assert that where both racing deliveries entered their executor, **both ran** — which compare-and-swap does not prevent and the protocol says it does not. Whatever an executor did outside Arvo was done twice, and the sandbox says so out loud rather than hiding it.

## 12. Replay, which is only another mechanism

A handler that comes out somewhere else on a replay is a handler whose record was not its memory. The mechanism that tests this is the simplest in the exercise and needs no framework: a tape recorder, committing under the outbox like any other.

- [ ] 12.1 Record a finished run as a transcript, read from the database rather than from memory: every event delivered, the record as it was read, and what was committed.
- [ ] 12.2 Replay it through a **fresh** handler, in order, into an empty database, with nothing of the first run alive. Every record committed and every event published must equal the first run's. This is the strongest form of *resumable from the record alone* the protocol has.
- [ ] 12.3 Replay it **shuffled and repeated**. Terminal states must match, repeats must be discarded rather than faulted, and the outbox must hold throughout.
- [ ] 12.4 Replay a run that was **abandoned** part way, and assert the pair is committed together on the replay exactly as on the first run, with nothing of the mechanism's own added.
- [ ] 12.5 Replay **Temporal's own history** through its replay checker, against a history captured from the real cluster. Handler results come from history rather than being re-executed, so what is judged is our adapter's workflow code: a replay that fails means the adapter is non-conformant as Temporal defines it. This is also §13.5's determinism check.
- [ ] 12.6 Replay through the *other* framework's store, so a run taken under Temporal is resumed under DBOS against its own Postgres. If the record is the memory, the mechanism it was written by cannot matter — and this is the one test that proves it.

## 13. Written as production code

What the standard means concretely, so it can be checked rather than claimed.

- [ ] 13.1 **Configuration** read from the environment, validated at boot by a schema, and a process that refuses to start rather than running half-configured.
- [ ] 13.2 **Worker lifecycle**: a real worker process per framework, with graceful shutdown on signal — stop accepting work, finish what is in flight, flush telemetry, close pools, exit non-zero only on genuine failure.
- [ ] 13.3 **Task queues** designed rather than defaulted: separate queues for the orchestrator and the leaves, so a five-hundred-wide fan-out cannot starve the thing waiting for it.
- [ ] 13.4 **Retry policies declared**, never inherited — and declared to agree with what the fault says, which is the whole of §9.
- [ ] 13.5 **Workflow versioning**: patched or versioned workflow code, with the determinism check of §12.5 run against a recorded history, so a change that would break running executions fails before it ships.
- [ ] 13.6 **Migrations** rather than schema created on the fly, run as a step of bringing the stack up.
- [ ] 13.7 **Connection pooling** with bounded size, and a store that surfaces exhaustion as a failure the handler can see rather than as a hang.
- [ ] 13.8 **Structured logs** carrying the execution's identity on every line, so one execution can be followed across both frameworks.
- [ ] 13.9 **Metrics**: the four ADR-006 names, plus whatever each framework publishes of its own.
- [ ] 13.10 **Health and readiness**, distinguishing a worker that is alive from one that can take work.
- [ ] 13.11 **Back-pressure**: bounded concurrency per worker, and a run that slows rather than falls over.
- [ ] 13.12 **Poison handling**: somewhere for a delivery that will never succeed to go, which is where §9's abandonment pair lands.
- [ ] 13.13 **No `any`, no silent catch, no sleep-based synchronisation.** Lint and typecheck clean under the same rules the package holds itself to.

## 14. Chaos, against the real stack

- [ ] 14.1 Worker containers killed mid-activity, repeatedly, mid-run — `docker kill`, not a thrown error.
- [ ] 14.2 The database stopped for a window and restarted, with connections dropped underneath the pool.
- [ ] 14.3 The Temporal cluster restarted mid-run.
- [ ] 14.4 The network partitioned between worker and server, then healed.
- [ ] 14.5 Signals and events delivered twice, and out of order.
- [ ] 14.6 A run interrupted and resumed by a **different** worker process, nothing of the first still alive.
- [ ] 14.7 The same invariants the in-process suites assert, asserted here against the database: one terminal state per execution, every request answered exactly once, revisions advancing one at a time from zero, every execution on one version for its whole life.
- [ ] 14.8 The outbox holding under every one of these, as §7.5 requires.
- [ ] 14.9 Every one of these visible in Grafana afterwards, because a failure nobody can see in telemetry is a failure a deployment will meet blind.

## 15. Where it breaks, and what Shape B costs

Not failure conditions — measurements. Two things grow with a fan-out: Arvo's record, rehydrated whole on every delivery, and the framework's own history. A wide execution pays both.

- [ ] 15.1 Find the fan-out at which each mechanism stops being able to carry one execution, and say which cost bound it — record size, history size, payload limit, or transaction time.
- [ ] 15.2 Find the depth at which a chain of child executions stops working, and why.
- [ ] 15.3 Report both as numbers with reasons, measured against the real stack, not as a verdict.
- [ ] 15.4 Write the same orchestrator as workflow code awaiting each service call inline, outside the protocol, to the same production standard, so the comparison is fair.
- [ ] 15.5 Then try to do with it what §12.6 does with the record: hand the execution to the other mechanism. Name what is no longer possible.
- [ ] 15.6 Name what else it costs: an executor that must be deterministic, and an execution no other language can resume.
- [ ] 15.7 Name what survives either way — contracts, the closed emittable set, identity, the fault vocabulary — because that is the part of Arvo doing work no framework does.

## 16. Running it

- [ ] 16.1 `distributed:up` brings the stack up and waits for health; `:down` tears it down; `:reset` returns it to nothing.
- [ ] 16.2 `distributed:temporal` and `:dbos` run each conformance suite against the running stack.
- [ ] 16.3 `distributed` runs everything in order and reports per obligation.
- [ ] 16.4 The tour stays runnable with nothing but Node. None of this is on its path.
- [ ] 16.5 A run says plainly what it needs and what is missing, and **fails rather than silently skipping** — a skipped conformance test proves nothing.
- [ ] 16.6 One README under `src/distributed/` holding the prerequisites, the commands, where Grafana is, and the findings.

## 17. What this found

To be written as it is found, as a judgement in these terms:

- which obligations each framework satisfied **naturally**, which took work, and which it could not satisfy at all;
- whether either framework needed a handler changed, which §5.9 is there to catch;
- whether one trace really holds both views of one execution, or whether that took work the ADR does not anticipate;
- what production code in each framework had to do that the protocol did not foresee;
- what the record earns on top of a mechanism that already remembers — and, honestly, where it is plainly duplication;
- the numbers from §15;
- what the protocol should perhaps change, stated as something an ADR could be written from.
