# ADR-018: Trace Context Across Layers

- **Status:** Accepted
- **Date:** 2026-10-22
- **Scope:** Arvo ecosystem
- **Amends:** [ADR-006](./006-arvoeventhandler-protocol.md), **Continuing the trace** — one additive paragraph: the event a handler continues the trace of may be a copy a layer has handed it, whose trace context points at that layer's span. Additive: nothing already there is replaced
- **Depends on:** [ADR-000](./000-arvo-system-identity-and-architectural-principles.md), whose *Observability by Default* places trace context inside the model and lets adapters add telemetry "provided it does not change the model"; [ADR-001](./001-arvoevent-structure.md), which places `traceparent` and `tracestate` on every event; [ADR-006](./006-arvoeventhandler-protocol.md), which fixes how a handler continues a trace, what its emitted events carry, and that OpenTelemetry is the observability surface
- **Addresses, in part:** [ADR-000](./000-arvo-system-identity-and-architectural-principles.md) Deferred Decisions — "Observability fields and propagation", the propagation of trace context through the parties that carry an event to a handler
- **Left deferred:** span names, attribute names and metrics for any layer above the handler; everything else in "Observability fields and propagation". See **Left deferred**

Conformance language is as defined in [ADR-000](./000-arvo-system-identity-and-architectural-principles.md).

## Scope

### What this ADR defines

How trace context flows through the parties that carry an event to a handler — whatever stands between the two, however many there are — so that the work each does on an event appears in the event's trace, nested in the order the work happened, and so that the trace of one workflow has the same shape whichever of those parties carried it. What such a party may change about an event in passing, and what it must leave alone. What it records on its own span. And what the protocol does, and does not, offer for controlling how much telemetry is produced.

### What this ADR deliberately does not define

- **API shape.** How a party makes the copy it hands on, what its span is called, which attributes it carries. Each language's own choice ([ADR-004](./004-multi-language-implementation-governance.md)), as ADR-006 already says of attribute names.
- **What any such party measures.** Its span's name, its metrics, what it marks on its span. Each party's own record is the place: the ADR that defines the party says what it records, citing this one for how its span joins the trace.
- **Collection, retention and export.** Infrastructure responsibilities under ADR-000, unchanged.
- **The handler's own instrumentation.** ADR-006, **Instrumenting the protocol itself**, unchanged.

### How this ADR changes

Once accepted, this ADR changes only by a superseding ADR. It is not amended in place.

## Context

### What ADR-006 settled, and for whom

ADR-006 settles trace context for the handler. A handler "MUST continue an existing trace rather than begin a new one wherever it can", taking its trace context "from the delivered event's `traceparent` and `tracestate`"; every event it emits carries "the execution's own trace context"; each delivery produces one span; and OpenTelemetry is the surface, with "the API's no-op behaviour, at no cost" where no SDK is configured ([ADR-006](./006-arvoeventhandler-protocol.md), **Observability**).

That makes the trace of a workflow a chain through its events: each handler's span descends from the span that emitted the event it received. It says nothing about anyone else. When ADR-006 was written, the handler was the only party the protocol defined.

### Parties now stand between an event and its handler

The handler is no longer the only party the protocol defines. ADR-006 itself names the mechanism that carries events between deliveries and supplies "a delivery's OpenTelemetry context so that the handler's span continues the delivered event's trace"; ADR-017 defines a party that gathers handlers and enters one of them; more will follow. Each does work on an event before the handler sees it, and that work — waiting, choosing, committing, retrying — is where time goes outside the handler and where a reader most needs to look.

Each such party can open a span of its own and continue the event's trace. Left unstated, three things go wrong. Each party's span hangs off the event's trace as a sibling of the handler's, so the trace no longer shows which work contained which. Each implementation chooses differently, so the same workflow carried by two parties, or in two languages, produces traces of two shapes that cannot be read side by side. And a party that tries to nest the handler under itself has no rule for how, or for what else it may touch while doing it.

This ADR states the rule once, for every such party, present and future. Which parties record, and what each records, is each party's own ADR's to say.

### Why this is a model-level decision

