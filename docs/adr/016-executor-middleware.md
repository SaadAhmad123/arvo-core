# ADR-016: Executor Middleware

- **Status:** Accepted
- **Date:** 2026-10-20
- **Scope:** Arvo ecosystem
- **Amends:** [ADR-006](./006-arvoeventhandler-protocol.md), **One executor per version** — a version's business code MAY be surrounded by layers; **The execution context** — adds two members, **middleware data** and **set middleware data**, the pair *state* and *set state* already form; and **What the mechanism calls** and **Required of infrastructure adapters**, each by one additive sentence. [ADR-008](./008-execution-faults-and-abandonment.md), **The `fault_kind` vocabulary and retry verdicts** — adds one kind, `middleware_conflict`. [ADR-009](./009-execution-bounds.md), **The run clock: what it covers, and what it does not** — one additive paragraph on the layers it covers and what its expiry means in each. Everything is additive: nothing already there is replaced
- **Depends on:** [ADR-006](./006-arvoeventhandler-protocol.md), which defines the executor, the execution context and the validation of what the executor returns; [ADR-008](./008-execution-faults-and-abandonment.md), which defines the two ways an executor fails; [ADR-009](./009-execution-bounds.md), which defines the run clock; [ADR-010](./010-delivery-classification-and-entry-validation.md), which fixes where in a delivery the executor is entered; [ADR-011](./011-dependency-lifetime.md) and [ADR-012](./012-absent-dependencies-and-hooks.md), which draw the line this ADR declines to cross
- **Addresses:** nothing ADR-000 deferred. It refines what ADR-006 means by *the executor*
- **Left deferred:** a per-version declaration site; a layer observing a failed execution. See **Left deferred**

Conformance language is as defined in [ADR-000](./000-arvo-system-identity-and-architectural-principles.md).

## Scope

### What this ADR defines

That a version's business code MAY be surrounded by **layers**, each with a part that runs before the business code and a part that runs after it; where layers are declared; the order they run in; what a layer receives, what it may and may not do, and how each part fails; what bounds a layer; the one place a layer may leave something for the code inside it; and that nothing of the kind exists outside the handler.

### What this ADR deliberately does not define

- **API shape.** Whether a layer is an object, a record, or something else; what its two parts and its identifier are called; how layers are listed; how an implementation runs them. Each language's own choice (ADR-004).
- **Any middleware around the handler or inside a mechanism.** Decided against rather than deferred — see **Nothing of the kind exists outside the handler**.
- **A per-version declaration site.** Deferred; see **Left deferred**.
- **What a layer is for.** Authentication, enrichment, measurement, a feature flag: all are the author's business, exactly as an executor's are.

### How this ADR changes

Once accepted, this ADR changes only by a superseding ADR. It is not amended in place.

## Context

### One seat, fully bounded

ADR-006 defines exactly one place where business code runs: the executor, entered as the last act of a delivery's gate ([ADR-010](./010-delivery-classification-and-entry-validation.md), **One delivery, in order**, step 6), given one object — the execution context — and nothing else, bounded by the run clock ([ADR-009](./009-execution-bounds.md), **Timeouts**), and judged on what it returns ([ADR-006](./006-arvoeventhandler-protocol.md), **What an executor returns**). Everything an executor can do, the protocol already allows for; everything it returns, the protocol already checks; every way it can fail, [ADR-008](./008-execution-faults-and-abandonment.md) already names.

### Concerns that belong to every executor and to none

Some of what an executor does belongs to no particular version: reading a flag before deciding whether to run at all, recording how long the work took, refusing on behalf of a tenant, resolving something every version needs. Written today, each is copied into every executor that needs it, and copied again when it changes. What is wanted is a way to write such a thing once and place it in the executor's seat for several versions, or for every handler a mechanism runs.

### Why the seat is the only place it can go

