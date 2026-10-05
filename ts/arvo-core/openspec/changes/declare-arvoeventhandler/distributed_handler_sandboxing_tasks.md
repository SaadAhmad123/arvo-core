# Running the handler under a real mechanism

Everything proven so far was proven against a mechanism written to be proven against. The lattice, the brokers, the threaded harness — each is a mechanism in [ADR-006](../../../../../docs/adr/006-arvoeventhandler-protocol.md)'s sense, and each was written by the same hand as the thing it tests. That is the limit of what any of them can tell us.

**Temporal and DBOS are mechanisms.** Not analogies for one — mechanisms, in exactly the sense ADR-006 means: they run the handler, they carry what it produces, and ADR-006 places five obligations on them. So this is not a compatibility exercise. It is a conformance exercise, run against two implementations nobody here wrote, and the rubric is **Required of infrastructure adapters**, obligation by obligation.

What makes it worth doing is that those five obligations were written without either framework in mind. If a durable-execution framework satisfies them naturally, the obligations are the right ones. If satisfying them takes contortion, the obligations are either wrong or under-specified, and that is a finding about the ADR rather than about the framework.

## The two shapes, and why both

An Arvo handler is already two things. Across one delivery it is a pure function — an event, a way to reach a store, an attempt number, and what it produces. Across many it is an orchestrator: it issues events, stops, and continues when answers arrive. Arvo and a durable-execution framework are two answers to the same problem. Arvo cuts an orchestrator into separate pure deliveries held together by a record; Temporal keeps it as one function held together by a replayed history.

- **Shape A — the record is the memory.** One `execute` per activity or step. The framework is the transport, the clock and the durability; Arvo's record is authoritative and `in_flight_event_map` is what the execution is waiting for. Conformant today. This is what the obligations are tested against.

- **Shape B — the history is the memory.** The executor is workflow code and awaits each service call inline. Replay restores the continuation, which satisfies ADR-000 honestly enough: no process holds the stack, the history does. Much pleasanter to write, and most of the record dissolves into what the framework already remembers.

**Shape B is not expressible today, and that is the point of prototyping it.** `ctx.build` returns an event and the executor *returns* it; there is no awaiting send. ADR-006 forbids the context exposing the mechanism or any transport, and bars a mechanism hook from altering "the events returned". So an awaitable send is neither in the context nor legal as a hook. Building B tells us precisely what the protocol would have to concede, and what it would lose: the closed emittable set is still checkable, but `collect`, the awaited collection and `cas_version` largely stop meaning anything.

## Layout

```
src/distributed/
  handler/<input_type>/      the handlers, knowing nothing of either framework
    contract.ts              the ArvoContract
    index.ts                 the ArvoEventHandler
  temporal/                  activities, workflows, the store, the worker
  dbos/                      steps, workflows, the store
  scenario/                  the events one run begins with, and what it asserts
```

One directory per handler, named for what it takes in. Both framework directories import the same handlers and add nothing to them — if either needs the handler changed, that is a finding.

## 1. The handlers, knowing nothing of any mechanism

- [ ] 1.1 `handler/com_order_fulfil/` — the orchestrator. Fans out wide, delegates a recursive walk, asks for a review it cannot do itself, and answers its caller once everything is in. Two versions, so a rolling upgrade is reachable.
- [ ] 1.2 `handler/com_inventory_check/` — the fan-out leaf. Answers at once. Hundreds of executions of it per run.
- [ ] 1.3 `handler/com_category_walk/` — declares itself as its own service, descends a tree, and unwinds. Depth, recursion and `max_depth` in one.
- [ ] 1.4 `handler/com_payment_charge/` — fails for the first few attempts and then succeeds, keyed on `attempt` so every mechanism agrees on what it does.
- [ ] 1.5 `handler/com_fraud_check/` — raises a non-retryable fault. Must stop a mechanism retrying, and must be abandoned with the pair.
- [ ] 1.6 `handler/com_manual_review/` — a contract with a `domain`, so its events leave the lattice and only something outside can answer them.
- [ ] 1.7 `handler/com_audit_write/` — no outputs, no services: the one shape that completes by returning nothing. Proves a sink works where a framework expects a return value.
- [ ] 1.8 Nothing in here imports Temporal or DBOS, and a test asserts it: the handlers are the constant, and the mechanisms are what vary.

