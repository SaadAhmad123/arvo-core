## Context

See proposal.md, Why.

Today both classes resolve telemetry once, in the constructor, and keep it:

```
build time                                   every call
──────────                                   ──────────
setupArvoEventHandler({ telemetry? })
  └─ new ArvoEventHandler
       this.telemetry = resolveTelemetry(…)  ─────►  handler.tryExecute(param)
                        ▲                               uses this.telemetry
                        │
       default tracer taken HERE, once.
       If no SDK is registered yet, it can
       stay silent for good.

createArvoDispatcher({ handlers, telemetry? })
  └─ new ArvoDispatcher
       this.telemetry = resolveTelemetry(…)  ─────►  dispatcher.tryExecute(param)
                                                        uses this.telemetry
                                                        handler.tryExecute(…) ← no telemetry passed;
                                                                                the handler uses its own
```

`resolveTelemetry` is already shared by both classes. It returns the given tracer, meter and logger, filling a missing tracer with the default and a missing meter or logger with none.

## Goals / Non-Goals

**Goals:**

- Telemetry is an input to one call and nothing else. No class holds it, publicly or privately.
- The default tracer is taken when a call begins, never when a class is built.
- A handler entered by a dispatcher always records with the dispatcher's telemetry for that call.

**Non-Goals:**

- Anything about what a span records, what it is called, or what is handed on with the event. ADR-018 and the existing specs stand unchanged.
- A cache of resolved telemetry. Resolving is cheap; see Risks.

## Decisions

### The rule, in one table

| Call | Telemetry the call records with | Telemetry the handler is entered with |
|---|---|---|
| `handler.execute({ … })` | `resolveTelemetry(undefined)` at that call | — |
| `handler.execute({ …, telemetry })` | `resolveTelemetry(telemetry)` at that call | — |
| `dispatcher.execute({ … })` | `resolveTelemetry(undefined)` at that call | the same resolved object |
| `dispatcher.execute({ …, telemetry })` | `resolveTelemetry(telemetry)` at that call | the same resolved object |

Three rules follow from it:

1. **Resolved once per call, at its start.** Nothing is resolved at build, and nothing resolved for one call is kept for the next.
2. **A dispatcher always passes telemetry to the handler.** The handler never meets an `undefined` telemetry inside a dispatcher, so it never looks up a default of its own.
3. **A dispatcher passes on what it resolved, not what it was given.** It always passes the tracer it resolved, and a meter or logger only where one was given. Given nothing, the handler is entered with `{ tracer }`: the default the dispatcher took, which the handler uses as given. The meter and logger, absent, resolve to none again inside the handler. Leaving them out keeps the telemetry type free of `null`, as the package's optional-inputs rule requires.

### The flow after this change

```
handler.tryExecute({ event, state, attempt, telemetry? })
  │
  ├─ resolved = resolveTelemetry(param.telemetry)     ← at this call
  ├─ span     = resolved.tracer.startSpan(…)          ← continues the event's trace, as today
  ├─ context telemetry = { span, resolved.meter, resolved.logger }
  ├─ run the execution (unchanged)
  └─ span.end()


dispatcher.tryExecute({ event, state, attempt, dependencies?, hooks?, telemetry? })
  │
  ├─ resolved = resolveTelemetry(param.telemetry)     ← at this call
  ├─ span     = resolved.tracer.startSpan(…)          ← the dispatcher's own span, as today
  ├─ pick the handler by event.to
  │    └─ none → handler_not_found, recorded on this span (unchanged)
  │
  ├─ handler.tryExecute({
  │     event:      the copy naming the dispatcher's span, or the event (unchanged),
  │     state, attempt, dependencies, hooks, middleware   (unchanged),
  │     telemetry:  { tracer, meter?, logger? }       ← always; the parts it resolved
  │  })
  │      │
  │      └─ inside the handler: resolveTelemetry(those parts)
  │           the tracer is present, so no default is taken:
  │           same tracer, same meter, same logger
  │
  └─ span.end()
```

The resulting trace:

```
caller span (from the event's traceparent)
└── arvo.dispatcher.execute        ← on resolved.tracer
    └── com_order_create.execute   ← on resolved.tracer, the same one
```

### `telemetry` on the execute parameter types

`ArvoEventHandlerExecuteParam` gains `telemetry?: ArvoTelemetryParam`. `ArvoDispatcherExecuteParam` gains the same member. ADR-017's rule that a dispatcher takes exactly what a handler takes, less middleware, then still holds as written.

Under the package's optional-inputs rule, absence is said by omitting the member, and the dispatcher always includes it when it enters the handler.

Considered: a separate second argument, `execute(param, { telemetry })`. Rejected because the dispatcher's parameter is defined as the handler's parameter less middleware. Two arguments would split that rule across two shapes for no gain.

### The handler resolves even what a dispatcher already resolved

Inside a dispatcher, the handler still calls `resolveTelemetry` on what it was given. Given a fully resolved object, that call returns the same tracer, meter and logger, so no default is ever taken there.

Considered: a second, internal entry that accepts already-resolved telemetry and skips the call. Rejected because it adds a path only a dispatcher may use, and the handler's public entry would then behave differently depending on who called it. One entry and one resolve call keep the handler's behaviour identical whoever enters it.

### Remove the option and the property; do not deprecate

`ArvoEventHandlerSetupParam.telemetry`, `ArvoDispatcherOptions.telemetry`, and the `telemetry` property on both classes are deleted outright. The package is pre-release on this major, and a deprecated option that still works would keep the very behaviour this change removes: telemetry fixed at build.

At runtime, a declaration that still names `telemetry`, from code no type checker saw, is ignored like any other key a declaration does not know. No declaration in this package checks for unknown keys today, and this change does not start.

### Tests observe spans, not properties

Two dispatcher tests read `dispatcher.telemetry` directly. With the property gone, they assert on what was recorded instead, through an in-memory exporter, which is what a caller can actually observe.

The regression this change exists for gets its own test, in both suites: a tracer provider registered after the class is built, and a call with no telemetry. The call's spans must record through that provider.

## Risks / Trade-offs

- **[A call costs one extra `resolveTelemetry`]** → It builds one small frozen object and asks the API for a tracer by name, which the SDK caches. That is negligible next to an execution, which validates events against schemas.
- **[Every caller who wants non-default telemetry must pass it on every call]** → This is the intent: whoever runs the handler decides where it records. Mechanisms build one telemetry object at start-up and pass the same object on each call.
- **[Breaking for anyone passing telemetry at construction]** → Moving the option from the constructor to the call is mechanical. The sandbox is the only known consumer, and it is updated as a follow-up in the same branch.
- **[Per-handler loggers and meters inside a dispatcher are lost]** → By design, a handler entered by a dispatcher has no say. A caller that wants to know which handler emitted a log line can read the attributes the handler already puts on its span and its log records.

## Migration Plan

1. Tests first, in arvo-core: the new requirements and the regression test, failing.
2. Source: execute parameter types gain `telemetry`; both classes resolve per call; the option and the property are removed; TSDoc updated to the project's rules, with an example calling `execute` with telemetry.
3. Existing tests move their tracer from construction to the call.
4. The sandbox mechanisms pass their telemetry on each call. That is outside this package, after this change is archived.

Rollback is reverting the change's commits. No data or stored format is touched.