The obvious alternative is to place it *around* the handler — before the gate, or after the return — where a mechanism already stands. ADR-006 and ADR-011 have already said what such a thing is permitted to do. A mechanism hook "MUST be read-only, or it MUST permit only stable mutation" and "MUST NOT be exposed" where it "could change what this delivery concludes" ([ADR-006](./006-arvoeventhandler-protocol.md), **Mechanism hooks**). A dependency supplier "can change what the trace says and nothing else" ([ADR-011](./011-dependency-lifetime.md), **Both operations receive the delivery's telemetry**). The reason is the same in both: outside the gate and the return validation, a change to the event, the record or the outcome is a change nothing checks.

Inside the executor's seat the opposite holds. A layer there sees only the context and acts only through the context's own members, and whatever the business code returns passes through the same validation it always did. Placing the capability here costs the protocol no new rule; placing it anywhere else would require either a new rule or a capability too weak to be worth having.

### Why this is a model-level decision

ADR-006 says "one executor per version" and builds the context, the clock, the failure categories and the return validation around that one thing. Saying that business code may be surrounded by layers changes what runs in that seat, and it must change identically for every language, or a handler declared with layers in one language would mean something different when its records are read by another (ADR-004). That is the boundary ADR-004 draws between an ADR and OpenSpec: "a design decision that is really a new model-level behavioral commitment … belongs in an ADR". This is one.

## Decision

### A layer has two parts and a name

**A version's business code MAY be surrounded by zero or more layers.** Each layer has an **identifier**, and two optional parts: a **before** part, which runs before the business code, and an **after** part, which runs after it has returned. A layer MAY have either part or both.

The identifier names the layer wherever the protocol refers to it — on the span, in a fault's message — and it MUST be unique among the layers of one execution (**Where layers are declared**).

A version with no layers is unchanged. Its executor is its business code, as before.

### Where layers are declared

Layers are declared at two sites, and only these two.

**On the handler**, as part of its definition, before any execution begins — alongside the contracts it implements and may send to ([ADR-006](./006-arvoeventhandler-protocol.md), **Definition and declaration**). Layers declared here apply to every version the handler declares, so a concern that belongs to the handler is written once rather than once per version. Two declared layers sharing an identifier are a declaration error, and the handler MUST be rejected at declaration time, as for any other defect in its definition.

**Per execution**, supplied by whatever runs the handler, alongside the dependencies, the attempt number and the hooks it already supplies ([ADR-006](./006-arvoeventhandler-protocol.md), **What the mechanism calls**). Layers supplied here apply to that execution only. This is how a mechanism, or anything running several handlers, places a concern in the seat of every executor it runs without any handler declaring it. A supplied layer whose identifier matches another layer's, declared or supplied, cannot be refused at declaration — the handler never saw it — so it is refused at execution: a non-retryable execution fault, `middleware_conflict`, raised before any layer runs.

Supplying layers is optional at both sites. Where neither supplies any, the business code runs alone. Layers are no part of the record: nothing about them is written, and two handlers that differ only in their layers are the same handler to the protocol, exactly as two that differ only in their dependencies are ([ADR-006](./006-arvoeventhandler-protocol.md), **Outside the model, supplied per delivery**).

### The order is fixed

**Before parts run in this order: layers supplied per execution, in the order supplied; then layers declared on the handler, in the order declared; then the business code. After parts run in the reverse order.** An implementation MUST run them so and MUST NOT offer another order.

The party furthest from the business code is outermost: a mechanism's concern surrounds the handler's, and the handler's surrounds its own business code. The order is fixed rather than left to each implementation because a layer's effect depends on what runs inside it: a handler declared with layers in one language MUST behave as it would in another.

### What a layer receives

**A layer receives the execution context — the same object the business code receives, and nothing more** ([ADR-006](./006-arvoeventhandler-protocol.md), **The execution context**). There is no second context and no narrower one. A layer MUST NOT be given anything ADR-006 withholds from an executor — the record as a writable whole, the mechanism, the store, any means to alter the outcome of the gate ([ADR-006](./006-arvoeventhandler-protocol.md), **What the context does not expose**). The boundary of the executor's seat is the boundary of a layer's.

The after part additionally receives **what the business code returned**, as a value a layer can read and not change.

### The before part

The before part MAY do what an executor may do: read the delivered event and the collected responses; write business state through the context's write member, so that the business code finds what the layer left; write middleware data (**Middleware data**); mark the execution cancelled; raise a fault through the context; or fail. It returns nothing.

**Where a before part fails, everything stops.** No further before part runs, the business code does not run, and no after part runs. What was raised decides the outcome, exactly as it would had the business code raised it ([ADR-008](./008-execution-faults-and-abandonment.md), **Failure protocol**): a fault built through the context is an execution fault, `executor_raised`, with the retry verdict the layer chose, and nothing is emitted or written; anything else is the work failing, and the handler produces the handler error event for the caller and rests the record at `error`. A before part is in the executor's seat, and its failure is the executor's failure.

### The after part

The after part runs **only where the business code returned**. Where the business code raised, or outran the run clock, no after part runs: the failure is already the protocol's to report — a fault with its kind on the span, or the handler error event to the caller — and a layer has nothing to add to it.

The after part MAY read the returned value and record about it, through the context's telemetry or anywhere else it reaches. It returns nothing, and **it MUST NOT be able to alter what the business code returned**: the value it receives is immutable, and nothing the after part does or returns reaches the emission.

**Where an after part fails, the outcome is unchanged.** The business code has returned and what it returned stands. The failure — a fault built through the context, or anything else — MUST be recorded on the delivery span and discarded; it MUST NOT become an execution fault, MUST NOT become the handler error event, and MUST NOT reach the mechanism. The remaining after parts run as if it had not failed. This is the rule ADR-011 already applies to a release that fails ([ADR-011](./011-dependency-lifetime.md), **Release**): once an outcome is decided, nothing that happens afterwards may undo it.

### The business code is the only author of what an execution emits

**Nothing a layer builds or returns reaches the emission.** Neither part of a layer returns a value the protocol reads, so an event a layer constructs — through the context's builder or by hand — goes nowhere. The one thing the handler validates and emits is what the business code returned.

ADR-006's "one executor per version" means the version's code decides what to emit, and a layer that could answer in its place could complete the caller's request while the version never had its say — the same reasoning by which ADR-008 forbids an executor to construct the handler error event. A layer influences what the business code sees; it never speaks for it. A cross-cutting *decision* — a cache already holding the answer, a tenant that must be refused — therefore travels inward as middleware data, and the business code acts on it and emits.

### Middleware data: what a layer leaves for the code inside it

**The execution context carries two further members, in the shape *state* and *set state* already have: middleware data, read; and set middleware data, write.** Middleware data is an object built fresh for every delivery. A layer's before part writes to it through the write member; every layer inside it, and the business code, read it through the read member. It is how a layer hands something inward — a resolved tenant, a decoded credential, an answer already in hand — without touching the delivered event, the record, or anything the builder derives addressing from.

**Set middleware data follows set state in everything but persistence.** It is a member of the context and the only way to write; the context judges the write and raises a fault where it is misused, as set state does; the written value is readable through the read member from that moment. What it does not do is reach the record: set state writes the execution's memory under the version's schema, set middleware data writes what this delivery alone will see.

Four rules, and only these:

- **Built per delivery, held by nothing.** It exists for one entry into the executor and is discarded with the context ([ADR-006](./006-arvoeventhandler-protocol.md), **One object, built per delivery**). Nothing in it is written to the record, validated by the protocol, or read by anything but the layers and the business code.
- **Open in shape.** What a layer writes, and under which keys, is the layer's own. The protocol fixes no schema here and an implementation MUST NOT require one: a layer is open-ended on purpose, and a shape it had to declare in advance would narrow the thing this member exists to carry. How an implementation types it is API shape (ADR-004).
- **Written once per key.** Set middleware data takes one key and one value. A key the member already holds is a defect — two layers were written to the same name — and the write MUST raise an execution fault, `middleware_conflict`, non-retryable. The same two layers collide on every attempt, so a retry changes nothing; and a silent replacement would be read as the wrong value by whatever ran inside, with no error anywhere.
- **Readable by everything inside, through the read member only.** The read member is not a way to write, and nothing outside the layers and the business code reads it.

### A layer holds nothing of its own per delivery

One layer serves every delivery of the handler it is declared on, and may serve several at once. **A layer MUST NOT keep anything about a delivery on itself**: what its before part learns and its after part needs travels through middleware data, and nothing else. This is the same property ADR-006 requires of the handler and the context, and the same one ADR-011 requires of a dependency object: a handle to a lifetime, not the lifetime.

### What bounds a layer

**One run clock covers the before parts, the business code and the after parts** ([ADR-009](./009-execution-bounds.md), **The run clock: what it covers, and what it does not**). What its expiry means depends on where it fires. **During a before part or the business code**, nothing has been concluded, and it is `run_timeout`, retryable, as today. **During an after part**, the business code has already returned and its return stands: the remaining after parts are not run, the overrun is recorded on the delivery span and discarded, and the delivery proceeds as if the after parts had finished. An after part is bounded — it has whatever remains of the attempt's time and no more — and it cannot turn a result into a fault, because a fault says nothing was concluded and here something was.

Both clocks are read at the moment the business code returns, so the execution-timeout check at return ([ADR-009](./009-execution-bounds.md), **How the execution clock is enforced**) measures to that moment and no later; a slow after part changes neither verdict.

**After parts run before return validation.** They see what the business code returned, as returned; whether it is then accepted is decided afterwards ([ADR-006](./006-arvoeventhandler-protocol.md), **What an executor returns**), and nothing an after part did changes that decision.

**Entering a layer is entering the executor.** Where ADR-009's collection rule says the executor is not entered — a followup under the default join whose collection is incomplete — no layer is entered either. Layers run when business code would have run and at no other time.

### `middleware_conflict`

One fault kind is added to ADR-008's vocabulary, non-retryable, raised in two situations: a supplied layer whose identifier another layer in the same execution already carries, and a middleware-data key written a second time. Both are defects in how the execution was assembled, reproduced exactly by any redelivery, which is the verdict ADR-008 gives every fault of that nature. One kind for two conditions follows ADR-008's own precedent — `record_invalid` is raised at two gate steps — and the fault's `message` says which condition and names the identifier or key.

### Nothing of the kind exists outside the handler

**The protocol defines no middleware around the handler and no middleware inside a mechanism**, and this is a decision rather than an omission.

A layer placed outside the gate and the return validation would have one of two shapes. It could be permitted to change the event, the record or the outcome, in which case it would change what the protocol then fails to check — the condition ADR-006 forbids a hook from having and ADR-011 forbids a supplier from having. Or it could be held to observing and recording, in which case it would be a second observability surface beside the one ADR-006 already mandates, offering nothing the delivery span and the protocol-level metrics do not.

The capability exists exactly once, in the executor's seat, where the protocol already holds it to account. A mechanism that wants a concern placed there supplies a layer per execution. A mechanism that wants to see a delivery reads the telemetry it is already required to be given.

### Observability

**An implementation SHOULD NOT open a span per layer.** A delivery is one span ([ADR-006](./006-arvoeventhandler-protocol.md), **Instrumenting the protocol itself**), and the stages inside it are marked as events on that span rather than as children of it — a layer is one more stage, not one more span. A span per layer would multiply the spans a delivery produces by the number of layers, for a thing that is part of the executor rather than a step beside it.

What an implementation SHOULD do instead, with the means ADR-006 already uses: mark the span as each part of each layer is entered and returned, by the layer's identifier, so a reader can see where the time went; and record a metric for time spent in the business code as distinct from time spent in the layers, so slow layers and slow business code are two different charts, as ADR-006 already separates executor time from protocol time.

Nothing else about observability changes. A layer records through the context's telemetry member, as the executor does ([ADR-006](./006-arvoeventhandler-protocol.md), **The executor's access to observability**), and may add its own events and attributes to the delivery span.

