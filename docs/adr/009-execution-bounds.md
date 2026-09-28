# ADR-009: Execution Bounds

- **Status:** Proposed
- **Date:** 2026-09-28
- **Scope:** Arvo ecosystem
- **Amends:** nothing in the AAM membership list; refines the handler lifecycle semantics [ADR-006](./006-arvoeventhandler-protocol.md) places inside the model
- **Depends on:** [ADR-006](./006-arvoeventhandler-protocol.md), which defines the options these bounds read, the gate steps that enforce them on entry, and the return validation that enforces them on exit; [ADR-007](./007-execution-record.md), which defines the record they are stored in; [ADR-008](./008-execution-faults-and-abandonment.md), which defines the faults they raise
- **Addresses, in part:** ADR-000 Deferred Decisions — "Handler concurrency and event-waiting patterns" (settled here)
- **Left deferred:** timers, deadlines and scheduling. See **Left deferred**

Conformance language is as defined in [ADR-000](./000-arvo-system-identity-and-architectural-principles.md).

## Scope

### What this ADR defines

This ADR defines the four bounds a version places on its own executions and how each is enforced: **depth**, how deep an execution may sit or reach before it stops calling out; **retry**, how many attempts a retryable fault is given and how long a mechanism waits between them; **timeouts**, how long one attempt may run and how long the whole execution may live; and **collection**, whether the executor is entered once every outstanding response is in or on each. All four are driven by the options ADR-006 defines and are enforced by the gate and the return path ADR-006 defines; this ADR says what each bound means, where it is checked, and what crossing it produces.

It is one of five ADRs that together specify the ArvoEventHandler protocol. [ADR-010](./010-delivery-classification-and-entry-validation.md) defines how a delivery is classified and the gate it passes. [ADR-006](./006-arvoeventhandler-protocol.md) defines the handler, its options, its gate and its return validation. [ADR-007](./007-execution-record.md) defines the record that stores the collection and the lifecycle a bound leaves an execution at. [ADR-008](./008-execution-faults-and-abandonment.md) defines the faults a crossed bound raises and what a mechanism may do with them. The five were written as one and split for size; where one refers to a heading in another, the reference names the ADR.

### What this ADR deliberately does not define

- **Timers, deadlines, and scheduling.** ADR-000 defers these, and this ADR defines no timer: nothing in it fires without a delivery. The two timeouts are bounds a handler checks when it is entered, not scheduled events. Following up on an execution that is waiting on something that never arrives belongs to whatever runs the handler (**What else the runner owns**).
- **What a mechanism does with a fault it will not retry.** The handler states a verdict; the mechanism's policy beyond not redelivering is its own ([ADR-008](./008-execution-faults-and-abandonment.md), **Abandonment**).
- **Whether the executor's work stops when the run clock expires.** The handler stops waiting; whether the code is interrupted is each language's own (**The run clock: what it covers, and what it does not**).

### How this ADR changes

Once accepted, this changes only by a superseding ADR. Nothing here is a durable format; the defaults live in ADR-006's options table and a change to one is a change to that ADR.

## Context

A handler holds nothing between deliveries and is entered only when something delivers to it. It therefore cannot know how much time has passed, whether a response is late, or whether this delivery is a retry, and everything that depends on time passing or on nothing happening has to be owned by whatever runs it. ADR-006 draws that line. This ADR fills in the handler's side of it: what the handler can bound from inside one delivery — its own depth, the time an attempt and an execution have consumed, and how many responses it waits for — and what it tells the mechanism so that the mechanism can bound the rest.

## Decision

### Depth

#### An execution-level guard, not an event constraint

**This is an execution-level guard, not a constraint on the event.** It does not narrow `depth` as ADR-001 defines it, does not restrict what depth an event may carry across the ecosystem, and imposes no limit the model enforces. ADR-000 holds that "Arvo imposes no architectural limit on composition depth", and this section does not contradict it: a version chooses its own maximum, and may choose one high enough that the guard never fires. What it bounds is how deep *this handler, at this version* is willing to be, and to go — a handler's own decision about its own recursion, not an architectural limit on composition.

ADR-001 gives `depth` its purpose: it "exists for operational comprehension", because unbounded nesting is "an operational risk rather than a structural impossibility". This guard is the one place in the protocol that reads the field for that purpose, and turns a runaway recursion into a diagnosable stop rather than an exhausted store.

#### One option, resolved per version

