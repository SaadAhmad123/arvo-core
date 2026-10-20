## Context

See `proposal.md` — Why. What shapes the approach:

- **ADR-016 is accepted and exact.** Two parts per layer, a fixed order, one context, the before part fails like the executor, the after part only observes, one run clock over all three, middleware data written once per key, one new fault kind. Nothing here is a design choice about *what*; every decision below is about *where in the existing code* each rule lands.
- **The version already has one seat.** `ArvoEventHandlerVersion#enterExecutor` runs `this.#executor(ctx)` under the run clock and reports `returned` / `raised` / `outran`. Everything the ADR says about layers happens inside that seat, so the change to the execute path is confined to it.
- **The context already has the pair to mirror.** `state` / `setState`: a private field, a getter, a write member that validates and faults through `ctx.fault`. `middleware` / `setMiddleware` is the same shape with no schema and no persistence.
- **The two spellings for nothing already meet in one place.** `ArvoEventHandler#dispatch` turns an omitted `dependencies` or `hooks` into `null`; `middleware` joins them there, and the version never sees `undefined`.
- **The fault vocabulary is a union plus a set.** `ArvoFaultKind` is a string union; `ARVO_RETRY_SAFE_FAULT_KINDS` names the retryable ones and everything else is non-retryable by omission. `middleware_conflict` is one line in the first and nothing in the second.
- **The sandbox is not authoritative.** It is used here as a proving ground — layers under three mechanisms with failures injected — and anything it finds comes back as a package test, never as a rule on its own.

## Goals / Non-Goals

**Goals**

- Every rule of ADR-016 enforced in exactly one place, and that place named here.
- No change to how an execution without layers behaves — same stages, same marks, same timings, same outputs.
- A layer author's mistakes caught where the ADR says: duplicate declared identifiers at build, duplicate supplied identifiers and repeated keys at execution, both as faults the mechanism already knows how to read.
- The chain runnable with nothing supplied and nothing declared at zero cost on the hot path.

**Non-Goals**

- Anything that runs several handlers or supplies layers from outside the handler — a later change.
- A narrower context type for layers. ADR-016 rejects it as a protocol rule; this change does not add it as a convenience either, because `build` on a layer is harmless and a second context type is a second thing to keep in step.
- Typing middleware data by what layers declare. ADR-016 rejects it; the read member is `Record<string, unknown>` and the executor narrows.
- A per-version declaration site. Deferred by the ADR.

## Decisions

### The chain runs inside `#enterExecutor`, under the clock it already has

`#enterExecutor` becomes: run every before part in order; run the executor; where it returned, run every after part in reverse; report `returned` / `raised` / `outran` as today. All of it inside the `running` promise the run clock races against, so the clock covers all three parts with no second timer.

*Where expiry lands decides what it means.* The clock settles `outran` for the race; what the version does with `outran` depends on a flag the chain sets when the executor returns: before that flag, `outran` is `run_timeout` as today; after it, the executor's return is already in hand, so the version proceeds with it, marks the overrun on the span, and skips the remaining after parts. One flag rather than two clocks.

*Both clocks read at the executor's return.* `#refuseOnClocks` runs on `returned` today after `#enterExecutor` resolves. It moves to read a timestamp the chain captures the moment the executor returns, so time in after parts is invisible to the execution-timeout check.

*Alternative: a separate budget for after parts.* Rejected by the ADR — one number an author sizes, not a new row in the options table.

### Running the chain is one small internal module

`version/middleware.ts`: a function that takes the ordered layers, the context, and the executor, and produces the `ArvoExecutorRun` the version already understands, plus the span marks. It is where the before-fails-stop, after-fails-continue, and after-only-on-return rules live, and nowhere else. One concern per file, and `version/index.ts` grows by one call rather than by forty lines.

*Why not a class implementing the middleware interface itself.* Considered — a composite layer whose before runs the befores and whose after runs the afters. It fits the interface neatly and it is one more type to keep in step with the public one; the ADR calls how the chain runs an implementation detail, so a function the version calls is enough.

### Normalization once, at the handler, as for dependencies and hooks

`setupArvoEventHandler` takes `middleware?: readonly IArvoEventHandlerMiddleware[]` — `?: T`, never `| null`, per `project.md` — *Optional inputs*. `ArvoEventHandler` normalizes to `readonly middleware: readonly IArvoEventHandlerMiddleware[] | null`, `null` where undefined or empty, and hands that to every `ArvoEventHandlerVersion`. The execute param takes the same optional, and `#dispatch` normalizes it beside `dependencies` and `hooks`. Below the handler there is one spelling for nothing.

*Why `null` for an empty list too.* An empty list and an omitted one mean the same thing — no layers — and two spellings for one meaning is what the rule exists to prevent. The version then has one branch: `null` → run the executor alone.

### Factories are invoked in the version, before anything else about layers

