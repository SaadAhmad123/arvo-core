# Proving `ArvoEventHandlerVersion` holds

The specs written alongside the version prove each reader in isolation. They
do not prove the thing a user actually depends on: that a workflow of many
executions, spread across many nodes, reaches the right end when the
transport repeats itself, the store loses a race, a service answers twice,
a human never answers at all, and the business code is wrong.

This file is that proof. It is written against the guarantees ADR-006 to
ADR-010 place on a version, and its working assumption is that **everything
that can go wrong does**, in combination, in an order nobody chose.

## Why this is testable without infrastructure

`execute` is a function of the event, the parsed record, the execution it is
for, the attempt, the dependencies and the telemetry, and it returns what to
publish and what to commit. It reaches no store and no transport. So the
whole distributed environment can be supplied in memory and driven
deterministically — thousands of executions, no mocks, no timing luck, and a
failing run reproducible from a printed seed.

The fixture is therefore not a bag of sample events. It is a mechanism.

## 1. The fixture

- [x] 1.1 Add `tests/ArvoEventHandler/version/scenarios/fixture.ts` with six contracts, each earning its place: `com_order_fulfil` at **two versions** with different state schemas, for version isolation and rolling upgrades; `com_inventory_reserve`, a worker that answers at once; `com_payment_charge`, a worker that is slow and can fail; `com_manual_review`, which **declares a domain** and so can only be fulfilled off the lattice; `com_tree_walk`, which declares **itself** as a service, for recursion and depth; and `com_audit_write`, which declares no outputs and no services, the one shape for which returning nothing is a completion.
- [x] 1.2 Make every executor parameterised — told to fail, hang, block the thread, cancel, return junk, emit a named batch, or read a signal — so one set of contracts drives every scenario and a scenario reads as a configuration rather than as a new handler.

## 2. The lattice

- [x] 2.1 Add `scenarios/lattice.ts`: a mechanism meeting the five obligations ADR-006 places on one, and able to break each deliberately. A store keyed by execution with real compare-and-swap and create-if-absent at revision `0`; an outbox committing events and record as one unit or neither; a router doing the handler's own steps — classify by `dataschema`, derive the execution, fetch, check presence, check the version is declared — because that is what the version assumes has happened.
- [x] 2.2 Give it **two planes**. The default plane routes by `to`. An event carrying a domain is **parked** and delivered to nobody: `parked(domain)` says what is waiting, `inject(event)` puts one back, `fulfil(domain, fn)` does both, and `forget(fraction)` drops some. This is what makes a domained event testable as what it is — work that leaves the lattice and may come back.
- [x] 2.3 Give it retry honouring the fault's own verdict, an injectable clock so days pass in microseconds, and a transcript recording every event, commit, discard, fault and telemetry call in order. Every assertion afterwards reads the transcript rather than instrumenting the version.
- [x] 2.4 Give it chaos knobs: duplicate each event up to three times, shuffle, deliver two answers concurrently, crash after commit and before publish, drop, read stale, and lose every compare-and-swap.

## 3. The invariants

- [x] 3.1 Add `scenarios/invariants.ts`, run after **every** scenario in every mode, so each scenario proves the universal properties as well as its own point: every request has exactly one terminal answer, none unanswered and none answered twice; no event in the outbox belongs to a round that faulted; every committed record restores to an equal record and serialises to identical bytes twice; each execution's revisions run `0,1,2,…` with no gaps and no repeats; `subject` is constant per workflow, `executionid` correct by role, `initid` only on completions, `depth` exactly one more per hop and never less; `baggage` byte-identical across every event of a workflow; no handler ever received a parked event; no execution awaits a request its own trail does not hold; every fault carries exactly the abandonment shape its situation allows; and no two executions share an identity unless they are the same execution.

## 4. The fault matrix

- [x] 4.1 Add `scenarios/faults.spec.ts`: one row for each `fault_kind` in the version's scope, each with a way to cause it and a full assertion — the kind, the retry verdict, the violations, both abandonment halves, that nothing was emitted, that nothing was committed, and what the span recorded. A kind that becomes unreachable through a refactor then fails the suite rather than quietly dying.

## 5. The scenarios

Each runs three ways: clean, under chaos, and with a fault injected at a
step the driver picks.

