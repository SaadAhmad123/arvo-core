# ADR-017: The Dispatcher

- **Status:** Accepted
- **Date:** 2026-10-22
- **Scope:** Arvo ecosystem
- **Amends:** [ADR-006](./006-arvoeventhandler-protocol.md), **The residual case: two handlers on one contract version** — the set of handlers that sentence calls an *execution context* is given a name and a definition here, and the SHOULD it places on a mechanism becomes a MUST on a dispatcher; one additive sentence. [ADR-008](./008-execution-faults-and-abandonment.md), **The `fault_kind` vocabulary and retry verdicts** — adds one kind, `handler_not_found`; and **`lifecycle_terminal` yields neither** — adds `handler_not_found` to the kinds that carry no abandonment pair. Everything is additive: nothing already there is replaced
- **Depends on:** [ADR-006](./006-arvoeventhandler-protocol.md), which defines the handler this ADR gathers into sets, what a mechanism supplies to it, and what a mechanism owes it; [ADR-008](./008-execution-faults-and-abandonment.md), which defines the fault this ADR adds one kind to; [ADR-010](./010-delivery-classification-and-entry-validation.md), whose gate step 1 is where the one cross-handler defect this ADR checks would otherwise surface; [ADR-011](./011-dependency-lifetime.md) and [ADR-012](./012-absent-dependencies-and-hooks.md), which fix what a dispatcher may and may not do about dependencies; [ADR-016](./016-executor-middleware.md), which already permits "anything running several handlers" to supply layers
- **Addresses:** nothing ADR-000 deferred. It names a thing ADR-006 already relies on without naming
- **Left deferred:** everything a mechanism does between one delivery and the next — where events wait, how they are committed, where each goes, retry, abandonment. See **Left deferred**

Conformance language is as defined in [ADR-000](./000-arvo-system-identity-and-architectural-principles.md).

## Scope

### What this ADR defines

That several handlers MAY be gathered into one **dispatcher**: a set of handlers entered as one, through the handler's own signature. What a dispatcher checks about its set when it is declared, and what it refuses. How it picks the handler for a delivered event. That it returns the handler's response unchanged, and does nothing else: it writes nothing, routes nothing, retries nothing, abandons nothing, and holds nothing between calls. One fault of its own, for an event no handler in the set takes. What a dispatcher can say about a name standing outside its set. And that the layers a dispatcher carries are supplied to every handler in it, as ADR-016 already permits.

### What this ADR deliberately does not define

- **API shape.** Whether a dispatcher is a class, a function or a record; what its one verb and its reads are called; how its handlers are listed; whether a dispatcher may be built from other dispatchers. Each language's own choice ([ADR-004](./004-multi-language-implementation-governance.md)).
- **Anything a mechanism does.** Where events wait, how the record and the events are committed, where a produced event goes, whether to retry, whether to abandon, who may push an event in. ADR-006 places all of this with the mechanism, under **Required of infrastructure adapters**, and this ADR moves none of it. A dispatcher is something a mechanism *uses*, not a mechanism.
- **Infrastructure adapter interfaces.** ADR-000 defers them. A dispatcher is not one and does not stand in for one.
- **The sealed node.** ADR-000 names "a composition of nodes presented behind a single contract". A dispatcher is the opposite: several handlers, each still addressed by its own contract type. Nothing here is hidden behind one contract.
- **An Arvo application.** ADR-000 defers its formal definition. A dispatcher is a set of handlers and is not called an application.

### How this ADR changes

Once accepted, this ADR changes only by a superseding ADR. It is not amended in place.

## Context

### A set ADR-006 relies on and does not name

ADR-006 derives `execution_id` from the init event alone, and notes the one case the derivation cannot separate: two handlers implementing the same contract. It closes that case with a rule on a set — "within one execution context, two handlers MUST NOT implement the same self contract", where an execution context is "the set of handlers among which a mechanism routes events by `to`" — and asks that "a mechanism SHOULD reject it where it can see the full handler set" ([ADR-006](./006-arvoeventhandler-protocol.md), **The residual case: two handlers on one contract version**).

