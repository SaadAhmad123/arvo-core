## Context

See proposal.md for why. Today the version calls `runMiddleware({ layers, ctx, executor, telemetry, middlewareProgress })`. That function runs the before parts, calls the executor, records its start time, return time and emission on the progress object, runs the after parts, and reports `returned` or `raised`. The version wraps its executor so that the record at the executor's return is captured on the way through, races the whole call against the run clock, and on expiry sets `outran` on the progress object so the chain stops.

## Goals / Non-Goals

**Goals:**
- The version reads as its steps: resolve, before, execute, after.
- Each rule of the chain lives in one place: stop at the first failing before part, run after parts in reverse, pass over a failing after part, stop once the clock has expired, and mark each part on the span.
- The executor and everything about it stay in the version.

**Non-Goals:**
- Any change in behaviour, metrics or faults, beyond the refusal order and the marks proposal.md lists.
- A public composite, or a composite placed inside a layer list.

## Decisions

### One async factory: check the lists, resolve, construct

```ts
const abortController = new AbortController();
const attempt = await tryCreateArvoComposedMiddleware({
  supplied: param.middleware,
  declared: this.#declaredMiddleware,
  abortSignal: abortController.signal,
});
if (!attempt.ok) throw await this.#faultFor(param, collectedRecord, refusalFrom(attempt.error));
const middleware = attempt.value;
```

The version makes one call and has one failure path. Inside, `tryCreateArvoComposedMiddleware` (`composed-middleware/factory.ts`) takes three steps and stops at the first that fails:

1. **Both lists must be arrays.** Omitted means none. A side that is not an array, possible only from a caller no compiler saw, is the validation error, and nothing is made.
2. **`tryResolveMiddleware` calls every factory.** A factory that throws is the resolution error.
3. **The constructor judges the layers.** A broken rule is the validation error. Anything else the constructor throws goes up as thrown, following `tryCreateArvoEvent`.

No throwing `createArvoComposedMiddleware` is added, because the constructor already is that form. The factory, the errors and the class live in `composed-middleware/`, not in `src/factories/`, since none of them is exported.

**Resolution** (`composed-middleware/resolve.ts`) takes two arrays and has one job: call each factory once and put what it returned in its place.

```ts
const resolveList = async (entries: readonly ArvoEventHandlerMiddlewareEntry[], source: ArvoMiddlewareSource) =>
  NeverthrowResult.combine(
    await Promise.all(
      entries.map(async (middlewareEntry, entryIndex) => {
        if (typeof middlewareEntry !== 'function') return ok(middlewareEntry);
        try {
          return ok(await middlewareEntry());
        } catch (thrown) {
          return err(new ArvoComposedMiddlewareResolutionError({ position: middlewarePosition(source, entryIndex), thrown }));
        }
      }),
    ),
  );
```

- **Supplied resolves before declared.** Within a list the factories run concurrently, and the first in the list that threw is the one reported. Where a supplied factory throws, the declared list is not resolved.
- **Each entry resolves to a neverthrow Result,** and `combine` returns the first failure, so there is no cast and no unreachable branch.
- **It knows nothing about layers.** The result is typed as `IArvoEventHandlerMiddleware[]`, as the entry type promises; the constructor checks it.

**The constructor** takes `{ supplied, declared, abortSignal }`, both lists typed as `IArvoEventHandlerMiddleware[]`. It joins them in run order, supplied first, and its private `#validate` judges them in two passes, following *Validation* in `project.md`:

1. **Shape.** Every entry must be a valid middleware. Every failure is collected, the refusal is `middleware_instantiation_failed`, and each issue is blocking: duplicate ids are checked only once every middleware is valid.
2. **Ids.** Every repeated id is collected, each naming both positions, and the refusal is `middleware_conflict`.

One refusal lists every bad entry, or else every duplicate, never both.

**Each failure has its own error** (`composed-middleware/errors.ts`), both with a `_tag` and the fault kind they become:

