## Context

See `proposal.md` for why, and `specs/event-dispatcher/spec.md` for what the dispatcher must do. [ADR-017](../../../../../docs/adr/017-dispatcher.md) is the governing record, and [ADR-018](../../../../../docs/adr/018-trace-context-across-layers.md) governs how the dispatcher joins an event's trace; where anything here and an ADR differ, the ADR governs.

This change depends on the `mutate-event` change, which supplies `mutateArvoEvent`; it is implemented after that change is archived.

What already exists and shapes the approach:

- **The handler** is `ArvoEventHandler<TSelf, TServices, TDependencies, TMechanismHooks>`. Its `tryExecute(param)` takes one `ArvoEventHandlerExecuteParam` object — `event`, `state`, `attempt`, `dependencies?`, `hooks?`, `middleware?` — and returns `AsyncResult<ArvoEventHandlerExecuteResponse, ArvoHandlerFault>`. It opens its own delivery span, continued from the event's `traceparent`. Its `contracts.self` is an `ArvoContract` (`type`, `uri`, `versions`); its `contracts.services` maps a local name to a `VersionedArvoContract` (`type`, `uri`, `version`); its `versions` is a `ReadonlyMap` whose values carry resolved `options`, including `runTimeout: number | null`.
- **The fault factory**, `createArvoHandlerFault`, requires a handler's `contracts.self`, its resolved `options` and a per-delivery `ArvoExecutionContextTelemetry`. It builds the handler error event from the self contract, computes the retry verdict from the options' budget, and records the fault on the telemetry's span, counter and log. A dispatcher raising `handler_not_found` has none of the three.
- **The identifier grammar** is a private constant in `src/ArvoContract/validator.ts`, used by a private `checkIdentifier`.
- **`ArvoEventHandlerValidationError`** carries `issues: readonly ErrorIssue[]` and builds its message with `buildErrorIssueMessage`. `createArvoContract` / `tryCreateArvoContract` is the reference pair for a class whose constructor throws.

## Goals / Non-Goals

**Goals:**

- A dispatcher a mechanism can hold in place of a handler: the same parameter object less `middleware`, the same result type, the same `tryX` / `X` shape.
- Full typing through the set: the dependency map keyed by each handler's literal self contract `type`, each value typed to that handler's dependencies; hooks typed to what every handler accepts.
- `handler_not_found` built and recorded by the existing fault machinery, not by a parallel one.
- No type-cast shortcut anywhere in `src`.

**Non-Goals:**

- Anything ADR-017 leaves with the mechanism (see `proposal.md` — Not in scope).
- Changing how a handler opens or names its span, or anything else about the handler.
- A per-call layer list. ADR-017 fixes layers at declaration.

## Decisions

### 1. Where the code lives

A new directory, `src/ArvoDispatcher/`, beside `src/ArvoEventHandler/`, one concern per file:

| File | Holds |
|---|---|
| `index.ts` | the `ArvoDispatcher` class: constructor, `tryExecute` / `execute`, `handles`, `longestRunTimeoutMs`, `tryValidateCallerName` / `validateCallerName` |
| `errors.ts` | `ArvoDispatcherValidationError` |
| `types.ts` | `ArvoDispatcherOptions`, `ArvoDispatcherExecuteParam`, the member constraint |
| `typing.ts` | `HandlersOf`, `DependenciesOf`, `HooksOf` — the set-level type helpers |
| `helpers/flatten.ts` | flattening nested dispatchers into one handler list and one layer list |
| `helpers/check-empty.ts` | the empty-set rule |
| `helpers/check-repeated-handlers.ts` | the same-instance-twice rule |
| `helpers/check-shared-types.ts` | the two-handlers-one-`type` rule |
| `helpers/check-service-versions.ts` | the service-at-an-undeclared-version-or-`uri` rule |
| `helpers/check-caller-name.ts` | the three caller-name rules |
| `helpers/longest-run-timeout.ts` | the read over every version's resolved options |

The factories go in `src/factories/createArvoDispatcher.ts`, as `createArvoContract` does.

**Alternative considered:** putting the dispatcher under `src/ArvoEventHandler/`. Rejected: it is a separate public class with its own error and its own declaration rules, and ADR-017 is a separate record.

### 2. Construction: the constructor holds the logic, `tryCreate` wraps it

`new ArvoDispatcher(options)` flattens, runs every check, collects every `ErrorIssue`, and throws one `ArvoDispatcherValidationError` naming all of them. `tryCreateArvoDispatcher` calls the constructor, turns that one error into `Err`, and rethrows anything else. `createArvoDispatcher` unwraps `tryCreateArvoDispatcher`. This is the class rule in `project.md`, and `createArvoContract` is copied exactly.

The empty-set check runs first and blocks the rest, with a `blockingReason`: the remaining rules compare handlers and say nothing true about an empty set.

