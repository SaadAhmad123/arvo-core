# ADR-014: Idempotency Keys

- **Status:** Accepted
- **Date:** 2026-10-13
- **Scope:** Arvo ecosystem
- **Amends:** [ADR-006](./006-arvoeventhandler-protocol.md), **The execution context** — adds one member. Additive: nothing already on the context changes, and no existing rule is replaced
- **Depends on:** [ADR-006](./006-arvoeventhandler-protocol.md), which defines the execution context and the derivation of `execution_id`; [ADR-002](./002-arvoevent-field-domain-constraints.md), which is why the separator below is unambiguous; [ADR-009](./009-execution-bounds.md), which defines the retry that makes this necessary
- **Addresses:** nothing ADR-000 deferred
- **Left deferred:** nothing

Conformance language is as defined in [ADR-000](./000-arvo-system-identity-and-architectural-principles.md).

## Scope

### What this ADR defines

Three idempotency keys the execution context exposes to an executor, and the byte-exact composition of each, so that two implementations in two languages produce the same key for the same execution.

### What this ADR deliberately does not define

- **Any guarantee that a side effect happens once.** A key is a string to hand to something else. Whether that thing honours it is its own business, and nothing here makes an executor's writes idempotent on its behalf.
- **What an executor should key.** Which of its calls need a key, and at which scope, is the executor's judgement.
- **A namespace per application.** An application wanting one prefixes the key it passes on. Nothing is gained by the protocol inventing that.

### How this ADR changes

Once accepted, this ADR changes only by a superseding ADR. It is not amended in place. The composition below is pinned as tightly as the `execution_id` derivation is, and for the same reason: two implementations differing on any part of it produce two keys for one execution.

## Context

### Why an executor needs one

[ADR-009](./009-execution-bounds.md) makes every retry a fresh delivery, and [ADR-010](./010-delivery-classification-and-entry-validation.md)'s compare-and-swap keeps one record per execution. Neither prevents an executor's code from running twice.

Two deliveries of one event can be carried out at the same moment. Both find no record, both enter the executor, and both do whatever that executor does outside Arvo. One commits; the other is refused. The record is correct — one execution, one answer — and the world outside has been written to twice.

The protocol says this plainly and does not pretend otherwise. What an executor needs in order to make it safe is a value that is the same on a repeat and different on anything that is not one.

### Why an executor should not compose it

Everything required is already on the context: the execution's identifier, the workflow's `subject`, the event that caused this delivery. An executor can assemble a key from them, and three things then go wrong.

It has to know which parts are stable. `execution_id` is stable across deliveries and retries; an event's `id` is stable across redeliveries of that event; **the attempt number is not stable at all**, and it is the one an author is most likely to reach for, because a retry is exactly what they are thinking about. A key containing the attempt is a different key on every attempt, which is the double write again with more code.

It has to be assembled identically everywhere. Two handlers in one deployment composing the same key two ways is a bug nothing catches; two *languages* composing it two ways is the same bug across a conformance boundary.

And the mistake is invisible. A wrong key does not fail. It works perfectly until a retry overlaps its original, which may be months.

ADR-006 already took this view once, about addressing: the fields a mistake would misroute "are all structurally valid either way", so the protocol builds the event rather than letting an executor set them. This is the same argument about the same kind of field.

## Decision

### Three scopes

**The execution context MUST expose three idempotency keys**, answering the three questions an executor actually asks:

| scope | the same for | an executor uses it for |
|---|---|---|
| `workflow` | every execution of one workflow, at every depth | something that must happen once per run, wherever in the run it is decided |
| `execution` | every delivery and every attempt of one execution | something an execution does once in its life |
| `delivery` | every attempt of one delivery, and every redelivery of the event that caused it | something an execution does once per event it receives |

All three are functions of the record and the delivered event alone. Nothing is stored, no field is added, and a replay of the same events produces the same three keys — which is what makes them usable at all.

**There is deliberately no scope keyed on the attempt.** A key that changed per attempt would defeat its own purpose, and its absence is the one thing about this surface an implementation MUST NOT make good on request.

