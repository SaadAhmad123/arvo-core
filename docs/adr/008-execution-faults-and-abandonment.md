# ADR-008: Execution Faults and Abandonment

- **Status:** Proposed
- **Date:** 2026-09-28
- **Scope:** Arvo ecosystem
- **Amends:** AAM 1 membership (ADR-000) — places the fault object's field names and the value `ArvoHandlerFault` inside the model as a durable format; supplies the representation of two of the three failure boundaries ADR-000's *Explicit Failure Boundaries* names
- **Depends on:** [ADR-006](./006-arvoeventhandler-protocol.md), which defines the handler whose failures these are and the mechanism obligations that act on them; [ADR-007](./007-execution-record.md), which defines the record a fault carries at `failure`
- **Left deferred:** the conditions for routing a failure to the workflow root; error kinds beyond handler failure. See **Left deferred**

Conformance language is as defined in [ADR-000](./000-arvo-system-identity-and-architectural-principles.md).

## Scope

### What this ADR defines

This ADR defines how an execution fails. It fixes the two categories every failure falls into, the single test that tells them apart, the handler error event and the two closed causes that produce it, the fault object a handler raises with every field typed and named, the full vocabulary of fault kinds with the retry verdict of each, and abandonment — the contingency every fault carries so that a mechanism which gives up on an execution can tell the caller and record the outcome without composing anything itself.

It is one of four ADRs that together specify the ArvoEventHandler protocol. [ADR-006](./006-arvoeventhandler-protocol.md) defines the handler, the gate whose steps raise most of the faults named here, and the mechanism obligation that acts on the abandonment pair. [ADR-007](./007-execution-record.md) defines the record the pair carries. [ADR-009](./009-execution-bounds.md) defines the bounds whose crossing is a fault here. The four were written as one and split for size; where one refers to a heading in another, the reference names the ADR.

### What this ADR deliberately does not define

- **What a mechanism does with a fault it will not retry.** The protocol requires only that it not redeliver. Abandonment is one choice, and this ADR neither requires nor enumerates the others (**Abandonment**).
- **Error kinds beyond handler failure.** As in ADR-005, exactly one standardized emit is in play — the handler error event. This ADR adds the non-event failure category and no further error kinds.
- **The conditions for routing a failure to the workflow root.** ADR-001 permits such an event and deferred the conditions; this ADR defines none (**No failure routes to the workflow root**).

### How this ADR changes

Once accepted, this changes only by a superseding ADR. The fault object's field names and the value `ArvoHandlerFault` are pinned as tightly as the record's: a fault may be dead-lettered, dead-lettering means storing it, and a stored fault must read the same in every language.

## Context

ADR-000's *Explicit Failure Boundaries* distinguishes protocol failures from handler failures from infrastructure failures, and defers their representation. ADR-005 gives every contract version one standardized handler error event and says it "is not a general system- or infrastructure-failure channel". ADR-006 defines a handler whose gate can refuse a delivery for fourteen reasons before business code runs, and whose executor can fail after it does. Those refusals and that failure are not the same thing, and a mechanism that cannot tell them apart either retries what no retry fixes or stays silent to a caller that is owed an answer. This ADR gives each its representation.

## Decision

### Failure protocol

#### The two categories

An execution's failures fall into exactly two categories. Both are defined before either is elaborated, because everything after this — the fault object, the retry figures, the abandonment pair, and what a mechanism is obliged to do — turns on which one is in play.

| | **Execution fault** | **Handler error** |
|---|---|---|
| What failed | The delivery — a precondition the handler required, or an obligation it had to meet | The work — the executor could not fulfil the contract it implements |
| Protocol state | Broken or unverifiable; nothing the executor determined can be relied upon | Intact; the delivery classified, the record was sound, the execution ran |
| Is it a conclusion? | No. Nothing was concluded | Yes. This is the execution's conclusion |
| Becomes an event | Not itself. It carries one, published only if the execution is abandoned | Yes — the version's handler error event |
| Record written by the handler | None | Yes; terminal at `error` |
| Audience | Whatever runs the handler | The caller |
| Retry | Carried explicitly: retry safe or not, with figures | Not applicable — a concluded execution has nothing to retry |