**A layer's author MAY open a span inside the layer**, as an executor's author may, and the consequences are then theirs: the span is ended on every path out of the layer, it is parented under the delivery span rather than beside it, and the trace context the execution's events carry is left as the handler set it — a replaced `traceparent` is already among ADR-006's unsafe fields for the reason that it fragments the workflow's trace at the point a suspension makes it hardest to reconstruct ([ADR-006](./006-arvoeventhandler-protocol.md), **What an executor may set: safe, unsafe, required**). The protocol does not open the span, and it does not close it: a layer that opens one owns it.

## Consequences

### Gained

- A concern that belongs to several versions, or to every handler a mechanism runs, is written once and placed in the executor's seat, rather than copied into each executor and maintained in each.
- The capability costs the protocol no new constraint on what runs. A before part has an executor's powers and an executor's failures because it occupies an executor's position; every rule that governs it was already written.
- What an execution emits is always the version's own decision. Every event in a record traces to the business code of the version that owns it, however many layers surround it, and nothing has to check this because no layer has a path to the emission.
- One place for such a thing, rather than one inside the handler and another around it with different powers and different rules.
- A handler declared with layers means the same thing in every language, because the order and the semantics are fixed here rather than chosen per implementation.

### Paid for

- **A before part can still change what an execution concludes**, by changing what the business code sees. It may alter state before the business code reads it, and what it leaves in middleware data may decide which branch the business code takes. The rule removes a layer's authorship of outputs, not its influence over them, and an implementation MUST document at the surface where layers are supplied that this is what placing one means.
- **No early answer from a layer.** A cache that already holds the result, a tenant that must be refused: a layer cannot answer for the version. It leaves what it knows in middleware data, and every version that wants the shortcut writes the branch. The cross-cutting decision stays cross-cutting; the cross-cutting answer is the version's own code.
- **No post-processing of the emission.** A layer cannot add to, redact, or re-address what the business code returned. Granting that later is additive; it is not granted now.
- **An after part that fails is heard by nobody but the trace.** That is the rule's intent — an outcome already decided is not undone — and it means a layer that *must* record something and cannot has no way to say so except on the span.
- **Middleware data is untyped by the protocol.** What a layer left is whatever it left, and the code inside checks what it reads. That is the price of a channel open enough for any layer to use, and it is paid where ADR-012 says such prices belong: by the party that knows what absence or the wrong shape means.
- **One more fault kind**, carried by every language for two defects most deployments will never see. Accepted because the alternatives are a silent overwrite and a silent duplicate.
- **Layer time is executor time.** One clock covers the before parts, the business code and the after parts, so a run clock sized for business code alone will fire on business code that is still fast if the before parts are slow, and will cut short an after part that the business code left little time for. An author sizes the clock for all three.