So the model already depends on a set of handlers with a rule over it, and already expects something to see the whole set and reject a defect in it. Nothing has yet said what that thing is, what else it can see, or what it is forbidden to do. Every mechanism written so far has answered privately.

### What depends on the mechanism, and what does not

ADR-006 places everything between one delivery and the next with the mechanism, and lists what it owes under **Required of infrastructure adapters**: committing the record and the events together, answering the state function live, abandoning with the pair as handed, a fresh delivery per retry, one writer per record. Every one of those depends on something only the mechanism has — its store, its queue, its policy — and so each is written once per mechanism, by design.

One step in a delivery depends on none of that. Given a delivered event and a set of handlers, finding the handler whose self contract `type` equals `event.to` and entering it with the inputs ADR-006 says a mechanism supplies needs no store, no queue and no clock. It is the same step under every mechanism, because nothing a mechanism owns enters into it. That is the step this ADR names and fixes, and the line it draws is the one ADR-006 already drew: what depends on the mechanism stays with the mechanism, and what does not is written once.

### One defect only the set can see

A handler checks that its own declaration is self-consistent. It cannot check that another handler's declaration agrees with it. Where handler A declares a service contract that handler B implements, and the two were built against different builds of that contract, every event A sends B will be refused at B's gate, step 1, as `event_unclassifiable` ([ADR-010](./010-delivery-classification-and-entry-validation.md), **One delivery, in order**). Neither handler can know this. The set is the first place it is visible, and the only place it can be refused before an event is sent.

### Why this is a model-level decision

A dispatcher could be left as each language's convenience. It is not, for the reason ADR-004 gives: "a design decision that is really a new model-level behavioral commitment … belongs in an ADR". What a dispatcher refuses at declaration, what it does with a delivered event, and what it is forbidden to do are commitments a set of handlers declared in one language must share with the same set declared in another, or a mechanism moving between them would meet different refusals and different behaviour from the same handlers. And the one fault it raises is a fault, which ADR-008 fixes as a durable format every language reads.

## Decision

### A dispatcher is a set of handlers, entered as one

**Several handlers MAY be gathered into a dispatcher.** A dispatcher is a set of handlers, each implementing its own self contract, together with the layers the set supplies to every handler in it (**Layers of the set**). It is entered as a handler is entered: given a delivered event and the inputs a mechanism supplies to a handler ([ADR-006](./006-arvoeventhandler-protocol.md), **What the mechanism calls**), it returns what a handler returns.

**A dispatcher's entry MUST take exactly what a handler's entry takes, less the layers supplied per execution, and MUST return exactly what a handler's entry returns.** The same inputs, under the same names: the event, the state function, the attempt number, the dependencies and the hooks. The same outcomes, unchanged: the events and the next record, a discard, or a fault. Two inputs widen and nothing else changes: where a handler takes its own one dependency object, a dispatcher takes one such object per handler, keyed by the handler's self contract `type`, and hands each handler its own; where a handler takes its own declared hooks, a dispatcher takes hooks every handler in the set can accept. A mechanism written against a handler is therefore written against a dispatcher, and reads the two alike. Layers are the one input a dispatcher does not take at entry, because its layers are fixed when it is declared (**Layers of the set**).

**A dispatcher holds nothing between calls.** It has no store, no queue, no clock, no memory of any delivery. Everything it knows, it knew when it was declared.

**The handlers are a set.** The same handler reached twice, however it is listed, is a defect, not a duplicate to be merged.

### What a dispatcher refuses at declaration

**A dispatcher MUST be rejected at declaration time where any of the following holds**, naming every rule broken, as a handler is rejected for a defect in its own definition ([ADR-006](./006-arvoeventhandler-protocol.md), **Definition and declaration**):

