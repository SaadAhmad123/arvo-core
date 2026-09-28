## 1. Probes before types

- [x] 1.1 Probe that a mapped type over `keyof M & ArvoSemanticVersion` rejects a handler declaring fewer versions than the contract, against a real `ArvoContract` built inline — two versions declared, one executor given, expect a compile error. Repeat with the contract's versions map held in an annotated `const` to confirm the widening trap `ArvoContract`'s own TSDoc describes degrades the check rather than breaking it.
- [x] 1.2 Probe that `Partial<T>` over a field typed `number | null` yields `number | null | undefined` and that TypeScript distinguishes an absent key from an explicit `undefined` only at the value level, not at the key level. This decides that resolution keys off `value === undefined` rather than `in`.
- [x] 1.3 Probe that `VersionedArvoContract` exposes `uri`, `type`, `version`, `outputs` and `error.type` off a value typed only as `VersionedArvoContract`, so the collision and duplicate-service rules can read them without a cast.
- [x] 1.4 Probe the generics the context sketch in `proposal.md` depends on, since every one of them has to be inferable from a single `new ArvoEventHandler({...})` call and none can be annotated by hand. Four things, and each has been wrong in a draft: that the services map infers as written rather than widening to `Record<string, VersionedArvoContract>`; that `StateSchemaOf<VD, V>` reads a version's own `state` back out of the same object literal that declares it; that a version written as the executor alone infers as stateless; that `H` and `D` infer off the `types` witness field and fall to `Record<string, never>` when it is omitted; and that a union of intersections narrows on `entry` where an intersection carrying a union does not — the collapse the factories change already hit with `Omit<A & (B | C), K>`. Record what compiles, because §2.2 is written against the answer.

## 2. Types

- [x] 2.1 Add `src/ArvoEventHandler/types/`, one module per group and no barrel — `schema.ts`, `supplied.ts`, `options.ts`, `services.ts`, `context.ts`, `executor.ts`, `declaration.ts`. Between them: `ArvoEventHandlerOptions` as the complete seven, `ArvoRetryDelayFn`, `ArvoServiceMap`, `ArvoMechanismHooks`, `ArvoEventHandlerExecutor`, `ArvoVersionDeclarations`, `StateSchemaOf`, `PayloadOf`, `ArvoEventHandlerParam`. `PayloadOf` is the conditional helper §1.4 found necessary: `z.infer` off an unresolved schema does not satisfy `ArvoEvent`'s payload constraint without it. Both option sites take `Partial<ArvoEventHandlerOptions>`; the resolved shape is the unpartialled type and no second type is introduced for it.
- [x] 2.2 Carry every generic the context sketch in `proposal.md` needs — the contract's type and version map, the services map as written, the per-version state schema, the dependency type and the hook type — even though nothing reads them yet. §1.4 is what proves they survive inference.
- [ ] 2.2a Add the `types` witness field: `Partial<{ mechanismHooks: H; dependencies: D }>`, both constrained to `Record<string, any>` and both defaulting to `Record<string, never>`. It is read by nothing and stored by nothing. TSDoc it as types only, name the empty default, and name the interface-versus-type-alias constraint trap from `design.md`.
- [x] 2.3 Accept a version declared as the executor alone, as well as the object form. Normalizing the shorthand to the object form is runtime and belongs with the constructor in §5.
- [x] 2.4 TSDoc `ArvoEventHandlerExecutor` to say what it is and that its parameter type arrives with the execution context, so a consumer hovering it is not left guessing why it is loose. State the return union ADR-006 fixes.
- [x] 2.5 TSDoc `ArvoEventHandlerParam` in full, per `project.md` — *Documentation in source*: it is where a caller meets the input rules, so it carries them and the constructed object's members stay to one line each. Include the widening trap from §1.1 on `contract`, and the local-name-only rule on `services`.

## 3. Options

