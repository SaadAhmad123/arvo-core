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

- **A declaration is built in three steps.** `setupArvoEventHandler(...)`, or `ArvoEventHandler.setup(...)` for the same thing, holds the contract implemented, the services, the handler-level options and the two type shapes. `.handler(version, ...)` declares one version and is repeated. `.build()` runs every rule and returns the handler.

- **`ArvoEventHandler`'s constructor is not public.** With a terminal `build` there is one way to declare a handler, and the constructor could not validate anything anyway: it never sees the versions. It holds the validation and `tryBuild` is derived from it, per `project.md` — *Result types*.

- **Two helpers type a version written away from the chain**, `InferArvoHandlerVersion` and `InferArvoHandlerExecutor`, so a handler with several substantial versions need not be one file.

- **The `tryX`/`X` pair is at the end of the chain**, `tryBuild` and `build`. Nothing earlier can fail, so nothing earlier returns a `Result`.

- **Every declaration rule ADR-006 states, checked at declaration:**

| Rule | ADR-006 |
|---|---|
| a handler for every version the self contract declares | *One executor per version* |
| no handler declared for a version the contract does not declare | *One executor per version* |
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

A declaration is built in three steps: **setup** holds everything there is exactly one of,
**handler** is repeated once per version, and **build** is where every rule runs and where a
handler comes into existence. Nothing before build can fail, so nothing before it returns a
`Result`.

```ts
/** Starts a declaration. Returns a setup, not a handler. */
function setupArvoEventHandler<T, M, X, D, H>(
  param: ArvoEventHandlerSetupParam<T, M, X, D, H>,
): ArvoEventHandlerSetup<T, M, X, D, H>;

/** The same thing under a static name. One implementation, two ways to reach it. */
ArvoEventHandler.setup(param);

class ArvoEventHandlerSetup<
  T extends string,
  M extends ArvoContractVersionMapParam,
  X extends ArvoServiceMap,
  D extends ArvoDependencies,
  H extends ArvoMechanismHooks,
  Declared extends ArvoDeclaredVersions = {},   // what has been declared so far
> {
  /** Declares one version. Returns a new setup carrying it; nothing is mutated. */
  handler<V extends keyof M & ArvoSemanticVersion, S extends z.$ZodObject | undefined = undefined>(
    version: V,
    declaration: ArvoVersionDeclaration<T, M, V, X, S, D, H> | ArvoEventHandlerExecutor<T, M, V, X, undefined, D, H>,
  ): ArvoEventHandlerSetup<T, M, X, D, H, Declared & Record<V, S>>;

  /** Runs every rule and reports each one broken, or gives back the handler. */
  tryBuild(): Result<ArvoEventHandler<T, M, X, D, H, Declared>, ArvoEventHandlerValidationError>;
  /** {@link tryBuild}, throwing instead of reporting. */
  build(): ArvoEventHandler<T, M, X, D, H, Declared>;
}
```

The setup holds what a handler has one of:

```ts
type ArvoEventHandlerSetupParam<T, M, X, D, H> = {
  /** The contract implemented. A contract, not a version. */
  contract: ArvoContract<T, M>;
  /** The contracts it may send to, each at one version, under the name you give. */
  services?: X;
  /** Defaults for every version. Omit one and the protocol's own default fills it. */
  options?: Partial<ArvoEventHandlerOptions>;
  /** Types only. Neither is stored, and both are empty when omitted. */
  types?: Partial<{ mechanismHooks: H; dependencies: D }>;
};

/** One version, where it has more to say than its executor. */
type ArvoVersionDeclaration<T, M, V, X, S, D, H> = {
  state?: S;
  options?: Partial<ArvoEventHandlerOptions>;
  execute: ArvoEventHandlerExecutor<T, M, V, X, S, D, H>;
};
```

**Why a chain rather than a map of versions.** A version's `execute` has to be typed by that
version's own `state` schema, and TypeScript will not read one key of an object literal to type
another key of the same literal. Each `handler` call is its own inference, so the schema is
settled before the executor is checked. The version is named once, as the argument, which no
other shape achieved.

**Completeness is checked at build, not by the compiler.** A handler missing a version the
contract declares is refused when `build` runs, alongside every other rule. Gating the terminal
call on a type-level accumulator was considered and is recorded as rejected in `design.md`.

## Writing a version somewhere else

A handler with several substantial versions should not be one file. Two helpers type a version
written away from the chain, and both take the setup as their first argument, so everything the
context needs is already known.

```ts
// one file
export const setup = setupArvoEventHandler({ contract: orderContract, services, types });
export const orderState = z.object({ orderId: z.string() });

// another file, fully typed with no chain in sight
export const v100: InferArvoHandlerVersion<typeof setup, '1.0.0', typeof orderState> = {
  state: orderState,
  options: { maxDepth: 250 },
  execute: async (ctx) => { ctx.setState({ orderId: ctx.event.data.items[0] }) },
};

// a version that declares no schema. The third argument is optional and omitted here.
export const v110: InferArvoHandlerVersion<typeof setup, '1.1.0'> = {
  execute: async (ctx) => { ctx.event.data.rush },
};

// just the executor, where a version is only that
export const v120: InferArvoHandlerExecutor<typeof setup, '1.2.0'> = async (ctx) => {};

// assembly
const handler = setup.handler('1.0.0', v100).handler('1.1.0', v110).handler('1.2.0', v120).build();
```

An annotation is resolved before the value it types, so `ctx` is typed from the annotation
rather than from a sibling key, and the circularity that forces the chain does not arise.

**Omitting the third argument forbids declaring a schema**, rather than quietly ignoring one:

```ts
const bad: InferArvoHandlerVersion<typeof setup, '1.1.0'> = {
  state: orderState,   // does not compile: the annotation was not told about a schema
  execute: async (ctx) => {},
};
```

