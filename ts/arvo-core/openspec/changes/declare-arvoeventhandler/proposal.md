## Why

`project.md` names three application-tier primitives: `ArvoEvent`, `ArvoContract`, `ArvoEventHandler`. Two exist. The third has no implementation and, until recently, no specification either — ADR-005 deferred handler behaviour and nothing had settled it.

That gap is now closed. [ADR-006](../../../../../docs/adr/006-arvoeventhandler-protocol.md) through [ADR-010](../../../../../docs/adr/010-delivery-classification-and-entry-validation.md) are accepted and define the protocol end to end. This is the first of six changes that build it in TypeScript.

It delivers the one thing every later change rests on, and nothing else: **a declared handler**. That is not an arbitrary first slice. ADR-006 puts most of its refusals at declaration — a version with no executor, an executor naming an undeclared version, two declared capabilities sharing an event type, two versions of one service contract, an option outside its domain, an execution timeout shorter than a run timeout. Every one of them is rejected *before any event exists*, which makes declaration a complete piece of behaviour with its own tests and no dependency on anything that runs.

## The plan

Six changes. Each compiles against the one before it, and each is shippable on its own.

| | Change | Builds | From |
|---|---|---|---|
| **1** | **`declare-arvoeventhandler`** — this one | the `ArvoEventHandler` class, what a declaration holds, every rule that rejects one, and option resolution | ADR-006 *Definition and declaration*, *Options* |
| 2 | `arvo-execution-record` | the execution record: its fields, its lifecycle, validation, hydration, self-consistency, `cas_version` | ADR-007 |
| 3 | `arvo-handler-faults` | `ArvoHandlerFault`, the `fault_kind` vocabulary, and the abandonment pair | ADR-008 |
| 4 | `arvo-execution-context` | the context an executor receives, the event builder, addressing, and validation of what an executor returns | ADR-006 *The execution context*, *Addressing an emitted event* |
| 5 | `arvo-execution-bounds` | depth, retry, the two timeouts, and collection | ADR-009 |
| 6 | `arvo-handler-delivery` | classification, the sixteen-step gate, and `tryExecute` / `execute` — the one mechanism-agnostic entry point | ADR-010 |

The order is forced by dependency, not preference: the context (4) reads the record (2) and builds faults (3), the gate (6) uses all of them, and the bounds (5) are what two of its steps enforce. Nothing runs until 6.

## What Changes

- **New capability `event-handler`** — the handler primitive. This change gives it declaration; changes 2 through 6 accumulate into the same capability, per `project.md` — *Capability conventions*.

- **New class `ArvoEventHandler`, constructed with `new`.** A declaration names one self contract, the service contracts it may send to, one executor per version of the self contract, and options at two levels. The constructor validates the whole declaration and throws on any rule it breaks.

- **A `tryX`/`X` pair reaching it**, `tryCreateArvoEventHandler` and `createArvoEventHandler`, following `createArvoContract`. Per `project.md` — *Result types*, the constructor holds the logic and `tryX` is derived from it, not the other way round.

- **Every declaration rule ADR-006 states, checked at declaration:**

| Rule | ADR-006 |
|---|---|
| an executor for every version the self contract declares | *One executor per version* |
| no executor naming a version the contract does not declare | *One executor per version* |
| no two declared capabilities sharing an event type | *No two capabilities may share an event type* |
| no two versions of one service contract | *No two versions of one service contract* |
| every option within its type's domain, at both levels | *Options* — *Validated at declaration* |
| a resolved `executionTimeout` not below the resolved `runTimeout`, and `null` where that is `null` | *Options*; ADR-009 *Why the execution clock cannot be shorter* |

- **The self contract may be declared as a service**, and doing so is not a collision. ADR-006 permits it so a handler can recurse, and ADR-005 already guarantees a contract's `type`, its `outputs` keys and its handler error type are disjoint.