1. **The set is empty.** There is nothing to enter.
2. **One handler appears twice.** A set, not a list.
3. **Two handlers implement self contracts of the same `type`**, whether or not the contracts share a `uri`. This is ADR-006's residual case made a MUST: a dispatcher is a thing that can see the full handler set, and so it MUST reject what ADR-006 asks a mechanism to reject where it can. The rule is on the `type` and not the contract, because the pick (**One verb: pick the handler, run it, return its response**) is on `to`, which carries the `type` alone; two handlers under one `type` leave the pick with no single answer, whatever their `uri`s.
4. **A handler declares a service contract that another handler in the set implements at a version the implementer does not declare, or under the same `type` with a different `uri`.** Every event the first sends the second would be refused at the second's gate step 1. The set refuses it first.

**A dispatcher MUST NOT refuse the following**, because the ADRs that govern them say not to:

- a service some handler declares that no handler in the set implements. The event may leave by `domain`, or the service may be implemented elsewhere; ADR-006 is silent on this on purpose;
- two handlers whose output types collide across different contracts. ADR-005 leaves that to a deployment's own naming discipline;
- anything about dependencies. ADR-012: a declaration cannot be held against a supplier;
- a handler that declares its own self contract as a service, or any cycle among handlers. ADR-006 permits recursion and bounds it by depth.

### One verb: pick the handler, run it, return its response

**Given a delivered event, a dispatcher picks the handler whose self contract `type` equals `event.to`, enters it with the inputs it was given, and returns that handler's response unchanged.** In order:

1. Find the handler whose self contract `type` is `event.to`. Where none is, the dispatcher raises its own fault, `handler_not_found` (**`handler_not_found`**). An event carrying no `to` ends here too: the handler whose gate would have said `event_unaddressed` is never reached.
2. Take, from the dependencies the caller supplied, the entry for that handler and no other. Where none is, the handler is entered with absence, exactly as ADR-012 requires. The dispatcher opens nothing.
3. Enter the handler with the event, the state function, the attempt number, that handler's dependencies, the hooks, and the set's layers as the layers supplied for this execution ([ADR-016](./016-executor-middleware.md), **Where layers are declared**).
4. Return the handler's response as it is.

**The response is the handler's own, unchanged.** A dispatcher MUST NOT alter, wrap, filter or interpret it. What the handler returned — events and the next record, a discard, or a fault — is what the dispatcher's caller receives, with the handler's own reasons. ADR-006 says of these outcomes that "a caller that cannot tell them apart cannot tell a repeat from a lost execution"; a dispatcher that interpreted them would take that distinction away from the mechanism, which is the party that needs it.

### What a dispatcher does not do

Each of the following is the mechanism's, under ADR-006 **Required of infrastructure adapters**, and **a dispatcher MUST NOT do any of them**:

- **Commit.** It does not write the record or the events anywhere. Obligation 1 is the mechanism's, and a dispatcher has no store to meet it with.
- **Route.** It does not decide where a produced event goes, and it does not look at a produced event's `to`, `domain` or `source` for that purpose. Routing belongs to infrastructure ([ADR-000](./000-arvo-system-identity-and-architectural-principles.md), *ArvoContract* is "not … routing configuration … discovery and routing belong to infrastructure").
- **Retry.** It does not read a fault's retry verdict, re-enter a handler, or put an event anywhere to be tried again. Obligation 4 is the mechanism's.
- **Abandon.** It does not read or act on a fault's abandonment pair. Obligation 3 is the mechanism's, and ADR-008 makes abandonment a policy the mechanism chooses.
- **Interpret a repeat.** It does not treat `record_unexpected` as a signal to stop, nor a discard as anything but a discard. ADR-010 says a mechanism *may* so treat them; "may" is policy, and policy is the mechanism's.
- **Supply anything of its own.** It passes through the state function, the attempt number, the dependencies and the hooks it was given, and adds only its layers.

The rule is deliberately a list of prohibitions rather than a definition of a mechanism. A dispatcher is small so that the things that differ between mechanisms stay with the mechanism, and a mechanism that is wrong about one of them is wrong alone.