- **`ArvoComposedMiddlewareResolutionError`**: a factory threw. It carries the position and keeps what was thrown as its `cause`. Its fault kind is always `middleware_instantiation_failed`.
- **`ArvoComposedMiddlewareValidationError`**: a list is not an array, or the layers break a rule. It follows `ArvoEventValidatorError`: it carries every issue, builds its message from them, and carries `middleware_instantiation_failed` or `middleware_conflict`.

**Every message is written for the person who wrote the middleware.** Positions read as their own code does, through `middlewarePosition` (`composed-middleware/position.ts`): `execute({ middleware })[1]`, `setupArvoEventHandler({ middleware })[0].before`. Each message says the execution was not run, that no middleware ran, and what to fix:

```text
This execution was not run: two or more of its middleware share an id. No middleware ran and the handler was not called.
The following problem was found:
  - setupArvoEventHandler({ middleware })[0].id: has the id "tenant", which execute({ middleware })[0] already uses. Every middleware in one execution needs its own id: rename one of them
```

The shared shape check in `helpers/check-middleware.ts` says "middleware", not "layer", in the same voice, which reaches a handler's build-time errors too. It stays in `helpers/`: the build-time check owns it and the composite reuses it.

**The errors become a fault beside the version.** `refusalFrom` lives in `src/ArvoEventHandler/version/middleware-refusal.ts`, so the composite's files know nothing of faults. It copies and decides nothing:

```ts
export const refusalFrom = (
  error: ArvoComposedMiddlewareResolutionError | ArvoComposedMiddlewareValidationError,
): ArvoGateRefusal => {
  if (error instanceof ArvoComposedMiddlewareValidationError) {
    return { faultKind: error.faultKind, message: error.message, violations: error.issues.map((issue) => issue.toString()) };
  }
  const thrownMessage = error.cause instanceof Error ? error.cause.message : String(error.cause);
  return { faultKind: error.faultKind, message: error.message, violations: [`${error.position}: ${thrownMessage}`], cause: thrownMessage };
};
```

`#faultFor` then passes the refusal to `createArvoHandlerFault`, unchanged: the fault gains the execution, the event it answers and the abandonment pair, and both kinds come out non-retryable because neither is among the kinds safe to retry. The version builds the composite before it builds the context, so a refusal leaves nothing half-done: no layer part ran and the executor was not entered.

**What a caller could notice.** Today each entry is made and checked before the next one. Now every factory in a list is made first, and the checks run after:

| Situation | Today | After this change |
|---|---|---|
| An early entry is not a middleware, and a later entry is a factory | Refused at the early entry. The later factory is not called. | The later factory is called, then the execution is refused. |
| An early entry is not a middleware, and a later factory throws | The early entry is reported. | The throwing factory is reported. |
| A factory throws, and later factories in the same list | The later ones are not called. | They are called, since a list resolves concurrently. |
| Several entries are wrong | Only the first is named. | Every one is named. |

The wording of every refusal changes too. In every case the execution is still refused, it is not retried, and no layer part runs. The spec already describes this order: *A Layer, Or A Way To Make One* calls every factory before any layer runs, and applies the identifier rule to what they return.

*Alternatives considered:*
- **Keep the checks in `tryResolveMiddleware`** and build the composite from layers already known to be valid. Rejected: it leaves the rules about layers outside the class that runs them.
- **Call `tryResolveMiddleware` from the version, then a synchronous factory.** Rejected: the version would hold two calls and two failure paths for one step, building its layers.
- **Resolve one factory at a time.** Rejected for the simpler concurrent map: the spec asks only that each factory run once before any layer, and factories are meant to be cheap, since anything with an open and a close is a dependency.

### The composite itself leaves nothing in telemetry

Only the layers inside the composite are marked: each part's entered, returned and failed marks, by the layer's own `id`, with `middleware.aborted` saying whether the run clock had fired. The composite's `id` never appears in a mark, and calling the composite opens no span and records nothing of its own.

The middleware-duration metric measures time spent in layers. As today, it is recorded only where there is at least one layer. The version knows that from the lists it passed in, so the composite needs no member to say it.

### The run clock reaches the composite as an `AbortSignal`

