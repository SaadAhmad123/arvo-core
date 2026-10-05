# Running the handler under mechanisms nobody here wrote

Everything proven so far was proven against a mechanism written to be proven against. The lattice, the brokers, the threaded harness — each is a mechanism in [ADR-006](../../../../../docs/adr/006-arvoeventhandler-protocol.md)'s sense, and each was written by the same hand as the thing it tests. That is the limit of what any of them can say.

**Temporal and DBOS are mechanisms.** Not analogies for one — mechanisms in exactly the sense ADR-006 means: they run the handler, they carry what it produces, and ADR-006 places five obligations on one. So this is a conformance exercise rather than a compatibility exercise, run against two implementations nobody here wrote, and the rubric is **Required of infrastructure adapters**, obligation by obligation.

What makes it worth doing is that those obligations were written with neither framework in mind. Where a durable-execution framework satisfies one naturally, the obligation is the right one. Where satisfying it takes contortion, the obligation is wrong or under-specified — and that is a finding about the ADR rather than about the framework.

## What is settled before any of it is written

**The record is the memory.** It is what makes a handler work under any mechanism at all: another language, another runner, or a person reading a store years later can pick an execution up from it. A framework's history is that framework's private bookkeeping for replaying its own code, and nothing else can read it. So the record is not duplication to be optimised away — it is the thing being tested, and every mechanism here is judged on whether it carries it faithfully.

**A replay is only another mechanism.** A framework replaying its history is re-delivering events that were already delivered. Nothing about that is special, which is exactly why it is worth running: a handler that comes out somewhere else on a replay is a handler whose record was not its memory after all. Replay is therefore a mechanism under test (§9), not a feature of one.

**Every mechanism here commits under the outbox.** The record and the events it accompanies are preserved as one unit or neither; no event is published before that commit succeeds; and anything re-sent is **what was committed**, byte for byte, rather than produced again. That is obligation 1, it applies to Temporal, to DBOS and to the tape recorder in §9 alike, and it is asserted of each rather than assumed.

## The two shapes

An Arvo handler is already two things. Across one delivery it is a pure function — an event, a way to reach a store, an attempt number, and what it produces. Across many it is an orchestrator: it issues events, stops, and continues when answers arrive. Arvo and a durable-execution framework are two answers to the same problem: Arvo cuts an orchestrator into separate pure deliveries held together by a record, a framework keeps it as one function held together by a replayed history.

**Shape A — the record is the memory.** One `execute` per activity or step. The framework supplies transport, durability, retry and the clock; the record is authoritative and `in_flight_event_map` is what an execution is waiting for. Conformant today, and what §3 through §8 test.

**Shape B — the history is the memory.** The executor is workflow code awaiting each service call inline, with the framework remembering where it got to.

**Shape B is written as a cost, not as a candidate, and nothing is conceded to it.** It trades the one property that makes the model portable for pleasanter-looking code, and buys a hard dependency on one vendor's replay. It also requires a deterministic executor, which ADR-000 deliberately does not. The protocol cannot express it in any case — `ctx.build` returns an event rather than sending one, and a mechanism hook may not alter what is returned — and that is correct rather than a gap. §12 builds it only so the loss is demonstrated in code rather than argued about.

## Layout

```
src/distributed/
  handler/<input_type>/      the handlers, knowing nothing of any framework
    contract.ts              the ArvoContract
    index.ts                 the ArvoEventHandler
  temporal/                  activities, workflows, the store, the worker
  dbos/                      steps, workflows, the store
  scenario/                  what one run begins with, and what is asserted of it
  replay/                    the mechanism that is only a tape recorder
```

One directory per handler, named for what it takes in. Every framework directory imports the same handlers and adds nothing to them. **If either framework needs a handler changed, that is a finding**, and it is recorded in §14 rather than worked around.

## 1. The handlers, knowing nothing of any mechanism

- [ ] 1.1 `handler/com_order_fulfil/` — the orchestrator. Fans out wide, delegates a recursive walk, asks for a review it cannot do itself, and answers its caller once everything is in. Two versions, so a rolling upgrade is reachable.
- [ ] 1.2 `handler/com_inventory_check/` — the fan-out leaf. Answers at once, and there are hundreds of executions of it per run.
- [ ] 1.3 `handler/com_category_walk/` — declares itself as its own service, descends a tree, and unwinds. Depth, recursion and `max_depth` in one handler.
- [ ] 1.4 `handler/com_payment_charge/` — fails for the first few attempts and then succeeds, keyed on `attempt` so every mechanism agrees on what it does.
- [ ] 1.5 `handler/com_fraud_check/` — raises a fault no attempt can fix. Must stop a mechanism retrying, and must be abandoned with the pair.
- [ ] 1.6 `handler/com_manual_review/` — a contract carrying a `domain`, so its events leave the lattice and only something outside can answer them.
- [ ] 1.7 `handler/com_audit_write/` — no outputs and no services: the one shape that completes by returning nothing. Proves a sink works where a framework expects a return value.
- [ ] 1.8 A check asserts no file under `handler/` imports either framework. The handlers are the constant; the mechanisms are what vary.