### `handler_not_found`

**One fault kind is added to ADR-008's vocabulary: `handler_not_found`, raised where no handler in the set implements a self contract whose `type` is `event.to`. Its retry verdict is no.** The set does not change between attempts, so a redelivery would meet the same refusal.

**It carries neither `abandonment_state` nor `abandonment_event`**, by rule, and joins the kinds ADR-008 lists under **`lifecycle_terminal` yields neither**. No handler was entered, so no execution exists to abandon, no record was ever to be written, and nothing could have addressed an abandonment event in the handler's name. A mechanism meeting this fault has, in ADR-006's words under obligation 3, "nothing to act on; what the mechanism does with the fault is entirely its own".

It is a fault, and not a new kind of error, because a dispatcher is entered where a handler is entered and fails where a handler fails. ADR-008 fixes the fault as the one durable form a failure takes before any record exists, and a dispatcher that refused an event in some other form would be a second failure channel beside it. **A dispatcher MUST NOT raise anything during a call but a fault**: the handler's own, passed through, or this one.

### A name standing outside the set

A mechanism answers whoever sent an event in by addressing the answer to that sender's name: a completion goes `to = init_event_source` ([ADR-006](./006-arvoeventhandler-protocol.md), **Addressing an emitted event**). So the name a sender from outside uses lives in the same namespace as the handlers' own contract types, and some names cannot stand outside a given set without an answer being mistaken for work.

**A dispatcher MUST be able to say whether a name may stand outside its set**, so that whatever holds such a name can ask once, at declaration, rather than discover the collision at the first answer. **A name MUST be refused where:**

| Refused | Because |
|---|---|
| it does not satisfy the contract-declared identifier grammar ([ADR-005](./005-arvocontract-structure.md), **Contract-declared identifier grammar**) | it is used as a key in the same namespace as contract types, and that grammar exists so such keys need no translation |
| it equals the self contract `type` of a handler in the set | an answer addressed to it would be indistinguishable from work for that handler, and would be delivered into the set instead of out of it |
| it equals the `type` of a service contract any handler in the set declares | that handler's requests would be addressed to the outside name, and whoever holds it would receive a request it never made |

Who holds such a name, and what it does with it, is the mechanism's and is not defined here. The check is a dispatcher's because the three rules need the set and the name together, and the set is the dispatcher's.

### Layers of the set

**A dispatcher MAY carry layers, and where it does, it supplies them to every handler it enters as that execution's supplied layers**, in the position ADR-016 fixes for layers "supplied per execution by whatever runs the handler" ([ADR-016](./016-executor-middleware.md), **Where layers are declared**, **The order is fixed**). Nothing about layers is new here: the dispatcher is the "anything running several handlers" that ADR-016 already names as a party that supplies them.

**The layers of a set are fixed when the set is declared.** A dispatcher does not accept layers call by call, and a mechanism that wants a layer of its own in every executor it runs declares the dispatcher with it. The layers a handler runs under are therefore a property of the set it belongs to, not of any one event.

**A dispatcher judges nothing about its layers.** Whether two of them share an identifier, whether a listed operation returns a layer, whether a layer misbehaves: each is already the handler's to refuse under ADR-016 (`middleware_conflict`, `middleware_instantiation_failed`), and a dispatcher that checked them first would hold a second copy of the handler's rule.

### What a dispatcher can be asked

Beside its one verb, a dispatcher answers three questions about its set, each a read and none a write: whether a given `type` is one a handler in the set implements; whether a given name may stand outside the set (**A name standing outside the set**); and the largest run timeout any version in the set declares ([ADR-009](./009-execution-bounds.md), **Timeouts**), so that a mechanism can bound how long it waits on a dispatcher without reading every handler itself. An implementation MAY answer further questions of the same kind, read-only and about the set, and MUST NOT answer any that reach a delivery.

## Consequences

### Gained

