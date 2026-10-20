## Why

Some of what an executor does belongs to no particular version: reading a flag before deciding whether to run, recording how long the work took, refusing on behalf of a tenant, resolving something every version needs. Today each is copied into every executor that needs it and copied again when it changes.

[ADR-016](../../../../../docs/adr/016-executor-middleware.md) is accepted and settles where such a thing lives: in the executor's seat, as a **layer** with a part that runs before the business code and a part that runs after it. A layer has an executor's powers on the way in, may only observe on the way out, and never authors what the execution emits. This change builds it.

## What Changes

- A new public type, `IArvoEventHandlerMiddleware`: an identifier, an optional `before`, an optional `after`. Wherever layers are listed, an entry may be an instance or a factory returning one; factories are invoked once per execution before any layer runs, and a layer so made lives for that execution and may hold per-execution state on itself.
- `setupArvoEventHandler` accepts `middleware`, applying to every version. Two declared layers sharing an identifier are a declaration error.
- `ArvoEventHandler.execute` and `tryExecute` accept `middleware` per execution, supplied by whatever runs the handler. A supplied identifier already in use is a fault.
- The order is fixed: supplied layers' `before` parts, then declared layers' `before` parts, then the version's executor; `after` parts in exact reverse.
- A `before` that fails stops everything and decides the outcome as the executor's own failure would. An `after` runs only where the executor returned, sees the emission and cannot alter it, and a failure in it is recorded on the span and discarded.
- Two new members on `ArvoExecutionContext`: `middleware`, read, and `setMiddleware`, write — built fresh per execution, never on the record, each key written once.
- Two new fault kinds, non-retryable: `middleware_conflict` — a duplicate identifier at execution, or a middleware-data key written twice; `middleware_instantiation_failed` — a factory that throws or returns something that is not a layer.
- The run clock covers `before` parts, the executor and `after` parts. Expiry during an `after` leaves the result standing and cuts the remaining `after` parts.
- Each part of each layer is marked on the delivery span by identifier; executor time and layer time are recorded apart. No span is opened per layer.

Nothing existing changes meaning. A handler declaring no layers and an execution supplied none behave exactly as today.

## Capabilities

### New Capabilities
- `event-handler-middleware`: layers around a version's executor — how they are declared and supplied, the order they run in, what each part may do and how it fails, the middleware data they hand inward, and what bounds them.

### Modified Capabilities
- `event-handler`: the execution context gains two members, `middleware` and `setMiddleware`; the fault vocabulary gains `middleware_conflict` and `middleware_instantiation_failed`; the declaration gains `middleware` and one declaration rule; the run clock's coverage is stated where layers are present.

## The shape, in TypeScript

A sketch so that whoever implements this sees the surface whole, and whoever uses it sees what to expect. Names are the ones the tasks use; the prose in `design.md` and the two specs govern where they disagree.

### The layer

```ts
// src/ArvoEventHandler/types/middleware.ts
export interface IArvoEventHandlerMiddleware<
  TId extends string = string,
  TSelf extends VersionedArvoContract = VersionedArvoContract,
  TServices extends ArvoServiceMap = ArvoServiceMap,
  TDataSchema extends z.$ZodObject = z.$ZodObject,
  TDependencies extends ArvoDependencies = ArvoDependencies,
  TMechanismHooks extends ArvoMechanismHooks = ArvoMechanismHooks,
> {
  /** Unique among the layers of one execution. Names the layer on the span and in a fault. */
  readonly id: TId;

  /** Before the executor. May do what an executor may; returns nothing; a failure stops everything. */
  before?(
    ctx: ArvoExecutionContext<TSelf, TServices, TDataSchema, TDependencies, TMechanismHooks>,
  ): PromiseAble<void>;

  /** After the executor returned, and only then. Sees the emission, cannot change it; a failure is recorded and discarded. */
  after?(
    ctx: ArvoExecutionContext<TSelf, TServices, TDataSchema, TDependencies, TMechanismHooks>,
    emission: Readonly<ArvoExecutorEmission>,
  ): PromiseAble<void>;
}
```

The context generics default wide, so a layer written for *any* handler types against the base context and compiles everywhere; a layer written for *one* handler names that handler's contract, services, dependencies and hooks and is refused by a handler whose declaration differs. Both are the same interface.

