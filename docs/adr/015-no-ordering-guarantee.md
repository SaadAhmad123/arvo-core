# ADR-015: No Ordering Guarantee

- **Status:** Accepted
- **Date:** 2026-10-14
- **Scope:** Arvo ecosystem
- **Amends:** nothing. It settles a decision three accepted ADRs defer by name
- **Depends on:** [ADR-001](./001-arvoevent-structure.md), which defines causal order through `parentid` and already forbids inferring order from `id` or `time`; [ADR-006](./006-arvoeventhandler-protocol.md), whose obligation 5 serializes writes to one record and says nothing across records; [ADR-009](./009-execution-bounds.md), whose collection already admits answers in any order
- **Addresses:** [ADR-000](./000-arvo-system-identity-and-architectural-principles.md) Deferred Decisions — "Delivery ordering scope and concurrent event handling", the ordering half; [ADR-001](./001-arvoevent-structure.md) **Left deferred** — "Ordering guarantees"; [ADR-006](./006-arvoeventhandler-protocol.md) **Left deferred** — "Delivery ordering and concurrent event handling across executions", the ordering half
- **Left deferred:** concurrent event handling, which travels alongside ordering in two of those lists and is not settled here

Conformance language is as defined in [ADR-000](./000-arvo-system-identity-and-architectural-principles.md).

## Scope

### What this ADR defines

That the protocol guarantees no ordering between events, that providing ordering is wholly a mechanism's choice, and that a participant MUST NOT require it.

### What this ADR deliberately does not define

- **Whether a mechanism should order.** It may, by whatever means and at whatever scope it likes. That is a property of a deployment, not of the model.
- **Concurrent event handling.** Two of the deferrals this closes pair ordering with concurrency. Only ordering is settled here; how many deliveries may be in flight, and what they may do to one another, stays where it is.
- **Causal order.** [ADR-001](./001-arvoevent-structure.md) already settles it. This ADR cites it and adds nothing.
- **Any ordering field.** No sequence number, no ordinal, no logical clock. Adding one is the alternative this ADR rejects, not a thing it leaves open.

### How this ADR changes

Once accepted, this ADR changes only by a superseding ADR. It is not amended in place.

A superseding ADR would have to be read with particular care. Removing a guarantee breaks every participant that came to rely on it; adding one breaks nothing, which is the asymmetry that makes stating the absence now the cheap move and stating it later the expensive one.

## Context

### Three different orders

The word carries three meanings here, and conflating them is most of the confusion.

**Emission order** is the order in which one execution's business code produced the events it returned. It exists inside that one return.

**Delivery order** is the order in which events arrive at whatever they are addressed to. It spans participants.

**Causal order** is which event caused which. [ADR-001](./001-arvoevent-structure.md) settles it: it comes from the `parentid` chain, and from nothing else — not from comparing identifiers, which that ADR forbids, and not from `time`, which it makes descriptive rather than authoritative.

Only the third is a fact about the model. The first two are facts about a mechanism, and a different mechanism has different ones.

### Why neither of the first two can be promised

Events returned together are addressed to different participants, each of which handles them independently. A mechanism that published them in a fixed order would still not have delivered them in that order: the deliveries are separate, they may be retried separately, and [ADR-006](./006-arvoeventhandler-protocol.md) obligation 5 serializes writes to one record while saying nothing about any relationship across records. So emission order survives exactly as far as the return statement and no further, and a guarantee about it would be a guarantee about nothing observable.

Delivery order is worse than merely unobservable: promising it would require every mechanism to serialize work that is independent. The cost falls on the deployments that need it least — a wide fan-out becomes a queue — and the promise is unkeepable the moment two participants run on two mechanisms, which is the arrangement the model exists to permit.

### What already assumed this

The decision is, in effect, already load-bearing in three accepted ADRs.

[ADR-000](./000-arvo-system-identity-and-architectural-principles.md) requires applications to be designed for environments producing "duplicate, delayed, reordered, replayed, concurrent, or undelivered events", and requires "no single delivery guarantee from every adapter". [ADR-001](./001-arvoevent-structure.md) forbids inferring order from an identifier and forbids establishing it from `time`. [ADR-009](./009-execution-bounds.md)'s collection is built so that an executor "never has to reason about how many responses have arrived, in what order, or whether it has seen this one before".

Those three have been relying on an unordered world without a record saying so. All this ADR does is write it down — and writing it down is what [ADR-000](./000-arvo-system-identity-and-architectural-principles.md)'s own governance asks, a deferred decision being something to settle deliberately rather than by accumulated practice.

## Decision

### Events are unordered

The protocol assumes an unordered world. It guarantees neither emission order nor delivery order, between any two events, at any scope — within one return, within one workflow, to one destination, or anywhere else.

A participant MUST NOT depend on either. In particular it MUST NOT infer order from an identifier, from `time`, from the position of an event within a return, or from the position of an entry in anything a record carries.

### Ordering is a mechanism's to provide

A mechanism MAY provide ordering, at whatever scope and by whatever means it chooses, and remains conformant either way. A mechanism that provides none is equally conformant; neither choice is the better one, and the model takes no view.

This permission is deliberately broad. A mechanism built on a substrate that orders for free should not have to discard the property, and one that would have to serialize independent work to obtain it should not have to.

### A participant may not require what a mechanism may provide