The bound is the option **`max_depth`** ([ADR-006](./006-arvoeventhandler-protocol.md), **Options**), resolved for the version an execution belongs to. It is resolved per version because two versions of one contract may nest differently and a version's executor is the code whose recursion it bounds; the handler-level value is what a version inherits when it declares none, not a bound on the handler as a whole.

There is no option for what happens when the limit is crossed. **Crossing it is always a non-retryable execution fault.** It has two kinds, one for each place it can be detected: `max_depth_event_received` where an event arrives at or beyond the limit, and `max_depth_event_requested` where the executor returns an event that would go beyond it.

#### Checked twice: on delivery, and on return

The guard is applied at two points, with one threshold.

**On delivery, at gate step 8** ([ADR-010](./010-delivery-classification-and-entry-validation.md), **Entry validation**), fault `max_depth_event_received`: the delivered event's `depth` MUST be below the version's maximum. The version is the one resolution selected — the event's on an init, the record's on a followup — which is why the check sits after the version is known and confirmed declared, and not earlier. It catches a caller with a looser limit than this handler's reaching it from too deep.

**On return, as part of return validation** ([ADR-006](./006-arvoeventhandler-protocol.md), **What an executor returns**), fault `max_depth_event_requested`: for each event the executor returned that would open a new execution — one addressed to a service — the depth it would carry is `state.depth + 1`, and that value MUST be below the maximum. An own-`outputs` event carries `state.depth` and can never violate.

The two thresholds are the same number, and that is what makes both checks safe together. Because emission refuses at `state.depth + 1 >= max`, no execution of this version ever opens a service execution at or above `max`, so no legitimate response — which carries the depth of the execution that produced it — ever arrives at or above `max` either. The delivery check therefore never rejects a reply this handler was owed, and only ever rejects an init that arrived from beyond the limit.

Refusing the *emission* is where the protection lies. A delivered response has already happened; nothing about refusing it prevents any depth. Refusing to emit stops the doomed work before it runs, which is the only point at which stopping is worth anything. The delivery check is the second line: a handler protecting itself against a caller that does not share its limit.

An executor does not have to discover the limit by hitting it. The execution context carries **at max depth** ([ADR-006](./006-arvoeventhandler-protocol.md), **The execution context**), true exactly when a service emission from this execution would fail the return check. An executor that reads it before deciding what to return can choose an own-`outputs` event instead, safely and inside its own logic, and never raise the fault at all.

#### One offending event rejects the whole batch

**One offending event rejects the whole batch.** Where any event an executor returns fails the guard, none of them is emitted, no record is written, and `max_depth_event_requested` is raised for the delivery. The alternative — emitting the permitted ones and faulting on the violation — would leave a fault describing a delivery that partly succeeded, which a fault by definition cannot ([ADR-008](./008-execution-faults-and-abandonment.md), **Failure protocol**). A batch is one decision by one executor, and it succeeds or fails as one. The same rule governs every other return-time check.

#### The executor can see it coming

**An executor can see it coming, which is why the outcome is its own.** The execution context exposes **at max depth** ([ADR-006](./006-arvoeventhandler-protocol.md), **The execution context**) — true when an event this execution emits to a service could no longer increment `depth` without reaching the maximum. An executor that checks it can take a different path, complete early with an own-`outputs` event that explains itself, or fail deliberately so the caller hears a handler error rather than an abandonment. Raising this fault on return therefore takes a deliberate act: emitting to a service after being told the limit is reached, or overriding `depth` outright, which is already among the unsafe fields under **What an executor may set**.

#### What the caller hears

Because a fault carries its abandonment pair ([ADR-008](./008-execution-faults-and-abandonment.md), **Abandonment**), a depth fault need not be silence. The fault is non-retryable, so a mechanism MUST NOT redeliver it; what it does instead is its own policy. Where it chooses to abandon, it publishes the handler error event and commits the record at `failure` together (**Required of infrastructure adapters**, obligation 3), and the caller learns the work will not be done in the one shape it is already obliged to handle, with the record saying why. On a `max_depth_event_received` fault against an init delivery, the record half is `null` — no execution began — and only the event is available, exactly as for any other init fault.

The fault's `message`, and the `lifecycle_description` of the abandonment record where there is one, MUST state the limit in force, the depth at which the execution sat or the event arrived, and — on `max_depth_event_requested` — the type and would-be depth of each event in the rejected batch, offenders and non-offenders alike, because the batch was rejected whole and a diagnostic showing only part of it would misrepresent what happened.

