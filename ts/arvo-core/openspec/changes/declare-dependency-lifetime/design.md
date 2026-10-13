## Context

See [proposal.md](./proposal.md), **Why**. [ADR-011](../../../../docs/adr/011-dependency-lifetime.md) fixes the three capabilities and their semantics; it leaves member names, the shape of the exposed surface, and whether an executor is handed that surface or the object carrying it to each language (ADR-004). This settles those for TypeScript.

Two facts about the existing code shape the work. The factory was resolved in the version, not the handler, and the handler reached it through a cast — `param.dependencies as ArvoDependencyResolver<TDependencies, TDataSchema>` — because a handler's param cannot know which of its versions will own the execution. And the record is serialized *after* the executor returns, so the obvious place for a `finally` is the wrong one.

## Goals / Non-Goals

**Goals:**
- One spelling for supplying a dependency, so the handler never asks which form it was given.
- Not one existing executor body changes. `ctx.dependencies.x.y()` stays one property access.
- The cast disappears rather than moving.
- The two calls land where nothing can skip them, including the paths a reader forgets exist.

**Non-Goals:**
- Giving hooks a lifetime. Their nullability here is a typing tidy under the package's **Optional inputs** rule and nothing more.
- Typing the record a supplier receives by default. Optional, for the reason under **Decisions**.
- Enforcing idempotency. It cannot be checked, only documented.

## Decisions

### `open` and `close`, not `acquire` and `release`

Shorter at the two call sites that matter, and already the words a reader expects on something holding a connection. ADR-011 fixes the capabilities, not the spelling.

### The executor is handed `attributes`

```ts
ctx.dependencies.catalogue.itemsIn('orders');
```

One property access, so no executor body changes and `close` is unreachable from one — not because an executor is told not to call it, but because it is never handed the thing that has one.

The alternative, handing over the object, was rejected on two counts: `ctx.dependencies.attributes.catalogue.itemsIn(...)` is a hop at every call site, and a reachable `close` would release every resource the object holds.

### `null` inside, `undefined` outside

The package's **Optional inputs** rule, unchanged: `dependencies?: IArvoEventHandlerDependency<TDependencies>` at the boundary a caller writes, normalized once in `ArvoEventHandler#dispatch` to `| null` for everything below. One line where the two spellings meet rather than a `??` down the call chain.

Nothing fabricates an instance. The empty object survives in exactly one place — where the execution context is built — and is about the *attributes*, which an executor must always find. That separates two absences the old code conflated: the dependency object can be absent; what the executor reads cannot.

Applied to hooks at the same time, which recovers a distinction the old `?? {}` destroyed: a mechanism that deliberately exposed nothing is now a different fact from one that was never asked, though an executor still finds `{}` either way.

### The scope's state schema is optional

```ts
export interface IArvoEventHandlerDependency<
  TAttributes extends ArvoDependencies = ArvoDependencies,
  TDataSchema extends z.$ZodObject = z.$ZodObject,
> {
  open(scope: ArvoDependencyScope<TDataSchema>): PromiseAble<void>;
  …
}
```

The version's param declares `IArvoEventHandlerDependency<TDependencies, TDataSchema>`, so at that boundary the record is typed by the version's own state schema. A supplier that omits the second parameter — the ordinary case, since one dependency serves every version of a handler — gets the loose record and narrows it; one written against a single version names the schema and gets `scope.state.data` typed.

Required rather than optional was rejected: a handler with three versions at three schemas gives a supplier no single value to name. A loose implementation still satisfies the tighter declaration because `open` and `close` are declared as methods, whose parameters TypeScript checks bivariantly — which is also why no cast returns.

### `open` and the read of `attributes` share one guarded region

Reading the surface is part of opening (ADR-011), so both sit inside the same `try` and both become `dependency_resolution_failed`. Outside it, a throwing getter would leave `version.execute` as a raw error rather than a fault — the same defect class as the `__proto__` lookup found earlier in this package, where a mechanism was handed something that was not a fault and had no basis for deciding whether to retry.

### The `finally` wraps `#produce`, not the executor

Everything from the open to the return goes inside it, which required extracting the rest of `execute` into a private method. The record is serialized in `#produce`, after the executor has returned, so a `finally` around the executor alone would release a connection the serialization might still need — and would pass every test anyone would think to write.

### `close` failing needs a telemetry verb the module lacked

`version/telemetry.ts` has `markStage`, `markExecutorRan` and `markOutcome`, all of which describe something that happened on the way through. Nothing described a failure the execution carried on from, so `markSwallowed` is added. It is the only place such a thing is recorded, which is the point: a swallowed failure with nowhere to appear is a swallowed failure nobody can debug.

### Test fixtures rather than a class per spec

Most specs in this suite pass a dependency because the executor they are testing reaches for one, not because the lifetime is under test. `heldDependencies` and `openedPerExecution` in `tests/ArvoEventHandler/dependency.ts` are the two shapes those specs want.

They are themselves conformant, and `dependency.spec.ts` proves it — idempotent open, idempotent close, close safe on something never opened. Without that, every spec using one would rest on an unverified fixture.

## Risks / Trade-offs

- **Breaking, with no compatible path.** A value has no release point, which is the whole problem, so there is no form that accepts both.
- **A dependency holding nothing is now a class with two empty methods.** Ceremony, accepted for one path through the handler.
- **Idempotency is a rule nothing checks.** A supplier that gets it wrong fails in a way that reads as the handler's fault. All an implementation can do is say so at the surface, which the interface's own documentation does.
- **The default scope types the record loosely.** A supplier serving one version can recover it; one serving a handler cannot, and narrows by hand. The alternative types nothing at all for multi-version handlers.