- [ ] 3.1 Add `src/ArvoEventHandler/options.ts` holding the seven defaults as one frozen object and nothing else spelling a default. Each carries a one-line comment naming the ADR-006 value it implements.
- [ ] 3.2 Add `resolveHandlerOptions(param)` returning a complete `ArvoEventHandlerOptions`, coalescing on `value === undefined` per §1.2 so an explicit `undefined` behaves as omission.
- [ ] 3.3 Add `resolveVersionOptions(handler, version)` returning a complete `ArvoEventHandlerOptions`, taking the version's value where it wrote one and the handler's otherwise. Coalesce on `undefined` only, so a written `null` is carried rather than replaced.
- [ ] 3.4 Add `checkOptionDomains(options, path)` reporting an `ErrorIssue` per option outside its domain: non-negative integers for `maxDepth` and `maxRetryAttempts`, a non-negative integer or a function for `retryDelay`, a positive integer or `null` for each timeout, one of two literals for `collect`, and a string or an `ArvoDomain` symbol for `handlerErrorDomain`. It reports and does not throw.

## 4. Declaration rules

- [ ] 4.1 Add `src/ArvoEventHandler/errors.ts`: `ArvoEventHandlerValidationError`, following `ArvoContractValidationError` in shape and carrying `ErrorIssue[]`.
- [ ] 4.2 Add `src/ArvoEventHandler/declaration.ts` with one function per rule, each taking the declaration and returning issues rather than throwing, so the constructor collects across all of them.
- [ ] 4.3 Implement the contract guard, and mark its issue blocking with a `blockingReason` naming what depends on it. Every other rule reads the contract, so nothing else runs when this one fails.
- [ ] 4.4 Implement version completeness both ways: an issue per declared version with no executor, and an issue per executor naming a version the contract does not declare.
- [ ] 4.5 Implement the duplicate-service rule on `uri`, reporting the contract named twice.
- [ ] 4.6 Implement the type-collision rule per version over the emittable set — service input types, that version's `outputs` keys, that version's handler error type — reporting the version and the shared type. Take no special case for the implemented contract appearing among the services: ADR-005's within-contract disjointness already makes that legal, and a guard here would forbid the recursion ADR-006 permits.
- [ ] 4.7 Implement the timeout relation on each version's **resolved** pair, after §3.3, reporting the version. Cover both halves: an execution timeout below a run timeout, and a non-null execution timeout against a null run timeout.
- [ ] 4.8 Add `buildEmittableTypes(contract, services)` returning one `ReadonlySet<string>` per version, computed once and reused by §4.6 rather than recomputed.

## 4a. The setup and the chain

- [ ] 4a.1 Add `src/ArvoEventHandler/types/setup.ts`: `ArvoEventHandlerSetupParam` holding contract, services, options and `types`, and `ArvoDeclaredVersions` recording what a chain has accumulated.
- [ ] 4a.2 Add `src/ArvoEventHandler/setup.ts` with `ArvoEventHandlerSetup`. `handler(version, declaration)` returns a new setup carrying that version and mutates nothing, so a chain in progress cannot be shared by accident.
- [ ] 4a.3 Accept both forms at `handler`: a declaration object, and the executor alone. Normalize the shorthand once here so nothing downstream handles two shapes.
- [ ] 4a.4 Add `src/factories/createArvoEventHandlerVersion.ts`, taking the setup, the version, and what `handler` takes inline. It validates nothing and has no `tryCreate` twin. Probe that a version created this way types `ctx` exactly as the inline form does, since that is the whole reason it exists.
- [ ] 4a.5 Give `handler` its second overload, taking a created version alone and reading the version off it.

## 5. The class

- [ ] 5.1 Add `src/ArvoEventHandler/index.ts` with the class. Public: `contract`, `services` and `versions` as declared, and the static `setup`. Internal: the constructor, the resolved handler options, the resolved per-version options, and the emittable sets.
- [ ] 5.2 Implement the constructor over a completed declaration: resolve handler options, run every rule from §4 including completeness, throw one `ArvoEventHandlerValidationError` carrying every issue, and freeze what it holds. Not exported for use; `tryBuild` is what reaches it.
- [ ] 5.3 Hold the resolved per-version options from §3.3 and the emittable sets from §4.8 as internal fields. Neither is exposed and neither is exported: the declaration is the whole public surface, and both are derived from it.
- [ ] 5.4 TSDoc the class and its members to one line each, with an `@example` declaring a handler. State that a handler processes no event yet — a consumer who installs this and expects to run one should learn it from the hover, not from trying.

## 6. Reaching it, and the public surface

