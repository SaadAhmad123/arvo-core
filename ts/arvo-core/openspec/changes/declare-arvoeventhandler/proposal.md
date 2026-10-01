## Why

`project.md` names three application-tier primitives: `ArvoEvent`, `ArvoContract`, `ArvoEventHandler`. Two exist. The third has no implementation and, until recently, no specification either — ADR-005 deferred handler behaviour and nothing had settled it.

That gap is now closed. [ADR-006](../../../../../docs/adr/006-arvoeventhandler-protocol.md) through [ADR-010](../../../../../docs/adr/010-delivery-classification-and-entry-validation.md) are accepted and define the protocol end to end. This is the first of six changes that build it in TypeScript.

It delivers the one thing every later change rests on, and nothing else: **a declared handler**. That is not an arbitrary first slice. ADR-006 puts most of its refusals at declaration — a version with no executor, an executor naming an undeclared version, two declared capabilities sharing an event type, two versions of one service contract, an option outside its domain, an execution timeout shorter than a run timeout. Every one of them is rejected *before any event exists*, which makes declaration a complete piece of behaviour with its own tests and no dependency on anything that runs.

## The plan

Four changes, built inward out. Each compiles against the one before it, and each is shippable
on its own.

| | Change | Builds | From |
|---|---|---|---|
| **1** | **`declare-arvoeventhandler`** — this one | the execution state an execution remembers, the fault a delivery raises, the whole context an executor receives, the version that runs against it, the handler that holds versions, and every rule that refuses a declaration | ADR-006 *Definition and declaration*, *Options*, *The execution context*, *Addressing an emitted event*, *Observability*; ADR-007; ADR-008's fault object and retry verdict; ADR-009's depth and clock bounds |
| 2 | `arvo-handler-delivery` | classification, the sixteen-step gate, hydration, `tryExecute` / `execute`, validation of a whole returned batch, enforcing the two clocks, rebuilding the awaited collection on emission, and the abandonment pair | ADR-010; ADR-008's abandonment; ADR-009's enforcement |

**Built inward out, and that is what moved the boundaries.** The context is the innermost thing
and everything above it is shaped by what it needs, so it is written first, then the version that
runs against it, then the handler that holds versions. Writing the shells first means guessing
the inner interface and bending the inner thing to fit the guess.

**Which pulled four changes into this one, and that was the ordering working rather than failing.**
It began as six. The context holds the execution state, so ADR-007's record had to exist rather
than be described; writing state checks it, and a rejected write raises the fault ADR-008 names,
so the fault had to exist too. Then the same argument kept applying outward. An executor cannot
be given a context whose `build` is missing, so emission came in. It cannot read `atMaxDepth` or
`timeRemaining` from a class that does not have them, so ADR-009's bounds came in. Each time,
deferring the member would have meant a context built against a placeholder, which is the one
thing this ordering exists to prevent.

**What that leaves for change 2.** Everything ADR-009 and ADR-010 define that needs a *delivery*
rather than a context: enforcing the two clocks rather than reporting what remains of them,
judging a whole returned batch rather than one candidate event, rebuilding the awaited collection
from a batch's emissions, and the gate that decides whether an executor is entered at all. The
split is no longer by ADR but by whether a delivery is in hand, which is the only boundary that
held.

**The context is complete here.** Every member ADR-006's table requires is on it: the delivered
event and the init event through `state`, the identity and the collection through it too, `entry`,
`attempt`, `dependencies`, the mechanism hooks, `build`, `atMaxDepth`, `timeRemaining`, `cancel`,
`fault`, and telemetry as a span, a meter and a logger. Nothing about it is deferred.

## What Changes

- **New capability `event-handler`** — the handler primitive. This change gives it the execution context, the version, the handler and every rule that refuses a declaration; change 2 accumulates into the same capability, per `project.md` — *Capability conventions*.

- **A declaration is built in three steps.** `setupArvoEventHandler(...)`, or `ArvoEventHandler.setup(...)` for the same thing, holds the contract implemented, the services, the handler-level options and the two type shapes. `.handler(version, ...)` declares one version and is repeated. `.build()` runs every rule and returns the handler.

