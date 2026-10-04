# Proving the handler holds

The version was proven in [`version_testing_tasks.md`](./version_testing_tasks.md): a lattice that could be made to misbehave, invariants after every run, the fault vocabulary exhausted, thirteen scenarios, seeded chance between them, and finally four real threads against one store. It found five defects in the code and five in the harness.

This does the same for `ArvoEventHandler` — everything the version was handed rather than asked to work out. Where the version was given a classified event, a derived identifier and a parsed row, the handler is given **an event and a way to reach a store**, and must decide what the event is, which execution it concerns, whether what came back is a record at all, and which version owns it.

## What is different about this layer, and why it needs its own suite

The version's suite could hand it a well-formed world because something upstream had made it well-formed. Nothing is upstream of the handler. So the inputs that matter here are the ones no earlier layer can rule out:

- **an event from a participant that was built against a different declaration** — an unknown contract, a version nobody declared, a type that contract never sends, a payload its schema refuses;
- **a store that lies** — returning another execution's record, a row that is not a record, a record whose own fields contradict each other, a row that changed between one attempt and the next;
- **a store that fails** — unreachable, slow, or failing in a way that is not an error at all;
- **a deployment mid-change** — a version withdrawn while its executions are still open, a state schema changed under records already written;
- **the handler's own seam** — the gate's order is normative, and the one place this implementation puts a rule somewhere other than where the protocol's table puts it is the event check, which is handed to the version to run in position.

And one property the version could not have: **the handler is the only thing that decides which version runs.** A handler with two versions in flight at once, each with its own schema, options and executor, is the case where a routing mistake is silent rather than loud.

## Why this is testable without infrastructure

The same reason the version was. A handler is a function of an event, a way to reach a store, dependencies, an attempt number and hooks. A test supplies a `Map` for the store and literal values for the rest. The lattice the version's suite built already models the one thing a mechanism must do — commit the record and the events together, or neither — so this reuses it rather than inventing a second one.

## 1. The fixture

- [x] 1.1 Added `tests/ArvoEventHandler/scenarios/fixture.ts`: one contract at **three versions** with genuinely different shapes — `1.0.0` with a state schema, `1.1.0` with a different one and its own options, `2.0.0` with none at all — plus a service, a second service sharing nothing, a contract declared as its own service for recursion, and a contract whose version set differs from what the handler declares.
- [x] 1.2 Behaviour injected per version, so one scenario can make `1.0.0` answer and `1.1.0` fail without two handlers.
- [x] 1.3 Added `scenarios/store.ts`. A store that can be told to misbehave: fail, hang, return another execution's record, return a row that is not a record, return one whose fields disagree with its own init event, and change what it returns between one read and the next.

Proven before anything is built on it, in `scenarios/fixture.spec.ts`: a harness that quietly does not do what it claims produces a suite that passes for the wrong reason, which the version's own suite found five times over.

## 2. The lattice, extended

- [x] 2.1 Reused rather than forked: `ArvoLatticeParam` gained a `handlers` map, and where one is registered for an event's `to` the lattice hands the event over whole and settles nothing first. The version's own path is untouched, and its suite still passes unchanged. Where it currently drives a version directly, it drives a handler: it publishes events and hands each to `handler.execute`, and the handler does its own classification, derivation and fetching.
- [x] 2.2 Asserted in `scenarios/lattice.spec.ts`, with the services declared as handlers of their own so no event in the lattice goes around a gate. That substitution is itself a test. Every invariant the version's suite asserts must still hold when the handler is the thing being driven, because the handler changes who decides, not what is true.
- [x] 2.3 Nothing needed adding: the committed row already names the version it was written under, and a fault already names its kind. The invariants read both.

## 3. The invariants, added to

Every check in `version/scenarios/invariants.ts`, plus those in `scenarios/invariants.ts`. Each is itself tested against a run that breaks it, in `scenarios/invariants.spec.ts`: an invariant that cannot fail proves nothing, and a suite full of them passes for the wrong reason.

- [x] 3.1 **Every execution ran under exactly one version for its whole life**, and that version is the one its init event named. Two checks, since a record could be consistent and still wrong.
- [x] 3.1a **Every record is stored under the identity the protocol derives for it** — the first place the derivation itself is on trial, the version having been handed the identifier.
- [x] 3.2 Covered as **every execution ran the version its own opening event named**, which is the same property stated where it can be observed — the record names both.
- [x] 3.3 **Every fault names the execution the store was asked about** — the derived identifier on an init, the event's own on a followup — and `null` only where the event could not be placed.
- [x] 3.4 **Every fault's abandonment pair matches what its step is allowed to carry**, which is the rule most easily lost: the event is present from step 2 on an init and from step 5 on a followup, and never before.
- [x] 3.5 The store records every identifier it was asked for, so one read per execution is provable. Asserted in §4.
- [x] 3.6 Observable as the fault a corrupt row produces: a row that is not a record is refused as corruption rather than reported as a mismatch. Asserted in §4 and §5.5.

## 4. The fault matrix, from the outside