- **Options resolve in one place, and that place is internal.** Seven options at two levels: the handler level is complete after defaulting, the version level is sparse, and a version's value wins where it wrote one. Resolution is an internal function, not a method a consumer can reach — the declaration is the whole public surface for options, and what the protocol makes of it is the protocol's business. Later changes read that one function; none re-derives the rule. One type describes both states: `ArvoEventHandlerOptions` complete, `Partial<ArvoEventHandlerOptions>` at each declaration site.

- **`unset` and `null` are distinguished**, because ADR-006 requires it: for the two timeouts an omitted option inherits and a written `null` means unbounded, and an implementation MUST NOT collapse the two. This is the one place the package's *Optional inputs* rule is departed from, and `design.md` records why.

- **New error `ArvoEventHandlerValidationError`**, reporting every rule the declaration broke rather than the first, each with its position. A declaration error is not an `ArvoHandlerFault`: ADR-006 defines no fault for it, precisely because it is a defect in code visible before any event exists.

- **BREAKING**: none. Additive.

## The developer-facing surface

Illustrative, not normative — the spec governs.

```ts
class ArvoEventHandler<
  T extends string,                             // the implemented contract's type
  M extends ArvoContractVersionMapParam,        // its versions, as declared
  S extends ArvoServiceMap,                     // the services, as declared
  D extends ArvoDependencies = ArvoNone,        // dependencies, as declared through `types`
  H extends ArvoMechanismHooks = ArvoNone,      // hooks, as declared through `types`
  VD extends ArvoVersionDeclarations<T, M, S, D, H> = ArvoVersionDeclarations<T, M, S, D, H>,
> {
  /** The contract this handler implements. */
  readonly contract: ArvoContract<T, M>;
  /** The contracts it may send to, each at one version, under the name given. */
  readonly services: Readonly<S>;
  /** One entry per version of the contract: its executor, state schema and options as declared. */
  readonly versions: Readonly<VD>;

  /**
   * Runs one delivery. The only way a handler does anything, and the whole of its boundary:
   * it names no broker, store, scheduler, transport or runtime, and reaches outward only
   * through the state function it is handed.
   */
  tryExecute(param: ArvoDeliveryParam<D, H>): AsyncResult<ArvoDelivered, ArvoHandlerFault>;
  /** {@link tryExecute}, throwing the fault instead of reporting it. */
  execute(param: ArvoDeliveryParam<D, H>): Promise<ArvoDelivered>;

  constructor(param: ArvoEventHandlerParam<T, M, S, D, H, VD>);
}

const tryCreateArvoEventHandler: <T, M, S, D, H, VD>(
  param: ArvoEventHandlerParam<T, M, S, D, H, VD>,
) => Result<ArvoEventHandler<T, M, S, D, H, VD>, ArvoEventHandlerValidationError>;
```

The handler exposes what was declared and nothing derived from it. Resolved options and the
per-version emittable set are computed at declaration and held internally, where the changes
that run a delivery read them.

The input, and where each part comes from:

```ts
type ArvoEventHandlerParam<T, M, S, D, H, VD> = {
  /** The contract implemented. A contract, not a version -- every version gets an executor. */
  contract: ArvoContract<T, M>;
  /** Contracts this handler may send to, each at exactly one version. The name is yours. */
  services?: S;
  /** Defaults for every version. Omit one and the protocol's own default fills it. */
  options?: Partial<ArvoEventHandlerOptions>;
  /**
   * Types only. Neither member carries a value or is read at runtime -- each exists so the
   * declaration can say what shape a mechanism will supply at delivery, and both reach an
   * executor through its context. Omit either and it is an empty object.
   */
  types?: Partial<{
    /** Whatever this handler's mechanism exposes to an executor. */
    mechanismHooks: H;
    /** Whatever this handler's executors are given to work with. */
    dependencies: D;
  }>;
  /** One entry per declared version. A missing version does not compile, and does not construct. */
  versions: VD;
};

/**
 * Each version declares its own state schema, so each executor's context differs.
 * A version needing neither state nor options is written as the executor alone.
 */
type ArvoVersionDeclarations<T, M, S, D, H> = {
  [V in keyof M & ArvoSemanticVersion]:
    | ArvoExecutor<T, M, V, S, undefined, D, H>        // shorthand: stateless, all options inherited
    | {
        /** Schema for this version's business state. Omit for a version that remembers nothing. */
        state?: z.$ZodObject;
        /** Options for this version. Omit one and the handler's value applies. */
        options?: Partial<ArvoEventHandlerOptions>;
        /** Business code for this version. */
        execute: ArvoExecutor<T, M, V, S, z.$ZodObject | undefined, D, H>;
      };
};

/** A version's state schema as written, or `undefined` where it declared none. */
type StateSchemaOf<VD, V extends keyof VD> =
  VD[V] extends { state: infer St extends z.$ZodObject } ? St : undefined;

/** The services a handler declares, by the local name it gives each. */
type ArvoServiceMap = Record<string, VersionedArvoContract>;

/** Whatever a mechanism chooses to expose to an executor. */
type ArvoMechanismHooks = Record<string, any>;

/** Whatever an executor is given to work with. Outside the model, and never stored. */
type ArvoDependencies = Record<string, any>;

/** Declared neither, so there is nothing to reach for. */
type ArvoNone = Record<string, never>;

type ArvoEventHandlerOptions = {
  maxDepth: number;                  // default 10000
  maxRetryAttempts: number;          // default 3
  retryDelay: number | ArvoRetryDelayFn;  // default 300 (ms)
  runTimeout: number | null;         // default 30000 (ms); null is unbounded
  executionTimeout: number | null;   // default null, unbounded
  collect: 'all' | 'each';           // default 'all'
  handlerErrorDomain: ArvoDomainInput;    // default ArvoDomain.LOCAL
};
```

`types` earns its place by being the only position from which a caller's dependency and hook
shapes can be inferred. Both are supplied by the mechanism at delivery and appear nowhere else in
the declaration, so without it a caller wanting either typed would have to write every type
argument by hand — the contract, its version map, the services and the version declarations
included. Writing one optional field is the smaller price, and a handler needing neither omits it.

Both sit at the handler and not at a version, because a mechanism runs a handler rather than a
version: one handler, one mechanism, one shape each. Every version's executor therefore sees the
same two types, and a version wanting a narrower dependency narrows it in its own body. The state
schema is the one of the three that is per version, because ADR-006 puts it on the executor's own
declaration.

`handlerErrorDomain` takes `ArvoDomainInput`, the type `ArvoDomain` already ships: a literal, or one of four symbols naming where to read a domain from. Those four are ADR-006's four sources under a different spelling, which ADR-004 leaves to each language, so nothing new is invented here.

## What an executor will receive

Change 4 builds this; it is sketched now because change 1 has to carry the generics that make it
possible. Every type below is read off the declaration — the contract implemented, the version
running, and the services declared — so nothing is annotated by hand and nothing is `any`.

```ts
/** The event that opens an execution of version V. */
type ArvoInitEvent<T, M, V> = ArvoEvent<T, z.infer<M[V]['input']>>;

/** Anything one declared service may answer with: one of its outputs, or its handler error. */
type ArvoServiceResponse<C extends VersionedArvoContract> =
  | { [K in keyof C['outputs'] & string]: ArvoEvent<K, z.infer<C['outputs'][K]>> }[keyof C['outputs'] & string]
  | ArvoEvent<C['error']['type'], z.infer<C['error']['schema']>>;

/** Anything any declared service may answer with. */
type ArvoAnyResponse<S extends ArvoServiceMap> =
  { [K in keyof S]: ArvoServiceResponse<S[K]> }[keyof S];

/** Every event version V may emit: a service's input, or one of its own outputs. Never its handler error. */
type ArvoEmittable<T, M, V, S> =
  | { [K in keyof S]: ArvoEvent<S[K]['type'], z.infer<S[K]['input']>> }[keyof S]
  | { [E in keyof M[V]['outputs'] & string]: ArvoEvent<E, z.infer<M[V]['outputs'][E]>> }[keyof M[V]['outputs'] & string];

/** What the builder accepts: a type from that set, and the payload that type declares. */
type ArvoEmitParam<T, M, V, S> =
  | { [K in keyof S]: { type: S[K]['type']; data: z.input<S[K]['input']> } & ArvoEmitFields }[keyof S]
  | { [E in keyof M[V]['outputs'] & string]: { type: E; data: z.input<M[V]['outputs'][E]> } & ArvoEmitFields }[keyof M[V]['outputs'] & string];

type ArvoEmitFields = {
  domain?: ArvoDomainInput;
  executionunits?: number;
  /** Everything ADR-006 marks unsafe, behind a name that says so. */
  dangerously_set?: Partial<ArvoEventParam>;
};
```

