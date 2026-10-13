# ADR-011: Dependency Lifetime

- **Status:** Accepted
- **Date:** 2026-10-13
- **Scope:** Arvo ecosystem
- **Supersedes, in part:** [ADR-006](./006-arvoeventhandler-protocol.md), **Dependencies** — **The two forms: a value or a factory** is replaced in full; **Why the factory form matters for resumability**, the three rules that follow it, **A failing factory is a retry-safe fault**, and the `dependencies` line of **What the mechanism calls** are replaced by this ADR's **Decision**. Everything else in ADR-006 stands
- **Depends on:** [ADR-006](./006-arvoeventhandler-protocol.md), which defines the handler, the execution context a dependency is placed on, and the gate step acquisition is; [ADR-008](./008-execution-faults-and-abandonment.md), which defines the fault a failed acquisition raises; [ADR-010](./010-delivery-classification-and-entry-validation.md), which defines the gate and the telemetry both operations receive
- **Addresses:** nothing ADR-000 deferred. It closes a gap in ADR-006 rather than settling a deferral
- **Left deferred:** nothing. Mechanism hooks are decided here, in the negative — see **Mechanism hooks are deliberately unchanged**

Conformance language is as defined in [ADR-000](./000-arvo-system-identity-and-architectural-principles.md).

## Scope

### What this ADR defines

This ADR defines how an executor's implementation dependencies are supplied, acquired, read and released: that they arrive as one object rather than as a value or a factory, when the handler acquires and releases it, what each operation is given, what happens when either fails, and what the supplier of such an object owes in return.

It replaces ADR-006's **The two forms: a value or a factory** and the sections that elaborate it. It leaves the rest of ADR-006 untouched, including that dependencies are supplied per delivery by the mechanism, that they are no part of a handler's declaration, that they are never written into the record, and that what an executor finds on the context is each language's own choice (ADR-004).

### What this ADR deliberately does not define

- **What a dependency is.** A database client, a clock, a secret: all outside the model, as ADR-006 says.
- **The names of the operations, or the shape of the readable surface.** API shape is each language's own (ADR-004). This ADR fixes the three capabilities and their semantics, not their spelling.
- **Mechanism hooks.** Deliberately left as ADR-006 defines them. The reasoning is under **Mechanism hooks are deliberately unchanged**, so the asymmetry is a decision on record rather than an omission.
- **Any pooling, caching or sharing strategy.** A supplier may do as it likes, subject to the one rule under **What may be retained, and what may not**.

### How this ADR changes

Once accepted, this ADR changes only by a superseding ADR. It is not amended in place.

## Context

### What ADR-006 claimed, and did not deliver

ADR-006 opens its **Dependencies** section by naming the one constraint ADR-000 places on an implementation dependency — "no live implementation dependency may be relied upon to survive one", a suspension — and says: "This ADR settles how they reach an executor so that the constraint holds by construction rather than by discipline."

It does not hold by construction. A factory opens a pooled connection and nothing in the protocol ever closes it. Every mechanism must wrap its own call to the handler in whatever its language calls a `finally`, and must itself remember what the factory took in order to give it back. A rule each mechanism separately remembers is discipline, which is the thing the sentence claimed to be replacing.

The factory was not wrong. Its reasoning is correct and this ADR keeps all of it: acquisition per delivery, as the last gate step, given the validated record or absence and the attempt number, so that nothing live is constructed until a delivery needs it. What was wrong is that the section said how a dependency comes to exist and never said how it stops.

### What the two forms cost

The value form existed for a dependency "safe to share across deliveries and hold no per-execution state — a configuration object, a pure client". A pure client is exactly the thing that turns out to hold a socket. The form invited the mistake, and because a value has no release point, the protocol had nowhere to correct it.

Two forms also meant the handler had to ask which one it was given before it could do anything with it, and a release obligation could only ever apply to one of them.

## Decision

### One form

**A dependency is supplied as one object that can be acquired, read, and released.** An implementation MUST accept that form and MUST NOT accept a bare value or a bare factory.

```
dependencies    optional; where absent, nothing is acquired or released,
                  and the context member is present and empty

    one object      exposing
                      acquire   taking the delivered event,
                                       the execution record or absence,
                                       the execution identifier,
                                       the attempt number,
                                       and the delivery's telemetry
                      release   taking the same
                      a readable surface, which is what the executor is given
                    both operations may be asynchronous where a language
                      distinguishes it
```

**One object, not a set of them.** A handler needing several resources is given one dependency that holds them, and how they relate — which opens first, which pool they share — is that object's own business. This removes a decision rather than imposing one: with a set, the protocol would have to say what happens when the second of three acquisitions fails while the first is already held, and it has no basis for saying. With one object there is nothing to unwind that the supplier cannot unwind itself, in the order its own resources require.