```ts
class ArvoComposedMiddleware implements IArvoEventHandlerMiddleware<'arvo.composed'> {
  readonly id = 'arvo.composed';
  constructor(param: {
    supplied: readonly IArvoEventHandlerMiddleware[];
    declared: readonly IArvoEventHandlerMiddleware[];
    abortSignal: AbortSignal;
  });                                    // throws ArvoComposedMiddlewareValidationError on a refusal
  before(ctx): Promise<void>;           // throws what a before part threw
  after(ctx, emission): Promise<void>;  // never throws
}
```

The constructor takes no telemetry. Every mark is made on `ctx.telemetry`, the same telemetry the version holds, since the context is built from it, and nothing is marked during construction.

The clock lives in the version, and the composite must notice it mid-chain. The version creates an `AbortController`, its timer calls `abort()`, and the composite checks `signal.aborted` before each part. The version reads the same signal wherever it needs to know the clock fired.

Every mark the composite makes carries the layer's `id` and whether the run clock had fired at that moment, read from the signal:

```ts
#markPart(ctx, stage: string, layer: IArvoEventHandlerMiddleware, extra = {}) {
  markStage(ctx.telemetry, stage, {
    'middleware.id': layer.id,
    'middleware.aborted': this.#abortSignal.aborted,
    ...extra,
  });
}
```

#### `before(ctx)`: in order, stopping at the first failure

```ts
async before(ctx) {
  for (const layer of this.#layers) {
    if (this.#abortSignal.aborted) return;           // clock fired: start nothing new
    if (layer.before === undefined) continue;        // a layer may have only an after
    this.#markPart(ctx, 'middleware_before_entered', layer);
    await layer.before(ctx);                         // a throw leaves here, unchanged
    this.#markPart(ctx, 'middleware_before_returned', layer);
  }
}
```

- **It catches nothing.** What a before part throws reaches the version exactly as thrown. A fault stays a fault, and anything else becomes the handler error, as if the executor had thrown it.
- **A failed part is marked entered and never returned.** That is how a reader of the trace sees where the chain stopped.
- **Once the signal is aborted, no further part starts.** A part already running finishes in the background. Its returned mark is still made, with `middleware.aborted` true, and nothing reads its result.

#### `after(ctx, emission)`: in reverse, never throwing

```ts
async after(ctx, emission) {
  const readOnlyEmission = Array.isArray(emission) ? Object.freeze(emission) : emission;
  for (const layer of [...this.#layers].reverse()) {
    if (this.#abortSignal.aborted) break;            // clock fired: the return already stands
    if (layer.after === undefined) continue;
    this.#markPart(ctx, 'middleware_after_entered', layer);
    try {
      await layer.after(ctx, readOnlyEmission);
      this.#markPart(ctx, 'middleware_after_returned', layer);
    } catch (thrown) {
      // a failing after part changes nothing: mark it and move on
      this.#markPart(ctx, 'middleware_after_failed', layer, describeThrown(thrown));
    }
  }
}
```

- **The emission is frozen,** so no after part can change what the executor returned. Only the array is frozen; the events in it are already immutable.
- **Each part's failure is caught on its own.** It is marked on the span, and the remaining after parts still run.
- **Every mark is made, whenever it happens.** A part that returns or fails after the clock fired is still marked, with `middleware.aborted` true, so the trace shows it finished late rather than hiding it. If the span has already ended by then, OpenTelemetry drops the mark without error. What the mark cannot do is change the outcome: the version settled that when the clock won.

#### What stays in the version

Calling the executor, its start and return times, and the record as the executor left it. So do the two marks that depend on those: `middleware_after_write_discarded`, which compares the record after the after parts with the one at the executor's return, and `middleware_after_cut`, which depends on who won the race. The composite knows nothing about the executor.

The signal is internal to the version and the composite. Whether layers themselves are given a signal is a separate question this change does not touch.

*Alternatives considered:*
- **A shared progress object passed into the constructor, as today.** Rejected: with the executor back in the version, the only state left to share is whether the clock fired.
- **A flag owned by the composite, set through `expire()` and read through `expired`.** Rejected: it adds a custom surface for what `AbortSignal` already says in a form every JavaScript reader knows. With the signal, the composite's surface is exactly the layer interface.