```ts
/** Held whichever way the delivery arrived. */
interface ArvoContextCore<T, M, V, S, D, H> {
  readonly attempt: number;
  readonly initEvent: ArvoInitEvent<T, M, V>;
  readonly identity: {
    readonly subject: string;
    readonly executionId: string;
    readonly parentExecutionId: string;
    readonly depth: number;
    readonly version: V;
  };
  readonly collected: {
    /** Keyed by the id of the event emitted; `null` while outstanding. */
    readonly responses: ReadonlyMap<string, ArvoAnyResponse<S> | null>;
    readonly outstanding: ReadonlySet<string>;
  };
  readonly dependencies: D;   // as declared through `types`, or empty
  readonly hooks: H;          // as declared through `types`, or empty
  readonly atMaxDepth: boolean;
  readonly timeRemaining: { readonly run: number | null; readonly execution: number | null };
  readonly telemetry: { readonly span: Span; readonly logger: Logger; readonly meter: Meter };

  /** The only member that produces an event. Its payload follows the type named. */
  build(param: ArvoEmitParam<T, M, V, S>): ArvoEmittable<T, M, V, S>;
  cancel(reason: string): void;
  fault(reason: string, retryable?: boolean): ArvoHandlerFault;
}

/** State exists only where the version declared a schema. A stateless version cannot reach it. */
type ArvoContextState<St extends z.$ZodObject | undefined> =
  [St] extends [z.$ZodObject]
    ? { readonly state: z.infer<St> | null; setState(value: z.input<St>): void }
    : { readonly state?: never; readonly setState?: never };

/**
 * A union, not an intersection carrying a union: narrowing on `entry` narrows `event`,
 * which is ADR-006's rule that a payload is unreachable until the case is settled.
 */
type ArvoExecutionContext<T, M, V, S, St, D, H> =
  | (ArvoContextCore<T, M, V, S, D, H> & ArvoContextState<St> & {
      readonly entry: 'init';
      readonly event: ArvoInitEvent<T, M, V>;
    })
  | (ArvoContextCore<T, M, V, S, D, H> & ArvoContextState<St> & {
      readonly entry: 'followup';
      readonly event: ArvoAnyResponse<S>;
    });

type ArvoExecutor<T, M, V, S, St, D, H> = (
  ctx: ArvoExecutionContext<T, M, V, S, St, D, H>,
) => PromiseAble<ArvoEmittable<T, M, V, S> | ArvoEmittable<T, M, V, S>[] | void>;
```

What that buys an executor author, all of it from the declaration and none of it annotated:

```ts
execute: async (ctx) => {
  if (ctx.entry === 'init') {
    ctx.event.data.items;                       // the version's own input schema
    ctx.setState({ orderId: 'o-1' });           // the version's own state schema
    return ctx.build({ type: 'com_payment_charge', data: { amount: 10 } });
    //                       ^ only a declared service's type or an output of this version
    //                                              ^ the payload that type declares
  }

  // followup: narrowed to what a declared service may answer with
  if (ctx.event.type === 'evt_payment_charged') ctx.event.data.receipt;

  return ctx.build({ type: 'com_order_created', data: { orderId: ctx.state!.orderId } });
}
```

```ts
// A stateless version has no state to reach, and the type says so.
'1.2.0': async (ctx) => {
  ctx.setState({});          // does not compile -- this version declared no schema
  ctx.build({ type: 'handler_com_order_create_error', data: {} });
  //                 ^ does not compile -- an executor never builds the handler error event
}
```