#### Execution fault

**Execution fault** is the condition in which a delivery could not be carried through to a trustworthy conclusion. What broke is a precondition the handler required before it could run — the gate ([ADR-006](./006-arvoeventhandler-protocol.md), **Entry validation**), the state function, the dependency factory — or an obligation it had to meet in order to commit: a returned event that is not permitted, a state that will not serialize, a batch that would breach the version's depth or time bound. Because nothing the executor determined can be relied upon, **a fault concludes nothing: it emits no event and writes no record.** It is a statement about the delivery, and its audience is whatever runs the handler.

#### Handler error

**Handler error** is the condition in which a delivery was carried through to a valid conclusion, and that conclusion is that the executor could not fulfil the contract it implements. The protocol was intact throughout: the gate passed, the record was sound, the executor ran and failed. Because the outcome is a contractual one, it is expressible as the standardized handler error event every contract version carries (ADR-005), and it returns to the caller as an ordinary event. It is a statement about the work, and its audience is the caller.

#### The single test: was anything concluded?

The test for any failure, including one a later ADR introduces, is one question: **did anything get concluded?** If nothing was, it is a fault. If something was, and what was concluded is "I could not", it is a handler error. The two timeouts under [ADR-009](./009-execution-bounds.md), **Timeouts** show the test at work: a run that overran concluded nothing and is a fault, retry safe because the next attempt may finish; an execution that outlived its bound also concluded nothing and is a fault, not retry safe because no attempt can give it back the time.

#### Handler error: the event and the terminal lifecycle

A handler error MUST be reported as the self contract version's handler error event, addressed as an own-contract emission under [ADR-006](./006-arvoeventhandler-protocol.md), **The complete field defaults**, and the execution MUST reach a terminal lifecycle. Which lifecycle depends on who publishes the event: **`error`** where the handler emits it itself, and **`failure`** where a mechanism publishes it for an execution already abandoned (**Abandonment**). In the first case it is a concluded execution — it produced an event and a record, and a mechanism has nothing to retry.

The event's payload is ADR-005's fixed shape: `error_name`, `error_message`, and `error_stack`. Where the executor failed, `error_name` is the name of the failure the language raised, `error_message` its message and `error_stack` its stack or `null`. Where the execution was abandoned, `error_name` is `ArvoHandlerFault` (**Why the name is fixed**), and the other two are the fault's `message` and `stack`.

#### The two causes, and the set is closed

**An executor never constructs the handler error event.** The handler does, from exactly two causes:

- **a failure escaping the executor** — the handler produces the event, emits it, and writes the record at `error` with the failure's message in `lifecycle_description`;
- **an execution abandoned after a fault** — the handler built the event in advance and carried it on the fault, and a mechanism publishes it on the handler's behalf when it gives up, committing the record at `failure` beside it (**Abandonment**).

That set is closed, and only the first is one an executor reaches by its own act. Everything else that ends in the handler error event arrives through the second: a depth bound crossed ([ADR-009](./009-execution-bounds.md), **Depth**), a time bound crossed ([ADR-009](./009-execution-bounds.md), **Timeouts**), a cancellation without an answer ([ADR-007](./007-execution-record.md), **Marking an execution `cancelled`**), a retry budget spent ([ADR-009](./009-execution-bounds.md), **Retry**). Each is a fault first, and becomes the event only if the mechanism abandons the execution. The two causes differ in who acts and where the record rests, and the record keeps them apart on purpose: being abandoned and concluding "I could not" are different facts, and `error` and `failure` are how a reader tells them apart later.

#### An executor never constructs the handler error event

Failing and the event are one thing seen from two sides: an executor says "I cannot fulfil this contract" by failing, and the caller hears it as the event. There is no path by which an execution reports its own failure and carries on, and none by which it carries on while claiming to have failed. This is why the **event builder** refuses the handler error type and a hand-built event carrying it is refused at return as `emission_not_permitted` ([ADR-006](./006-arvoeventhandler-protocol.md), **What an executor may return**): an executor that could construct the event could emit it and then keep running, and the event would no longer mean what ADR-005 says it means.