### On the context

```ts
// src/ArvoEventHandler/context/index.ts — two members beside state / setState
readonly middleware: Readonly<Record<string, unknown>>;        // frozen shallow copy on every read; {} where nothing was written
async setMiddleware(key: string, value: unknown): Promise<void>; // one key, one value; a key already present throws
                                                                  // ArvoHandlerFault { faultKind: 'middleware_conflict' }
```

### On the declaration and on the execution

```ts
// src/ArvoEventHandler/types/middleware.ts — an entry is a layer or a way to make one
export type ArvoEventHandlerMiddlewareEntry<…> =
  | IArvoEventHandlerMiddleware<…>
  | (() => PromiseAble<IArvoEventHandlerMiddleware<…>>);            // invoked once per execution, before any layer runs

// src/ArvoEventHandler/types/setup.ts
middleware?: readonly ArvoEventHandlerMiddlewareEntry<…>[];        // optional at the boundary; never null; factories not invoked here

// src/ArvoEventHandler/index.ts
readonly middleware: readonly ArvoEventHandlerMiddlewareEntry[] | null; // null where undefined or empty

// src/ArvoEventHandler/types/execute.ts
middleware?: readonly ArvoEventHandlerMiddlewareEntry[];           // per execution; normalized to null in #dispatch

// src/ArvoEventHandler/fault/types.ts
| 'middleware_conflict'                                            // non-retryable: a duplicate id at execution, or a key written twice
| 'middleware_instantiation_failed'                                // non-retryable: a factory threw, or returned something that is not a layer
```

### What a layer author writes

A layer is a class implementing the interface. Configuration lives on the instance; anything about one delivery lives in middleware data, never on `this`, because one instance serves every delivery of the handler it is declared on, several at once.

```ts
// A layer for any handler: typed against the base context, so it reads only what every context has.
class MeasureDuration implements IArvoEventHandlerMiddleware<'measure_duration'> {
  readonly id = 'measure_duration' as const;

  constructor(private readonly metricName: string) {}

  async before(ctx: ArvoExecutionContext): Promise<void> {
    await ctx.setMiddleware(`${this.id}.started_at`, Date.now());       // per-delivery; never on this
  }

  async after(ctx: ArvoExecutionContext, emission: Readonly<ArvoExecutorEmission>): Promise<void> {
    const started = ctx.middleware[`${this.id}.started_at`];            // unknown — narrow before use
    if (typeof started !== 'number') return;
    ctx.telemetry.metric.record(this.metricName, Date.now() - started);
    ctx.telemetry.addEvent('emitted', {
      count: Array.isArray(emission) ? emission.length : emission ? 1 : 0,
    });
  }
}

// A layer for one handler: names its dependencies, so ctx.dependencies is typed.
class RequireTenant implements IArvoEventHandlerMiddleware<
  'require_tenant',
  typeof orderVersion,
  typeof services,
  typeof orderState,
  { directory: Directory }
> {
  readonly id = 'require_tenant' as const;

  async before(ctx: ArvoExecutionContext<typeof orderVersion, typeof services, typeof orderState, { directory: Directory }>): Promise<void> {
    const tenant = await ctx.dependencies?.directory?.lookup(ctx.state.subject);
    if (!tenant) {
      throw await ctx.fault({                                           // a fault: everything stops; the mechanism decides about a retry
        faultKind: 'executor_raised',
        message: `no tenant for subject ${ctx.state.subject}`,
        retryable: false,
      });
    }
    await ctx.setMiddleware('tenant', tenant);                          // the executor decides what a suspended tenant means
  }
  // no after: a layer may have either part or both
}

// A layer made per execution: listed as a factory, so this instance serves one execution and may hold what it learns on itself.
class Stopwatch implements IArvoEventHandlerMiddleware<'stopwatch'> {
  readonly id = 'stopwatch' as const;
  #startedAt = 0;                                                       // allowed here, and only here: one instance, one execution

  async before(): Promise<void> { this.#startedAt = Date.now(); }
  async after(ctx: ArvoExecutionContext): Promise<void> {
    ctx.telemetry.metric.record('order.duration', Date.now() - this.#startedAt);
  }
}

// An observe-only layer: after only.
class AuditTrail implements IArvoEventHandlerMiddleware<'audit_trail'> {
  readonly id = 'audit_trail' as const;

  constructor(private readonly sink: AuditSink) {}

  async after(ctx: ArvoExecutionContext, emission: Readonly<ArvoExecutorEmission>): Promise<void> {
    await this.sink.write(ctx.state.executionId, emission);             // throws here are recorded on the span and discarded
  }
}
```