**Member names and the readable surface are each language's own** (ADR-004), as is whether an executor is handed that surface or the object carrying it. ADR-006's **Outside the model, supplied per delivery** already leaves what an executor finds on **dependencies** to each language, and this ADR does not narrow it.

### Both operations receive the delivery's telemetry

For the reason the state function does ([ADR-010](./010-delivery-classification-and-entry-validation.md), **Resolving the existing execution**): acquiring a connection is work that takes time, and time nothing accounts for reads as the handler's. A supplier MAY record its own span, metric or log against the delivery, so a pool that takes four seconds to answer is visible as that rather than as an unexplained gap inside the delivery span.

What it may not do is change what the execution concluded. This is the same latitude a mechanism hook has, and the same limit: a supplier can change what the trace says and nothing else. A supplier that marked the delivery span failed on an execution that succeeded would mislead every reader of that trace, and an implementation SHOULD document at this surface that the span belongs to the delivery rather than to the supplier.

### Acquire

Unchanged from the factory in position and in consequence. The handler acquires **exactly once per delivery**, as the last step of the gate — step 16 under [ADR-010](./010-delivery-classification-and-entry-validation.md), **Entry validation** — after every other check has passed and before the executor is entered. It receives a record the handler has already validated, or absence on an init, and never a structure not yet established to be a record.

**A failure to acquire is an execution fault, `dependency_resolution_failed`, and it is retry safe.** However the language signals it, the handler MUST NOT catch and reinterpret it: it surfaces as a fault with the failure rendered into `cause`, nothing is emitted or written, and the executor is not entered. It is retry safe because acquiring reaches outside the handler — a pool that is exhausted now, a service that is restarting — and what is outside may answer differently a moment later. Like every retry-safe fault it is subject to exhaustion, and on a followup it carries the abandonment pair ([ADR-008](./008-execution-faults-and-abandonment.md)).

**Reading the surface is part of acquiring.** A supplier whose surface is computed may fail at that point rather than at acquisition — a connection taken and then found closed. That failure is the same fault, for the same reason: the dependency did not become usable, and the executor is not entered. An implementation MUST read the surface inside the same guarded region as the acquisition, so that a failing read is a fault rather than an error escaping the handler.

Acquisition is not under the run clock ([ADR-009](./009-execution-bounds.md), **Timeouts**): the run clock bounds the executor's code, and an acquisition that hangs is diagnosed as a dependency failure rather than as a stuck executor. An implementation MAY bound acquisition on its own account, and where it does, expiry is this same fault.

### Release

**The handler MUST release the dependency after the execution ends, on every path out.** Not only where the executor returned: a refusal at return validation, a record that would not serialize, an expired run clock, an expired execution clock, a cancellation, an executor that raised, and a fault raised by any of them all end an execution, and each one MUST release. This is the obligation that makes ADR-000's rule hold by construction, because there is now exactly one place a dependency's life ends and it is inside the protocol.

**Release MUST also run where the surface could not be read**, the acquisition having already succeeded by then. A dependency that took something and then failed to hand it over still took something.

Release runs after the protocol's outputs are decided and before the delivery returns to the mechanism. Nothing released may be needed to produce the record or the events, so a dependency is never let go of while something still needs it.

**A failure to release MUST NOT fail the execution.** It is recorded on the delivery span and discarded, as a telemetry failure is (ADR-006, **Telemetry**). By the time release runs the execution has concluded and its record and events are decided; turning a concluded execution into a fault because a socket would not close would make a mechanism retry business logic over a cleanup problem, and would make a successful execution's outcome depend on something that happened after it finished. An implementation MUST NOT surface a release failure as an execution fault, and SHOULD record it where a reader of the trace can see it.

Release is not under the run clock either. An implementation MAY bound it, and where it does, expiry is recorded and discarded like any other release failure rather than raised.

### Both operations are idempotent, and that is the supplier's obligation

**Acquire and release MUST each be safe to call more than once, and release MUST be safe to call on something never acquired.** This is required of the supplied object, not provided by the handler: the handler keeps no record of what it has already called and MUST NOT be expected to.

The obligation is placed there deliberately. A handler tracking acquisition state would be holding something about a dependency across the steps of a delivery, and would then have to decide what that state means when a retry arrives, when acquisition fails part way, or when one object is supplied to two deliveries at once. The supplier already knows what its own resources require. An object whose acquire is not idempotent is non-conformant, and its failures will present as the handler's.