#### The narrow exception: an executor raising a fault

The exception is deliberate and narrow. Where an executor raises a failure that *is* an execution fault — one built through the **fault** member of the execution context ([ADR-006](./006-arvoeventhandler-protocol.md), **The execution context**) — it stays a fault and does not become a handler error. It carries `fault_kind` `executor_raised`, the executor's reason as `message`, and the retry verdict the executor chose, **retry safe unless the executor says otherwise**, expressed as `retry` present or `null`. Where the executor said not, or where its retries are spent, `retry` is `null` and it carries the abandonment pair like any other fault. It is the one kind whose verdict is not fixed in the vocabulary, so for it alone `fault_kind` does not tell a mechanism whether the failure was fixable; the executor's `message` is where that reason lives.

How such a failure is distinguished from an ordinary one is API shape and each language's own choice (ADR-004); what this ADR fixes is that the distinction exists, which side of it produces an event, and what it costs (**The cost of an executor raising a fault**).

#### The fault object

A fault MUST carry whether a **retry is in prospect** and, where it is, how long a mechanism should wait before the next attempt — so a mechanism can retry, dead-letter, or escalate without inspecting a message or consulting a handler's declaration. It carries the rest of what follows for the same reason: a fault writes no record, so anything not on the fault is lost to everything downstream of it.

```
ArvoHandlerFault                     extends the language's native error type;
                                     every field below is JSON-representable

    name                string          'ArvoHandlerFault', fixed; reaches the wire via error_name
    fault_kind          string          which fault this is; the vocabulary is the table below
    message             string          what failed, the value, and the rule broken
    cause               string | null   the underlying failure rendered as a string,
                                        or null where nothing underlies it
    stack               string | null
    violations          string[]        every check that failed, not only the first;
                                        one human-readable entry per failed check,
                                        naming the check and the value that failed it.
                                        empty only where nothing was checked

    subject             string          the delivered event's subject
    execution_id        string | null   the key the state function was called with: on an
                                        init, the identifier derived from the event; on a
                                        followup, the event's executionid. null only where
                                        the delivery could not be classified
    event_id            string          the delivered event's id

    attempt             integer         this delivery's attempt number, counting from 0
    timestamp           integer         when this delivery was processed, ms since the Unix epoch
    retry               object | null   null where no retry is in prospect
        max_retry_attempts_allowed   integer
        retry_in_ms                  integer   milliseconds
        retry_at                     integer   ms since the Unix epoch; timestamp + retry_in_ms

    abandonment_event   ArvoEvent | null    the handler error event to publish if this
                                            execution is abandoned
    abandonment_state   record | null       the execution record to commit alongside it,
                                            already terminal at failure

                                            NEITHER is acted on when the fault is received --
                                            only if the execution is abandoned. See Abandonment
```

`subject` and `event_id` are read from the delivered event and are never `null`: ADR-001 requires both on every event, and the gate has them before it checks anything. `execution_id` is **the execution this delivery concerns, as the key the handler passed to the state function** ([ADR-006](./006-arvoeventhandler-protocol.md), **Resolving the existing execution**). On an init that is the identifier derived from the event's `dataschema` and `id` ([ADR-006](./006-arvoeventhandler-protocol.md), **Execution identity**), which is *not* the event's own `executionid` — that names the caller and becomes `parent_execution_id`. On a followup the two coincide, because a response carries its caller's identity in `executionid`. It is `null` only on `event_unclassifiable`, where step 1 failed and no key was ever selected. Defining it as the key rather than as a field of the event is what lets a mechanism dead-lettering the fault find the record it concerns.

#### What is normative in the fault object

**Everything above is normative: the semantics of every field, the field names, the value `ArvoHandlerFault`, the `fault_kind` vocabulary, and the requirement that the whole object be representable as JSON.** The names are fixed for the same reason the record's are ([ADR-007](./007-execution-record.md), **The execution record**). A mechanism may dead-letter a fault, and dead-lettering means storing it; a fault stored by one language MUST be readable by another (ADR-004), and a durable format with per-language spellings is not one format. This is the second of the two objects that leave the process (**Scope**), and it is held to the same standard as the first.

