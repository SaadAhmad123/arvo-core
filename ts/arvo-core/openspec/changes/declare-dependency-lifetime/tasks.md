## 1. The type

- [x] 1.1 `src/ArvoEventHandler/types/dependency.ts`: `IArvoEventHandlerDependency<TAttributes, TDataSchema>` with `open`, `close` and `attributes`, and `ArvoDependencyScope<TDataSchema>` carrying the event, the record or absence, the execution, the attempt and the delivery's telemetry. Both type parameters default, so a supplier serving a whole handler names neither.
- [x] 1.2 TSDoc to the package's rules: the constraint stated rather than argued, the ADR cited rather than copied, and an `@example` that implements the interface it sits on.

## 2. The specs, before the behaviour

Written first, because the question of whether `close` runs before or after the record is serialized decides where the `finally` goes — and the obvious placement passes every test anyone would think to write afterwards.

- [x] 2.1 `tests/ArvoEventHandler/dependency.ts`: `heldDependencies` and `openedPerExecution`, the two shapes the rest of the suite wants.
- [x] 2.2 `tests/ArvoEventHandler/dependency.spec.ts`: the fixtures are themselves conformant — idempotent open, idempotent close, close safe on something never opened, and a surface that refuses to be read before opening. Every spec that uses one rests on this.
- [x] 2.3 Open called once, before the executor, with the event, the execution, the attempt and the telemetry.
- [x] 2.4 Open sees absence on an execution with no record yet, and the record where there was one.
- [x] 2.5 The executor is handed what the dependency exposes, not the dependency — asserted by its having neither `open` nor `close` on it.
- [x] 2.6 Close called once, for the same execution it was opened for.
- [x] 2.7 One dependency serving two executions opens for each, and what each executor finds belongs to its own execution.
- [x] 2.8 Nothing supplied: the executor finds an empty object, and nothing is opened or closed.
- [x] 2.9 A dependency that cannot be opened is `dependency_resolution_failed`, retry in prospect, executor never entered — including where it failed with something that is not an error.

## 3. The implementation

- [x] 3.1 `types/execute.ts` and `version/types.ts`: the param takes an instance, `undefined` at the caller's boundary and `null` below it. The version's declaration carries its own state schema through.
- [x] 3.2 `ArvoEventHandler#dispatch`: normalize absence once, for dependencies and hooks alike. Nothing fabricates an instance.
- [x] 3.3 `version/index.ts`: `#openDependencies` where the factory was called, with the read of `attributes` inside the same guarded region, so a surface that cannot be read is the same fault and not an error escaping the handler.
- [x] 3.4 `version/index.ts`: `#closeDependencies` in a `finally` wrapping everything after the open — which meant extracting the rest of `execute`, because the record is serialized after the executor returns.
- [x] 3.5 `version/telemetry.ts`: `markSwallowed`, for the one kind of failure that cannot change what an execution concluded and so has nowhere else to be seen.
- [x] 3.6 `types/supplied.ts` and `src/index.ts`: `ArvoDependencyResolver` removed, `IArvoEventHandlerDependency` and `ArvoDependencyScope` added.
- [x] 3.7 The stale one-line comment above the `dependencies` field, describing a form the type no longer accepts.

## 4. Migration

- [x] 4.1 Every handler-level call site through the fixtures; every version-level one to `null`.
- [x] 4.2 The scenario lattice, which was handing over a bag that only typechecked through a cast — found by 313 failing specs, not by the compiler.
- [x] 4.3 The worker-thread runner, which the compiler never sees because it drives the built package in a thread.
- [x] 4.4 Whole suite green, lint and typecheck clean.

## 5. The sandbox adopts it

- [x] 5.1 The Temporal activity loses its array of release functions, its push into it, and its `finally`. `PostgresCatalogue` becomes the dependency rather than something the activity opens and remembers to release.
- [x] 5.2 The sandbox's own specs follow.

## 6. Hooks, deliberately

- [x] 6.1 Hooks are nullable past the boundary, under the same **Optional inputs** rule, which preserves the difference between a mechanism that exposed nothing and one that was never asked.
- [x] 6.2 The line between the two written where both are declared: a thing that needs the event, the record or the attempt is a dependency; a thing that needs none of them is a hook.