- **`ArvoEventHandler`'s constructor is not public.** With a terminal `build` there is one way to declare a handler, and the constructor could not validate anything anyway: it never sees the versions. It holds the validation and `tryBuild` is derived from it, per `project.md` — *Result types*.

- **`createArvoEventHandlerVersion(setup, version, declaration)` declares a version away from the chain**, taking exactly what `handler` takes inline, so a handler with several substantial versions need not be one file.

- **A record reaches a store and comes back.** `ArvoExecutionStateSerializer` reads like `ArvoEventSerializer`: a `tryX` pair each way, its own error, and no opinion about where the string goes. It is bound to one version's data schema, that being the one thing a record does not carry. Reading back is where a record's events are restored and its data is checked.

- **Five classes, built inward out.** `ArvoExecutionState` is what an execution remembers, `ArvoHandlerFault` is why a delivery could not be carried through, `ArvoExecutionContext` is what an executor receives, `ArvoHandlerVersion` is what runs against it, and `ArvoEventHandler` holds versions. Each is written against the ones below it rather than against a placeholder.

- **`ctx.state` is the execution record, and `setState` writes only its data.** An executor reads everything the execution knows about itself and changes the one field it owns. Each write mints a new state with the rest carried across, so the lifecycle, the identity and the event log cannot be touched even by accident.

- **A rejected write raises a fault, not a bare error.** `ArvoHandlerFault` carries ADR-008's full field set, and a state the schema refuses raises `state_schema_rejected` at the line that wrote it.

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
const handler = setupArvoEventHandler({
  contracts: {
    self: orderContract,
    services: { payments: paymentContract.versions['1.0.0'] },
  },
  options: { maxRetryAttempts: 5 },
  types: { dependencies: {} as { db: Db } },
})
  .handler('1.0.0', { state: orderState, execute: async (ctx) => {} })
  .handler('1.1.0', async (ctx) => {})
  .build();

handler.contracts.self.type;                            // 'com_order_create'
handler.contracts.services.payments.type;               // 'com_payment_charge'
handler.versions.get('1.0.0').options.maxRetryAttempts; // 5
handler.versions.get('9.9.9');                          // does not compile
```

Four generics, named and every one defaulted, so the bare name is a usable type:

```ts
class ArvoEventHandler<
  TSelf extends ArvoContract = ArvoContract,
  TServices extends ArvoServiceMap = ArvoServiceMap,
  TDependencies extends ArvoDependencies = ArvoNone,
  TMechanismHooks extends ArvoMechanismHooks = ArvoNone,
> {
  /** What this handler implements, and what it may send to. */
  readonly contracts: {
    readonly self: TSelf;
    readonly services: Readonly<TServices>;
  };
  /**
   * Every declared version, keyed by the versions the self contract declares.
   * `.get('9.9.9')` does not compile, and nothing comes back `undefined` —
   * `build` has already refused a declaration missing a version.
   */
  readonly versions: ArvoVersionMap<TSelf, TServices, TDependencies, TMechanismHooks>;
}
```

Nothing threads a version map alongside the contract, because the contract carries one:

```ts
/** A version the self contract declares. */
type ArvoVersion<TSelf extends ArvoContract> = keyof TSelf['versions'] & ArvoSemanticVersion;

/**
 * A real `Map` underneath; this only retypes its surface. A `ReadonlyMap`
 * returns `V | undefined` and gives every key one value type, so `.get` would
 * need a null check and would not carry that version's own state schema.
 */
type ArvoVersionMap<TSelf, TServices, TDependencies, TMechanismHooks> = {
  get<TVersion extends ArvoVersion<TSelf>>(
    version: TVersion,
  ): ArvoHandlerVersion<TSelf, TVersion, TServices, TDependencies, TMechanismHooks>;
  has(version: string): boolean;
  keys(): IterableIterator<ArvoVersion<TSelf>>;
  readonly size: number;
};
```

What one version is, and what it can do. A class, because a version is what runs, and one that
stands on its own rather than being filled in by whatever built it:

```ts
class ArvoHandlerVersion<TSelf, TVersion, TServices, TDependencies, TMechanismHooks, TState> {
  constructor(param: {
    /** Which version this is. */
    version: TVersion;
    /** This version of the contract implemented, and the contracts it may send to. */
    contracts: {
      self: VersionedArvoContract;
      services: TServices;
    };
    /** The schema for this version's state, or omitted. */
    state?: TState;
    /** The options in force. Complete, never partial: resolution has already happened. */
    options: ArvoEventHandlerOptions;
    /** Business code for this version. */
    execute: ArvoEventHandlerExecutor<TSelf, TVersion, TServices, TState, TDependencies, TMechanismHooks>;
  });