Trace context is inside the model: ADR-000 lists "causation, lineage, and trace context" among AAM membership, and ADR-006 opens its observability section with "Trace context is inside the model". What a party carrying an event may do to that event's trace context, and what shape the resulting trace takes, must be the same for every party and every language, or a trace is only readable by someone who knows which implementation produced it. That is the boundary ADR-004 draws for an ADR.

## Decision

### A layer

**A layer is any party that does work on an event and then hands it to another party that does work on it**, whatever the two parties are. The handler is the innermost party and hands the event to no one; ADR-006 governs it, and this ADR adds nothing to how it continues a trace.

### One span per event, continuing the event's trace

**A layer that records telemetry about its work on an event MUST open exactly one span for each attempt at that work, continuing the event's trace**: a child of the context the event's `traceparent` and `tracestate` name where a `traceparent` is present, and the root of a new trace only where none is. This is ADR-006's rule for a handler, applied to every layer. A layer that tries the same event again, whether by redelivery or within itself, opens a new span for the new attempt; one span never covers two.

A layer MAY record nothing, and open no span. A layer that does not is conformant, and passes the event on unchanged, as **What a layer hands on** requires of a span that is not recording.

### What a layer hands on

**A layer whose span is recording MUST hand the next party a copy of the event whose `traceparent` and `tracestate` name that span, and that is identical to the event in every other field.** The next party, continuing the copy's trace, opens its span inside the layer's. The handler, innermost, continues the trace of the copy it was handed, exactly as ADR-006 requires.

**A layer MUST NOT change any other field in passing.** Identity, addressing, causality, payload, baggage, time: each is what deduplication, the gate and the record depend on, and none is a layer's to touch. Trace context is the one exception, because the next party reads it for one purpose only — to know which span to continue — and nothing in the protocol reads it for anything else ([ADR-010](./010-delivery-classification-and-entry-validation.md), **One delivery, in order**, checks no trace field).

**A layer whose span is not recording MUST hand the event on unchanged.** A span is not recording where no OpenTelemetry SDK is configured, or where the sampler has decided to drop it; either way nothing will ever be seen of it, and an event pointed at it would name a span that does not exist for any reader. Handing the event on as it is keeps whatever trace context it already carries, so the next party continues the same trace the layer would have, and a layer that records nothing costs the trace nothing. Whether a span is recording is one question the OpenTelemetry API answers directly, and it is the only test this rule asks an implementation to make.

### The event itself is never changed

**The event as a layer received it is never altered.** The copy is what is handed inward; the event a layer holds, stores, publishes or redelivers is the one it had. A redelivered event therefore carries its original trace context, and each attempt appears in the trace as another span under the same parent.

The record's `triggering_event`, which ADR-006 says "carries [the trace] if a reader needs it later", is the copy the handler received, and so names the innermost layer's span. That is the span the delivery's work descends from, which is what a reader following the trace needs.

### What a handler emits

**Unchanged.** Every event a handler emits carries the execution's own trace context ([ADR-006](./006-arvoeventhandler-protocol.md), **The complete field defaults**), which is now a context descending from the layers that carried the event in. When an emitted event is carried onward, the next layer's span descends from the handler's, and the chain continues: layer, handler, layer, handler.

**A layer MUST pass on, commit and publish every event an inner party returns exactly as it was returned, trace context included.** The copy a layer hands inward is the only event whose trace context a layer replaces. An event travelling outward was caused by the inner party's work, and its trace context says so; a layer that replaced it with its own span would hang everything the event goes on to cause under the layer instead of under the work that caused it, and the trace would no longer show which step led to which. ADR-006 already requires this of a mechanism for what it commits; it is stated here for every layer.

### What a layer records on its span

**A layer records its own work on its own span, and nothing an inner party records on its own.** A fault a layer raises itself MUST be recorded on that layer's span, as ADR-006 requires a handler to record its faults on its delivery span, because a fault writes no record and the trace may be the only place it is ever seen. A fault an inner party raised and recorded on its own span MUST NOT be recorded again as though the layer had raised it; a layer MAY record what it did about it.

### How much telemetry is produced

**The protocol defines no sampling, filtering or verbosity setting of its own.** How much is kept is governed through OpenTelemetry's own configuration — samplers, views, processors — which ADR-006 already forbids an implementation to require any particular one of. What the protocol owes those controls is only that they can find and act on Arvo's telemetry as one thing:

