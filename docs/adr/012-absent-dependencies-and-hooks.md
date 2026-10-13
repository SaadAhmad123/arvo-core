# ADR-012: Absent Dependencies and Hooks

- **Status:** Accepted
- **Date:** 2026-10-13
- **Scope:** Arvo ecosystem
- **Supersedes, in part:** [ADR-006](./006-arvoeventhandler-protocol.md), **The execution context** — the **dependencies** and **mechanism hooks** rows of the context table, and the sentence under **Mechanism hooks** that justifies them. Everything else in ADR-006 stands, as does all of [ADR-011](./011-dependency-lifetime.md)
- **Depends on:** [ADR-006](./006-arvoeventhandler-protocol.md), which defines the execution context and what a hook is; [ADR-011](./011-dependency-lifetime.md), which defines how a dependency is supplied, opened and released
- **Addresses:** nothing ADR-000 deferred
- **Left deferred:** nothing

Conformance language is as defined in [ADR-000](./000-arvo-system-identity-and-architectural-principles.md).

## Scope

### What this ADR defines

What an executor finds on the execution context's **dependencies** and **mechanism hooks** members where a mechanism supplied neither: absence, stated as absence, rather than an empty object standing in for it.

### What this ADR deliberately does not define

- **What a dependency or a hook is**, or how either is supplied, opened or released. ADR-006 and ADR-011 settle those and are unchanged.
- **What an executor should do about absence.** That is the executor's, which is the whole point of this ADR.
- **Whether a mechanism must supply what a version declared.** It must not be obliged to — see **A mechanism cannot be held to a declaration it cannot see**.

### How this ADR changes

Once accepted, this ADR changes only by a superseding ADR. It is not amended in place.

## Context

### What ADR-006 decided, and the reason it gave

ADR-006's context table says of **dependencies** "the executor's own type; empty object where none supplied", and of **mechanism hooks** "object; empty where none supplied … never absent". Under **Mechanism hooks** it gives the reason:

> Where a mechanism supplies no hooks, the member is present and empty, so an executor written against it never has to test for its absence.

The intent is kindness to the executor author: one less thing to check. What it actually produces is a value whose type is a claim nothing checked.

### The empty object is a lie wherever anything was declared

A version declares the shape its executor expects on **dependencies**. Supplying them is optional, so a mechanism may supply none, and the executor is then handed an empty object *typed as the shape it declared*. Every member the declaration promised is absent, and nothing says so. In a language with static types the result reads as present and fails on use; in one without, it reads as present and fails on use.

The sentence ADR-006 gives as the justification is therefore the problem: an executor written against a declared dependency is exactly the party that has to test for its absence, and the empty object is what prevents it from being able to.

### A mechanism cannot be held to a declaration it cannot see

The obvious repair — oblige a mechanism to supply whatever a version declared — is not available, and the reason is worth stating because it is the reason this ADR exists.

A mechanism routes an event to the handler the event addresses. Which handler that is, and therefore what that handler declared, is known when the event arrives and not before. A generic mechanism — the ordinary kind, and the kind ADR-006 is written for — holds a set of handlers and hands one delivery to whichever the event names. It has no site at which the declared shape is known, so an obligation expressed against that shape can only be satisfied by asserting it, which reproduces the same unchecked claim one layer earlier.

So supplying remains optional, and absence remains possible. What changes is that absence is now visible.

## Decision

### Absence is stated, not substituted

**Where a mechanism supplies no dependency, the context's `dependencies` member MUST state absence. Where it supplies no hooks, `mechanism hooks` MUST state absence.** A handler MUST NOT substitute an empty object for either.

How absence is spelled is each language's own (ADR-004) — a null, a none, an empty optional — provided it is distinguishable from a supplied value and an executor cannot read a member off it by mistake.

**An empty value that was supplied remains a supplied value.** A mechanism that deliberately exposes an empty set of hooks has supplied them, and the context says so. This is the distinction the substitution destroyed, and it is now observable.

### An executor decides what absence means

The protocol says nothing about what an executor does with absence, because only the executor knows whether it can proceed without what it asked for. Both of these are conformant:

- an executor that cannot proceed raises a fault, naming what was missing. This is an ordinary executor fault and needs no new vocabulary ([ADR-008](./008-execution-faults-and-abandonment.md)), and it produces a readable failure where the substitution produced a failure on the use of an absent member;
- an executor that can proceed without it does so. A cache it would have read, a metrics sink it would have written to, a hook belonging to a mechanism it is not running under: all legitimately absent, and an executor that degrades rather than failing is doing the right thing.

An implementation MUST NOT decide between these on an executor's behalf, and in particular MUST NOT refuse the delivery because something a version declared was not supplied. The executor is entered and the decision is its.

### What does not change

- Supplying either remains optional. A mechanism obliged to supply what it cannot see is the alternative this ADR rejects.
- A hook's constraint — read-only, or stable mutation only — is unchanged (ADR-006, **Mechanism hooks**).
- Everything ADR-011 says about opening, reading and releasing a dependency is unchanged. Where no dependency was supplied there is nothing to open and nothing to close, which ADR-011 already states.
- Nothing about the record, the events, the gate or the fault vocabulary.

## Consequences

### Gained

- A declared dependency that was not supplied is visible at the one place that can act on it, and the resulting failure names what was missing rather than surfacing as a member read off an empty object.
- An executor that can run without something is able to say so, and to mean it.
- A mechanism that deliberately exposes nothing is distinguishable from one that was never asked.
- No party is obliged to honour a declaration it cannot see.

### Paid for

- **An executor that uses a declared dependency now states its expectation in code.** One guard at the top of the executor, after which a static language narrows the type and the rest of the executor reads as before. That is the cost, and it is charged to the party that knows what absence means.
- **Breaking for executors already written.** One written against the empty object compiles against it no longer, and must say what it expects. This is the intended effect: the ones that break are the ones whose expectation was unchecked.
- A reader of ADR-006's context table must now read two rows against this ADR.

## Considered Alternatives

### Obliging a mechanism to supply whatever a version declared

Rejected, and the rejection is the reason this ADR exists — see **A mechanism cannot be held to a declaration it cannot see**. It is enforceable only where a mechanism is written against one handler, which is the rare case, and elsewhere it is satisfied by an assertion that reproduces the unchecked claim.

### Keeping the empty object and documenting the hazard

Rejected. The hazard is that a type says a member exists when it does not, and documentation does not make a claim true. It also leaves the failure as a read of an absent member, which names nothing useful.

### Refusing the delivery where a declaration was not satisfied

Rejected. It makes the protocol decide something only the executor knows, and it turns a degradable execution into a failed one. An executor that cannot proceed can already fault, which is the same outcome arrived at by the party entitled to choose it.

### Absence only for hooks, keeping the empty object for dependencies

Considered, on the grounds that a hook is more obviously optional. Rejected: the lie is the same lie, and it is worse for dependencies, because a dependency is what a version declared it needs rather than what a mechanism offered.

## Conformance to ADR-000

### Effect on AAM

None. The AAM membership list is unchanged.

### Invariants depended on

None beyond those ADR-006 already depends on.

### Invariants strained

None. This narrows what a handler may present to an executor and adds no capability a node must have.

### Required of infrastructure adapters

Nothing new. Supplying a dependency and supplying hooks remain optional, and a mechanism that supplies neither is conformant.

### Left deferred

Nothing.