- [x] 5.1 **The long chain.** Fifty nested executions, each delegating one level deeper, then completing back up. Proves depth, addressing, completions routing home, and fifty callers each answered once.
- [x] 5.2 **The wide fan-out.** Five hundred workers, answers shuffled. Proves the executor is entered exactly once with a complete collection, and that order does not matter.
- [x] 5.3 **The flaky transport.** The same fan-out with every event delivered two or three times, reordered. The final store must equal the clean run's, and every repeat must be discarded rather than faulted — because under at-least-once the last response of every execution is repeated, and a handler that faults on it reports a failure for every success.
- [x] 5.4 **The concurrent pair.** Two answers against one record, all six interleavings of read, execute and commit enumerated. One commits, the loser publishes nothing, re-reads, and converges.
- [x] 5.5 **The human in the loop.** An order fanning out to two services and one **domained** review. The review parks; the lattice delivers it to nobody; the record waits on three keys with one outstanding and the executor is entered zero times. A fulfiller outside the lattice injects the approval and the executor is entered exactly once with all three. Then it goes wrong in every way a party outside the lattice can: never answering, answering twice, answering with the wrong request, with a mutated workflow or execution, after the workflow already ended, days late, with the service's own error event, with a domain still set so it parks again and the workflow stalls, for an execution that never asked, with an init rather than a reply, and forgetting thirty percent of two hundred — where exactly the forgotten stall and nothing else is touched.
- [x] 5.6 **The slow worker.** The run clock expires repeatedly; attempts count up; exhaustion flips the verdict without changing the kind and carries the pair; the caller receives exactly one error event.
- [x] 5.7 **The recursive tree walk.** Branching three, depth six, with the bound at five. The batch at the boundary is refused whole and the rest of the tree completes.
- [x] 5.8 **The cancelled branch.** A signal read through the dependency factory. A branch that cancels and answers rests cancelled; a response arriving afterwards is refused for having concluded, and that fault carries neither half.
- [x] 5.9 **The rolling upgrade.** Executions of the first version in flight while the second takes new work. Each record stays on its own version and mixing is refused.
- [x] 5.10 **The corrupt row.** Six hand-edited records — drifted depth, missing opening event, awaiting a request never sent, data its schema refuses, unparseable, belonging to another execution — each refused with the right kind and the right abandonment shape, and nothing read off a record not established to be one.
- [x] 5.11 **Crash and replay.** The commit lands, the publish is lost, recovery republishes the committed bytes. Receivers discard them and the store is unchanged.
- [x] 5.11a **A process that dies part way, and a workflow nobody is coming back for.** The machine is lost between reading a record and committing one: nothing committed, nothing published, nothing recording that it ran, and the next delivery reaches the same end as a run where nothing died — while whatever the executor did outside Arvo is done twice, keyed on an execution that is the same on both machines. Then a broker that loses one queue, where the asker waits with nothing to report and sending the very same request again resumes it, because the identity is derived rather than minted. Then an answer lost after its commit, which is resumed by publishing what was committed and not by asking again. Then a workflow waiting on a person who never comes: it stays exactly where it stopped however often anything runs, and is resumed from the stored record alone — by a different process, with nothing of the first still alive — unless its version set a bound and that bound has passed.
- [x] 5.12 **Adversarial executors.** The same event returned twice; an event carrying the id of one already emitted; a hand-built event addressed wrongly; a thrown string, `null` and frozen object; a thrown fault **belonging to another execution**; ten thousand writes; a context used after the execution ended; attempts to mutate what the context exposes; dependencies stashed in module scope; a promise that never settles.
- [x] 5.13 **Byzantine services.** Replies with a mutated workflow, execution or request; from a version never declared; with depth going backwards; with baggage altered; for an execution that never asked; two services sharing one event id; and an answer to a round whose collection was already rebuilt away.

## 6. Scale, boundaries and chance

- [x] 6.1 Scale: five thousand wide, two hundred deep, ten thousand executions through one version. The trail grows linearly and never quadratically, the awaited collection is rebuilt rather than accumulated, and a wall-clock budget is asserted so a regression in collection handling fails the suite instead of merely slowing it.
- [x] 6.2 Boundaries, where off-by-one lives: depth at the bound and one below, elapsed exactly at each timeout, attempt exactly at the limit and one below, a limit of zero on each, both clocks unbounded, and collections of exactly one and of none.
- [x] 6.3 Payload cruelty: `__proto__` and `constructor` as state keys and as request ids, a megabyte of state, two hundred levels of nesting, emoji and surrogate pairs in a workflow name, numbers at JSON's precision edge, and `undefined` inside data, which JSON drops silently and which must therefore be caught rather than lost.
- [x] 6.4 Chance: two hundred seeded runs per scenario shape, invariants after each, the seed printed on failure and pinned as a named regression. The named scenarios are the cases a human chose; this explores the space between them.
- [x] 6.5 Statelessness: two executions interleaved through one version instance, proving no cross-talk, because a handler holding nothing between executions is a claim worth testing rather than assuming.