An entry is a layer or a zero-argument operation returning one. The version resolves every entry — declared and supplied — into instances at the start of its layer work, in one place, and faults `middleware_instantiation_failed` through `#faultFor` where an operation throws or returns a value without a string `id`. Only then does the identifier check run, over instances. Declared factories are not invoked at build: a factory per execution is the point, and invoking it once at build would produce an instance that then serves every execution, which is the other form.

*Why not resolve in `#dispatch`.* Same reason as the duplicate check: `#dispatch` has nothing to build a fault against.

### Duplicate identifiers: one check at build, one at execution

Declared duplicates among *instances* are checked in `ArvoEventHandler`'s constructor alongside the other declaration rules, reporting an `ErrorIssue` per duplicate under `middleware[<index>].id`; a declared factory contributes no id at build and is checked at execution with everything else, so a declaration breaking several rules still reports them all (`project.md` — *Validation*). Supplied duplicates — against each other and against the declared set — are checked in the version before the first before part runs, as a `middleware_conflict` fault built through the version's own `#faultFor`, so it carries the abandonment pair like any fault raised after the gate.

*Why the version and not `#dispatch`.* `#dispatch` has no record and no telemetry scope to build a fault against; the version does, and it is already where every post-gate fault is built.

### `setMiddleware` mirrors `setState` without the schema

A private `#middleware: Record<string, unknown>`, a getter returning a frozen copy, and `async setMiddleware(key, value)` that faults `middleware_conflict` through `this.fault(...)` where the key exists. Asynchronous because `fault` is — the abandonment pair is serialized as the fault is built — which is the same reason `setState` is.

*A frozen copy on read, not a live reference.* The ADR says the read member is not a way to write. Returning the private object would let `ctx.middleware.x = y` succeed silently; a frozen copy makes it throw in strict mode and makes the data readable while the write path stays the only write path. The copy is shallow — what a layer stores is its own, and the protocol does not deep-freeze a value it does not understand.

### Both new kinds are non-retryable by omission

`middleware_conflict` and `middleware_instantiation_failed` are added to `ArvoFaultKind` and not to `ARVO_RETRY_SAFE_FAULT_KINDS`. That is the whole of the verdict table change, and it is how every non-retryable kind is already expressed.

### Span marks, not spans

`ARVO_EXECUTION_STAGES` gains the marks the ADR asks for, recorded through `markStage` on the delivery span with the layer's identifier as an attribute: a layer's before part entered and returned, its after part entered and returned, an after part that failed, and an after chain cut by the clock. `markExecutorRan` continues to measure the executor alone, so executor time and layer time stay apart. No `tracer.startSpan` anywhere in the chain.

### The after part's view of the return is frozen

The executor's return — an event, an array, or nothing — is frozen before any after part sees it: `Object.freeze` on an array, and events are already immutable. That is the ADR's "cannot alter" made true rather than asked for.

### Everything the executor could do, a before part can

No new surface is built for a before part. It receives the same `ctx` the executor does, so `setState`, `setMiddleware`, `cancel`, `fault`, `build` all work as they do today, and a thrown value takes exactly the path a thrown value from the executor takes — `#enterExecutor` reports `raised`, and the version's existing branches handle it.

### The record is the one the executor returned with

After parts run on the same context the executor was given, so an after part calling `setState` or `cancel` would — left alone — change the record the version then produces. ADR-016 is explicit that nothing after the executor returned may undo what it concluded. The version therefore wraps the executor it hands the chain, captures `ctx.state` the moment it returns, and uses that record for return validation, the silent-cancel check, and `#produce`. Where the context's state has moved on by the time the after parts finish, `middleware_after_write_discarded` is marked on the span. Found by the adversarial suite (task 6.2) and closed test-first.

### A caller no compiler saw

`null` for `middleware` reads as none at both sites, matching how the package treats a `null` from an untyped caller elsewhere (`project.md` — *Optional inputs*). Something that is not a list is kept as given by the setup and refused at build with an issue at `middleware`; supplied per execution, it is `middleware_instantiation_failed`. A supplied entry that is an object but not a layer is also `middleware_instantiation_failed`: of the two kinds, it is the one that means "no layer could be had from this entry".

## Risks / Trade-offs

- **[A before part that throws looks, in the fault, exactly like the executor throwing]** → intended by the ADR; the span marks name which layer was entered last, so a reader of the trace can tell.
- **[After parts under the run clock share the executor's budget]** → stated in the ADR's consequences; the TSDoc on `middleware` at both sites says so.
- **[A layer holding per-delivery state on itself]** → cannot be enforced; the TSDoc on `IArvoEventHandlerMiddleware` states the rule and points at `setMiddleware`.
- **[`Record<string, unknown>` on `ctx.middleware`]** → the ADR's chosen cost; the TSDoc says to narrow what is read.
- **[The frozen copy on every read of `ctx.middleware`]** → a copy per read is cheap at the sizes involved; a cached frozen snapshot invalidated on write is the fallback if it ever shows up in a profile.

## Open Questions

None. Every question this change raised was settled in ADR-016.