What is *not* normative is the shape of the object in a language's own terms: which native error type it extends, whether the fields are properties or accessors, and how an executor's `fault` is told apart from an ordinary failure. Those are API shape (ADR-004).

#### Why the name is fixed

`ArvoHandlerFault` is fixed rather than left to each language because it does not stay inside the implementation. It is what the abandonment event carries in `error_name`, which is the only thing telling a caller that its callee was *abandoned* rather than that its callee's own logic failed. A caller filtering on that string against an implementation that spelled its class differently does not error — it silently falls through to the wrong branch, and the one signal that distinguishes "the work was given up" from "the work was tried and failed" is lost.

#### `cause` and `violations`

`cause` is a string rather than the underlying error value because a fault may be dead-lettered, and dead-lettering means persisting it. That is the same reason the whole object must survive JSON: anything added here later must survive it too.

`violations` exists because [ADR-006](./006-arvoeventhandler-protocol.md), **Entry validation** requires a fault to name every check that failed rather than only the first ([ADR-006](./006-arvoeventhandler-protocol.md), **Every fault names every failed check**), and a single `message` cannot carry that structurally — a reader would have to parse prose to recover a list, which is the interpreting-a-message this object exists to avoid. **Each entry is a string**, one per failed check, naming the check and the value that failed it; the list is JSON `string[]` and nothing more structured, because a reader in another language needs to display it, not to branch on it — branching is what `fault_kind` is for. Where the gate short-circuited, `violations` holds the one check that stopped it; where it evaluated several, as steps 12 and 14 do, it holds all of them. On a return fault it holds every rejected event in the batch, offenders and non-offenders alike ([ADR-009](./009-execution-bounds.md), **One offending event rejects the whole batch**). `message` remains the human-readable rendering of the same thing.

#### `attempt` and `timestamp`

`attempt` and `timestamp` sit on the fault rather than inside `retry`, because both are true whether or not another attempt is coming, while everything inside `retry` is only meaningful if one is. Nulling them alongside the forward-looking figures would lose the attempt count at exactly the moment it is most worth having — the fault that exhausts a retry budget, on which a mechanism decides whether to abandon. Their units, and those of the `retry` block, are pinned under [ADR-009](./009-execution-bounds.md), **Units: milliseconds throughout**.

#### The `fault_kind` vocabulary and retry verdicts

| Where | Fault | `fault_kind` | Retry safe |
|---|---|---|---|
| gate 1 | the delivered event's `dataschema` names no declared contract at a declared version | `event_unclassifiable` | no |
| gate 2 | `category` contradicts what resolution found | `category_mismatch` | no |
| gate 3 | the state function failed | `state_resolution_failed` | **yes** |
| gate 4 | an init delivery arrives with a record | `record_unexpected` | no |
| gate 4 | a followup delivery arrives without one | `record_expected` | no |
| gate 5, gate 7 | the record's envelope fails validation, or its `data` fails the owning version's schema | `record_invalid` | no |
| gate 5 | an event in the record fails to restore | `record_event_unrestorable` | no |
| gate 6 | the record's `version` is no longer declared | `version_not_declared` | no |
| gate 8 | the delivered event's `depth` is at or beyond the version's maximum | `max_depth_event_received` | no |
| gate 10 | the delivery reaches a record already at a terminal `lifecycle` | `lifecycle_terminal` | no |
| gate 11, and return | the execution has outlived the version's execution timeout | `execution_timeout` | no |
| gate 12 | the event carries no `to` | `event_unaddressed` | no |
| gate 12 | record, handler and event disagree on `to`, `source`, `execution_id` or `subject` | `addressing_mismatch` | no |
| gate 13 | the event's type is not one the resolved contract can send here | `type_not_receivable` | no |
| gate 14 | the delivered event's payload fails its contract's schema | `event_schema_rejected` | no |
| gate 15 | a response's `initid` names nothing the collection is awaiting | `response_unawaited` | no |
| declaration reached a delivery | the handler declares two versions of one service contract | `service_version_conflict` | no |
| gate 16 | resolving the executor's dependencies failed | `dependency_resolution_failed` | **yes** |
| execution | the executor did not return within the version's run timeout | `run_timeout` | **yes** |
| execution | the executor marked the execution cancelled and returned no own-`outputs` event | `execution_cancelled` | no |
| execution | a fault the executor raised deliberately through the context | `executor_raised` | **executor's choice; yes unless stated** |
| return | a returned value is not an event, or an event's type is not emittable by this version, or it is structurally invalid, or a batch carries more than one own-`outputs` event | `emission_not_permitted` | no |
| return | a returned event's payload is rejected by its schema | `emission_schema_rejected` | no |
| return | a returned event would go beyond the version's maximum depth | `max_depth_event_requested` | no |
| return | the value written through `set state` is rejected by the declared schema | `state_schema_rejected` | no |
| return | `data` does not survive a JSON round trip | `state_not_serializable` | no |