## 7. What this broke

Three were expected. Five were found, and each became its own fix rather
than a softened test.

- [x] 7.1 A fault raised by an executor that belongs to a **different execution** passed straight through, naming another execution's workflow, caller and record to a mechanism that would act on them. Throwing one is the corruption itself, so it is refused as this execution's own `executor_raised`, not worth another attempt, the foreign one kept as the cause.
- [x] 7.2 Telemetry that throws took the execution down, and what escaped was not even a fault. Split in two: something that cannot be recorded against is refused where telemetry is built, and something that works and then stops costs the recording and nothing else.
- [x] 7.3 The per-response join was sound. The collection is rebuilt rather than merged on every emission, and an answer to a round that no longer exists is refused as unawaited.
- [x] 7.4 **Not predicted.** Two of the four domain sources — this handler's own contract, and the event that caused the execution — resolved to no domain at all, so an event asked to leave the lattice silently stayed on it, and a version's failure path went to the ordinary one.
- [x] 7.5 **Not predicted.** A record opened at one version ran under another version's executor, reading its state under a schema that was never its own and answering with the wrong version on the wire. Refused now at both layers.

Three more came out of the harness rather than the code, and are recorded
because each would have been a false pass: a completion carries its own
execution's depth and not the depth of the request that caused it; a
commit is not an executor entry, since the record is written on every
answer and the executor is entered only when the join completes; and a
mechanism must run the delivery that lost a race again, against the
record now there.

## 8. Real threads

Everything above schedules its own interleavings, which proves the rules
and not the race. This runs the same questions with the threads real:
four handlers in four worker threads against one store on the main
thread, loading the built package rather than the source, because a
thread cannot share memory and so nothing can be quietly arranged. A
record crosses as bytes, an event crosses as bytes, and which thread
reads before which writes is the operating system's to decide.

- [x] 8.1 Add `scenarios/worker/` — the contracts both sides agree on, a runner that is one handler and holds no store, and a broker that owns what a mechanism owns and nothing else: the store, the compare-and-swap, the queue and the outbox.
- [x] 8.2 Sixty workflows through four threads, each answered once, every record opening at zero and advancing one revision at a time, every execution resting finished.
- [x] 8.3 The same event handed to four threads at one moment, each held inside its executor so all four are genuinely in there together: one commits, the rest conflict or find it already done, and no revision is ever written twice. Repeated runs reach an identical store however the threads interleaved.
- [x] 8.4 A thread killed outright mid-work, twice over: whatever it held is run again elsewhere, nothing is lost, and no half-written record is left behind.
- [x] 8.5 A service that concludes it cannot do the work in every thread — an answer, not a failure — telling each order once with no fault raised anywhere.
- [x] 8.6 Attempts that run out in whichever thread spends the last one: a retryable fault raised every time is retried the three attempts the options allow and then abandoned exactly once per execution, the abandoned record resting at failure while the order it was for rests at success, having been told.
- [x] 8.7 A service that fails twice and then does not, keyed on the attempt so every thread agrees: attempts are spent across threads and every workflow finishes.
- [x] 8.8 All of it at once — every event carried twice, the queue taken out of order, machines dying mid-flight — with each order still answered exactly once, every record opening at zero, no revision written twice, and the same end reached run after run.

Two more harness defects, both of which would have been a false pass:
the broker marked a thread busy only after reading the record, so a
broker mid-handover looked like one with nothing left and settled before
any work began; and threads were identified by where they sat rather
than by identity, so losing one renamed the rest and a thread's answer
landed in another thread's slot. Nothing in the handler itself was found
wanting under real threads.

The suite rebuilds `dist/` whenever the source is newer, because threads
loading a stale build would prove something about code nobody has.

## 9. Finishing

- [x] 9.1 `pnpm lint`, `pnpm typecheck` and `pnpm test` clean — 2295 tests. The simulated suite runs in under four seconds; the real-thread spec adds five.
- [x] 9.2 Coverage held. The one line not covered is the guard for a handler error event that cannot be built, which no legitimate record reaches — kept as a guard rather than cast away.