### Retry

#### A handler cannot retry itself

A handler cannot retry itself. It is stateless and runs only when something delivers to it, so a retry is a redelivery and every decision about one belongs to whatever runs the handler. What this ADR settles is what the handler must tell it, and what the mechanism must do with what it is told.

#### Every delivery carries its attempt number

**Every delivery carries which attempt it is.** The mechanism supplies an attempt number alongside the event, the state function and the dependencies. It is on the execution context ([ADR-006](./006-arvoeventhandler-protocol.md), **The execution context**), so an executor may read it — knowing this is the third attempt is sometimes exactly what a decision turns on — and it is also passed to the state function, so a mechanism can tune its own read by it ([ADR-010](./010-delivery-classification-and-entry-validation.md), **Resolving the existing execution**).

It is not part of the record. It describes a delivery, not an execution, and a record that carried it would be claiming to remember something no delivery can know about another.

#### Attempts count from zero

**Attempts count from 0**, and a retry is in prospect while `attempt < max_retry_attempts_allowed`. Both halves are pinned because neither is inferable: with the default of 3 and an unpinned base, one implementation delivers three times and another four, and both could call themselves conformant.

#### Retry information travels on the fault

**Retry information travels on the fault, not in the record.** Where a delivery ends in an execution fault, the fault carries everything a mechanism needs to decide what happens next — `attempt`, `timestamp`, `fault_kind`, and the `retry` block. Those fields are defined once, with the rest of the object, under [ADR-008](./008-execution-faults-and-abandonment.md), **The fault object**; what follows is what they mean rather than a second copy of their shape.

`retry` is `null` where no retry is in prospect: a fault whose kind no redelivery fixes, or one whose attempts are spent. A mechanism can therefore read "retry, and here is when" or "do not" without interpreting a message. **`retry` is the permission and `fault_kind` is the nature**, and the two are kept on separate fields on purpose: a mechanism that will not retry can still tell, from the kind, whether the failure was the fixable sort that ran out of budget or the defective sort that never was, and that difference may decide what it does instead ([ADR-008](./008-execution-faults-and-abandonment.md), **Abandonment**).

#### Why the fault is the only place this can live

**The fault is the only place this can live.** A fault produces no record, so a figure written into the record could never be persisted at the moment it mattered — and outside a fault there is nothing to retry, so the field would be `null` on every record that ever reached a store. The fault exists exactly when the information is meaningful and at no other time.

#### No exhaustion flag, no cross-delivery total

There is deliberately no exhaustion flag and no cross-delivery total. A flag would be dead weight — `retry` is `null` exactly when no redelivery is in prospect, so any flag beside it could only ever restate it; and there is no separate retry-safety field for the same reason, since the kind's verdict is fixed in the vocabulary and a second field carrying it could only agree or wrongly disagree.

A total is worse than redundant: it is uncomputable. The mechanism supplies only this delivery's attempt number, retry state is deliberately absent from the record, and a fault writes no record — so nothing the handler is given could produce a figure spanning deliveries, and a field no conformant implementation can fill does not belong in a specification.

#### Units: milliseconds throughout

`timestamp` and `retry_at` are instants and `retry_in_ms` a duration. **All three are numbers in milliseconds** — the instants as milliseconds since the Unix epoch, the duration as a count of milliseconds — so `retry_at = timestamp + retry_in_ms` is arithmetic between like units and needs no conversion rule, notwithstanding that the two operands sit at different levels of the object.

Milliseconds rather than the finest precision available, for three reasons. It keeps that addition honest: a microsecond instant plus a millisecond duration is a unit error waiting to be written. A millisecond epoch sits far inside the range a JSON number represents exactly, where a nanosecond epoch does not — nothing here needs precision a durable format cannot carry. Furthermore, a millisecond clock is something every language implementing AAM can read from its standard library without a platform-specific call.

#### The two retry options

Retry is governed by two options, **`max_retry_attempts`** and **`retry_delay`** ([ADR-006](./006-arvoeventhandler-protocol.md), **Options**), which a mechanism reads off the fault rather than from the handler's declaration.

In its function form, `retry delay` receives the retry state as well as the delivery: which attempt this was and how many the version allows. That is what makes a backoff expressible — a figure that grows with `attempt`, or one that stretches as the budget nears its end — without the function reaching for state the handler does not hold. It receives no more than that, because nothing else about a retry exists: the record carries no retry state, and no attempt can know about another (**No exhaustion flag, no cross-delivery total**).