This table is the whole of the `fault_kind` vocabulary, and it is here rather than in a list of its own so that a kind, its meaning, where it arises, and its retry verdict cannot drift apart. Several conditions a mechanism must be able to tell apart are named separately even where one gate step catches both — a record that arrived when none was expected is a different diagnosis from one that never arrived at all, and a mechanism reading `fault_kind` should not have to recover that distinction from a message.

The verdicts follow from one question: **would the same inputs produce the same failure?** A malformed record, a removed version, a bad payload, an impermissible emission and a crossed bound are all reproduced exactly by a redelivery. Three are different. The state function and the dependency factory reach outside the handler, and what is outside may answer differently a moment later. A run timeout says only that *this* attempt did not finish, and the next may. Every retry-safe verdict is subject to exhaustion: once `attempt` reaches the version's limit the fault is reported with no retry in prospect — `retry` is `null` while `fault_kind` and its verdict are unchanged — and carries the abandonment pair ([ADR-009](./009-execution-bounds.md), **Exhaustion ends retrying**).

#### Abandonment: the contingency a fault carries

A fault never becomes an event and never writes a record. What it carries is a **contingency**: a handler error event and the execution record that accompanies it, both built by the handler while it still had what it needed, to be acted on for it if it is never going to run again.

#### The pair is what an ordinary delivery returns

**The pair is exactly what an ordinary delivery returns.** A successful delivery hands the mechanism events and a next record to commit together; abandonment hands it the same two things, prepared in advance for a delivery that could not finish. The obligation that the event and the record be committed together or not at all (**Required of infrastructure adapters**, obligation 1) therefore applies unchanged, and no new rule about their ordering is needed.

#### Acted on only when a mechanism gives up

The distinction from an ordinary emission is only *when*. **Neither is acted on when the fault is received.** They MAY be acted on at exactly one moment: when a mechanism has decided it will not retry, and has chosen to abandon (obligation 3). Publishing on an attempt that is then retried successfully would deliver a caller both a handler error event and a real completion for the same request, which is worse than the silence this exists to end.

**Whether to abandon is the mechanism's decision, and this ADR does not make it.** A non-retryable fault, or an exhausted one, means one thing to a mechanism: it MUST NOT redeliver. What it does instead is policy that belongs to the deployment, and this ADR neither requires nor enumerates it — abandoning with the pair is one choice, and a deployment may dead-letter, alert, hold, or discard, those being illustrations and not a list. The choice is the mechanism's because it knows things the handler cannot: whether a store outage is being repaired, whether a `record_unexpected` was its own redelivery rather than a defect, whether an operator would rather decide. The pair exists so that abandonment, when chosen, needs nothing composed; it does not exist to force the choice. What the protocol fixes is only that a mechanism which abandons MUST use the pair as handed, together, and MUST NOT author a substitute.

#### The handler builds both, the mechanism composes neither

This is the point of carrying them. A mechanism gains no ability to construct an event and no ability to author a record — it commits one and sends the other, exactly as it does for a delivery that succeeded. It is also why the event must be complete, `id` included, rather than a recipe: should a mechanism commit the pair, publish the event, and crash before it has recorded that the event was sent, it will publish the same committed event again on recovery (obligation 1), and the caller's gate discards the second copy at step 9 as already seen — where a regenerated event would arrive as a second, distinct error.