## 2. The scenario

One run that does everything at once, because nothing here is interesting in isolation.

- [ ] 2.1 A root order fans out to **five hundred** inventory checks under `collect: 'all'`, so the executor is entered once with a complete collection and the record carries the whole of it.
- [ ] 2.2 One branch walks a category tree **deep**, each level a child execution of the same contract, with `max_depth` set so the boundary is crossed on purpose in one variant and respected in another.
- [ ] 2.3 One branch asks for a manual review, which **leaves the lattice** and is answered from outside — a signal in Temporal, an awaited event in DBOS. The execution waits indefinitely until it is, which is what `waiting` means.
- [ ] 2.4 A payment that **fails and then does not**, so the attempt number has to cross the mechanism boundary intact.
- [ ] 2.5 A fraud check that **never succeeds**, so a mechanism must stop and abandon.
- [ ] 2.6 An audit write that answers nobody.
- [ ] 2.7 Several whole runs at once, so nothing depends on being the only thing happening.

## 3. Obligation 1 — the outbox

> The emitted events and the next execution record MUST be preserved together, and the events MUST reach their destinations once the record is committed.

- [ ] 3.1 How each mechanism provides it, stated plainly: in Temporal, by committing and publishing inside the workflow that owns the execution, so both are one history event; in DBOS, by committing the record and enqueuing the events in one transaction.
- [ ] 3.2 Assert nothing is published before the commit succeeds — a commit made to fail leaves no event anywhere.
- [ ] 3.3 Assert recovery **republishes what was committed**, byte for byte, rather than re-running the delivery. Kill the worker between commit and publish and compare the republished bytes against the committed ones.
- [ ] 3.4 Assert the republished copy is **discarded** at the receiver rather than processed twice, which is what makes the abandonment event's `id` matter.

## 4. Obligation 2 — the state function, answered live

> The mechanism MUST supply the state function, and MUST answer it live.

- [ ] 4.1 Supply it in each mechanism without classifying, deriving or filtering: it takes one identifier and answers with what is under it, parsed and nothing more.
- [ ] 4.2 Assert it is asked **on every delivery**, including every retry, and never answered from something read earlier. A record changed behind the mechanism's back must be seen by the next attempt.
- [ ] 4.3 Assert it is never given the event or the classification, by construction — the signature cannot carry them.
- [ ] 4.4 Assert it validates nothing: a row that is not a record reaches the handler and is refused there, rather than being rejected by the mechanism.
- [ ] 4.5 Make it fail, and assert the handler's `state_resolution_failed` reaches the mechanism as retry-safe and is retried.

## 5. Obligation 3 — abandonment, exactly as handed

> A mechanism that abandons an execution MUST do so with the fault's `abandonment_state` and `abandonment_event`, together, and with nothing of its own.

- [ ] 5.1 Assert a fault whose `retry` is null is **never redelivered**, in either mechanism — which means mapping it onto a non-retryable failure rather than letting a retry policy keep going.
- [ ] 5.2 Assert that where the mechanism abandons, it commits the record and publishes the event **together**, and composes neither.
- [ ] 5.3 Assert the three shapes separately: a fault carrying both, one carrying only the event, and one carrying neither. A mechanism must act on every contingency a fault carries and on nothing it does not.
- [ ] 5.4 Assert an opening event for an execution that already exists is **not** read as a failure, which ADR-008 names as the case a mechanism is most likely to get wrong.

## 6. Obligation 4 — every retry a fresh delivery

> The mechanism re-invokes the handler with the same event and the incremented attempt number.

- [ ] 6.1 Map the attempt number across the boundary and assert it: Temporal counts from one, Arvo from zero, and a mechanism that forgets is a mechanism whose retry budget is off by one.
- [ ] 6.2 Assert the record is re-read on every attempt, and that nothing is cached behind the state function.
- [ ] 6.3 Assert dependencies are **re-resolved** through the factory on every attempt, never carried forward.
- [ ] 6.4 Assert only the attempt number carries forward, by changing the record between attempts and watching the retry see the change.
- [ ] 6.5 Assert the retry delay the fault asks for is honoured, or that ignoring it is a visible choice rather than an accident.