  readonly version: TVersion;
  readonly contracts: { readonly self: VersionedArvoContract; readonly services: Readonly<TServices> };
  readonly state: TState;
  readonly options: ArvoEventHandlerOptions;
  /** Worked out from the contracts above, not handed in. */
  readonly emittableTypes: ReadonlySet<string>;

  /** Runs this version's business code. Validating what it returns joins this in change 2. */
  execute(
    ctx: ArvoExecutionContext<TSelf, TVersion, TServices, TState, TDependencies, TMechanismHooks>,
  ): PromiseAble<ArvoEvent | ArvoEvent[] | void>;
}
```

**It takes its own version of the contract, not the whole one.** A version needs its own
`input`, `outputs` and handler error type, which is what a `VersionedArvoContract` is. Given
that and the services, it works out its own emittable types rather than being handed them.

**Its options are complete on the way in.** Resolution happens before a version is built, so
there is never a moment where one exists holding a sparse set nothing has finished.

**`options` is always what is in force**, with inheritance applied. There is no second property
holding what was declared: a consumer wrote that and has it in their own source, so reading it
back answers nothing.

The setup and the chain:

```ts
type ArvoEventHandlerSetupParam<TSelf, TServices, TDependencies, TMechanismHooks> = {
  /** The contract implemented, and the contracts it may send to. */
  contracts: { self: TSelf; services?: TServices };
  /** Defaults for every version. Omit one and the protocol's own default fills it. */
  options?: Partial<ArvoEventHandlerOptions>;
  /** Types only. Neither is stored, and both are empty when omitted. */
  types?: Partial<{ mechanismHooks: TMechanismHooks; dependencies: TDependencies }>;
};

class ArvoEventHandlerSetup<TSelf, TServices, TDependencies, TMechanismHooks> {
  /** Declares one version inline. Returns a new setup carrying it; nothing is mutated. */
  handler<TVersion extends ArvoVersion<TSelf>, TState extends z.$ZodObject | undefined = undefined>(
    version: TVersion,
    declaration: ArvoVersionInput<TSelf, TVersion, TServices, TDependencies, TMechanismHooks, TState>,
  ): ArvoEventHandlerSetup<TSelf, TServices, TDependencies, TMechanismHooks>;
  /** Adds a version made by `createArvoEventHandlerVersion`, which carries its own version. */
  handler<TVersion extends ArvoVersion<TSelf>, TState extends z.$ZodObject | undefined>(
    created: ArvoCreatedVersion<TSelf, TVersion, TServices, TDependencies, TMechanismHooks, TState>,
  ): ArvoEventHandlerSetup<TSelf, TServices, TDependencies, TMechanismHooks>;

  /** Runs every rule and reports each one broken, or gives back the handler. */
  tryBuild(): Result<
    ArvoEventHandler<TSelf, TServices, TDependencies, TMechanismHooks>,
    ArvoEventHandlerValidationError
  >;
  /** {@link tryBuild}, throwing instead of reporting. */
  build(): ArvoEventHandler<TSelf, TServices, TDependencies, TMechanismHooks>;
}
```

`ArvoEventHandler.setup(...)` is the same thing under a static name. One implementation, two ways
to reach it.

**Why a chain rather than a map of versions.** A version's `execute` has to be typed by that
version's own `state` schema, and TypeScript will not read one key of an object literal to type
another key of the same literal. Each `handler` call is its own inference, so the schema is
settled before the executor is checked. The version is named once, as the argument, which no
other shape achieved.

**Completeness is checked at build, not by the compiler.** A handler missing a version the
contract declares is refused when `build` runs, alongside every other rule. Gating the terminal
call on a type-level accumulator was considered and is recorded as rejected in `design.md`.

## Writing a version somewhere else

A handler with several substantial versions should not be one file. `createArvoEventHandlerVersion`
takes the setup, the version, and exactly what `handler` takes inline, so a version can be
declared anywhere and assembled later.

```ts
// one file
export const setup = setupArvoEventHandler({ contracts: { self: orderContract, services }, types });