## How a handler is run

One operation, taking values and returning values. **The mechanism is whatever wraps that call,
and the handler never knows which one it is.** This package implements no adapter and defines no
adapter interface. It defines a call that any adapter can make, and everything ADR-006 requires of
the thing running a handler is expressed as an input to it or a result from it. The same handler
therefore runs under a queue consumer, a serverless invocation, a test, or a loop in a script,
with nothing to register and no interface to satisfy.

```ts
type ArvoDeliveryParam<D, H> = {
  /** The event delivered. */
  event: ArvoEvent;
  /**
   * Reads whatever is stored under an execution id. The handler calls it once per delivery and
   * judges everything about what comes back; it takes no event and never branches on one.
   */
  state: (param: {
    executionId: string;
    attempt: number;
    telemetry: ArvoTelemetry;
  }) => PromiseAble<JSONObject | null>;
  /** Which attempt this delivery is, counting from 0. Defaults to 0. */
  attempt?: number;
  /** A value, or a factory called once for this delivery. Defaults to an empty object. */
  dependencies?: D | ((param: ArvoDependencyFactoryParam<D>) => PromiseAble<D>);
  /** Whatever this mechanism exposes to executors. Defaults to an empty object. */
  hooks?: H;
  /** The delivery's OpenTelemetry context. Defaults to the active one. */
  telemetry?: ArvoTelemetry;
};

/** What a delivery that was carried through produces. */
type ArvoDelivered =
  /** Commit the record and publish the events together. */
  | { readonly kind: 'produced'; readonly events: ArvoEvent[]; readonly record: ArvoExecutionRecord }
  /** Already seen. Nothing to do, nothing wrong. */
  | { readonly kind: 'discarded' };
```

The fault an adapter reads is an error in its own right, so `execute` can throw it and a
`catch` can name it. Change 3 builds it; its shape decides what an adapter may branch on, so it
belongs beside the call that returns it.

```ts
/** Every fault ADR-008 defines, and nothing else. The verdict of each is fixed there. */
type ArvoFaultKind =
  // the gate, in order
  | 'event_unclassifiable' | 'category_mismatch' | 'state_resolution_failed'
  | 'record_unexpected' | 'record_expected' | 'record_invalid'
  | 'record_event_unrestorable' | 'version_not_declared' | 'max_depth_event_received'
  | 'lifecycle_terminal' | 'execution_timeout' | 'event_unaddressed'
  | 'addressing_mismatch' | 'type_not_receivable' | 'event_schema_rejected'
  | 'response_unawaited' | 'dependency_resolution_failed'
  // a declaration that reached a delivery
  | 'service_version_conflict'
  // the executor
  | 'run_timeout' | 'execution_cancelled' | 'executor_raised'
  // what it returned
  | 'emission_not_permitted' | 'emission_schema_rejected' | 'max_depth_event_requested'
  | 'state_schema_rejected' | 'state_not_serializable';

/** Present where a retry is in prospect, `null` where none is. Milliseconds throughout. */
type ArvoFaultRetry = {
  readonly max_retry_attempts_allowed: number;
  readonly retry_in_ms: number;
  /** `timestamp + retry_in_ms`, as ms since the Unix epoch. */
  readonly retry_at: number;
};

/**
 * Why a delivery could not be carried through. An error, so `execute` throws it and
 * `tryExecute` reports it, and a durable format, so a mechanism may dead-letter it and
 * another language may read what it dead-lettered.
 */
class ArvoHandlerFault extends Error {
  override readonly name = 'ArvoHandlerFault';
  readonly fault_kind: ArvoFaultKind;
  /** The underlying failure rendered as a string, so the whole object survives JSON. */
  override readonly cause: string | null;
  override readonly stack: string | undefined;
  /** Every check that failed, not only the first. One readable line each. */
  readonly violations: readonly string[];

  readonly subject: string;
  /** The key the state function was called with. `null` only where classification failed. */
  readonly execution_id: string | null;
  readonly event_id: string;

  readonly attempt: number;
  /** When this delivery was processed, as ms since the Unix epoch. */
  readonly timestamp: number;
  readonly retry: ArvoFaultRetry | null;

  /**
   * What to act on if this execution is abandoned, and only then. Neither is acted on
   * when the fault is received, and whether to abandon at all is the mechanism's policy.
   */
  readonly abandonment_event: ArvoEvent | null;
  readonly abandonment_state: ArvoExecutionRecord | null;

  /** The whole object as JSON, for a mechanism that stores it. */
  toJSON(): ArvoSerializedHandlerFault;
}
```