## Considered Alternatives

### Middleware around the handler, observe-only

Considered first, and rejected. Held to the constraint ADR-006 and ADR-011 already place on anything outside the gate — change the trace and nothing else — it can observe a delivery and record what it saw, and nothing more. ADR-006 already mandates a delivery span, stage marks and protocol-level metrics, so an observe-only layer around the handler adds a second surface for information the first already carries. The genuinely useful form — one that can act on what the business code sees — is available only inside the seat.

### Middleware around the handler, permitted to act

Rejected outright. Anything that alters the event before the gate, or the outcome after return validation, alters what the protocol then does not check. This is exactly the condition ADR-006 names when it forbids a hook that "could change what this delivery concludes", and the reason ADR-011 limits a supplier to the trace.

### A single part that wraps the business code

Considered at length: one part receives the context and a continuation, invokes the continuation to run what is inside it, and returns what it yielded. It holds a scope open across the business code, which two parts cannot. Rejected because, once a layer may not author or alter the emission, the continuation's only remaining power is that scope, while its hazards — invoked twice, never invoked, something else returned — each need a runtime check and a fault to close. Two parts have none of those hazards and need no check, and a layer holds nothing per delivery, so there is nothing for a scope to hold. The timer a wrap would have kept in a closure goes through middleware data instead.