// another file, fully typed with no chain in sight
export const v100 = createArvoEventHandlerVersion(setup, '1.0.0', {
  state: z.object({ orderId: z.string() }),
  options: { maxDepth: 250 },
  execute: async (ctx) => { ctx.setState({ data: { orderId: ctx.state.initEvent.data.items[0] } }) },
});

export const v110 = createArvoEventHandlerVersion(setup, '1.1.0', {
  execute: async (ctx) => { ctx.state.initEvent.data.rush },
});

// a version that is only an executor
export const v120 = createArvoEventHandlerVersion(setup, '1.2.0', async (ctx) => {});

// assembly. A created version knows which version it is, so it is named once overall.
const handler = setup.handler(v100).handler(v110).handler(v120).build();
```

**It is a function call, which is why it works.** The state schema is settled within the call
before the executor is checked, exactly as it is inline. The schema is written once, inside the
declaration it belongs to, and nothing has to be repeated in an annotation.

**No `tryCreate` twin.** Creating a version cannot fail, because nothing is validated until
`build`. Per `project.md` — *Result types*, which of the two a function is gets decided before
it is written, and this one has no failure channel.

**`handler` therefore takes two shapes**: a version and a declaration, for declaring inline, or
a created version on its own. They are the same declaration reached two ways, and the second
carries the version it was created with.

## What an executor will receive

A class, built fresh for one delivery, and the innermost thing in this change. Every type on it
is read off the declaration — the version of the contract implemented, the services declared —
so nothing is annotated by hand and nothing is `any`.

```ts
class ArvoExecutionContext<
  TSelf, TServices, TDataSchema, TArvoEntryKind, TDependencies, TMechanismHooks,
> {
  /** This version of the contract implemented, and what it may send to. */
  readonly contracts: { readonly self: TSelf; readonly services: Readonly<TServices> };

  /** Whether this delivery opened the execution or answers something it awaited. */
  readonly entry: TArvoEntryKind;
  /** Which attempt this delivery is, counting from 0. */
  readonly attempt: number;

  /** What this delivery's executor is given to work with, or empty. */
  readonly dependencies: TDependencies;
  /** What the mechanism running this handler exposed, or empty. */
  readonly hooks: TMechanismHooks;

  /**
   * Everything this execution remembers about itself, the delivered event
   * included. Typed from the contracts above, so nothing here is widened.
   */
  get state(): ArvoExecutionState<
    TDataSchema,
    ArvoInitEvent<TSelf>,
    ArvoDeliveredEvent<TSelf, TServices, TArvoEntryKind>
  >;

  /** Replaces this execution's own data, and nothing else about it. */
  setState(param: { data: ArvoDataWrite<TDataSchema> }): void;
}
```

**Nothing is on the context that the state already answers.** The delivered event and the event
that opened the execution are both on the record, so they are read there:
`ctx.state.triggeringEvent` and `ctx.state.initEvent`. What stays on the context is what the
record does not have — how this delivery was classified, which attempt it is, what the mechanism
supplied, and the live contracts, which are not the informational snapshot the record carries.ts
class ArvoExecutionContext<
  TSelf, TServices, TDataSchema, TArvoEntryKind, TDependencies, TMechanismHooks,
> {
  /** This version of the contract implemented, and what it may send to. */
  readonly contracts: { readonly self: TSelf; readonly services: Readonly<TServices> };

  /** Whether this delivery opened the execution or answers something it awaited. */
  readonly entry: TArvoEntryKind;
  /** The event delivered, which follows from how it was classified. */
  readonly event: ArvoDeliveredEvent<TSelf, TServices, TArvoEntryKind>;
  /** The event that opened this execution. The delivered event, on an init. */
  readonly initEvent: ArvoInitEvent<TSelf>;
  /** Which attempt this delivery is, counting from 0. */
  readonly attempt: number;

  /** What this delivery's executor is given to work with, or empty. */
  readonly dependencies: TDependencies;
  /** What the mechanism running this handler exposed, or empty. */
  readonly hooks: TMechanismHooks;

  /** Everything this execution remembers about itself. */
  get state(): ArvoExecutionState<TDataSchema>;
  /** Replaces this execution's own data, and nothing else about it. */
  setState(param: { data: ArvoDataWrite<TDataSchema> }): void;
}
```