- [ ] 4.1 Add `tests/ArvoEventHandler/scenarios/faults.spec.ts`: one row per fault the handler itself raises — `event_unclassifiable`, `category_mismatch`, `state_resolution_failed`, `record_unexpected`, `record_expected`, `record_invalid`, `record_event_unrestorable`, `version_not_declared`, `type_not_receivable`, `event_schema_rejected` — each caused through `execute` rather than by calling a helper, and each asserted whole: the kind, the retry verdict, the violations, both abandonment halves, that nothing was emitted, that nothing was committed, and what the span recorded.
- [ ] 4.2 And one row per fault the handler must pass through **unaltered** from the version, so a refactor that reinterprets one is caught: `max_depth_event_received`, `lifecycle_terminal`, `execution_timeout`, `response_unawaited`, `addressing_mismatch`, `event_unaddressed`, `dependency_resolution_failed`, `run_timeout`, `executor_raised`, and every return-time kind.

## 5. The scenarios

Each runs clean, under chaos, and with a fault injected at a step the driver picks.

- [ ] 5.1 **Three versions in flight at once.** Executions of all three open together, interleaved, each answered. Proves each ran under its own schema, its own options and its own executor, and that none read another's state.
- [ ] 5.2 **A rolling upgrade, from the outside.** `1.0.0` executions in flight while `1.1.0` takes new work; then `1.0.0` is withdrawn from the handler and every one of its in-flight executions is refused at step 6 with the abandonment event addressed to its caller. Proves the drain story the ADR describes is the one that actually happens.
- [ ] 5.3 **A participant built against another declaration.** Events naming an unknown contract, a version nobody declares, a service version the handler did not declare, a type the resolved contract never sends, and a payload its schema refuses — each refused with its own kind, and each distinguishable from the others by `fault_kind` alone.
- [ ] 5.4 **Recursion through the handler.** A contract declared as its own service: a request to itself opens a child, the child's reply resumes the parent, and a type that is neither is refused as unplaceable. Then the same with the child at a version the parent did not open it at.
- [ ] 5.5 **A store that lies.** Each way, separately: another execution's record under this key; a row that is not a record; a record whose `init_event_id` or `subject` disagrees with its own init event; a record whose stored event will not restore. Each refused as corruption, before anything compared it against the arriving event.
- [ ] 5.6 **A store that fails.** Unreachable, then reachable: the first attempt faults retry-safe, the second succeeds against an unchanged record. Then failing for the whole retry budget, so the fault arrives with no retry in prospect. Then failing in ways that are not errors — a rejected promise, a thrown string, a thrown `null`.
- [ ] 5.7 **The same event delivered twice, three times, a hundred times.** Every repeat after the first discarded, the store unchanged, and nothing published. Then the repeat arriving while the first is still running.
- [ ] 5.8 **A redelivered init.** The first opened an execution; the redelivery derives the same identifier, finds the record, and is refused `record_unexpected` — which a mechanism may read as "stop redelivering" rather than as a defect.
- [ ] 5.9 **A late reply to a finished execution.** Refused for its lifecycle, carrying neither abandonment half — and still refused for its lifecycle when its payload is also wrong, which is the ordering this implementation had to be built carefully to keep.
- [ ] 5.10 **A state schema changed under records already written.** Executions open under the old shape, the version's schema changed, and every one of them refused at step 7 with the cause named. Proves the consequence the ADR states is the consequence that occurs.
- [ ] 5.11 **A version that remembers nothing.** Its records carry no state, it completes, and a record that somehow carries state is refused rather than read under a schema that was never its own.
- [ ] 5.12 **The whole chain, through the handler.** The version's long chain, wide fan-out, human-in-the-loop and tree-walk scenarios, re-run with the handler as the thing driven. Nothing about them should change, and that is the assertion.

## 6. Scale, boundaries and chance

- [ ] 6.1 Scale: ten thousand executions through one handler, three versions, one store. The cost of placing an event must not grow with how many executions exist, and a wall-clock budget is asserted so a regression fails the suite rather than merely slowing it.
- [ ] 6.2 Boundaries: a contract with one version and with many; a handler with no services; an event at the exact depth bound; the first and last attempt; a store returning an empty object against one returning nothing.
- [ ] 6.3 Payload cruelty at the boundary: `__proto__` as an event type, a `dataschema` with no separator, one with several, an empty `to`, an enormous payload, and `undefined` inside data.
- [ ] 6.4 Chance: two hundred seeded runs, invariants after each, the seed printed on failure and pinned as a named regression.
- [ ] 6.5 Statelessness: two executions of different versions interleaved through one handler instance, proving the handler holds nothing between them — the claim the whole protocol rests on.

## 7. Real threads

- [ ] 7.1 Extend `version/scenarios/worker/` so the worker loads a **handler** rather than a version, and the broker stops classifying: it publishes bytes and reads back what the handler decided. The broker becoming simpler is the point — everything it no longer does is something the handler now does.
- [ ] 7.2 The same cruelty as before: duplicates, disorder, threads killed mid-work, attempts running out. Plus the one this layer adds: two threads opening the same execution from the same init event at the same moment, where both derive the same identifier and exactly one may create the record.

## 8. What this broke

To be filled in as it is. Each finding becomes its own fix rather than a softened test.

## 9. Finishing

- [ ] 9.1 `pnpm lint`, `pnpm typecheck` and `pnpm test` clean.
- [ ] 9.2 Coverage held at 100% across statements, branches, functions and lines for the handler, with every uncovered line named and justified.