### Letting a layer author or alter the emission

Considered, and this is where the first draft stood: a layer could return events of its own, replace what the business code returned, or decline to run it and answer in its place. It is the more powerful shape, and it makes a cache hit or a refusal expressible without the version knowing. Rejected because it makes a layer a second author of what the version emits, so that an event in a record could trace to code that is not the version's own, and because its most convenient form — answering without running the business code — leaves no trace of the business code not having run. The reasoning is ADR-008's for the handler error event: a thing that can answer for the version can answer while the version never ran. Granting any part of this later is additive.

### Running the after part on a failed execution

Considered: an after part that runs however the business code ended, receiving what happened. Rejected for now. The failures are already reported — a fault on the span with its kind, the handler error event to the caller — and the one real argument for it, finishing something a before part started, has no object: a resource with an open and a close is a dependency, which ADR-011 already closes on every path, and a layer holds nothing of its own. Adding such a part later is additive; see **Left deferred**.

### Separate parts for error, fault and finally

Considered alongside the previous. Rejected because none of them could do anything the others could not — nothing in a layer may change an outcome — so three parts would be one part with three filters, and three orders to define. Should observing a failure ever be wanted, one part receiving the outcome is the shape; see **Left deferred**.

### Letting a later layer overwrite an earlier one's middleware data