The handler must put a number in the fault's `retry_in_ms`, so `retry_delay` is never undefined: the handler level always holds a value ([ADR-006](./006-arvoeventhandler-protocol.md), **Options**). A mechanism may of course ignore the figure, but it must be given one.

#### Retry before a version is known

`state_resolution_failed` is raised at gate step 3, before the record has been read and therefore, on a followup, before any version is known — a followup's `dataschema` names the service, and the version that owns the execution is inside the record the read failed to produce. On an init the event's own `dataschema` names the version and the version's options apply as usual. **On a followup, the version side of every option is `null`, so the handler's values apply** — the ordinary resolution rule with nothing on the version side ([ADR-006](./006-arvoeventhandler-protocol.md), **Options**), and the fault's `retry` block carries those figures. Its `message` SHOULD say so.

In its function form `retry_delay` is then called with `null` in place of the record, because none was read; a handler-level function MUST accept that. This is the one fault today for which a version's own retry options are never consulted, and only because no version can be known.

#### `retry delay` must not be able to fail

In its function form `retry delay` **MUST NOT be able to fail**. Where it does — throwing, or returning anything that is not a usable number — an implementation MUST substitute the fixed protocol fallback for `retry_delay`, `300` ms from the Fallback column under [ADR-006](./006-arvoeventhandler-protocol.md), **Options**, rather than propagate the failure. The fallback is never a declared value: a handler-level function that fails would otherwise be its own fallback. A failure while working out how long to wait before retrying would turn a recoverable situation into an unrecoverable one, which is the one outcome the retry path exists to prevent.

#### Exhaustion ends retrying

**Exhaustion ends retrying, and the handler says so.** Where `attempt` has reached `max_retry_attempts_allowed`, a fault of a retry-safe kind MUST carry `retry` as `null`, exactly as a non-retry-safe kind always does. Its `fault_kind` is unchanged — the failure is still the fixable sort, and the budget, not the nature, is what ran out. A mechanism stops rather than loops.

The handler is the party that applies this because it is the party that knows the version's limit; the mechanism knows only which attempt it is making. A mechanism MAY stop earlier than the handler tells it to — its own budgets are its own — but it MUST NOT continue past a fault that says no retry is in prospect.

#### Only the mechanism can bring an execution to `failure`

**`failure` is the one lifecycle only the mechanism can reach, and it reaches it by choosing to abandon.** This needs stating because no handler gets there under its own steam: a handler runs only when something delivers to it, and exhaustion is the case where nothing more will. A fault commits no record of its own, so the stored record still says `waiting`. A mechanism that abandons an exhausted execution commits the `failure` record so that it is distinguishable from one legitimately waiting on a slow service; a mechanism that does not abandon leaves the record at `waiting`, and owns the fact that the two now look alike.

Where a mechanism chooses to abandon, it commits the fault's `abandonment_state` and publishes its `abandonment_event` together, where the fault carries them ([ADR-008](./008-execution-faults-and-abandonment.md), **Abandonment**; **Required of infrastructure adapters**, obligation 3). What it does instead is the mechanism's own policy, which this ADR neither requires nor enumerates; the protocol requires only that it not retry. `failure` is terminal, and no delivery to it is ever processed ([ADR-010](./010-delivery-classification-and-entry-validation.md), **Entry validation**, step 10).

**Only the mechanism can put an execution there, but it never composes what it writes.** The record it commits and the event it sends were both built by the handler, on the attempt that failed, and carried on the fault against precisely this outcome — so the rule that model data originates in the handler holds without an exception here. What is genuinely the mechanism's, and only its, is the decision that no further attempt will be made. That is a decision no handler can reach, because a handler is entered only when something delivers to it and giving up is the case where nothing will.

#### Every retry re-reads the record

**Every retry MUST fetch the record afresh.** A retry is a new delivery, not a replay of the one that failed. Between the failed attempt and the retry the record may have moved on — another response may have arrived, been recorded, and advanced `cas_version` — so re-running against a record read before the failure would compute from state that is no longer current. With compare-and-swap in place that write fails and the retry never converges; without it, the retry silently erases work that succeeded in between.