- **An implementation SHOULD record all of its telemetry under one instrumentation name**, so that everything it produces can be configured, sampled or dropped as one thing without listing every contract or handler it serves.
- **A layer SHOULD open no span beyond the one per attempt this ADR requires.** Stages within a layer's work are marked on its span, as ADR-016 does for middleware layers inside the handler, not opened as spans of their own.

## Consequences

### Gained

- One rule for every party that carries an event, stated once: continue the event's trace, open one span, hand on a copy that continues under it. Every party the protocol defines follows the same sentence, and so will whatever comes next.
- A workflow's trace has one shape whichever parties, or language, carried it, so two traces can be compared and a dashboard survives moving a workflow between implementations.
- The work outside the handler — the time spent waiting, choosing, committing, retrying — is visible in the trace, and nested where it happened.
- A party that raises a fault of its own records it, whatever did or did not enter it.

### Paid for

- **One more span per layer per attempt.** A workflow carried through two layers produces three spans per attempt where a handler alone produced one. Close to free in time; real in exported volume at scale, and governed by whatever sampling the deployment configures.
- **A copy of the event per layer per event.** Small, and the price of never changing the event itself.
- **The record's `triggering_event` names a layer's span, not the emitting handler's.** A reader following the trace from a record arrives one level inside the layer rather than at the handler that emitted the event. The chain is unbroken; it is one step longer.
- **A layer may not "fix" an event in passing**, however convenient. A layer that wants to re-address an event or alter its payload does so as an event of its own, under every rule an emitted event obeys, not as a side effect of carrying one.
- **The one-instrumentation-name rule asks an implementation to change** where it names its telemetry after each contract today. It is a SHOULD, and the change is the implementation's to schedule.

## Considered Alternatives

### Every party continues the event's trace, nobody hands on a copy

Considered first: each layer opens its span as a child of the event's trace context, and passes the event unchanged. No event is copied and the trace still joins up. Rejected because every layer's span and the handler's become siblings under the emitting span, so the trace stops showing which work contained which. The nesting is the information a reader most needs about a layer: how much of its time was the handler's, and how much its own.

### Separate traces, joined by links

Considered: each layer records in a trace of its own, linked to the event's. Keeps the handler chain free of layers entirely. Rejected because sampling is decided per trace, so a layer's trace could be kept while the handler's it carried was dropped, or the reverse — half a picture, at exactly the moment one is needed.

### Handing the next party a span or context as an input

Considered: a layer passes its span to the next party directly, rather than through the event. Rejected because the handler's inputs are fixed by ADR-006, and a party that mirrors the handler's entry has the same inputs and no other; because an in-process context does not survive a queue or a suspension, where the event does; and because ADR-006 already chose the event's trace context as the one thing that carries a trace across every boundary.

### Pointing returned events at the layer's span

Considered: a layer, on the way out, replaces the trace context of the events an inner party returned with its own span, so that whatever those events cause hangs under the layer. Rejected because the events were caused by the inner party's work, not the layer's, and the trace exists to preserve causation (ADR-000, *Observability by Default*). The layer's work is already visible as the span the inner party's span sits under.

### Letting a layer change other fields in passing

Considered, for a layer that wants to stamp something on every event it carries. Rejected because every other field is read by something — deduplication, the gate, the record, the receiver — and a change in passing is a change nothing checks, which is what ADR-006 and ADR-016 decline to allow anywhere around the handler.

### Deciding here which parties record

Considered: naming, in this ADR, which of the parties the protocol defines open a span and which do not. Rejected because it would tie a general rule to the parties that happen to exist today, and would have to change each time one is added. Whether a party records is that party's own ADR's to decide; this ADR says only what a party that records must do.

### An Arvo setting for how much telemetry to produce

Considered: a verbosity level or a sampling rate on a handler, or on any party that carries events to one. Rejected because OpenTelemetry already has the controls, every deployment that cares has configured them, and a second set would disagree with the first. What the protocol owes is that the first set works across a workflow, which **How much telemetry is produced** secures.

## Conformance to ADR-000

### Effect on AAM

None to the membership list. ADR-000 already places "causation, lineage, and trace context" inside the model; this ADR states how trace context passes through the parties that carry an event, which ADR-006 stated only for the handler.