#### `abandonment_state`

**`abandonment_state` is the record at `failure`**, with `lifecycle_description` carrying the fault's own message, `event_ids` extended with the abandonment event's `id` as `emitted`, `triggering_event` set to the delivered event, and `cas_version` incremented as for any other write. Every other field is carried forward from the record as the attempt read it. `failure` rather than `error` because the execution was abandoned rather than concluded, and [ADR-007](./007-execution-record.md), **The execution record** keeps those apart.

#### Each attempt builds its own pair

Each attempt builds its own pair from the record it was given, which is what the re-read under [ADR-009](./009-execution-bounds.md), **Every retry re-reads the record** makes correct: the pair a mechanism finally commits was derived from the record as of the attempt it gave up on, not as of the first one. Where a write nonetheless lands in between, the compare-and-swap fails (obligation 5), and what to do then is the mechanism's — committing anyway overwrites a record that legitimately advanced, while honouring the failure leaves an execution un-abandoned. Neither is safe in general, so this ADR requires the attempt and leaves the resolution where the knowledge is.

#### When each is present, and why they differ

`abandonment_event` is present wherever the handler can address a completion. On an **init** delivery that is as soon as step 1 has classified it: the init event itself carries the caller's `source`, the `subject`, and the `executionid` a completion answers to, so every init fault from step 2 onward carries the event, `max_depth_event_received` included. On a **followup** delivery it is as soon as step 5 has passed: the record is then trustworthy and holds `init_event_source` and everything else the defaults table needs. Before that point a followup holds only a service's response, whose `source`, `initid` and `executionid` all name the service rather than this execution's caller, and there is nothing to address from. So the event is `null` on `event_unclassifiable`, where the delivery could not even be told init from followup; and on a followup's `category_mismatch`, `state_resolution_failed`, `record_expected`, `record_event_unrestorable`, and `record_invalid` **as raised at step 5**. The same kind raised at step 7 is different: the envelope passed, `init_event` was restored, and only `data` failed its schema, so the handler can address the caller and the event is present. One fault kind, two steps, two contingencies — the step, not the kind, decides. An implementation MUST NOT salvage the addressing fields from a record that failed validation — reading fields off a structure not established to be a record is what [ADR-006](./006-arvoeventhandler-protocol.md), **Why the record is validated before anything reads it** rules out.

`abandonment_state` is present where a record exists or can be built to be brought to `failure`. On a **followup** that is any fault past step 5: the envelope is trustworthy, and the record is carried forward at `failure`. Where the fault is step 7's `record_invalid`, the carried record keeps the `data` that failed — replacing it would invent state, and `lifecycle_description` says why it rests where it does.

On an **init** delivery the answer depends on where the fault arose, and this is the one place the ADR distinguishes two groups of init faults. **A fault raised in the gate carries no record**, because no execution validly began and there is nothing to mark terminal; manufacturing one would also make the init undeliverable, since the next attempt would find a record where step 4 requires none, and a transient init fault would become an init that can never be delivered again. So on an init gate fault the caller is told and nothing is stored: something was waiting on an answer, and nothing was ever waiting on a record. **A fault raised after the gate has passed** — inside the executor or at return — is different. Once every step has passed, the handler holds everything the first record needs, the same things it would have written had the delivery succeeded, so it builds that record at `cas_version` `0` and `failure` and carries it. Committing it is the create-if-absent [ADR-006](./006-arvoeventhandler-protocol.md), **Required of infrastructure adapters** obligation 5 already defines, so a redelivered init that raced it is refused rather than duplicated.

#### `lifecycle_terminal` yields neither

`lifecycle_terminal` yields `null` for both, by rule rather than by inability. That execution already answered its caller and already rests terminal; a second completion would be discarded or refused at the caller's gate, and overwriting its lifecycle would erase how it actually ended. The same holds for `response_unawaited`, `event_unaddressed` and `addressing_mismatch` on a record already terminal, since step 10 refuses those deliveries before the later steps run.

#### What the abandonment event carries