### What may be retained, and what may not

ADR-006's rule that **a resolved dependency MUST NOT be retained by the handler across deliveries** is unchanged and unaffected: the handler holds nothing between deliveries, dependencies included. So is its rule that a resolved dependency MUST NOT be written into the execution record.

What this ADR adds is the supplier's side, which ADR-006 did not address. **A mechanism MAY retain the dependency object across deliveries** — constructing one per worker rather than one per delivery is the ordinary case, and is part of why acquire and release must be idempotent. What MUST NOT survive a delivery is anything live the object holds, and release is the whole of how that is guaranteed. The object is a handle to a lifetime, not the lifetime.

### Mechanism hooks are deliberately unchanged

Hooks keep the shape ADR-006 gives them. They are not given a lifetime, and the asymmetry is a decision rather than an oversight.

A dependency's acquisition needs the **record**, which is why it cannot happen before the handler has read and validated one, and therefore why the handler must be the one to do it. A hook needs nothing from inside the execution — it is what one mechanism chooses to expose, and it is available before the delivery begins. The mechanism is the caller; it already surrounds the delivery and can acquire and release anything of its own without the protocol's help.

That gives the line between the two, stated here so it need not be re-derived: **a thing that needs the event, the record or the attempt is a dependency; a thing that needs none of them is a hook.** A hook that turns out to need a lifetime is a dependency declared in the wrong place, and the correction is to move it rather than to grow a second lifetime mechanism.

## Consequences

### Gained

- ADR-000's rule that no live dependency survives a suspension holds by construction. There is one place a dependency's life ends, it is inside the protocol, and no mechanism can forget it.
- A mechanism loses the `finally` it used to need and the bookkeeping of what its factory took.
- One form means the handler never asks which form it was given, and a release obligation applies to every dependency rather than to the one form that could carry it.
- A dependency that holds something can say so in the one place that knows: itself.

### Paid for

- **Breaking for every implementation.** One that accepted a bare value or a bare factory is non-conformant until it accepts the one object instead. This is the cost of the obligation and there is no compatible path to it: a value has no release point, which is the whole problem.
- A dependency that genuinely holds nothing — a configuration object, a set of constants — is now supplied as an object whose acquire and release do nothing. That is ceremony, and it is accepted: one path through the handler is worth more than the keystrokes.
- Idempotency becomes a conformance rule with nothing checking it. A supplier that gets it wrong fails in a way that reads as the handler's fault, and an implementation can only document the obligation, not enforce it.

### Unchanged

Nothing observable about a conformant execution: the same events, the same record, the same faults, the same retry verdicts. What changes is that a dependency is now certain to be released, where before it was likely to be.

## Considered Alternatives

### Keeping the two forms and adding a release hook beside them

Considered first, and rejected. A release supplied as a second argument beside the dependency makes the handler the party keeping count — it must know whether it acquired before it may release, and must decide what that means across a retry. It also leaves the value form with no release point, so the obligation would apply to some dependencies and not others, which is the gap this ADR exists to close.

### A release member on the dependency value itself

Rejected. The value is what the executor reads, and a release member on it is reachable by the executor — the one party that must never call it. Hiding it behind a reserved name is a convention, not a guarantee, and in a language with open record types it is not even that.

### A set of dependencies, each with its own lifetime

Rejected for the reason under **One form**: the protocol would have to decide what happens when one acquisition of several fails while others are held, and it has no basis for deciding. The supplier does.

### The host language's own resource-management construct

Considered where one exists — an explicit disposal protocol, a scoped resource block. Rejected as a model-level answer: it would put the lifetime back on the readable surface, and it would state the model's obligation in terms of a feature not every language implementing the AAM has. ADR-004 lets an implementation express this ADR's three capabilities through such a construct if its language has one; what it may not do is make the obligation conditional on having it.

## Conformance to ADR-000

### Effect on AAM

None. The AAM membership list is unchanged. This ADR constrains how an implementation supplies something ADR-006 already places outside the model.

### Invariants depended on

- **No live implementation dependency may be relied upon to survive a suspension.** This ADR is the mechanism by which that holds rather than being hoped for.
- **A handler must not require a continuously running process while awaiting events.** Release is what makes the gap between deliveries genuinely empty.

### Invariants strained

None. The obligation narrows what an implementation may accept and adds no capability a node must have.

### Required of infrastructure adapters

An adapter MUST supply dependencies as one object with the three capabilities above, MUST make both operations idempotent, and MUST NOT rely on the handler to track what it has acquired. It MAY retain the object across deliveries and MUST NOT let anything live it holds survive one.

### Left deferred

Nothing.