The state function makes this structural rather than a rule a mechanism must remember: the handler calls it on every delivery, and the function MUST read the store rather than return a value captured earlier ([ADR-010](./010-delivery-classification-and-entry-validation.md), **Resolving the existing execution**). What a mechanism must still get right is not caching behind it, and re-resolving the dependencies for each attempt. Only the attempt number carries forward, which is the one input a retry genuinely inherits.

#### What else the runner owns

Everything that depends on time passing or on nothing happening is outside what a handler can observe, because it is entered only when something delivers to it:

- storing, interpreting and acting on the `retry` a fault carries, including whether to honour the delay at all;
- following up on an execution resting at `waiting` whose responses have not arrived — the handler has no way to notice absence, and the model defines no deadline (ADR-000 defers timers);
- persisting the record, publishing the events, and delivering them;
- deciding when to stop, what to do with a fault it will not retry, and whether to act on the abandonment pair.

This ADR states what a handler produces and what it requires. Everything between one delivery and the next belongs to the mechanism, and is deliberately not divided further here.

### Timeouts

#### Two clocks, resolved per version

Time is bounded in two places by two options, **`run_timeout`** and **`execution_timeout`** ([ADR-006](./006-arvoeventhandler-protocol.md), **Options**), and the two are different questions.

The **run clock** bounds one entry into the executor: how long a single attempt may spend in business code before the handler stops waiting. The **execution clock** bounds the execution itself: how long may pass from the init event to the moment this execution's lifecycle becomes terminal. The first asks whether *this attempt* is stuck. The second asks whether *the business process* has taken longer, start to finish, than the version allows.

Both are in milliseconds, as everything under **Retry** is.

#### `null` is unbounded

On either clock, `null` means **no bound**: the handler starts no timer and the corresponding check never fails. The run clock defaults to thirty seconds because business code that has not returned in that time is far more often stuck than slow, and a mechanism that is never told so retries nothing and frees nothing. The execution clock defaults to `null` because many workflows legitimately live for hours or days between deliveries, and a default that could end one of those silently would be worse than no default.

#### Why the execution clock cannot be shorter than the run clock

[ADR-006](./006-arvoeventhandler-protocol.md), **Options** requires that a version's resolved `execution_timeout` not be smaller than its resolved `run_timeout`, and that a `null` run timeout force a `null` execution timeout. The reason belongs here. A single attempt that may run longer than the whole execution is allowed to could never complete inside the execution's bound, so the version could never succeed; and an unbounded attempt is longer than any finite bound on the whole. Both are defects in the declaration, visible before any event exists, and [ADR-006](./006-arvoeventhandler-protocol.md), **Options** refuses them there.

#### The run clock: what it covers, and what it does not

The run clock starts when the handler enters the executor and stops when the executor returns or fails. It covers nothing else: not the gate, not the state function, not the dependency factory, not return validation. Each of those either has its own fault (`state_resolution_failed`, `dependency_resolution_failed`) or is the handler's own code, and bundling them into one clock would blur who was slow when it fired.

**Where the run clock expires, the handler stops waiting and raises a retry-safe execution fault, `run_timeout`.** Nothing is emitted and no record is written by the handler. The fault carries retry information like any other retry-safe fault (**Retry information travels on the fault**), so a mechanism redelivers under the version's retry options and each attempt has its own thirty seconds — or whatever the version set. A timed-out attempt is an attempt: it consumes one of `max retry attempts`, and where it is the last, the fault is reported with no retry in prospect — `retry` null, the kind unchanged — and carries the abandonment pair (**Exhaustion ends retrying**). A stuck executor is therefore bounded twice over, once per attempt and once in how many attempts it gets.

**The protocol does not promise that the executor's work stops.** No language can guarantee that arbitrary running code halts on demand, and a rule that pretended otherwise would be one every implementation broke. What the handler guarantees is narrower and keepable: once the clock has expired, nothing the executor later returns, writes through **set state**, or raises is accepted or acted on. Whether the underlying work is interrupted is each language's own affair. An executor MUST NOT assume it was stopped, and an executor with side effects that must not outlive the attempt SHOULD watch **time remaining** on the context rather than rely on being killed.

#### The execution clock: from the init event to this execution's end