**`error_name` carries `ArvoHandlerFault`**, which is what distinguishes this event from one an executor's own failure produced. `error_message` carries the fault's `message` and `error_stack` its `stack`, per ADR-005's fixed payload. Every other field follows the own-contract column of [ADR-006](./006-arvoeventhandler-protocol.md), **The complete field defaults**, `parentid` being the delivered event's `id` because that delivery is what caused the abandonment.

Because that message crosses into another handler's event stream and is persisted in that handler's record for as long as the record lives, an implementation SHOULD keep raw infrastructure detail — hosts, credentials, connection strings — out of fault messages, or redact when building this event. It is the one place this protocol moves diagnostic text across a node boundary.

#### No failure routes to the workflow root

**No failure defined here routes to the workflow root.** ADR-001 permits such an event — carrying `subject` as its `executionid`, bypassing intermediate executions so a failure surfaces at the top regardless of depth — and defers the conditions to this ADR. This ADR defines none: a handler failure is attributable to the execution that suffered it and returns to that execution's caller, and an abandonment event goes to that same caller for the same reason. The capability remains available and unused, and the conditions stay deferred rather than being invented to fill the slot (**Left deferred**).

#### Where each category records its cause

Both categories record their cause in `lifecycle_description` where a record survives them — a handler error reaching `error` writes the failure's message there, and a mechanism abandoning an execution writes the fault's message alongside `failure`. A fault leaves nothing behind of its own, which is why its retry safety and everything else a mechanism needs must travel on the fault itself rather than in the record.

#### The cost of an executor raising a fault

**An executor raising a fault leaves its caller waiting until the retry budget is spent, and that consequence MUST be documented wherever the means to raise one is offered.** A fault is not an answer, so nothing reaches the caller while the mechanism is still retrying — and where the fault carries no abandonment event, nothing reaches it afterwards either. The cost is bounded by the version's retry options and by the mechanism's own patience, but it is not nothing: the caller waits for as long as the retries take, and **Considered Alternatives** rejects the general shape of it for handler failures on the ground that a failure a caller never hears about is a workflow that stalls.

#### When to raise a fault and when to fail

That makes the choice a narrow one rather than a matter of taste. Raise a fault where the *delivery* is compromised and a retry is the only sensible response: a resource that would not open this time, a precondition the executor can see is not yet met. Where the executor's own *work* failed, fail — and let the handler error event tell the caller now, which is the shape it is already obliged to handle. An executor that is unsure should fail: a handler error the caller hears at once is recoverable by the caller, and a fault the caller waits on is recoverable only by the mechanism.

#### The two names are kept distinct

The two categories are named distinctly on purpose. "Handler error" refers only to the event; a fault is never an event, and the event it may carry is the handler's, not the fault's. An implementation MUST NOT use one name for both, and the fault's own name is fixed at `ArvoHandlerFault` rather than left to each language, for the reason given under **Why the name is fixed**.

## Consequences

### Gained

**Every failure has one of two shapes, and a mechanism never guesses.** A fault says on its face whether to retry and when; a handler error is an event the caller already handles. An adapter that reads `retry` and `fault_kind` has all it needs, and never parses a message.

**An abandoned execution can still answer its caller and record how it ended, with nothing composed by the mechanism.** The fault carries both, built by the handler before it lost the ability to speak. The failure that most reliably strands a workflow — retries exhausted, a store gone, a depth or time bound crossed — can surface in the shape every caller already handles, and the mechanism's only work is to commit and publish what it was handed. Whether it does is its policy; that it can, without inventing model data, is the gain.

### Paid for

**Every fault builds a pair that is usually thrown away.** Most faults are retried successfully, so the abandonment event and record are constructed on the expectation that they will be discarded. And where the record is the thing that broke, neither half can be built at all: the stranding the pair exists to prevent survives in exactly the case where the execution's own memory is what failed.

**A mechanism must make a judgement this ADR declines to make for it.** When the abandonment record loses a compare-and-swap, committing overwrites a record that legitimately advanced and not committing leaves an execution un-abandoned. The ADR requires the attempt and leaves the resolution where the knowledge is.

## Considered Alternatives

### Reporting a handler failure as a fault