A handler MUST NOT require ordering, including where the mechanism it is currently running under provides it.

This half is not a formality, and it is the half the permission above would otherwise undo. A participant that quietly comes to depend on its mechanism's ordering stops being portable while continuing to work, and nothing reports it: the dependency is invisible until the participant is moved, at which point it is also load-bearing. Since [ADR-004](./004-multi-language-implementation-governance.md) judges conformance on observable behaviour, such a participant is non-conformant from the moment it takes the dependency, whether or not anything has yet failed.

### What a record says about order

A record carries which events an execution has touched and in which direction. It does not state the order in which they were touched: `event_ids` is a list of what happened, not a sequence of when, and [ADR-007](./007-execution-record.md) promises nothing about position.

An implementation whose list happens to be in the order things occurred has not thereby made that an interface. Nothing may read order out of it.

### Causal order is unaffected

Everything above concerns temporal order. Causal order — which event caused which — is a fact about the events themselves, is carried by `parentid`, and is unaffected by any of this. An application needing to reconstruct what led to what reads the chain, which is exactly the use [ADR-001](./001-arvoevent-structure.md) provides it for.

## Consequences

### Gained

A deferral closed in three ADRs at once, and an assumption three of them already depend on made explicit.

A mechanism author knows what is required of them: nothing. Ordering becomes a feature a mechanism may offer rather than a bar it must clear, which keeps the floor low enough that a mechanism as plain as a loop and a table is conformant.

A participant author knows what they may rely on, before the knowledge arrives as a portability failure. The prohibition is stated where it can be read, rather than discovered when a participant is moved.

And the absence is stated while it is still cheap. A guarantee can be added later without breaking anything; one that participants have silently come to rely on can never be removed.

### Paid for

An application that genuinely needs ordering gets no help from the model. It must obtain it from its own data — a value its participants agree on and carry — or from a mechanism it has chosen for that property and accepts it is now tied to. The model offers no middle path, and will not.

A participant author must resist a real temptation: a mechanism that orders makes code written against that order work, and nothing fails until the move. The rule exists precisely because the failure mode is delayed, which also means the rule is unenforceable by anything but review.

Nothing in the model can detect a violation. There is no field whose misuse marks it, because this ADR declines to add one — so a participant depending on order is caught by reading it, or by moving it.

## Considered Alternatives

### Guaranteeing emission order

Rejected as a guarantee about nothing. The order survives to the end of the return statement; the deliveries that follow are independent, separately retried, and governed by no relationship this model defines. Promising it would oblige every mechanism to preserve something no participant could observe.

### Guaranteeing order per destination

Narrower, and still rejected. It reads as modest — only events to the same place, in the order they were produced — and it obliges every mechanism to serialize per destination and to keep doing so across retries and across participants that may be running somewhere else entirely. The cost is unbounded and the beneficiaries are few, and a mechanism able to offer it cheaply may do so under **Ordering is a mechanism's to provide** without any participant being allowed to assume it.

### An ordinal on each emitted event

Rejected for what it would become. A field exists to be read, and a field expressing position would be read as a guarantee however carefully its description hedged — then depended on, then load-bearing. [ADR-001](./001-arvoevent-structure.md) already took this position for `id` and `time`, declining to let a descriptive value become an ordering one; a field whose entire purpose is position could not be hedged even that far.

### Forbidding a mechanism from ordering at all

Rejected as overreach. Nothing in the model is harmed by a mechanism whose substrate orders for free, and forbidding it would make a conformant mechanism discard a property its users value for no benefit to anybody. What must be constrained is the participant, which **A participant may not require what a mechanism may provide** does.

### Leaving it deferred

Rejected because the deferral is no longer idle. Three ADRs assume an unordered world, implementations have been built on that assumption, and a mechanism is already in use whose events come back in an order its own storage chose. The decision is being made either way; leaving it unwritten only means it is made by accumulated practice, which is the one way [ADR-000](./000-arvo-system-identity-and-architectural-principles.md) says a deferred decision must not be settled.

## Conformance to ADR-000

### Effect on AAM

None. No member of the model gains, loses, or changes a field. This ADR states a property the model already had.

### Invariants depended on

Portability — a participant composes with others regardless of what any of them runs under. The prohibition on a participant requiring ordering is that invariant applied: a participant that requires it is portable only by coincidence.

Mechanism independence — the model specifies how participants compose, not how anything executes them. Ordering is therefore a mechanism's to decide, and the model's to say nothing about.

### Invariants strained

None directly. What is strained is the model's capacity to detect a violation: a participant depending on ordering is conformant to every check an implementation can make, and non-conformant in fact. This ADR adds a rule nothing can enforce, which is honest about the cost rather than a reason to avoid stating the rule.

### Required of infrastructure adapters

Nothing new. An adapter already must not depend on `time` or on any ordering of `id` values ([ADR-001](./001-arvoevent-structure.md)); it is now also explicit that an adapter is under no obligation to preserve the order in which events were produced, and that one which does preserve it confers no guarantee on anything downstream.

### Left deferred

Concurrent event handling, paired with ordering in both ADR-000's and ADR-006's deferral lists. How many deliveries may be in flight, and what two of them may do to one another, is untouched here. ADR-006 obligation 5 and ADR-009's collection remain the whole of what is settled about it.