Its field names are ADR-008's own rather than this package's camel case, for the reason
`ArvoEvent` carries ADR-001's: both are durable formats, a fault stored by one language must be
readable by another, and a second spelling is a second format. `name`, `message`, `stack` and
`cause` are the ones `Error` already has, each narrowed rather than added.

```ts
// The call itself. Not an adapter: an adapter is whatever code already sits around a queue
// and a store, and this is what that code does when an event arrives.
const delivery = await handler.tryExecute({
  event: incoming,
  attempt: message.deliveryCount,
  state: ({ executionId }) => store.read(executionId),
  dependencies: () => ({ db }),
});

if (!delivery.ok) return policy.handle(delivery.error);        // a fault, and it says what to do
if (delivery.value.kind === 'produced') {
  await store.commitAndPublish(delivery.value.record, delivery.value.events);
}
```

`tryExecute` is the pair every fallible operation in this package comes as, and `execute` is the
thin unwrap that throws the fault instead. A fault is the expected failure of a delivery, which is
what a `Result`'s error channel is for, and ADR-008 makes the fault an error type in its own
right — so it reports as `Err` and throws from `execute` without anything being wrapped. Anything
that is not a fault escaping the handler is a defect and propagates out of `tryExecute`
unconverted, per `project.md` — *Result types*.

**Both are change 6, not change 1.** They need the gate, the record and the fault object, so it
cannot exist before them. It is sketched here because the shape of the whole decides what the
declaration has to carry, and because a reader of change 1 is owed an answer to what any of it
is eventually for.

## Using it

```ts
// A handler implementing one contract, calling one service, with two versions.
const handler = new ArvoEventHandler({
  contract: orderContract,                       // declares 1.0.0 and 1.1.0
  services: { payments: paymentContract.versions['1.0.0'] },
  options: { maxRetryAttempts: 5, runTimeout: 10_000 },
  versions: {
    '1.0.0': {
      state: z.object({ orderId: z.string(), attempts: z.number() }),
      options: { maxDepth: 250, executionTimeout: 86_400_000 },
      execute: async (ctx) => { /* typed against this version -- see above */ },
    },
    '1.1.0': {
      execute: async (ctx) => { /* stateless: no state schema */ },
    },
    '1.2.0': async (ctx) => { /* stateless: no state schema can also be definde as this with no otehr config */ },
  },
});
```

Options resolve version-then-handler, and a consumer never sees the resolution: for the handler
above, version `1.0.0` runs with its own maximum depth of 250, the handler's five retry attempts,
and the protocol's own `'all'` collection strategy, while `1.1.0` and `1.2.0` inherit all seven.
That is an internal function the changes which run a delivery read, not a method on the class.

```ts
// Omitted inherits; a written null is a value. The two are never the same answer.
new ArvoEventHandler({ ..., options: { runTimeout: 10_000 },
  versions: { '1.0.0': { execute, options: {} } } });            // runTimeout 10_000
new ArvoEventHandler({ ..., options: { runTimeout: 10_000 },
  versions: { '1.0.0': { execute, options: { runTimeout: null } } } });  // unbounded
```

```ts
// Declaring what the mechanism will hand every executor. Types only -- no value is stored.
const handler = new ArvoEventHandler({
  contract: orderContract,
  versions: { '1.0.0': async (ctx) => { ctx.dependencies.db.find(); ctx.hooks.scheduler; } },
  types: { dependencies: {} as { db: Db }, mechanismHooks: {} as { scheduler: Scheduler } },
});
// Omit `types` and both are empty: ctx.dependencies.db does not compile, because none was declared.
```