Considered, not chosen. It would let a mechanism retry application failures uniformly, with one path for everything that goes wrong. It would also make a handler's failure invisible to the caller waiting on it, which contradicts ADR-000's *Event-Only Communication*: the caller's continuation depends on an event arriving, and a failure it never hears about is a workflow that stalls. A handler error is a conclusion and travels as an event; a fault concludes nothing and does not (**Failure protocol**).

### Letting an executor construct the handler error event

Considered, not chosen. It would let an executor say "I failed" and keep running — emit the error event to its caller and then go on to call a service, for instance. That is the property ADR-005 gave the event and this ADR must not lose: it means the handler failed, full stop. An executor that wants to say it cannot do the work says so by failing, and the handler turns that into the event (**An executor never constructs the handler error event**). Refusing the type at the builder and at return costs an executor nothing it legitimately needs.

### Letting a mechanism compose the abandonment event

Considered, not chosen. It looks simpler, since the mechanism is the party that knows abandonment has happened. But addressing a completion needs `to`, `initid`, `executionid`, `subject`, `category`, `dataschema` and a version, all of which are read off a record or an init event by rules this ADR spends a section on — so a mechanism composing one would be reimplementing [ADR-006](./006-arvoeventhandler-protocol.md), **Addressing an emitted event**, and any drift between its version and the handler's would misroute a failure at the exact moment a workflow is already in trouble. Carrying a finished event keeps one implementation of the addressing rules and reduces the mechanism's new capability to publishing something it was handed.

### Mandating abandonment on every non-retryable fault

Considered, not chosen. A draft required a conformant mechanism to act on the abandonment pair the moment it received a non-retryable or exhausted fault, so that whether a stranded caller is told would be a property of the model rather than of the deployment. It is the more predictable rule, and ADR-004's concern about behaviour varying by deployment weighs in its favour.

It was rejected because it makes the handler decide something only the mechanism can know. A `record_unexpected` on an init may be the mechanism's own redelivery, and publishing a handler error event for it tells the caller its work failed when the work is running. A store outage under `record_invalid` may be minutes from repair. A deployment may want every abandonment reviewed by a person. Under a mandate each of those produces a false or premature error event; under the chosen rule the handler builds the pair so that abandonment costs the mechanism nothing to compose, and the mechanism decides whether this fault is one to abandon on. What the protocol keeps is the part that must not vary: a fault that says no retry is never redelivered, and a mechanism that does abandon uses the pair as handed.

## Conformance to ADR-000

### Effect on AAM

This ADR places one durable format inside the model — the fault object's field names and the value `ArvoHandlerFault` — for the reason ADR-007 gives for the record. It supplies the representation for two of the three boundaries ADR-000's *Explicit Failure Boundaries* names: an execution fault is a protocol failure, a handler error is a handler failure. Infrastructure and delivery failures stay the mechanism's, and stay deferred. It touches one item ADR-000 lists outside the model and leaves it there: "retry counts, batching, and other adapter-internal behaviour" remain the mechanism's, and what this ADR adds is only that the handler states a verdict — `retry` present with a suggested delay, or `null` — which the mechanism MUST NOT continue past ([ADR-009](./009-execution-bounds.md), **Exhaustion ends retrying**).

### Invariants depended on

- **Event-Only Communication.** A handler's failure and its abandonment both reach the caller as an ArvoEvent governed by a contract; a fault, which is not an event, reaches only the mechanism.
- **Explicit Failure Boundaries.** This ADR is the representation of two of the three boundaries it names.
- **Nondeterminism Is Permitted.** The abandonment event is complete, `id` included, so a republished copy is discarded rather than regenerated.

### Invariants strained

None beyond those ADR-006 records.

### Required of infrastructure adapters

Nothing beyond ADR-006's five obligations. Obligation 3 is the one that acts on what this ADR defines: a mechanism that abandons does so with the contingencies the fault carries, exactly as handed, and composes nothing.

### Left deferred

- **The conditions under which a handler routes a failure to the workflow root**, which ADR-001 deferred here and this ADR does not settle (**No failure routes to the workflow root**).
- **Error kinds beyond handler failure**, and the representation of infrastructure and delivery failures, which ADR-000's *Explicit Failure Boundaries* names and this ADR does not reach.