## 7. Obligation 5 — writes serialized

> Writes to one execution record MUST be serialized. A mechanism MUST commit at `cas_version` `0` only where no record exists.

- [ ] 7.1 State how each gets it, and where that makes `cas_version` redundant: one workflow per execution *is* a lock, so the counter becomes a consistency check rather than the mechanism. Whether a redundant guarantee is a cost or a defence is one of the questions this answers.
- [ ] 7.2 Assert create-if-absent: two opening events for one execution, and exactly one record created.
- [ ] 7.3 Assert a record whose revision is not exactly one greater is refused.
- [ ] 7.4 Deliver two answers to one execution at the same moment and assert one commits, the loser publishes nothing, re-reads, and converges.
- [ ] 7.5 Assert that where both racing deliveries entered their executor, **both ran** — which compare-and-swap does not prevent and the protocol says it does not. What an executor did outside Arvo was done twice, and the sandbox says so out loud.

## 8. The three supplied inputs, and the trace

- [ ] 8.1 The attempt number, counting from zero.
- [ ] 8.2 Dependencies, in both forms, resolved per delivery — and the thing a framework makes natural: a client from the worker's own scope, handed in through the factory, keyed on the execution.
- [ ] 8.3 Hooks, read-only or stably mutable, and what each framework would reasonably expose through them — a heartbeat in Temporal, a workflow handle in DBOS.
- [ ] 8.4 The delivery's OpenTelemetry context, so the handler's span continues the event's trace **and** sits inside the framework's own trace. A workflow whose spans and Arvo's spans do not join is a workflow nobody can debug.

## 9. Chaos, under each mechanism

- [ ] 9.1 Workers killed mid-activity, repeatedly, mid-run.
- [ ] 9.2 The store made unavailable for a window and restored.
- [ ] 9.3 Signals and events delivered twice, and out of order.
- [ ] 9.4 A run interrupted and resumed from nothing but what was committed — a fresh process, nothing of the first still alive.
- [ ] 9.5 The same invariants the in-process suites assert, asserted here: one terminal state per execution, every request answered exactly once, revisions advancing one at a time from zero, every execution on one version for its whole life.

## 10. Where it breaks

Not a failure condition — a measurement. Two things grow with a fan-out: Arvo's record, which is rehydrated whole on every delivery, and the framework's own history. A wide execution pays both.

- [ ] 10.1 Find the fan-out at which each mechanism stops being able to carry one execution, and say which of the two costs bound it.
- [ ] 10.2 Find the depth at which a chain of child executions stops working, and why.
- [ ] 10.3 Report both as numbers with the reason, not as a verdict.

## 11. Shape B, prototyped rather than shipped

- [ ] 11.1 Write the same orchestrator as workflow code that awaits each service call inline, outside the protocol, in whichever framework makes it most natural.
- [ ] 11.2 Record exactly what the protocol would have to concede: a context member that sends and waits, and what becomes of `collect`, the awaited collection, `cas_version` and the record's lifecycle once a history remembers them instead.
- [ ] 11.3 Record what survives either way — contracts, the closed emittable set, identity, the fault vocabulary — because that is the part of Arvo that is doing work a framework does not.
- [ ] 11.4 State plainly whether it is worth a protocol change, and what the cost would be to everything already built.

## 12. Running it

- [ ] 12.1 Temporal through `@temporalio/testing`, which brings its own test server, so a run needs nothing installed and no container.
- [ ] 12.2 DBOS needs Postgres. Where none is reachable, the run says so and skips rather than failing, and the prerequisite is documented in one place.
- [ ] 12.3 A separate target from the tour — `pnpm run distributed` — because the tour must stay runnable with nothing but Node.
- [ ] 12.4 Neither framework reaches `arvo-core`'s own dependencies: both live in the sandbox, which is private and never published.

## 13. What this found

To be written as it is found. The useful outcome is a judgement, in these terms:

- which obligations each framework satisfied **naturally**, which took work, and which it could not satisfy at all;
- what Arvo's record earns on top of a mechanism that already remembers — and where it is plainly duplication;
- what the protocol should perhaps change, stated as something an ADR could be written from.