### The version holds the executor and races one function

```mermaid
sequenceDiagram
  participant V as Version
  participant M as Composed middleware
  participant E as Executor
  participant C as Run clock
  V->>C: start
  V->>M: before(ctx)
  M-->>V: returns, or throws
  V->>E: executor(ctx)
  E-->>V: emission
  Note over V: keep start and return times,<br/>the emission and ctx.state
  V->>M: after(ctx, emission)
  C-->>V: expiry, if it comes first
  C->>M: signal aborted
```

The sketches below show the shape, not code to copy. The decisions above and the existing tests are what bind the implementation.

The function the clock races:

```ts
const run = async (): Promise<ArvoExecutorRun> => {
  try {
    await middleware.before(ctx);
    // the clock has already won the race; this only avoids entering the executor for nothing
    if (abortController.signal.aborted) return { kind: 'outran' };
    executorStartedAt = Date.now();
    emission = await this.#executor(ctx);
    returnedAt = Date.now();
    recordAtExecutorReturn = ctx.state;
  } catch (thrown) {
    return { kind: 'raised', thrown };
  }
  await middleware.after(ctx, emission);
  if (ctx.state !== recordAtExecutorReturn && !abortController.signal.aborted) {
    markStage(ctx.telemetry, 'middleware_after_write_discarded');
  }
  return { kind: 'returned', emission };
};
```

The race around it:

```ts
if (this.options.runTimeout === null) return await run();

let timer: ReturnType<typeof setTimeout> | undefined;
const clock = new Promise<ArvoExecutorRun>((settle) => {
  timer = setTimeout(() => {
    abortController.abort();                        // no part not yet started will run
    settle({ kind: 'outran' });
  }, this.options.runTimeout);
});

try {
  const executorRun = await Promise.race([run(), clock]);
  if (executorRun.kind !== 'outran') return executorRun;
  if (returnedAt !== null) {                 // fired during an after part
    markStage(ctx.telemetry, 'middleware_after_cut');
    return { kind: 'returned', emission };   // the executor's return stands
  }
  return executorRun;                        // fired during a before part or the executor
} finally {
  clearTimeout(timer);
}
```

The race decides the outcome, and the signal stops further work: a promise cannot be cancelled, so `run()` carries on in the background, but no layer part starts once the signal is aborted. `returnedAt` says where the clock fired, so the version knows whether the executor's return stands, exactly as today. The executor wrapper and `readRecordAtExecutorReturn` disappear, because the record is captured where the executor returns.

### Implements the layer interface, and stays internal

The composite implements `IArvoEventHandlerMiddleware`, with a fixed `id` of `arvo.composed`. The version then calls `before(ctx)` and `after(ctx, emission)` against the same signatures a user's layer has, so the type system holds the composite to the layer contract, and a change to the interface forces a change here. Its `after` is stricter than the interface requires, since it never throws, and a stricter implementation still satisfies the interface.

Two rules keep this safe, and both are recorded in the class's TSDoc:
- **It is never exported from `src/index.ts`.** A consumer cannot construct one, so a consumer cannot place one in a layer list.
- **It never appears inside a layer list.** The uniqueness check runs over the resolved layers, and the composite is built from them, never placed among them. Its own `id` therefore never meets the check.

If either rule is ever relaxed, the uniqueness check has to look inside composites, or inner identifiers would escape it. That is a decision for the change that relaxes the rule.

The version never calls `new` itself: it goes through `tryCreateArvoComposedMiddleware`, as consumers go through factories everywhere else in the package.

*Alternative considered:* a plain class that does not implement the interface, which removes the nesting question entirely. Rejected: the nesting question only arises if the composite becomes public, and the type-level guarantee is worth having now.

## Risks / Trade-offs

- [A before part still running when the clock fires keeps running in the background] → Unchanged from today. The protocol promises only that the execution no longer listens, and the aborted signal stops every later part.
- [Tests of `runMiddleware` are rewritten, so they could drift from what they checked] → Port each case one for one against the class, and require every test that runs through the public surface to pass without edits.
- [One more class where there was a function] → Accepted for the reading order it buys.