**The execution clock spans the whole life of one execution: from the init event that opened it to the moment its lifecycle becomes terminal** — `success`, `error`, `cancelled` or `failure` ([ADR-007](./007-execution-record.md), **The six lifecycle values**). That is the same notion of finished the gate uses at step 10, and it covers every way an execution can end: a completion emitted, a handler error event emitted, a cancellation, a sink version resting at `success` by returning nothing, and abandonment by a mechanism. Between those two points an execution may emit any number of requests to services and receive any number of their responses. **None of those is an end.** A service request is a step on the way, its response is another, and the clock neither stops at one nor restarts from one. It is one interval, measured once, from start to finish.

The clock is measured from the init event's `time` — the delivered event's on an init delivery, `state.init_event`'s on a followup. It is the protocol's own notion of when the execution began, it is on the record for the whole life of the execution, and it needs no field this ADR does not already carry. The producer's clock set it, so skew is possible; ADR-001 already accepts that for `time` and this ADR does not tighten it. `time` is used here as a duration's origin, not to order events, which is what ADR-001 forbids.

#### How the execution clock is enforced

A handler runs only when an event is delivered, so it cannot watch an execution between deliveries. The bound is therefore enforced at the two moments the handler is present, entry and return, and **the check at either moment is how the bound is enforced, not what the bound means.**

**On entry, at gate step 11** ([ADR-010](./010-delivery-classification-and-entry-validation.md), **Entry validation**): where the version sets an execution timeout and the time from the init event to now is not below it, the delivery is a non-retryable execution fault, `execution_timeout`. It follows the duplicate and lifecycle checks deliberately: a redelivered event is discarded and a late event reaching a finished execution is refused for its lifecycle, so neither can abandon a record that has already concluded. It precedes the checks on the event itself because an execution past its bound has nothing further to do with the event, whatever it carries. It applies on an init delivery too: an init that sat undelivered longer than the version allows is refused on arrival rather than started late, and the fault carries what a mechanism needs to tell the caller why.

**On return, after the executor finishes**: where the version sets an execution timeout and the time from the init event to the moment of return is not below it, the return is a non-retryable execution fault, `execution_timeout`, and nothing the executor returned is emitted or written. This is what makes the bound a bound on the *end* of the execution rather than on its last entry. Without it, an execution entered a moment before its limit could run for the whole of a run timeout and emit its completion well beyond the bound, and the bound would have meant nothing. Depth is checked at the same two moments for the same reason (**Checked twice: on delivery, and on return**).

Being non-retryable, the fault carries the abandonment pair ([ADR-008](./008-execution-faults-and-abandonment.md), **Abandonment**): the handler error event, and a record at `failure` where one exists or can be built — on an init the entry check at step 11 carries no record, since no execution began, while the return check carries the execution's first record, at `failure` and `cas_version` `0`, because the gate had passed (ADR-008, [ADR-008](./008-execution-faults-and-abandonment.md), **When each is present, and why they differ**). A mechanism that chooses to abandon publishes and commits what is carried, and the caller learns the process was abandoned for time. The fault's `message` and the record's `lifecycle_description` MUST state the limit in force, the init event's `time`, and the elapsed time as the handler measured it.

#### Where both expire in one attempt

A run that expires can carry the execution past its own bound in the same attempt. **When the run clock fires, the handler MUST evaluate the execution clock before reporting**: where that too has passed, the fault is `execution_timeout` and non-retryable, not `run_timeout` and retryable. Retrying an execution that the next gate would refuse for time would cost a redelivery to reach the same answer, and the non-retryable verdict is the broader judgement of the two.

#### Why these are options and not fixed limits

Depth has one fixed treatment because the sensible bound is the same for almost every version and its failure is always a defect. Time is not like that. A version fronting a synchronous lookup and a version orchestrating a week-long approval have nothing in common in how long an attempt should take or how long the process should live, and the protocol has no ground to choose for either. What the protocol fixes is the shape — two clocks, one retryable and one not — and a run default conservative enough that a stuck executor is never invisible.

### Collection

An execution that calls out to services has to know what it is waiting for, and has to be re-enterable when an answer arrives. `in_flight_event_map` is that memory, and this section defines what goes into it, when a response re-enters the executor, and what happens to a response nothing is waiting for.

#### Recording emissions as outstanding

When an executor returns one or more events addressed to service contracts, the handler records each in `in_flight_event_map` before the delivery ends, keyed by the `id` of the event it is emitting, with `null` as the value. The execution then rests at `waiting` ([ADR-007](./007-execution-record.md), **The execution record**) — unless the same batch also carried an own `outputs` event, in which case the emissions still go out and are still recorded, but the execution rests terminal ([ADR-007](./007-execution-record.md), **A mixed batch completes**).