- The set ADR-006 already relies on has a name, a definition, and a party that MUST reject the defect ADR-006 could only ask a mechanism to reject where it could.
- A defect no single handler can see — two handlers built against different builds of one contract — is refused at declaration instead of surfacing as a gate fault on the first event between them.
- The piece every mechanism wrote by hand is written once, and the pieces that differ between mechanisms are kept out of it by rule, so that a mistake in one mechanism stays in that mechanism.
- A set of handlers declared in one language refuses what the same set refuses in another, and behaves as it behaves, which is the property ADR-004 exists to secure.
- A mechanism needs one thing from a set of handlers, the handler's own signature, and reads a dispatcher exactly as it reads a handler.

### Paid for

- **A dispatcher cannot help a mechanism with the hard part.** Committing together, redelivering after a lost write, abandoning with the pair as handed: every mechanism still writes these, because each depends on what only that mechanism has. A mistake in one of them is caught by conformance testing of that mechanism, not by a shared implementation. The temptation to move those pieces into the dispatcher later is real, and this ADR's prohibitions exist to make yielding to it a supersession rather than a drift.
- **One more fault kind**, carried by every language, for a defect in how a deployment was wired rather than in any handler. Accepted because the alternative is a refusal in some shape other than a fault, which would be a second failure channel.
- **An event addressed to a service nobody in the set implements is not refused at declaration.** ADR-006 permits that arrangement, so the dispatcher must too, and the mechanism discovers the gap only when it tries to deliver such an event and meets `handler_not_found`. That is the price of leaving open what ADR-006 left open.
- **The outside name's rules live on the dispatcher while the name itself lives elsewhere.** A reader must look in two places to understand one check. Accepted because the alternative, the rules copied into every holder of such a name, is worse.

## Considered Alternatives

### A dispatcher that commits, routes and retries

Considered at length, and in several shapes: a dispatcher handed a store and a caller's name per call, deciding each produced event's destination and committing it with the record; a dispatcher reading a fault's retry verdict and saying "run again"; a dispatcher committing the abandonment pair. Each shape made the dispatcher the one place the protocol's mechanics were written, so that no mechanism could get them wrong.

Rejected, in steps, each for the same reason. Every one of those mechanics depends on something the mechanism owns — its store, its queue, its policy — and ADR-006 places each of them with the mechanism by name. A dispatcher that did them would be a mechanism in all but name, and would need to be handed the mechanism's store to do them. Where a produced event goes is a function of the event, the outside name and the set, and nothing about it needs deciding at commit time; the mechanism decides it when it moves the event. A refused commit needs no fault and no verdict; the mechanism sees it from its own store and redelivers. Whether to abandon is a policy ADR-008 gives the mechanism, and the write is one commit of the pair as handed.

### A dispatcher-level middleware of its own

Considered: layers around the whole dispatcher call, observing the delivery and the response. Rejected because ADR-016 already decided it, under **Nothing of the kind exists outside the handler**, and a second kind of layer beside the handler's would be two mechanisms for one job. A dispatcher carries ADR-016's layers and nothing else.

### Refusing a dependency entry that names no handler

Considered: a key in the supplied dependencies that matches no handler in the set is almost always a mistake, and refusing it would catch the mistake early. Rejected because the handler already treats an unsupplied dependency as absence (ADR-012), because a supplied entry for a handler not in the set is never read and so harms nothing, and because ADR-012 is explicit that a declaration cannot be held against a supplier.

### An error class of the dispatcher's own

Considered: a dispatcher raising its own error for an event no handler takes, distinct from a fault. Rejected because ADR-008 already fixes how a failure before any record is represented, and a second channel would have its own shape, no retry verdict, and nothing written to the delivery span.

### Leaving the set to each language

Considered: no ADR, each language gathering handlers however it likes. Rejected because ADR-006 already places a MUST on the set and asks a party to enforce it, and because what a set refuses and what it is forbidden to do are behaviours a mechanism moving between languages must be able to count on.

## Conformance to ADR-000

### Effect on AAM