## 2. The scenario

One run that does everything at once, because nothing here is interesting in isolation.

- [ ] 2.1 A root order fans out to **five hundred** inventory checks under `collect: 'all'`, so the executor is entered once with a complete collection and the record carries the whole of it.
- [ ] 2.2 One branch walks a category tree **deep**, each level a child execution of the same contract, with `max_depth` set so the boundary is respected in one variant and crossed on purpose in another.
- [ ] 2.3 One branch asks for a manual review, which **leaves the lattice** and is answered from outside — a signal in Temporal, an awaited event in DBOS. Until it is, the execution rests at `waiting`, which is what waiting means.
- [ ] 2.4 A payment that **fails and then does not**, so the attempt number has to cross the mechanism boundary intact.
- [ ] 2.5 A fraud check that **never succeeds**, so a mechanism has to stop and abandon.
- [ ] 2.6 An audit write that answers nobody.
- [ ] 2.7 Several whole runs at once, so nothing depends on being the only thing happening.

## 3. Obligation 1 — the outbox

> The emitted events and the next execution record MUST be preserved together, and the events MUST reach their destinations once the record is committed.

- [ ] 3.1 State how each mechanism provides it: in Temporal, by committing and publishing within the workflow that owns the execution, so both are one history event; in DBOS, by committing the record and enqueuing the events in one transaction.
- [ ] 3.2 Assert nothing is published before the commit succeeds — a commit made to fail leaves no event anywhere.
- [ ] 3.3 Assert recovery sends **what was committed**, byte for byte, rather than re-running the delivery to produce it again. Kill the worker between commit and publish, and compare the bytes that arrive against the bytes that were stored.
- [ ] 3.4 Assert the re-sent copy is **discarded** at the receiver rather than processed twice, which is what makes an abandonment event's `id` matter.
- [ ] 3.5 Assert the negative at every point in every run: there is no moment at which a record exists without the events committed with it, or an event was published without that commit having succeeded.

## 4. Obligation 2 — the state function, answered live

> The mechanism MUST supply the state function, and MUST answer it live.

- [ ] 4.1 Supply it in each mechanism without classifying, deriving or filtering: one identifier in, what is under it out, parsed and nothing more.
- [ ] 4.2 Assert it is asked **on every delivery**, including every retry, and never answered from something read earlier. A record changed behind the mechanism's back must be seen by the next attempt.
- [ ] 4.3 Assert it is never given the event or the classification — by construction, since the signature cannot carry them.
- [ ] 4.4 Assert it validates nothing: a row that is not a record reaches the handler and is refused *there*, rather than being rejected by the mechanism on the handler's behalf.
- [ ] 4.5 Make it fail, and assert the handler's `state_resolution_failed` reaches the mechanism as retry-safe and is retried.

## 5. Obligation 3 — abandonment, exactly as handed

> A mechanism that abandons an execution MUST do so with the fault's `abandonment_state` and `abandonment_event`, together, and with nothing of its own.

- [ ] 5.1 Assert a fault whose `retry` is null is **never redelivered** — which means mapping it onto a non-retryable failure rather than letting a retry policy run its course.
- [ ] 5.2 Assert that where a mechanism abandons, it commits the record and publishes the event **together**, under the outbox, and composes neither.
- [ ] 5.3 Assert the three shapes separately: a fault carrying both halves, one carrying only the event, and one carrying neither. A mechanism acts on every contingency a fault carries and on nothing it does not.
- [ ] 5.4 Assert an opening event for an execution that already exists is **not** read as a failure. ADR-008 names this as the case a mechanism is most likely to get wrong, and both of ours get a chance to.

## 6. Obligation 4 — every retry a fresh delivery

> The mechanism re-invokes the handler with the same event and the incremented attempt number.

- [ ] 6.1 Map the attempt number across the boundary and assert it: Temporal counts from one and Arvo from zero, and a mechanism that forgets has a retry budget off by one.
- [ ] 6.2 Assert the record is re-read on every attempt, with nothing cached behind the state function.
- [ ] 6.3 Assert dependencies are **re-resolved** through the factory on every attempt, never carried forward.
- [ ] 6.4 Assert only the attempt number carries forward, by changing the record between attempts and watching the retry see the change.
- [ ] 6.5 Assert the delay a fault asks for is honoured, or that ignoring it is a visible choice rather than an accident.

## 7. Obligation 5 — writes serialized

> Writes to one execution record MUST be serialized. A mechanism MUST commit at `cas_version` `0` only where no record exists.