The validated handlers are held in a `ReadonlyMap` from self contract `type` to handler, built once. The pick at call time is one `get`, and `handles` is one `has`.

### 3. The pick, and what is passed on

`tryExecute(param)`:

1. `this.#handlersByType.get(param.event.to)` — `to` absent or unknown both miss.
2. Miss: build `handler_not_found` (decision 5) and return it as `Err`.
3. Hit: read the handler's dependency entry with `Object.hasOwn` on `param.dependencies`, so an inherited key is never taken for an entry, and call `handler.tryExecute({ event, state, attempt, dependencies: entry, hooks, middleware: this.middleware })`. An absent entry is passed as omitted, never as `null`, per the optional-inputs rule.
4. Return the handler's `AsyncResult` as it is. Nothing inspects it.

`execute(param)` unwraps `tryExecute(param)` and throws the fault, as the handler's `execute` does. `middleware` is omitted from the call when the set has no layers, so a handler entered through a dispatcher with none sees exactly what it would see entered directly.

### 4. Typing the set

```ts
type ArvoDispatcherMember =
  | ArvoEventHandler<any, any, any, any>
  | ArvoDispatcher<any>;

class ArvoDispatcher<const TMembers extends readonly ArvoDispatcherMember[]> { … }

type HandlersOf<TMembers> = TMembers extends readonly [infer Head, ...infer Rest]
  ? Head extends ArvoDispatcher<infer Inner> ? [...HandlersOf<Inner>, ...HandlersOf<Rest>]
  : Head extends ArvoEventHandler<any, any, any, any> ? [Head, ...HandlersOf<Rest>]
  : never
  : [];

type DependenciesOf<THandlers extends readonly ArvoEventHandler<any, any, any, any>[]> = {
  readonly [THandler in THandlers[number] as THandler['contracts']['self']['type']]?:
    THandler extends ArvoEventHandler<any, any, infer TDependencies, any>
      ? IArvoEventHandlerDependency<TDependencies>
      : never;
};

type HooksOf<THandlers extends readonly ArvoEventHandler<any, any, any, any>[]> =
  UnionToIntersection<THandlers[number] extends ArvoEventHandler<any, any, any, infer THooks> ? THooks : never>;
```

The type parameter is over the *members* as written, so nesting survives in the type; `HandlersOf` flattens it the same way the constructor does at runtime. The `const` modifier keeps the tuple's element types without the caller writing `as const`.

**How a nested dispatcher is read at the type level.** `HandlersOf` and the member constraint read a nested dispatcher structurally, through a public `handlers: HandlersOf<TMembers>` the class declares, and the layer list through a public `middlewares`. Two reasons: the helpers are written before the class (group 3 precedes group 5), and inferring a generic back out of a class requires a property that carries it. Both properties are reads of the set, which ADR-017 permits. The cost is that any object with a `handlers` list satisfies the member type; the constructor checks each member with `instanceof` at runtime and refuses anything that is neither a handler nor a dispatcher, so the structural looseness never reaches a call.

`any` appears only as the argument of a constraint, where it means "any handler at all" and is permitted by the package's lint configuration. It is not a cast: no value is asserted to a type it was not checked against. The handler's own type parameters are contravariant in places (`dependencies` is an input), so `ArvoEventHandler<ArvoContract, ArvoServiceMap, ArvoDependencies, ArvoMechanismHooks>` as the constraint would refuse ordinary handlers; `any` is what lets every handler in.

Inside the class, `#handlersByType` holds `ArvoEventHandler<any, any, any, any>` values, so the call in decision 3 type-checks with no assertion: the public parameter is fully typed for the caller, and the internal call accepts it because the held handler's input types are `any`. The one place the public map type is read internally is the `Object.hasOwn` lookup, which reads a property off a record and needs no cast.

**Alternative considered:** a non-generic dispatcher with `Record<string, IArvoEventHandlerDependency<ArvoDependencies>>` for dependencies. Rejected: it loses each handler's dependency type, which is the typing the handler itself works hard to keep.

### 5. `handler_not_found` through the existing fault factory

`ArvoFaultKind` gains `'handler_not_found'`. `ArvoHandlerFaultFactoryParam` gains a third branch, for an event that reached no handler:

```ts
type ArvoHandlerFaultFactoryParam = {
  attempt: number;
  telemetry: ArvoExecutionContextTelemetry;
  message: string;
  cause?: string;
  violations?: readonly string[];
} & (
  | ({                                   // a handler was entered — today's two branches, unchanged
      contracts: { self: VersionedArvoContract };
      options: ArvoEventHandlerOptions;
      faultKind: ArvoFaultKind;
      retryable?: boolean;
    } & (
      | { state: ArvoExecutionState; entry: ArvoEntryKind }
      | { state: null; event: ArvoEvent; initEvent: ArvoEvent | null; executionId: string | null }
    ))
  | {                                    // no handler was entered
      contracts: null;
      faultKind: 'handler_not_found';
      event: ArvoEvent;
    }
);
```