An object literal satisfies the same interface — the handler sees only the shape — but a class is the form the package documents and tests against. Which way a class is **listed** decides what it may hold: an instance (`new RequireTenant()`) serves every execution of the handler and keeps nothing per delivery on `this`; a factory (`() => new Stopwatch()`) is invoked once per execution, and the instance it returns may hold what it learns, because nothing else will ever see it.

### What a handler author writes

```ts
const orderHandler = setupArvoEventHandler({
  contracts: { self: orderContract, services },
  types: {} as { dependencies: { directory: Directory } },
  middleware: [new RequireTenant(), () => new Stopwatch()],   // declared: every version; a factory is invoked once per execution
})
  .handler('1.0.0', {
    state: orderState,
    execute: async (ctx) => {
      const tenant = ctx.middleware.tenant as Tenant | undefined;   // what the layers left; narrow it
      if (!tenant) throw await ctx.fault({ faultKind: 'executor_raised', message: 'tenant layer did not run' });
      if (tenant.suspended) return ctx.build({ type: 'com_order_refused', data: { reason: 'suspended' } });
      await ctx.setState({ data: { stage: 'placed' } });
      return ctx.build({ type: 'com_order_created', data: { order_id: ctx.state.subject } });
    },
  })
  .build();
```

### What whatever runs the handler writes

```ts
const ran = await orderHandler.tryExecute({
  event, state, attempt,
  dependencies,
  middleware: [new AuditTrail(sink)],                   // supplied: this execution only; outermost
});
// ran.ok && ran.value.kind === 'produced'  → commit ran.value.state and ran.value.events as one unit
// !ran.ok && ran.error.faultKind === 'middleware_conflict' → a duplicate id or key; non-retryable; a defect to fix, not to retry
```

### What to expect

| | |
|---|---|
| No `middleware` anywhere | exactly today's behaviour, same marks, same timings |
| A `before` throws or faults | the executor and every `after` are skipped; outcome as if the executor had thrown or faulted |
| An `after` throws or faults | the executor's result is produced unchanged; the failure is on the span |
| The run clock fires in a `before` or the executor | `run_timeout`, retryable |
| The run clock fires in an `after` | result produced unchanged; remaining `after`s skipped; marked on the span |
| A layer returns an event | ignored |
| `ctx.middleware.x = y` | throws (frozen); use `setMiddleware` |
| `setMiddleware` on a key already present | `middleware_conflict` fault |
| Same id twice, declared | `ArvoEventHandlerValidationError` at `build` |
| Same id twice, supplied — or supplied equals declared | `middleware_conflict` fault before any layer runs |
| A factory throws, or returns a non-layer | `middleware_instantiation_failed` fault before any layer runs |
| A factory is listed | invoked once per execution; the instance lives for that execution |

## Impact

- **Public surface:** `IArvoEventHandlerMiddleware` exported from `src/index.ts`; `middleware` on the setup param and the execute param; `middleware` and `setMiddleware` on `ArvoExecutionContext`; `middleware_conflict` and `middleware_instantiation_failed` on `ArvoFaultKind`. All additive.
- **`src/ArvoEventHandler`:** `setup.ts`, `index.ts`, `version/index.ts`, `version/types.ts`, `types/execute.ts`, `types/setup.ts`, `context/index.ts`, `fault/types.ts` (the verdict set in `fault/retry.ts` is unchanged), `version/telemetry.ts`; one new type file and one new internal file for running the chain.
- **Tests:** new specs for the new capability; existing handler, context and fault specs extended for the new members and kind. Coverage stays at the package bar.
- **Dependencies:** none added.
- **Sandbox:** the distributed handlers gain layers and each mechanism supplies one, with a failure-injection layer, so the feature is proven under Temporal, DBOS and the plain loop before the change closes. The sandbox is a proving ground, not authority.
- **Out of scope:** anything that runs several handlers or supplies layers to them from outside as a product surface — a later change.