Without that, forgetting `typeof orderState` in the annotation would leave the schema declared
and the executor's state untyped, with nothing to notice it. Untyped state stays reachable
either way — a version with no schema has `state` as any JSON object — so the rule costs a
version nothing except the requirement to say what it is doing.

The one cost, and it applies only to a version that declares a schema this way: the schema is
named twice, once in the annotation and once as the property. Declared inline through `handler`
it is named once. Both forms are supported and neither is preferred by the protocol.

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

**Everything the protocol does happens inside that one call.** Classification, the sixteen-step
gate, reading and validating the record, hydrating its events, resolving options and dependencies,
building the context, entering the executor, validating what it returns, building the next record,
and building a fault with its abandonment pair where any of it refuses. ADR-010's *One delivery,
in order* is the sequence, and `tryExecute` is where that sequence lives. A caller does not
assemble it and cannot reach into the middle of it.

Behind the call it is many files, not one. The decomposition follows the sequence — a module per
gate step group, one for classification, one for hydration, one for the context, one for return
validation, one for building each of the two things a delivery can produce — and every one of them
is internal. None is exported, none appears in `src/index.ts`, and the boundary stays two methods
wide however many modules sit behind it.

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
// A handler implementing one contract, calling one service, with three versions.
const handler = setupArvoEventHandler({
  contract: orderContract,                       // declares 1.0.0, 1.1.0 and 1.2.0
  services: { payments: paymentContract.versions['1.0.0'] },
  options: { maxRetryAttempts: 5, runTimeout: 10_000 },
})
  .handler('1.0.0', {
    state: z.object({ orderId: z.string(), attempts: z.number() }),
    options: { maxDepth: 250, executionTimeout: 86_400_000 },
    execute: async (ctx) => { /* ctx.state is typed by the schema above */ },
  })
  .handler('1.1.0', { options: { collect: 'each' }, execute: async (ctx) => {} })
  .handler('1.2.0', async (ctx) => { /* nothing but an executor */ })
  .build();
```

Options resolve version-then-handler, and a consumer never sees the resolution: for the handler
above, version `1.0.0` runs with its own maximum depth of 250, the handler's five retry attempts,
and the protocol's own `'all'` collection strategy, while `1.2.0` inherits all seven. That is an
internal function the changes which run a delivery read, not a method on anything.

```ts
// Omitted inherits; a written null is a value. The two are never the same answer.
setupArvoEventHandler({ contract, options: { runTimeout: 10_000 } })
  .handler('1.0.0', { options: {}, execute })                       // runTimeout 10_000
  .build();

setupArvoEventHandler({ contract, options: { runTimeout: 10_000 } })
  .handler('1.0.0', { options: { runTimeout: null }, execute })     // unbounded
  .build();
```

```ts
// Declaring what the mechanism will hand every executor. Types only -- no value is stored.
ArvoEventHandler.setup({
  contract: orderContract,
  types: { dependencies: {} as { db: Db }, mechanismHooks: {} as { scheduler: Scheduler } },
}).handler('1.0.0', async (ctx) => { ctx.dependencies.db.find(); ctx.hooks.scheduler });
// Omit `types` and both are empty: ctx.dependencies.db does not compile, because none was declared.
```

```ts
// A handler may call itself. Recursion is permitted, and is not a collision.
setupArvoEventHandler({
  contract: treeWalkContract,
  services: { self: treeWalkContract.versions['1.0.0'] },
}).handler('1.0.0', execute).build();
```

```ts
// Declaration errors, all of them, at build and before any event exists.
setupArvoEventHandler({ contract: orderContract }).handler('1.0.0', execute).build();
// throws ArvoEventHandlerValidationError -- no handler for 1.1.0 or 1.2.0

setupArvoEventHandler({ contract, options: { runTimeout: 30_000, executionTimeout: 5_000 } })
  .handler('1.0.0', execute)
  .build();
// throws -- an attempt could never finish inside the execution's own bound

const attempt = setup.handler('1.0.0', execute).tryBuild();
if (!attempt.ok) attempt.error.issues;   // every rule broken, each with its position
```

## Capabilities

### New Capabilities

- `event-handler`: what an ArvoEventHandler is, what declaring one requires, which declarations are refused, and how a version's options are resolved. Changes 2 through 6 add the record, faults, the execution context, the bounds and the delivery to this same capability.

### Modified Capabilities

None. `arvo-contract` is read and not changed — a handler names a contract and its versions, and asks nothing new of either. `arvo-event` is untouched: this change constructs no event.

## Impact

**Affected code**

- `src/ArvoEventHandler/index.ts` (new) — the class, its constructor not exported for use
- `src/ArvoEventHandler/types/` (new) — one module per group, no barrel: `schema.ts`, `supplied.ts`, `options.ts`, `services.ts`, `context.ts`, `executor.ts`, `declaration.ts`, `infer.ts`
- `src/ArvoEventHandler/setup.ts` (new) — the setup, its `handler` method, and `build`/`tryBuild`
- `src/ArvoEventHandler/options.ts` (new, internal) — the seven defaults, and version-then-handler resolution. Not exported.
- `src/ArvoEventHandler/declaration.ts` (new) — the rules that reject a declaration
- `src/ArvoEventHandler/errors.ts` (new) — `ArvoEventHandlerValidationError`
- `src/factories/setupArvoEventHandler.ts` (new) — the free function delegating to `ArvoEventHandler.setup`
- `src/index.ts` — new public exports
- `tests/ArvoEventHandler/` (new) — mirroring the modules above
- `ts/sandbox/src/playground.ts` — a section declaring a handler through the chain, one version written standalone through `InferArvoHandlerVersion`, and a refused declaration

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