### Invariants depended on

- **Observability by Default.** The trace preserves causation across every party that carries an event, and collection, retention and export remain infrastructure's. A layer adds telemetry without changing the model: the copy it hands on differs only in the one field the model uses for nothing but the trace.
- **Infrastructure Independence.** The rule names no mechanism and no backend, and holds with no SDK configured, where no span records and it reduces to passing events on unchanged.

### Invariants strained

None.

### Required of infrastructure adapters

A mechanism that records telemetry about its work on an event MUST open one span for that work, continuing the event's trace, and MUST hand the party it enters a copy of the event continuing under that span, differing from the event in nothing else, and MUST NOT alter the event it holds. A mechanism that records nothing passes events on unchanged and is conformant. This refines ADR-006's requirement that a mechanism "supply a delivery's OpenTelemetry context so that the handler's span continues the delivered event's trace": the copy is how it is supplied.

### Left deferred

- **What a layer measures, and what its span is called.** Span names, attributes and metrics for any party above the handler. Each party's own ADR is the place.
- **The rest of "Observability fields and propagation".** Propagation of anything other than trace context — correlation fields beyond those ADR-001 already defines, baggage beyond what ADR-001 already fixes — is untouched.

## Appendix: An illustrative trace

These sketches are illustrative only. They define nothing; where prose and a sketch appear to disagree, the prose governs.

### What a layer does with one event

```
layer.handle(event, inputs):

    span = open span                                one span for this attempt at this event;
             continuing event.traceparent,            a child of the context the event names,
                        event.tracestate              or a new trace where it names none

    if span is recording
        inward = copy of event                      every field the event's own — id, subject,
                 with traceparent, tracestate         addressing, causality, data, baggage, time —
                      naming span                     but trace context, which names this span
    else
        inward = event                              no SDK, or sampled out: handed on as it is

    returned = next.handle(inward, inputs)          the next party continues inward's trace,
                                                      so its span opens inside this one

    mark this layer's own stages on span            events on the span, never spans of their own
    if this layer raised a fault of its own
        record it on span                           as ADR-006 has a handler record its own
    end span

    return returned                                 every event returned exactly as returned,
                                                      trace context included — never pointed
                                                      at this layer's span

event                                               never altered: what the layer holds, stores,
                                                      publishes or redelivers is the original
```

### What the innermost party does

```
handler.execute(event, inputs):                     ADR-006, unchanged

    span = open span continuing event's trace       event is whatever the last layer handed in
    ...
    emitted = events built by the executor          each carries span's trace context by default
    return emitted
```

### One workflow, carried through two layers

Two layers, an outer and an inner, stand between each event and its handler. What they are does not matter here.

```
caller pushes  E1                             E1's trace context names C

outer layer takes E1        opens A1 under C      hands on E1' naming A1
inner layer, given E1'      opens B1 under A1     hands on E1'' naming B1
handler X, given E1''       opens X1 under B1     emits E2 naming X1

outer layer takes E2        opens A2 under X1     hands on E2' naming A2
inner layer, given E2'      opens B2 under A2     hands on E2'' naming B2
handler Y, given E2''       opens Y1 under B2     emits E3 naming Y1
```

### The trace that results

```
C   caller
└── A1  outer layer: its work on E1
    └── B1  inner layer: its work on E1
        └── X1  handler X: handled E1
            └── A2  outer layer: its work on E2
                └── B2  inner layer: its work on E2
                    └── Y1  handler Y: handled E2
```

E1, E2 and E3 as the outer layer holds them are never changed; E1', E1'' and the rest are copies differing only in their trace context. A redelivery of E2 starts again from E2 as held, so a second attempt appears as a second `A2` under `X1`.

### Where no span records

With no SDK configured, or where the sampler drops the workflow, no layer's span records, and every layer hands the event on as it is.

```
E1 names a trace C
    outer layer takes E1      span not recording      hands on E1 unchanged
    inner layer, given E1     span not recording      hands on E1 unchanged
    handler X                 continues C, exactly as it would have with no layers

E0 names no trace
    outer layer takes E0      span not recording      hands on E0 unchanged
    inner layer, given E0     span not recording      hands on E0 unchanged
    handler X                 begins a new trace, exactly as it would have with no layers
```