**The delivered event is inferred from the contracts, and typed by how the delivery was
classified.** An init carries the event this version takes in. A followup carries whatever a
declared service answered with, its handler error included. Each member of that union has a
literal `type` and no two can share one, because the collision rule refuses that at declaration,
so narrowing reaches the exact payload.

```ts
execute: async (ctx) => {
  const delivered = ctx.state.triggeringEvent;
  if (delivered.type === 'evt_payment_charged') delivered.data.receipt;

  ctx.state.initEvent.data.items;   // what opened this execution
  ctx.entry;                        // 'init' | 'followup', how it was classified
  ctx.dependencies.db.find();       // what `types.dependencies` declared
}
```

**It carries every member the protocol defines**, so nothing about the context is deferred. What
is deferred is the handler *around* it: entering an executor, judging what one returns, and
enforcing the clocks whose remaining time the context reports.

## What an execution remembers

`ctx.state` is the execution record itself, not a bare payload. An executor can read everything
the execution knows about itself, and write only the one field it owns.

```ts
class ArvoExecutionState<
  TDataSchema extends z.$ZodObject = z.$ZodObject,
  TInitEvent extends ArvoEvent = ArvoEvent,
  TTriggeringEvent extends ArvoEvent = ArvoEvent,
> {
  /**
   * Checks the whole record as it is built, and throws
   * {@link ArvoExecutionStateValidationError} where any of it is wrong. A
   * record that exists is a record that was valid.
   */
  constructor(param: ArvoExecutionStateParam<TDataSchema, TInitEvent, TTriggeringEvent>);

  /** From something that is not yet a record, reporting rather than throwing. */
  static tryBuild<TDataSchema extends z.$ZodObject>(
    input: unknown,
    dataschema: TDataSchema,
  ): Result<ArvoExecutionState<TDataSchema>, ArvoExecutionStateValidationError>;
  /** {@link tryBuild}, throwing instead. */
  static build<TDataSchema extends z.$ZodObject>(
    input: unknown,
    dataschema: TDataSchema,
  ): ArvoExecutionState<TDataSchema>;

  /**
   * This executor's own business state, and the only field an executor may
   * change. `null` until something writes: every other field is known the
   * moment an execution opens, and this one is not.
   *
   * The schema is a type parameter and nothing more. It types this field and
   * is never carried, because a record is data and a schema is code.
   */
  readonly data: z.output<TDataSchema> | null;

  /** Identity, and where this execution sits. */
  readonly subject: string;
  readonly executionId: string;
  readonly parentExecutionId: string;
  readonly depth: number;
  readonly source: string;
  readonly version: ArvoSemanticVersion;

  /** Where it rests, and why. */
  readonly lifecycle: ArvoExecutionLifecycle;
  readonly lifecycleDescription: string | null;

  /** What opened it, and what caused the delivery being processed. */
  readonly initEvent: TInitEvent;
  readonly triggeringEvent: TTriggeringEvent;

  /** What it has touched, and what it is waiting on. */
  readonly eventIds: readonly ArvoTouchedEvent[];
  readonly inFlightEventMap: ReadonlyMap<string, ArvoEvent | null>;

  /** Bookkeeping a mechanism needs, and a reader years later. */
  readonly recordFormatVersion: string;
  readonly casVersion: number;
  readonly contracts: ArvoRecordContracts;
}

/**
 * A new state with the fields named replaced and every other one carried
 * across. The only way a record changes.
 *
 * A function rather than a method, so the record stays a record: fields and
 * no behaviour. Generic in the state it is given, so what comes back is the
 * same kind of state and not a widened one.
 */
declare function tryMutateState<TState extends ArvoExecutionState>(
  current: TState,
  next: Partial<ArvoExecutionStateFields<
    TState['data'], TState['initEvent'], TState['triggeringEvent']
  >>,
): Result<TState, ArvoExecutionStateValidationError>;
/** {@link tryMutateState}, throwing instead. */
declare function mutateState<TState extends ArvoExecutionState>(
  current: TState,
  next: Partial<ArvoExecutionStateFields<
    TState['data'], TState['initEvent'], TState['triggeringEvent']
  >>,
): TState;
```