```ts
// A handler may call itself. Recursion is permitted, and is not a collision.
new ArvoEventHandler({
  contract: treeWalkContract,
  services: { self: treeWalkContract.versions['1.0.0'] },
  versions: { '1.0.0': { execute } },
});
```

```ts
// Declaration errors, all of them, before any event exists.
new ArvoEventHandler({ contract: orderContract, versions: { '1.0.0': { execute } } });
// throws ArvoEventHandlerValidationError -- no executor for 1.1.0

new ArvoEventHandler({ ..., options: { runTimeout: 30_000, executionTimeout: 5_000 } });
// throws -- an attempt could never finish inside the execution's own bound

const attempt = tryCreateArvoEventHandler({ ... });
if (!attempt.ok) attempt.error.issues;   // every rule broken, each with its position
```

## Capabilities

### New Capabilities

- `event-handler`: what an ArvoEventHandler is, what declaring one requires, which declarations are refused, and how a version's options are resolved. Changes 2 through 6 add the record, faults, the execution context, the bounds and the delivery to this same capability.

### Modified Capabilities

None. `arvo-contract` is read and not changed — a handler names a contract and its versions, and asks nothing new of either. `arvo-event` is untouched: this change constructs no event.

## Impact

**Affected code**

- `src/ArvoEventHandler/index.ts` (new) — the class
- `src/ArvoEventHandler/types.ts` (new) — the param types, the executor type, the options types
- `src/ArvoEventHandler/options.ts` (new, internal) — the seven defaults, and version-then-handler resolution. Not exported.
- `src/ArvoEventHandler/declaration.ts` (new) — the rules that reject a declaration
- `src/ArvoEventHandler/errors.ts` (new) — `ArvoEventHandlerValidationError`
- `src/factories/createArvoEventHandler.ts` (new) — the `tryX`/`X` pair
- `src/index.ts` — new public exports
- `tests/ArvoEventHandler/` (new) — mirroring the modules above
- `ts/sandbox/src/playground.ts` — a section declaring a handler, including the shorthand version form, and showing a refused declaration

**Dependencies**

None added. `zod/v4/core` for the state schema's type, `ArvoDomain` for the error domain, `neverthrow` through `src/result.ts` for the pair. All present.

**Not touched**

- `src/ArvoContract/` — a declaration reads a contract. Its `type`, `versions`, `outputs` and `error` supply everything the rules compare, and none is re-derived.
- `src/ArvoEvent/` — no event is built here.
- `src/ArvoDomain/` — consumed as it stands.

**Release**: additive. Nothing published yet.

## Out of Scope

Everything the plan assigns to changes 2 through 6, and specifically:

- **Running anything.** `tryExecute` and `execute` are sketched under **How a handler is run** and built in change 6. In this change no event is classified, no record is read or written, and no executor is called. A declared handler is inert, and the spec says so rather than implying a delivery path exists.
- **Building the execution context.** Its shape is sketched above, and change 1 carries the generics it needs, but nothing constructs one here. Two of its members — `fault` and the record-backed half of `identity` and `collected` — are typed against changes 2 and 3, so the type itself lands with change 4 alongside the code that fills it.
- **The state schema's contents.** ADR-007 makes a version's state schema the author's, and the protocol places no rule on how it changes. This change holds the schema; it validates nothing against it.
- **Emission.** The per-version emittable set is computed because the collision rule needs it, and held internally. Deriving `to`, `subject` or any other field from a type is ADR-006's *Addressing an emitted event* and belongs to change 4.
- **The mechanism's obligations.** ADR-006 places five on whatever runs a handler. This package is not a mechanism and implements none of them.
- **Anything the ADRs defer.** Timers and deadlines, a bound on fan-out, capability profiles as a format, error kinds beyond handler failure. Each is deferred in an accepted ADR and stays deferred here.