The factory checks `param.contracts === null` first. In that branch it builds no handler error event and no abandonment record — there is no self contract to address one from and no execution to abandon — sets `retry: null` without consulting any options, takes `subject` and `eventId` from the event and `executionId` as `null`, and records the fault on the given telemetry exactly as every other fault is recorded. The discriminant is `contracts: null` and the branch fixes `faultKind` to `'handler_not_found'`, so the compiler refuses a handler-less fault of any other kind. The handler branch keeps `faultKind: ArvoFaultKind` as it is: the handler's own call sites hold the kind in variables typed as the whole vocabulary, and narrowing the branch would make every one of them fail to compile for a case none of them can produce.

Every existing caller builds one of the first two branches and compiles unchanged.

**Alternative considered:** constructing `ArvoHandlerFault` directly in the dispatcher. Rejected: it would bypass the factory's recording, so the fault would leave no span, counter or log — and a fault writes no record, so telemetry is the only place it is ever seen.

**Alternative considered:** a separate small factory for handler-less faults. Rejected: two factories for one class is the two-mechanisms problem `project.md` warns against, and the recording would be written twice.

### 6. Telemetry: one span per call, under ADR-018

ADR-017 **Telemetry** makes the dispatcher a layer under ADR-018 that always records. On every call `tryExecute`:

1. Opens one span continuing the event's trace, with the same `continueTraceFromEvent` the handler uses, and builds an `ArvoExecutionContextTelemetry` around it, as the handler does.
2. Where `span.isRecording()`, hands the handler `mutateArvoEvent(event, { span })`: the same event, its trace context now naming the dispatcher's span. Where it is not recording, hands the handler the event as it is. This is the `mutate-event` change's function, which is why that change is implemented first.
3. Marks on the span that it was entered and which handler it picked, as span events under the package's attribute prefix, the way `markEntryStage` marks a handler's stages.
4. On a miss, builds `handler_not_found` through the fault factory with that telemetry, so the fault is recorded on the dispatcher's span, counter and log exactly as a handler's fault is on the handler's.
5. Ends the span before returning, on every path.

It records nothing the handler records: no duration of the handler's, no fault of the handler's. The handler's response is returned untouched, emitted events and their trace context included.

The dispatcher accepts an optional `telemetry` in its options, shaped exactly as a handler's setup takes it (`tracer?`, `meter?`, `logger?`), with the same defaults: a tracer from the global provider, no meter, no logger.

**Alternative considered:** a span only on a miss, so a found handler's span keeps today's parent. Rejected by ADR-017's revision: a dispatcher records on every call, and ADR-018 nests the handler under it.

**Alternative considered:** rewriting the event's trace context in place. Rejected: an event is immutable, and ADR-018 requires the event as received to be unaltered; `mutateArvoEvent` returns a copy.

### 7. The identifier grammar is shared, not copied

`IDENTIFIER_GRAMMAR` and a predicate over it move from `src/ArvoContract/validator.ts` into `src/ArvoContract/identifier.ts`, exported to the package (not from `src/index.ts`). The contract validator imports it and behaves exactly as before; the caller-name check imports the same predicate. One copy of the rule.

### 8. The service-version rule

For each handler A and each service contract S A declares: if some handler B in the set has `contracts.self.type === S.type`, then the declaration is refused where `S.uri !== B.contracts.self.uri`, or where `S.version` is not a key of `B.contracts.self.versions`. Where no handler in the set implements `S.type`, nothing is checked. Each refusal names A, B, the service's local name, and the version or `uri` that disagrees.

### 9. `longestRunTimeoutMs`

Computed once in the constructor: the largest non-null `runTimeout` over every resolved version of every handler, or `null` where none is set. A getter returns it. It reads resolved options, so a version inheriting the handler's default is counted at that default.

## Risks / Trade-offs

- **[Recursive generics may be slow or hit depth limits for very large sets]** → The recursion is over the members as written, one level per entry, not per handler. A set of tens of handlers is well inside TypeScript's limits. Covered by a typecheck test over a deliberately large and deeply nested set.
- **[`HooksOf` produces `never` where two handlers declare incompatible hooks]** → That is correct: no single value satisfies both, and the error belongs where hooks are supplied. A type-level test asserts it.
- **[The fault factory's parameter union grows a third branch]** → Every existing call site is in one of the first two branches and is unchanged; the new branch is reachable only by passing `contracts: null`. The factory's existing tests stay as they are, and the new branch gets its own.
- **[A dispatcher's own span name is new telemetry vocabulary]** → It is one span per dispatcher call, named for the dispatcher; dashboards built on handler span names are unaffected, and the handler's span now has it as a parent, which ADR-018 fixes for every layer.
- **[`ArvoFaultKind` widens]** → A consumer's exhaustive `switch` needs one more case, as when ADR-016 added two kinds. Stated in the proposal.