**The envelope is checked as a record is built, the way an event's is.** Every field has a
shape: the identifiers are strings, `depth` and `casVersion` are non-negative integers,
`lifecycle` is one of six values, `recordFormatVersion` is a semantic version, and the two
events are events. A record that exists is a record that was valid, so nothing downstream
re-checks it, and `ArvoExecutionState.tryBuild` is how one is rebuilt from something that is
not yet a record — a row from a store, a fixture, a replay.

**Generic in the two events it holds, not in the contracts they came from.** A record holds
events; it does not resolve contracts, route against them or validate with them. Typing it by
what it holds keeps it a record, and whoever builds one already knows which events they are.

**`initEventId` and `initEventSource` are gone.** They were the caller's address, read off the
init event, and the init event is right here. One value, one place.

**Writing mints a new one.** `setState({ data })` checks the value against the schema the
context holds, then produces a fresh `ArvoExecutionState` with the checked data and every other
field carried across unchanged. Three things follow, and each is the
point rather than a side effect:

- **An executor cannot touch what is not its own.** The lifecycle, the identity, the event log
  and the collection are carried, not writable, so they cannot be changed even by accident.
- **What was read stays what was read.** A value held before a write is still that value after
  one, so nothing an executor captured goes stale under it.
- **A delivery keeps the last one produced.** There is no merge step and no question of which
  copy is current.

**`data` takes a value or a function.** The function receives what is there now, so building on
it is not the caller's bookkeeping. Every write is checked as it happens, against the schema the
context was given, and a rejected one raises `ArvoHandlerFault` at the line that wrote it rather
than surfacing later with nothing to point at.

**Only `data` is ever empty.** An execution knows its subject, its identity, its depth, where it
rests and what opened it from the moment it opens. It does not know what its business logic will
choose to remember, and a schema with a required field has no value to show before the first
write. So the record is whole from the start with `data` alone `null`, rather than the record
itself being absent.

**The state itself checks nothing, and holds no schema.** It carries what an execution
remembers; the schema that governs its data is supplied by whoever is doing something with it —
the context on a write, the serializer on a read. That keeps a record purely data, which is what
lets it be stored and read back without a rule travelling alongside it and going stale.

```ts
ctx.state.data;                                      // null until something writes
ctx.state.lifecycle;                                 // 'waiting', and not writable
ctx.setState({ data: { orderId: 'o-1', attempts: 1 } });
ctx.setState({ data: (current) => ({ ...current, attempts: (current?.attempts ?? 0) + 1 }) });
```

## Storing what an execution remembers, and reading it back

A record outlives the delivery that wrote it, so it has to reach a store and come back. That is
`ArvoExecutionStateSerializer`, which reads the way `ArvoEventSerializer` already does: a `tryX`
pair at each direction, its own error carrying the original cause, and no opinion about where
the string goes.

```ts
class ArvoExecutionStateSerializer<
  TDataSchema extends z.$ZodObject,
  TInitEvent extends ArvoEvent = ArvoEvent,
  TTriggeringEvent extends ArvoEvent = ArvoEvent,
> {
  /**
   * Bound to one version's data schema, because every record it reads back
   * belongs to that version and a schema is the one thing a record does not
   * carry.
   */
  constructor(dataschema: TDataSchema);

  /** To a wire string, reporting the outcome rather than throwing. */
  trySerialize(
    state: ArvoExecutionState<TDataSchema, TInitEvent, TTriggeringEvent>,
  ): Result<string, ArvoExecutionStateSerializerError>;
  /** {@link trySerialize}, throwing instead. */
  serialize(state: ArvoExecutionState<TDataSchema, TInitEvent, TTriggeringEvent>): string;

  /** Back to a state, checked and with its events restored. */
  tryDeserialize(
    data: string,
  ): Result<
    ArvoExecutionState<TDataSchema, TInitEvent, TTriggeringEvent>,
    ArvoExecutionStateSerializerError
  >;
  /** {@link tryDeserialize}, throwing instead. */
  deserialize(data: string): ArvoExecutionState<TDataSchema, TInitEvent, TTriggeringEvent>;
}
```