### Choosing between them

The table above is exact and still leaves the choice harder than it needs to be, so here is one run with the three keys in it.

An order is placed. It asks for two inventory checks, a payment charge, a fraud check and a review, then answers its caller once all five have answered. Each of those is an execution of its own, and a recursive walk under it has more.

**The workflow key is one string for all of them.** The order, both checks, the payment, the fraud check, every walk node, at every depth. It comes from `subject`, which is constant across a workflow by definition. So it is the key for something that must happen once per order wherever in the run it is decided — one confirmation to the customer, one audit entry. If the order handler sends the confirmation, and a year later a second handler is added that also sends one, both compose the same key and the customer gets one message.

**The execution key is one string per execution, and nothing outside that execution shares it.** Not another handler, and not another execution of the *same* handler: the two inventory checks run the same code and get two different execution keys, which is right, because they are reserving different items.

What it spans is the whole of one execution — from the event that opened it, through everything it emitted, through every answer it took in, through every retry of each, to the answer that finished it. **Including the waiting.** An order resting at `waiting` for a week while a person reviews it has the same execution key before and after. That is what makes it usable for *charge the card once*: the charge and the eventual completion belong to one execution however much time and however many events pass between them.

**The delivery key is one string per event an execution receives.** The order is entered six times — once to open it and once per answer — and the two keys part company there:

| the order was entered by | its execution key | its delivery key |
|---|---|---|
| the order request | the same one | one of its own |
| the first inventory answer | the same one | one of its own |
| the second inventory answer | the same one | one of its own |
| the payment answer | the same one | one of its own |
| the fraud answer | the same one | one of its own |
| the review answer | the same one | one of its own |

So: *once per run* is the workflow key. *Once ever, by this execution* is the execution key. *Once for each thing that arrives* is the delivery key.

#### Where the two are interchangeable, and where they are not

An execution that receives one event in its life — an inventory check, a payment charge, a fraud check: asked, answers, done — has one delivery, so both keys are constant across everything that happens to it and either will do. They are never the same string, because the scope name is inside the hash, but they are equally correct.

They part company for an execution that waits and is entered again, which is exactly where choosing wrongly is silent.

**Choosing the execution key for per-event work loses work.** If the order reserves stock each time a supplier answers and keys on the execution, all six deliveries present the same key. The first reservation is made and the service recognises the next five as repeats of it. Five reservations gone, no error anywhere, and the run reports success.

**Choosing the delivery key for once-ever work duplicates it.** A payment charge keyed on the delivery is correct while the payment has one delivery — and stops being correct the day someone adds a step that waits for an answer, because the execution is then entered twice, composes two delivery keys, and charges twice. Nothing about that change looks risky.

Which makes the execution key the safer default for *once ever*: it is the one that survives a handler later becoming one that waits.

### The composition is pinned

For each scope:

```
key = "arvo1-" ‖ scope ‖ "-" ‖ hex( SHA-256( input ) )

input(workflow)  = utf8("workflow")  ‖ 0x00 ‖ utf8(subject)
input(execution) = utf8("execution") ‖ 0x00 ‖ utf8(execution_id)
input(delivery)  = utf8("delivery")  ‖ 0x00 ‖ utf8(execution_id)
                                     ‖ 0x00 ‖ utf8(delivered_event_id)

scope  is one of the literals "workflow", "execution", "delivery"
hex    is 64 lowercase hexadecimal characters, no prefix and no separator
```

`delivered_event_id` is the `id` of the event that caused this delivery — `triggering_event` on the record, which on an opening delivery is the init event itself.

Every part of that is fixed. The literals, their order, the separator byte, the hash, the case of the hex, the prefix: an implementation differing on any of them is non-conformant, and the failure it produces is a duplicate write at a third party.

### Why it is composed that way

**The scope name is inside the hash.** This is what stops two scopes producing one key. Without it, a workflow whose `subject` happened to equal some execution's identifier would give `workflow` and `execution` the same key, and an executor using both would find its second call silently treated as a repeat of its first.