Considered. Simpler, and no fault kind to add. Rejected because the mistake it permits — two layers choosing the same key — is correct until the day it is not, and then the business code reads the wrong value with nothing to say so. A fault on the first run is cheaper than a wrong answer months later.

### Requiring a layer to declare the shape of what it writes

Considered, and rejected as a protocol rule. A layer is open-ended on purpose, and layers supplied per execution cannot be known when the business code is written, so a declared shape would be at best a partial truth. An implementation MAY offer typing as a convenience; the protocol asks for none.

### A narrower context for a layer

Considered: a view of the execution context without the builder, so a layer could not construct an event at all. Rejected as a protocol rule because it is unnecessary — nothing a layer builds reaches the emission, so withholding the builder prevents nothing — and because a second context type is a second thing to keep in step with the first. An implementation MAY narrow what a layer sees as a convenience to its authors; the protocol gives a layer the one context and relies on the one fact that matters.

### A per-version declaration site

Considered. A layer that belongs to one version and not its neighbours is a real case. It is also expressible today by placing the concern in that version's business code, and adding a third site now would add a third position in the order before any version has asked for one. Deferred, not rejected.

## Conformance to ADR-000

### Effect on AAM

None to the membership list. This ADR refines "handler interfaces and lifecycle semantics", which ADR-006 places inside the model, by stating what may surround the business code in the executor's seat. It adds two members to the execution context and one kind to the fault vocabulary, all additively, as ADR-014 added one member before it.

### Invariants depended on

- **Explicit Contracts and Runtime Validation.** What the business code returns is validated at runtime as before; nothing about a layer is trusted because of where it was declared, and no layer has a path to the emission that could bypass the check.
- **Nondeterminism Is Permitted.** A layer may decide differently on two deliveries, as an executor may; the protocol asks nothing about why.
- **Infrastructure Independence.** Layers are declared by the handler or supplied per execution; the model names no mechanism and needs none to have them.

### Invariants strained

None. The capability is placed where the protocol already bounds everything that happens, and adds no power that was not already an executor's.

### Required of infrastructure adapters

Nothing new. A mechanism MAY supply layers per execution, alongside dependencies and hooks, and MUST NOT be required to supply any. A mechanism that supplies none is conformant.

### Left deferred