- [ ] 6.1 Implement `tryBuild` on the setup, wrapping the constructor, converting only `ArvoEventHandlerValidationError` into `Err` and rethrowing anything else, matching `createArvoContract.ts`. Build the `Result` through `src/result.ts` and never as a literal.
- [ ] 6.2 Implement `build` as the thin unwrap over `tryBuild`, carrying no logic of its own, and `setupArvoEventHandler` in `src/factories/` as the thin delegate to `ArvoEventHandler.setup`.
- [ ] 6.3 Export from `src/index.ts`: the class, the pair, the error, and the types a consumer writes against — `ArvoEventHandlerParam`, `ArvoVersionDeclarations`, `ArvoEventHandlerOptions`, `ArvoEventHandlerExecutor`, `ArvoRetryDelayFn`, `ArvoServiceMap`, `ArvoMechanismHooks`. Export neither the resolver nor the emittable-set builder.

## 7. Tests

- [ ] 7.1 Add `tests/ArvoEventHandler/declaration.spec.ts`: a one-version handler built, a handler with no services built, a version with and without a state schema, a version declared as its executor alone, services held at the version named, and a declaration carrying `types` built with nothing of it stored on the handler.
- [ ] 7.2 Extend it with completeness: two versions each with an executor built, a missing executor refused naming the version, and an executor for an undeclared version refused naming it.
- [ ] 7.3 Add `tests/ArvoEventHandler/collisions.spec.ts`: two services sharing a type, a service colliding with an output, a service colliding with a handler error type, a collision in one version of two reported against that version, and — the legal cases, which a rejection-only suite would miss — two versions declaring the same output type built, and two different contracts at one version each built.
- [ ] 7.4 Add `tests/ArvoEventHandler/recursion.spec.ts`: the implemented contract declared as a service is built, and is still built when that version declares outputs. ADR-006 permits this and §4.6 has no guard, so this is the test that stops one being added.
- [ ] 7.5 Add `tests/ArvoEventHandler/options.spec.ts`: every default present where nothing is declared, each of the seven asserted against ADR-006's stated value, a handler-level value kept, a version's value winning, an undeclared option inheriting, an option declared nowhere falling to its default, and per-version independence across two versions.
- [ ] 7.6 Extend it with the unset-versus-null pair, which is the requirement most easily lost to a refactor: a version omitting `runTimeout` inherits, a version writing `runTimeout: null` is unbounded, and a version writing `runTimeout: undefined` behaves as omission.
- [ ] 7.7 Add `tests/ArvoEventHandler/timeouts.spec.ts`: an execution timeout below a run timeout refused, the two halves declared at different levels refused, a null run timeout with a bounded execution timeout refused, and the legal cases — both null, execution above run, and the two equal.
- [ ] 7.8 Add `tests/ArvoEventHandler/errors.spec.ts`: two unrelated rules reported together, a non-contract reported alone and marked blocking, every issue carrying a position naming the version and option where one applies, and each option domain rejected individually rather than by a representative sample, per `project.md` — *Testing*.
- [ ] 7.9 Add `tests/ArvoEventHandler/build.spec.ts`: `build` and `tryBuild` agreeing on a valid declaration, `tryBuild` reporting a failure as `Err` with the same issues `build` throws, an unrelated error propagating out of `tryBuild` unconverted, both entry points producing the same handler, and a chain in progress left unchanged by a further `handler` call.
- [ ] 7.9a Add `tests/ArvoEventHandler/standalone.spec.ts`: a version created through `createArvoEventHandlerVersion` with a state schema and one without, each assembled through the single-argument `handler` overload, each behaving exactly as the inline form does, and a created version for an undeclared version refused at `build` like any other.
- [ ] 7.10 Add `tests/ArvoEventHandler/emittable.spec.ts`: the set for a version, two versions differing while sharing every service type, and a version declaring no outputs.

## 8. Finishing

- [ ] 8.1 Add a section to `ts/sandbox/src/playground.ts` declaring a three-version handler with a service, one version using the executor-only shorthand, and one refused declaration.
- [ ] 8.2 `npx tsc --noEmit` clean, `pnpm lint` clean, `pnpm test:coverage` at 100% across statements, branches, functions and lines for the new modules.
- [ ] 8.3 `node_modules/.bin/openspec validate declare-arvoeventhandler --strict` clean.