- [ ] 7.1 State how each gets it, and where that makes `cas_version` redundant: one workflow per execution *is* a lock, so the counter becomes a consistency check rather than the mechanism. Whether a redundant guarantee is a cost or a defence is one of the questions this answers.
- [ ] 7.2 Assert create-if-absent: two opening events for one execution, exactly one record created.
- [ ] 7.3 Assert a record whose revision is not exactly one greater is refused.
- [ ] 7.4 Deliver two answers to one execution at the same moment: one commits, the loser publishes nothing, re-reads, and converges.
- [ ] 7.5 Assert that where both racing deliveries entered their executor, **both ran** — which compare-and-swap does not prevent and the protocol says it does not. Whatever an executor did outside Arvo was done twice, and the sandbox says so out loud rather than hiding it.

## 8. The three supplied inputs, and the trace

- [ ] 8.1 The attempt number, counting from zero.
- [ ] 8.2 Dependencies in both forms, resolved per delivery — including the thing a framework makes natural: a client from the worker's own scope, handed in through the factory and keyed on the execution.
- [ ] 8.3 Hooks, read-only or stably mutable, and what each framework would reasonably expose through one — a heartbeat in Temporal, a workflow handle in DBOS.
- [ ] 8.4 The delivery's OpenTelemetry context, so the handler's span continues the event's trace **and** sits inside the framework's own. A workflow whose spans and Arvo's spans do not join is a workflow nobody can debug.

## 9. Replay, which is only another mechanism

A handler that comes out somewhere else on a replay is a handler whose record was not its memory. The mechanism that tests this is the simplest one in the exercise and needs no framework: a tape recorder, committing under the outbox like any other.

- [ ] 9.1 Record a finished run as a transcript: every event delivered, the record as it was read, and the record and events committed together.
- [ ] 9.2 Replay it through a **fresh** handler, in order, with nothing of the first run alive. Every record committed and every event published must equal the first run's. This is the strongest form of *resumable from the record alone* the protocol has.
- [ ] 9.3 Replay it **shuffled and repeated**. Terminal states must match, repeats must be discarded rather than faulted, and the outbox must hold throughout.
- [ ] 9.4 Replay a run that was **abandoned** part way, and assert the pair is committed together on the replay exactly as on the first run, with nothing of the mechanism's own added.
- [ ] 9.5 Replay **Temporal's own history** through `@temporalio/testing`, which re-runs a workflow against what it recorded to check determinism. Handler results come from history rather than being re-executed, so what is judged is our adapter's routing code: a replay that fails means the adapter is non-conformant as Temporal defines it.
- [ ] 9.6 Replay through the *other* framework's store, so a transcript taken under Temporal is resumed under DBOS. If the record is the memory, the mechanism it was written by cannot matter — and this is the one test that proves it.

## 10. Chaos, under each mechanism

- [ ] 10.1 Workers killed mid-activity, repeatedly, mid-run.
- [ ] 10.2 The store made unavailable for a window, then restored.
- [ ] 10.3 Signals and events delivered twice, and out of order.
- [ ] 10.4 A run interrupted and resumed from nothing but what was committed — a fresh process, nothing of the first still alive.
- [ ] 10.5 The same invariants the in-process suites assert, asserted here: one terminal state per execution, every request answered exactly once, revisions advancing one at a time from zero, and every execution on one version for its whole life.
- [ ] 10.6 The outbox holding under every one of these, as §3.5 requires.

## 11. Where it breaks

Not a failure condition — a measurement. Two things grow with a fan-out: Arvo's record, which is rehydrated whole on every delivery, and the framework's own history. A wide execution pays both.

- [ ] 11.1 Find the fan-out at which each mechanism stops being able to carry one execution, and say which of the two costs bound it.
- [ ] 11.2 Find the depth at which a chain of child executions stops working, and why.
- [ ] 11.3 Report both as numbers with reasons, not as a verdict.

## 12. What Shape B costs

- [ ] 12.1 Write the same orchestrator as workflow code awaiting each service call inline, outside the protocol, in whichever framework makes it most natural.
- [ ] 12.2 Then try to do with it what §9.6 does with the record: hand the execution to the other mechanism. Name what is no longer possible.
- [ ] 12.3 Name what else it costs: an executor that must be deterministic, and an execution no other language can resume.
- [ ] 12.4 Name what survives either way — contracts, the closed emittable set, identity, the fault vocabulary — because that is the part of Arvo doing work no framework does.

## 13. Running it

- [ ] 13.1 Temporal through `@temporalio/testing`, which brings its own test server, so a run needs nothing installed and no container.
- [ ] 13.2 DBOS needs Postgres. Where none is reachable the run says so and skips rather than failing, and the prerequisite is documented in one place.
- [ ] 13.3 A separate target from the tour — `pnpm run distributed` — because the tour must stay runnable with nothing but Node.
- [ ] 13.4 Neither framework reaches `arvo-core`'s own dependencies. Both live in the sandbox, which is private and never published.

## 14. What this found

To be written as it is found, as a judgement in these terms:

- which obligations each framework satisfied **naturally**, which took work, and which it could not satisfy at all;
- whether either framework needed a handler changed, which §1.8 is there to catch;
- what the record earns on top of a mechanism that already remembers — and, honestly, where it is plainly duplication;
- what the protocol should perhaps change, stated as something an ADR could be written from.