- **A per-version declaration site.** Where a layer should apply to one version only. It would take the position between the handler's layers and the business code.
- **A layer observing a failed execution.** The after part runs only where the business code returned. Should a case arise that needs a layer told how an execution failed, the addition SHOULD be one part receiving the outcome whole — returned, raised, or outran — rather than separate parts per kind of failure, and it SHOULD keep the rule that nothing a layer does after the business code has ended may change what was concluded. Adding it is additive to this ADR.

## Appendix: An illustrative surface

These sketches are illustrative only. They define nothing and are not a specification of any language's API — per ADR-004, API shape is each language's own choice. They exist to show the rules above together, in a notation belonging to no language, as the appendix to [ADR-006](./006-arvoeventhandler-protocol.md) does for the handler. Where prose and a sketch ever appear to disagree, the prose governs.

### Declaring layers on a handler

```
handler
    self        com_order_create
    services    payments    com_payment_charge @ 1.0.0

    middleware                                      optional; applies to every version below;
                                                    before parts run in this order, inside anything
                                                    supplied per execution; after parts in reverse
        require_tenant                              a layer: an identifier, a before part, an after part
        measure_duration                            another

    version 1.0.0
        execute(ctx) → ...                          the business code; the only author of the emission
```

### Supplying layers per execution

```
execute(
    event
    state
    attempt
    dependencies    optional
    hooks           optional
    middleware      optional; outermost, in the order given;
                      how a mechanism, or anything running several handlers,
                      places a concern in every executor it runs;
                      an identifier already in use → middleware_conflict
)
```

### The order, for one delivery

```
before   supplied[0]  →  supplied[1]  →  declared[0]  →  declared[1]
                                                                      →  execute(ctx)
after    supplied[0]  ←  supplied[1]  ←  declared[0]  ←  declared[1]  ←  (only if it returned)
```

### A layer

```
require_tenant
    id      "require_tenant"

    before(ctx):
        tenant = ctx.dependencies.directory.lookup(ctx.event.subject)

        if tenant is absent
            throw ctx.fault(                        a fault: the delivery cannot proceed; everything
                kind      executor_raised             stops — no more before parts, no business code,
                message   "no tenant for this subject" no after parts; the mechanism decides about a retry
                retryable false
            )

        ctx.setMiddleware("tenant", tenant)         written once; a second write of "tenant" anywhere
                                                    in the chain is the fault middleware_conflict
                                                    — the business code decides what a suspended
                                                    tenant means; this layer does not answer for it

measure_duration
    id      "measure_duration"

    before(ctx):
        ctx.setMiddleware("started_at", now())      per-delivery, so it lives in middleware data,
                                                    never on the layer itself

    after(ctx, emission):                           runs only where the business code returned
        ctx.telemetry.meter.record("order.duration", now() - ctx.middleware.started_at)
        ctx.telemetry.span.addEvent("emitted", { count: length of emission })
                                                    may read the emission; may record about it;
                                                    returns nothing; cannot change it.
                                                    if this part fails, the failure is recorded on
                                                    the span and discarded; the emission stands
```

### Inside the business code

```
execute(ctx):

    tenant = ctx.middleware.tenant                  what the layers left for this delivery;
                                                    read-only; built fresh each time; never on the record

    if tenant is absent                             a layer may not have run — supplied layers are the
        throw ctx.fault(...)                          mechanism's — and this is the executor's to judge

    if tenant is suspended
        return ctx.build(type com_order_refused, data { ... })
                                                    the shortcut the layer could not take: the version
                                                    emits it, and owns it

    ctx.setState({ ... })                           the execution's memory, under the schema — a
                                                    different thing from middleware data

    return ctx.build(type com_order_created, data { ... })
```

### What a layer cannot do

```
    before returns an event                         goes nowhere: a layer returns nothing the protocol reads
    after alters the emission                       cannot: the value is immutable; nothing after reaches it
    ctx.middleware.tenant = other                   refused: the read member is not a way to write
    keep per-delivery state on the layer            refused: the layer serves many deliveries at once
    reach the record, the store, the mechanism      not on the context, so not reachable
```