The key is the emitted event's `id` because that is the value a response carries back in `initid` ([ADR-010](./010-delivery-classification-and-entry-validation.md), **Matching a response by `initid`**). The key MUST be present while the answer is outstanding, because the key set — not the values — is what says what the execution is waiting for. A response arriving for a key replaces that key's `null` with the response event.

#### The default: join on all

**By default a handler joins on all of them.** On a response delivery the handler records the response against its key and then:

- if any entry in the map is still `null`, the executor MUST NOT be entered. The delivery ends, the record is written, and the execution stays at `waiting`.
- if none is, the executor is entered with every response available to it through **collected** on the execution context ([ADR-006](./006-arvoeventhandler-protocol.md), **The execution context**).

This makes concurrency invisible to an executor. It is entered once per round with a complete collection, and never has to reason about how many responses have arrived, in what order, or whether it has seen this one before. The safe behaviour is the one that requires no decision from an author.

#### The per-version override: enter on each

The join is governed by the option **`collect`** ([ADR-006](./006-arvoeventhandler-protocol.md), **Options**): `all` joins, `each` enters the executor on every response with whatever the collection holds at that moment — some entries answered, others still `null`.

It is resolved per version rather than fixed per handler, because an executor entered on every response must be safe to enter repeatedly, and that is a property of executor code, which is written per version. State is version-bound too, so a version keeping a running tally may tolerate this where its successor does not.

Under the override, returning nothing on a partial collection is the ordinary case rather than a defect: responses remain outstanding, so the execution stays at `waiting` ([ADR-007](./007-execution-record.md), **Emitting nothing: `waiting` or `idle`**). An implementation SHOULD document the cost plainly at the point the option is offered, because an executor that is not in fact safe to enter repeatedly will appear to work until two responses arrive close together.

#### The map is rebuilt, not merged

`in_flight_event_map` is **rebuilt on every emission**, not merged into. When an executor returns service emissions, the new map is exactly those emissions; whatever the map held before is gone. It therefore always describes precisely what the current round awaits, and "what is this execution waiting for" has one answer at all times.

Under the default join this is unobservable, because the executor is entered only on a complete collection and a complete collection is the only state from which it can emit again. Under the override it is observable and lossy: emitting while a response is still outstanding abandons that response, since the rebuilt map no longer holds its key and the answer will not be awaited when it arrives. An implementation MUST document this as the cost of the override.

#### A response is processed only if awaited

**A response is processed only if the collection is awaiting it.** One that is not is a fault, `response_unawaited`, checked at gate step 15 ([ADR-010](./010-delivery-classification-and-entry-validation.md), **Entry validation**).

One rule covers three situations: a response whose key the map was rebuilt without, a response answering a key that already holds an answer, and a response arriving at an execution that has already finished. None of them re-enters the executor, and none reopens a terminal execution — the last is caught earlier still, by the lifecycle check at step 10.

#### Duplicate versus unawaited

The one response delivery that is discarded rather than faulted is an outright duplicate, recognised at gate step 9 by its event `id` already appearing in `event_ids` ([ADR-010](./010-delivery-classification-and-entry-validation.md), **Why the duplicate check precedes the lifecycle check**).

The distinction is worth holding onto. A duplicate is the transport doing its job under at-least-once delivery, and the handler has demonstrably already processed that exact event, so there is nothing to report and nothing to do. An unawaited response is a participant sending something nobody asked for, which is a real disagreement between two deployed nodes. Quiet about the first, loud about the second.

#### A service that never responds

Under the default join, a service that never responds leaves an execution at `waiting` indefinitely, and every other response it was waiting for is held with it. The handler cannot notice this: it is entered only when something arrives, and nothing arriving is precisely the case.

Following up on such an execution belongs to whatever runs the handler (**What else the runner owns**). The model defines no deadline of its own — ADR-000 defers timers, and this ADR assigns the responsibility without inventing the semantics. What a bound on `waiting` should be is left deferred (**Left deferred**).

## Consequences

### Gained

**Recursion and time are both bounded by default.** A version that says nothing gets a depth guard and a thirty-second run clock, so a runaway fan-out and a stuck executor both end as named faults carrying the caller's answer ready for a mechanism to send, rather than as a stack overflow or a process that never returns. A version that says more gets an execution clock, and its total lifetime is bounded too.