```ts
const serializer = new ArvoExecutionStateSerializer(orderState);

const wire = serializer.serialize(ctx.state);   // to whatever stores it
const restored = serializer.deserialize(wire);

restored.data.orderId;              // typed, and checked on the way back
restored.inFlightEventMap;          // every stored event, an ArvoEvent again
```

**Reading back restores, and the record checks itself.** A stored record is JSON: its events
are plain objects and its collection is an object rather than a map. The serializer parses the
string, turns each event back into an `ArvoEvent`, rebuilds the map, and hands the result to
`ArvoExecutionState.tryBuild`, which checks the envelope and the data. Nothing is checked twice
and nothing half-restored comes back.

**What it checks on the way back, and what it does not.** It restores every event to a
structurally valid `ArvoEvent` and checks `data` against the schema it was built with. It does
not check an event against a contract: whether a stored event still belongs to the contract it
claims is a delivery's question, not a reader's. The two event type parameters are therefore the
caller's statement of which events these are, and the gate is what confirms it.

**Bound to a schema once rather than given one per call.** Whoever reads records back is reading
records of one version, so the schema belongs on the serializer rather than repeated at every
call. It also makes the return type exact: `deserialize` gives back a state typed by that
schema, with nothing for a caller to assert.

**Synchronous, where the event serializer is asynchronous.** That one is async because a
CloudEvent converter may be, and a caller may supply their own. A record has one format and no
converter, so there is nothing to await and pretending otherwise would cost every caller an
`await` for nothing.

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
  contracts: {
    self: orderContract,                                  // declares 1.0.0, 1.1.0 and 1.2.0
    services: { payments: paymentContract.versions['1.0.0'] },
  },
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

```ts
// One accessor answers everything about a version, with inheritance applied.
handler.versions.get('1.0.0').options.maxDepth;          // 250   -- its own
handler.versions.get('1.0.0').options.maxRetryAttempts;  // 5     -- the handler's
handler.versions.get('1.0.0').options.collect;           // 'all' -- the protocol's
handler.versions.get('1.2.0').options.maxDepth;          // 10000 -- the protocol's
handler.versions.get('1.0.0').emittableTypes;            // what it may send
handler.versions.get('9.9.9');                           // does not compile
```

```ts
// Omitted inherits; a written null is a value. The two are never the same answer.
setupArvoEventHandler({ contracts: { self }, options: { runTimeout: 10_000 } })
  .handler('1.0.0', { options: {}, execute })
  .build()
  .versions.get('1.0.0').options.runTimeout;                      // 10_000

setupArvoEventHandler({ contracts: { self }, options: { runTimeout: 10_000 } })
  .handler('1.0.0', { options: { runTimeout: null }, execute })
  .build()
  .versions.get('1.0.0').options.runTimeout;                      // null, unbounded
```

```ts
// Declaring what the mechanism will hand every executor. Types only -- no value is stored.
ArvoEventHandler.setup({
  contracts: { self: orderContract },
  types: { dependencies: {} as { db: Db }, mechanismHooks: {} as { scheduler: Scheduler } },
}).handler('1.0.0', async (ctx) => { ctx.dependencies.db.find(); ctx.hooks.scheduler });
// Omit `types` and both are empty: ctx.dependencies.db does not compile, because none was declared.
```

```ts
// A handler may call itself. Recursion is permitted, and is not a collision.
setupArvoEventHandler({
  contracts: { self: treeWalkContract, services: { self: treeWalkContract.versions['1.0.0'] } },
}).handler('1.0.0', execute).build();
```