**`0x00` is the separator.** [ADR-002](./002-arvoevent-field-domain-constraints.md) excludes U+0000 from `subject` and `id`, and `execution_id` is hexadecimal, so the byte cannot occur inside any part. Without that, `a` ‖ `bc` and `ab` ‖ `c` are one string and two different deliveries can share a key. It is the same choice, for the same reason, as the `execution_id` derivation.

**The output is hashed rather than readable.** Two reasons. A `subject` is chosen by whoever started the run and may be any length and may carry something an application would not choose to send to a payment gateway; a hash is fixed-length and reveals neither. And many services that accept an idempotency key bound its length, so a key that is sometimes short and sometimes very long is a key that sometimes fails.

**The prefix is readable.** `arvo1-execution-` in a third party's dashboard says what the key is and where it came from, which a bare hash does not. The `1` is this composition's version: a superseding ADR changing any part of the input would change it, so a reader can tell two compositions apart rather than discovering the difference through a duplicate charge.

### What it does not do

**A key does not make anything idempotent.** It is an argument to something else, and that something else has to honour it. An executor handing a key to a service with no such notion has gained nothing, and should not believe otherwise.

**It does not narrow the warning.** Two executors can still both run; this is how an executor makes that safe, not a reason it no longer happens.

**It is not a lock.** Two racing deliveries will hand the same key to the same service at the same moment. Whether that service serializes them, answers both from one effect, or fails one of them is the service's design, and an executor that needs one of those behaviours must check that it has it.

## Consequences

### Gained

- The one value an executor must not use is not available, so the mistake that cannot be caught by a test cannot be made by accident either.
- The three scopes an executor actually needs are named, so choosing between them is a decision rather than an assembly job.
- Two languages produce the same key for the same execution, which is what makes a handler portable across them in the presence of a retry.
- A replay produces the same keys, so re-running a recorded run does not duplicate what it already did at a third party.

### Paid for

- Three hashes per delivery where an executor uses none. An implementation MAY compute them on first use, provided the value is the same whenever it is read.
- Another pinned derivation, with the same cost as the first: it changes only by supersession, and a change invalidates every key already handed out.
- An opaque key is harder to trace back to its execution than a readable one. The prefix makes the kind visible; the rest requires the record.

## Considered Alternatives

### Exposing the parts and letting an executor compose the key

This is the position before this ADR. Rejected for the three reasons under **Why an executor should not compose it** — chiefly that the attempt number is the obvious thing to include and the worst.

### A readable key rather than a hash

Considered: `arvo1-execution-<execution_id>` is debuggable and needs no hashing. Rejected for the `workflow` scope, whose input is a caller-chosen string of unbounded length and unknown sensitivity — and taking one form for two scopes and another for the third would be worse than either.

### One key instead of three

Considered, at the `execution` scope alone. Rejected: once per received event is a real and common need — an orchestrator reserving stock each time a supplier answers — and an executor forced to compose that one by hand is back where it started, with the attempt number within reach.

### A scope keyed on the attempt

Rejected, and named here because a reader will wonder. A key that changes per attempt identifies the attempt rather than the work, which is the opposite of what the surface is for.

### Letting an application supply a namespace or a salt

Considered. Rejected as something an application does for itself by prefixing what it passes on, with nothing gained by the protocol defining it.

## Conformance to ADR-000

### Effect on AAM

None. The AAM membership list is unchanged. This adds one derived member to the execution context.

### Invariants depended on

- **Every retry is a fresh delivery** ([ADR-009](./009-execution-bounds.md)). The keys exist because of it.
- **`execution_id` is derived and identical in every language** ([ADR-006](./006-arvoeventhandler-protocol.md)). Two of the three keys are built on it, so this ADR is only as portable as that one.

### Invariants strained

None. Nothing new is stored and nothing a node must do changes.

### Required of infrastructure adapters

Nothing. The keys are the handler's to compose from the record and the delivered event; a mechanism supplies neither.

### Left deferred

Nothing.