### Paid for

**The default join waits forever.** Concurrency is invisible to an executor, and the price is an execution at `waiting` on a service that never answers, which the handler cannot notice. The execution timeout does not rescue it: it is checked only when something is delivered, so an execution nothing delivers to is never checked, and all it can do is refuse a later delivery for time if one comes. The default is unbounded in any case, because the alternative is a default that ends legitimate long-lived workflows.

**A run clock that cannot stop the code.** The protocol promises to stop *waiting*, not to stop the executor, and an executor with side effects must watch the clock itself. An implementation that could interrupt would be more useful than the guarantee the ADR can actually make.

**Time is measured against a producer's clock.** The execution clock starts from the init event's `time`, which the producer set and the handler cannot verify. Skew between a producer and a handler is read as elapsed time, and a version with a tight execution timeout inherits the producer's clock discipline.

## Considered Alternatives

### Entering the executor on every response by default

Considered, not chosen. It is the more flexible default and needs no override. It also makes every multi-service handler concurrency-sensitive by default, and the failure mode is a partially processed execution rather than an error — an executor that was not written to be entered twice appears to work until two responses arrive close together. The safe behaviour is the one that should require no decision, so joining is the default and entering on each is the per-version opt-in (**Collection**).

### Merging into `in_flight_event_map` on emission

Considered, not chosen. It would prevent a response being abandoned under the enter-on-each override. It would also let a collection span rounds and outlive the emission that created it, so "what is this execution waiting for" would no longer have a single answer. One rule that is occasionally lossy is preferred to a rule that is always ambiguous, and the loss is documented at the point the override is offered.

### Letting a version choose between a fault and an error event on a depth breach

Considered, not chosen. A draft offered a per-version option — fault, or emit the handler error event — and a function form that could pick per event. It gave an author control over what the caller hears. It was rejected because the fault already carries the handler error event as its abandonment pair, so the option chose between two paths to the same event, and the function form was a second place for business logic to live outside the executor. One outcome, always a fault, with the executor able to see the limit coming through **at max depth** and choose its own path, is the same expressiveness with one path (**Depth**).

### Bounding time with a single timeout

Considered, not chosen. One number is simpler to declare and to explain. But the two questions it would have to answer have different answers and different remedies: an attempt that is stuck should be retried, and an execution that has lived too long should not. A single clock would either retry an execution that no attempt can rescue or abandon one whose only problem was a slow attempt. Two clocks, one retryable and one not, with a rule about their relation, is the smallest shape that gets both verdicts right (**Timeouts**).

## Conformance to ADR-000

### Effect on AAM

This ADR adds nothing to the AAM membership list. It refines "handler interfaces and lifecycle semantics", which ADR-006 already places inside the model, with the four bounds and their enforcement. It decides ADR-000's Deferred Decision on "handler concurrency and event-waiting patterns": the default join and its per-version override (**Collection**).

### Invariants depended on

- **Infrastructure Independence.** Every bound is checked by the handler from what a single delivery gives it; none needs a timer, a clock the mechanism owns, or a store.
- **Nondeterminism Is Permitted.** The join is the default precisely so that an executor need not be safe to enter repeatedly unless its version says it is.

### Invariants strained

**Open Composition**, addressed rather than strained, and stated so a reader sees why. ADR-000 holds that "Arvo imposes no architectural limit on composition depth" and that "practical limits belong to the selected infrastructure". The guard under **Depth** is not such a limit. It constrains nothing about the `depth` field, applies to what one handler is willing to emit rather than to what the model permits, and its maximum is a version's own choice, settable arbitrarily high. Two handlers in one workflow may hold different limits, which an architectural limit could not tolerate. What it adds is a default where previously an author had to notice the risk themselves, and a default is not a constraint. The execution timeout is the same shape with a `null` default, so it constrains nothing until a version asks it to.

### Required of infrastructure adapters

Nothing beyond ADR-006's five obligations. Obligation 4 — every retry is a fresh delivery — is the one this ADR's **Retry** section leans on, and **What else the runner owns** lists what the mechanism holds that no bound here can reach.

### Left deferred

- **Timers, deadlines and scheduling.** Nothing in this ADR fires without a delivery. The two timeouts are bounds checked on entry and return, not timers: an execution at `waiting` whose responses never come is never checked by either, because nothing delivers to it. Following up on such an execution remains the mechanism's, with no deadline the model defines.