None to the membership list. This ADR names a set ADR-006 already relies on, under "handler interfaces and lifecycle semantics", and adds one kind to the fault vocabulary, additively, as ADR-016 added two.

### Invariants depended on

- **Infrastructure Independence.** A dispatcher names no mechanism, holds no store, and is entered through the handler's own signature; any mechanism may use one.
- **Explicit Contracts and Runtime Validation.** Every rule a dispatcher enforces at declaration is a rule over declared contracts; nothing is trusted because of where a handler was listed.
- **Event-Only Communication.** A dispatcher adds no control path. It picks a handler by a field the event already carries and returns what the handler returned.

### Invariants strained

None. A dispatcher is forbidden every act that could strain one.

### Required of infrastructure adapters

Nothing new, and one thing made easier. A mechanism MAY enter a set of handlers through a dispatcher instead of through each handler, and reads it exactly as it reads a handler. Every obligation under ADR-006 **Required of infrastructure adapters** remains the mechanism's, unchanged. A mechanism meeting `handler_not_found` has nothing to act on, as for any fault carrying neither half of the pair.

### Left deferred

- **Everything between one delivery and the next.** Where events wait, how a mechanism commits the record and the events, where each produced event goes, redelivery after a refused commit, retry, abandonment, who may push an event in and under what name. ADR-006 already places these with the mechanism; this ADR confirms they are not the dispatcher's and defines none of them. An ADR on infrastructure adapter interfaces, which ADR-000 defers, would be the place.
- **A set presented behind one contract.** ADR-000's sealed node. A dispatcher is many handlers, each addressable; the sealed node is many behind one, and nothing here reaches it.

## Appendix: An illustrative surface

These sketches are illustrative only. They define nothing and are not a specification of any language's API — per ADR-004, API shape is each language's own choice. Where prose and a sketch ever appear to disagree, the prose governs.

### Declaring a dispatcher

```
dispatcher
    handlers                                        a set; the same handler twice is refused
        order_handler                               self com_order_create
        payment_handler                             self com_payment_charge
        inventory                                   another dispatcher: contributes its handlers
                                                    (a convenience an implementation may offer;
                                                     the result is still one flat set)

    middlewares                                     optional; ADR-016 layers, supplied to every
        require_tenant                              handler here on every call, fixed at declaration;
        () → measure_duration                       not judged here — the handler refuses a defect

refused at declaration, every rule broken named:
    the set is empty
    one handler listed twice
    two handlers with self type com_order_create
    order_handler declares com_payment_charge @ 2.0.0, payment_handler implements only 1.0.0
```

### Entering a dispatcher

```
execute({                                           one object, the handler's own, less `middleware`
    event
    state                                           the mechanism's state function, read only
    attempt
    dependencies    optional; keyed by handler self type; the picked handler
                      gets its own entry or absence (ADR-012); the rest are never read
    hooks           optional; what every handler in the set can accept
})
→   the picked handler's own response, unchanged:
        produced  { record, events }
        discarded { reason }
        fault     the handler's own, or handler_not_found
```

### What a dispatcher does not do, as a mechanism's loop would read

```
response = dispatcher.execute({ event, state: store.read, attempt, dependencies, hooks })

if response is discarded                            the mechanism's: nothing to do
if response is produced                             the mechanism's: commit record + events together (obligation 1);
                                                      refused → put the event back, the gate decides;
                                                      then, per event: to = my outside name → leaves to it;
                                                                       domain set        → leaves by domain;
                                                                       otherwise         → waits here
if response is a fault with a retry verdict         the mechanism's: back to wait, next attempt, after the delay
if response is a fault without one                  the mechanism's policy: abandon with the pair as handed, or not
if response is handler_not_found                    the mechanism's policy: nothing to act on
```

### Asking a dispatcher about its set

```
dispatcher.handles("com_order_create")              → true
dispatcher.validateCallerName("com_acme_api")        → the name, or every rule it breaks
dispatcher.longestRunTimeoutMs                       → the largest run timeout any version declares
```