```ts
// Declaration errors, all of them, at build and before any event exists.
setupArvoEventHandler({ contracts: { self: orderContract } }).handler('1.0.0', execute).build();
// throws ArvoEventHandlerValidationError -- no handler for 1.1.0 or 1.2.0

setupArvoEventHandler({
  contracts: { self: orderContract },
  options: { runTimeout: 30_000, executionTimeout: 5_000 },
}).handler('1.0.0', execute).build();
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

A directory per concept, a file per helper, and no barrel exports.

- `src/ArvoEventHandler/state/` (new) — everything about what an execution remembers:
  `index.ts` holding `ArvoExecutionState`, `types.ts` holding what one is built from and the
  record's own vocabulary, `utils.ts` holding the `mutateState` pair, `serializer.ts` holding
  `ArvoExecutionStateSerializer`, and `errors.ts` holding its error
- `src/ArvoEventHandler/fault/` (new) — `index.ts` holding `ArvoHandlerFault`, `types.ts`
  holding the `fault_kind` vocabulary and the retry block
- `src/ArvoEventHandler/context/` (new) — `index.ts` holding `ArvoExecutionContext`,
  `types.ts` holding what one is built from
- `src/ArvoEventHandler/version/` (new) — `index.ts` holding `ArvoHandlerVersion`, `types.ts`
  holding what one is built from
- `src/ArvoEventHandler/setup/` (new) — `index.ts` holding `ArvoEventHandlerSetup` and its
  chain, `types.ts` holding the setup's own shapes
- `src/ArvoEventHandler/index.ts` (new) — `ArvoEventHandler`, its constructor not exported for use
- `src/ArvoEventHandler/errors.ts` (new) — `ArvoEventHandlerValidationError`
- `src/ArvoEventHandler/types/` (new) — what is genuinely type-level and shared:
  `schema.ts`, `supplied.ts`, `options.ts`, `services.ts`, `executor.ts`, `declaration.ts`,
  `version-map.ts`
- `src/ArvoEventHandler/helpers/` (new) — one file per rule and per piece of machinery:
  `defaults.ts`, `resolve-options.ts`, `check-options.ts`, `check-timeouts.ts`,
  `check-contract.ts`, `check-versions.ts`, `check-services.ts`, `check-collisions.ts`,
  `emittable-types.ts`, `normalize-version.ts`, `at.ts`
- `src/factories/setupArvoEventHandler.ts` (new) — the free function delegating to `ArvoEventHandler.setup`
- `src/factories/createArvoEventHandlerVersion.ts` (new) — a version declared away from the chain
- `src/index.ts` — new public exports
- `tests/ArvoEventHandler/` (new) — mirroring the above, one spec per module
- `ts/sandbox/src/playground.ts` — a section declaring a handler through the chain, one version
  written standalone, and a refused declaration

**Dependencies**

None added. `zod/v4/core` for the state schema's type, `ArvoDomain` for the error domain, `neverthrow` through `src/result.ts` for the pair. All present.

**Not touched**

- `src/ArvoContract/` — a declaration reads a contract. Its `type`, `versions`, `outputs` and `error` supply everything the rules compare, and none is re-derived.
- `src/ArvoEvent/` — no event is built here.
- `src/ArvoDomain/` — consumed as it stands.

**Release**: additive. Nothing published yet.

## Out of Scope

Everything that needs a delivery in hand, which is change 2, and specifically:

- **Running a delivery.** `tryExecute` and `execute` are sketched under **How a handler is run**. Nothing here classifies an event, reads or writes a record, or enters an executor of its own accord. A built handler is inert.
- **Judging a whole batch.** One candidate event can be checked here, through the event and depth validators. The rules that span a batch cannot: at most one completion, the batch failing whole rather than in part, and rebuilding the awaited collection from its emissions. Each needs the batch an executor returned.
- **Enforcing the clocks.** The context reports what remains on each. Stopping an attempt when the run clock expires, and refusing a return past the execution clock, both need the delivery that would be stopped.
- **Committing a record, and deciding when to.** Turning one into a string and back is here. Where the string goes, the compare-and-swap it is committed under, and which record a delivery should read are all a mechanism's.
- **The state schema's contents.** ADR-007 makes a version's state schema the author's, and the protocol places no rule on how it changes. This change checks a write against whatever schema it was given and has no opinion on the schema itself.
- **Acting on abandonment.** A fault carries the pair built and written out. Publishing the event and committing the record is a mechanism's decision, and nothing here acts on either.
- **The mechanism's obligations.** ADR-006 places five on whatever runs a handler. This package is not a mechanism and implements none of them.
- **Anything the ADRs defer.** Timers and deadlines, a bound on fan-out, capability profiles as a format, error kinds beyond handler failure. Each is deferred in an accepted ADR and stays deferred here.
