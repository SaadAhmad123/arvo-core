## Context

See `proposal.md` — Why and The plan. The constraints that shape this slice:

- **The declaration is where ADR-006 puts its refusals.** Six rules, all of them "rejected at declaration time", none needing an event, a record or a store. That is what makes declaration a slice rather than an arbitrary cut.
- **A handler is inert until change 6.** Nothing calls an executor, nothing builds a context, nothing reads a record. Whatever this change ships must be honest about that rather than implying a delivery path.
- **`ArvoContract` already holds everything the rules compare.** `type`, `versions`, each version's `outputs`, and `error.type`. Every collision check reads fields that exist.
- **`ArvoDomain` already ships the four domain sources** ADR-006 names. The error-domain option consumes them rather than introducing a second vocabulary.
- **Options carry a rule the package's own conventions do not anticipate.** ADR-006 requires `unset` and a written `null` to mean different things for the two timeouts, and `project.md` — *Optional inputs* forbids exactly the type that expresses it. One of them gives; the reasoning is below.

## Goals / Non-Goals

**Goals**

- A declaration that either constructs or names every rule it broke.
- Every rule read off the contract rather than re-derived.
- One internal place that answers "what option is in force for this version", so no later change re-implements the resolution and no consumer depends on it.
- Compile-time completeness where TypeScript can give it, and a runtime check anyway for JavaScript callers.
- Nothing shipped that implies something runs.

**Non-Goals**

- Anything in `proposal.md` — Out of Scope.
- Building the execution context. Its types are sketched in `proposal.md` so the generics here are provably sufficient; constructing one is change 4's.
- Guarding a declaration ADR-006 permits. Recursion is legal; a version declaring no state is legal; a handler with no services is legal.

## Decisions

### A declaration is a chain, because a version's executor must be typed by that version's schema

An earlier draft declared versions as one object keyed by version, each entry carrying a `state` schema and an `execute`. It does not work, and the probes under **What the probes established** are where that surfaced: TypeScript will not read one key of an object literal to type another key of the same literal, so `execute` received an untyped context and a version's own state schema governed nothing. The step 1 probe had stubbed that position as `any` and so missed it.

Three shapes were tried against a compiler, and all three fix it:

| | what it costs |
|---|---|
| a generic wrapper per stateful version | a wrapper call, and the version named twice |
| state schemas hoisted into their own map | a version's schema and its executor declared apart |
| **a chain of `handler` calls** | **a terminal `build`, and completeness no longer free** |

The chain wins because each call is its own inference, so the schema is settled before the executor is checked, and the version is named once as an argument rather than twice. Neither of the other two manages both.

*What it costs, named rather than discovered.* The constructor no longer sees the versions, so it cannot validate a declaration, and every rule moves to `build`. And the mapped type over `keyof M` that made a missing version a compile error is gone with the map.

### Completeness is checked at build, and not by the compiler

A type-level accumulator could gate `build` so that it will not compile until every declared version has one. It was considered and rejected for this change.

It is the fiddliest type in the design and it buys the least: a missing version is caught either way, and caught before any event exists either way, because `build` runs at module load in every real declaration. What it would cost is a `build` whose error message, when a version is missing, is whatever TypeScript makes of an unsatisfied conditional — reliably worse than an `ArvoEventHandlerValidationError` naming the version.

*Left open rather than closed.* Adding the gate later is additive, since it only narrows what already compiles.

### Two entry points, one implementation

`ArvoEventHandler.setup(...)` and `setupArvoEventHandler(...)` do the same thing, matching `new ArvoContract(...)` and `createArvoContract(...)`. The static holds it; the free function delegates and carries no logic, so the two cannot drift.

*And the constructor is not among them.* `new ArvoEventHandler(...)` is not public. With a terminal `build` it would be a second way to declare, and it could not validate anything, because a constructor taking only the setup has no versions to check. It holds the validation and is called by `tryBuild`, which is the direction `project.md` — *Result types* requires for a class.

### Writing a version away from the chain is a function, not a type

`createArvoEventHandlerVersion(setup, version, declaration)` takes the setup, the version, and exactly what `handler` takes inline. It is a function call, so the state schema is settled within the call before the executor is checked, which is the same reason the chain works at all.

*An annotation was tried first and is worse.* `InferArvoHandlerVersion<typeof setup, V, S>` also types `ctx` correctly, because an annotation is resolved before the value it types. But its schema argument is a type, so the schema has to be named twice — once in the annotation, once as the property — and forgetting the argument silently leaves the executor untyped, which then needs a `never` guard to make safe. The function has none of that: one argument list, the schema written once inside it, and nothing to forget.

*Which is why only one ships.* Both forms working would be two ways to declare one thing, and the function is better in every case found.

*No `tryCreate` twin.* Creating a version cannot fail. Nothing is validated until `build`, so there is no failure channel to report, and `project.md` — *Result types* asks which of the two a function is before it is written rather than pairing everything by reflex.

*And `handler` takes two shapes.* A version and a declaration, or a created version alone. The second carries the version it was created with, so assembly names it once overall. Two overloads of one method rather than two methods, because they are the same declaration reached two ways.

### The context is sketched now and built in change 4, and that is why the generics land here

`proposal.md` — What an executor will receive carries the context in full types. Nothing in this change constructs one, and the type itself lands with change 4: `fault` is typed against ADR-008 and the record-backed halves of `identity` and `collected` against ADR-007, neither of which exists.

Sketching it now is not decoration. It is what proves the declaration carries enough type information for the inference to be possible at all — the services map as written, the state schema per version, the dependency and hook types. A declaration generic only in the contract would make every one of those `any` later, and discovering that in change 4 would mean reopening change 1. So the generics land here and the executor's parameter is typed loosely for one release.

The alternative was to define the context now. ADR-006 fixes sixteen members and nine of them are typed against things that do not exist: `state` and `setState` against the version's schema *and* the record, `identity` and `collected` against the record (ADR-007), `fault` against `ArvoHandlerFault` (ADR-008), `build` against the addressing rules, `atMaxDepth` and `timeRemaining` against the bounds (ADR-009). Defining them would mean writing four changes' worth of types to ship one change's behaviour, and every one of those types would be written before the code that has to satisfy it.

*The cost, named rather than discovered:* tightening the executor's signature in change 4 is a breaking type change for anyone who wrote an executor against this release. Nothing is published, and a handler that cannot run has no callers to break, so the cost is real but paid by nobody.

### Running a delivery is one operation, and it is the `tryX`/`X` pair like everything else

A handler does one thing and there is one operation for it, and that operation is the whole boundary: **the mechanism is whatever wraps it**, and nothing on either side of the call knows more about the other than the signature says. It takes the delivered event, a function that reads the store, an attempt number, dependencies, hooks and a telemetry context. Nothing in it names a broker, a store, a scheduler, a transport or a runtime, so the same handler runs under a queue consumer, a serverless invocation, a test, or a loop in a script. Adapting it is reading the result, not implementing an interface.

`tryExecute` holds every branch and returns `AsyncResult<ArvoDelivered, ArvoHandlerFault>`. `execute` is the thin unwrap with no logic of its own, returning the value or throwing the fault. That is `project.md` — *Result types* applied without exception, and it is the package's first asynchronous `tryX`, so `fromNeverthrowAsync` in `src/result.ts` — written alongside the synchronous boundary and unused until now — is what converts. No `Result` is built as a literal anywhere in the path.

*What lives behind it.* The whole protocol. ADR-010's *One delivery, in order* lists ten steps and every one of them runs inside `tryExecute`: classification, the gate, the record read and its validation, hydration, option and dependency resolution, the context, the executor, return validation, and building either the next record or a fault with its abandonment pair. Nothing is assembled by a caller and nothing is reachable halfway through, because a delivery that can be entered in the middle is a delivery whose invariants no longer hold.

*And how it is decomposed.* Many modules, all internal, following the sequence rather than the class. The alternative — one long method — would be untestable at the step level, and `project.md` — *Testing* wants a case per rule, which means each rule has to be reachable on its own. What does not change is the boundary: two methods wide, however many files sit behind them, and nothing behind them is exported.

*Why the fault is the error channel, having first been drafted as a third success outcome.* An earlier draft returned `produced | discarded | fault` and no `Result`, on the reasoning that ADR-008 makes a fault a value a mechanism reads rather than an error it catches. That confused *what a mechanism does with it* for *what it is*. A fault is precisely the expected failure of a delivery, which is what a `Result`'s error channel exists to carry, and ADR-008 has it extend the language's native error type for exactly this reason. The draft also invented a third mechanism for reporting failure in a package whose conventions already have one, which is the two-mechanisms problem *Dependencies and reuse* warns against arriving at the API-shape level.

*What remains a value, and why.* `discarded` stays on the success side. ADR-010 step 9 discards a redelivered event, and that is a delivery carried through to a correct conclusion that happens to produce nothing — "nothing to do, nothing wrong". Reporting it as `Err` would claim a failure that did not occur.

*What is not converted.* Only an `ArvoHandlerFault` becomes `Err`. Anything else escaping the handler is a defect in this package and propagates out of `tryExecute` unconverted, per *Result types*: a `Result`'s error type is a claim about what kind of failure occurred, and swallowing an arbitrary exception into it makes that claim false.

*The fault extends `Error`, and that is what makes the pair work.* ADR-008 has it extend the language's native error type, so `execute` throws it, a `catch` can name it, and `tryExecute` reports it as `Err` without wrapping. Four of its members — `name`, `message`, `stack` and `cause` — are `Error`'s own, narrowed rather than added: `name` to the literal ADR-008 fixes, `cause` from `unknown` to `string | null` because the whole object must survive JSON. Its remaining field names are ADR-008's spelling and not this package's camel case, for the reason `ArvoEvent` carries ADR-001's: a durable format read across languages cannot have two spellings. Change 3 builds it; it is sketched in `proposal.md` because its shape decides what an adapter may branch on.

*One naming collision, accepted.* The business code a version declares is also called `execute`. `handler.execute` runs a delivery; `versions['1.0.0'].execute` is the executor that delivery may enter. ADR-006 keeps the two apart as *handler* and *executor*, and the nesting makes the relationship read correctly at a call site. The TSDoc on each says which is which.

### Dependencies and hooks are declared as types, through one witness field

`types?: Partial<{ mechanismHooks: H; dependencies: D }>` carries no value and is never read at runtime. It exists so that TypeScript has a position from which to infer the two shapes a mechanism supplies at delivery.

*Why it is needed at all.* Both are given to the handler per delivery, so neither appears anywhere else in a declaration. A generic that appears in no parameter cannot be inferred, so without this field a caller who wanted either typed would have to supply every type argument explicitly — the contract's type, its version map, the services map and the version declarations included. That is not an API anyone would use, and the alternative of leaving both `any` gives up the type safety the context sketch exists for.

*Why a witness field rather than explicit type arguments.* One optional field a caller writes once, against six type arguments they would otherwise have to spell at every declaration. The cost is that a caller writes a value purely to carry a type, conventionally `{} as MyDeps`, which reads oddly the first time. The TSDoc says outright that nothing is stored.

*Why both sit at the handler.* A mechanism runs a handler, not a version, so there is one dependency shape and one hook shape per handler. Both thread down into every version's executor. The state schema is the one of the three that is per version, because ADR-006 puts it on the executor's own declaration rather than on the handler's.

*Both default to `Record<string, never>`* rather than `{}`. `{}` in TypeScript means "any non-nullish value" and would let an executor reach for a dependency that was never declared. The empty record makes the absence real: `ctx.dependencies.db` does not compile where no dependencies were declared, which is the honest answer.

*The constraint, and its one trap.* Both are constrained to `Record<string, any>`, matching how the package already constrains an event's payload. TypeScript gives an object type alias an implicit index signature and does not give one to an `interface`, so a dependency bag declared as an interface will not satisfy the constraint while the identical `type` alias will. That is a TypeScript rule rather than a decision here, and the TSDoc names it where a caller meets it.

### Services are a named record, and the name means nothing to the protocol

`services: Record<string, VersionedArvoContract>`, the key chosen by the author. ADR-006 speaks of "the set of contract versions" and derives an emitted event's destination from its `type`, never from a name, so the key is API shape and ADR-004 leaves it to each language. ADR-006's own appendix sketches services with names, which is the precedent followed.

An array would match the ADR's wording more literally. The record wins on two counts: a name is how an author refers to a dependency when reading their own declaration back, and change 4 can surface `services.payments.type` to an executor without inventing a lookup. Nothing in the protocol reads the key, and the spec says so, so an implementation in another language declining to offer names is still conformant.

### Completeness is a runtime rule, and the widening trap is why that is no loss

A handler declaring fewer versions than its contract does is refused at `build`, naming each version with no handler, and one declaring a version the contract does not know is refused the same way.

An earlier draft had the compiler catch the first through a mapped type over `keyof M`, and the probes showed what that was actually worth: a contract whose versions map was annotated `ArvoContractVersionMapParam` widens its keys, so a handler built from it accepted *no versions at all* and compiled. The compile-time half was already unreliable in exactly the case a large codebase reaches first. The runtime rule has no such hole, runs at module load in every real declaration, and reports a version by name.

### `unset` inherits, a written `null` is a value, and this departs from *Optional inputs*

ADR-006 requires an implementation to distinguish an option that was not written from one written as `null`, and MUST NOT collapse the two: for the two timeouts, omission inherits the handler's value and `null` means unbounded. So `runTimeout?: number | null` and `executionTimeout?: number | null`.

`project.md` — *Optional inputs* says an optional input is `T | undefined`, "written `field?: T`, never `field?: T | null`", even where the stored field is nullable. This breaks the letter of that rule and keeps its reason. The rule exists to stop one meaning having two spellings; here there are two meanings — *inherit* and *unbounded* — and collapsing them would make one of them unsayable. The other five options take no `null` and follow the rule unchanged.

*Consequence worth pinning:* `{ runTimeout: undefined }` written explicitly must behave as omission, because TypeScript cannot tell an absent key from a present undefined one at a call site. Resolution therefore keys off `value === undefined`, not on key presence, and a test covers the explicit-undefined spelling alongside the absent one.

### Option resolution is internal, and the declaration is the whole public surface

One internal function implements ADR-006's rule, and nothing exposes it. The handler level is resolved once in the constructor and stored complete — every one of the seven holds a value after defaulting — so resolution is a single coalesce per option rather than a walk, which is what ADR-006 means by "there is no third step, because the handler is never missing a value".

*Why it is not a method.* An earlier draft put `optionsFor(version)` on the class. It reads well and it is genuinely useful to a consumer debugging a declaration, and that is the problem: it makes the resolution rule part of the published surface, so a consumer can branch on a value the protocol reserves for itself, and every later change to how an option is resolved becomes a breaking change to an API nobody needed. What a consumer declares is theirs; what the protocol makes of it is the protocol's. The same reasoning retires the per-version emittable set from the surface — it is derived, not declared.

*What the changes that run a delivery use instead.* The internal function, imported directly. Keeping it a free function in `options.ts` rather than a private method also keeps it testable without reaching through a class, which matters because it is the module carrying every default.

### The per-version emittable set is computed once and held internally

The collision rule needs it — service input types, that version's `outputs` keys, and its handler error type — so it is computed while checking and kept rather than recomputed. Change 4 validates what an executor returns against the same set, and change 1 is where it is cheapest to build, once, at declaration.

It is not exposed, for the reason above: it is derived from the declaration rather than part of it.

### The error-domain option takes `ArvoDomainInput`

ADR-006 pins four domain sources and gives each an identifier for a purpose that no longer exists — the identifiers were fixed so a version hash would agree across languages, and version hashing was removed from the ADRs before they were accepted. What remains is a fixed set of four, and `ArvoDomain` already is that set: `LOCAL`, `FROM_EVENT_CONTRACT`, `FROM_SELF_CONTRACT`, `FROM_TRIGGERING_EVENT`.

So the option is `ArvoDomainInput` — a literal string, or one of those symbols — and no second vocabulary is introduced. ADR-004 makes the spelling each language's own; the set is what the ADR fixes, and the set matches.

*What this change does not do:* resolve one. A symbol is held as declared. Resolution needs the sources a symbol reads from, which is change 4's.

### The timeout relation is checked on the resolved pair

`executionTimeout` must not be below `runTimeout`, and must be `null` where `runTimeout` is `null`. ADR-006 requires this "on each version's resolved pair, after the rule above has been applied", which matters because the two halves can be written at different levels: a handler-level `runTimeout` of 30 seconds and a version-level `executionTimeout` of 5 seconds are individually reasonable and jointly impossible.

So the check runs once per declared version, after resolution, and reports the version it failed for. Checking the written values instead would pass that declaration and leave a version that can never succeed.

### A declaration error is its own error, and is not a fault

`ArvoEventHandlerValidationError`, alongside `ArvoContractValidationError` and `ArvoEventValidationError`, carrying `ErrorIssue[]` and reporting every rule broken rather than the first.

It is deliberately not `ArvoHandlerFault`. ADR-008 defines a fault as something a *delivery* produces, and ADR-006 is explicit that a declaration defect has no fault defined for it "because it is a defect in code, visible before any event exists, so no backstop at delivery is needed". Reusing the fault would put a runtime vocabulary — `retry`, `fault_kind`, an abandonment pair — on a failure that has no delivery, no attempt and no caller.

*One rule is blocking, and only one.* If `contract` is not an `ArvoContract`, every other rule is unanswerable: completeness, collisions and the per-version timeout check all read it. Per `project.md` — *Validation*, that issue carries a `blockingReason` and the rest are not attempted. Everything else collects: a missing executor, a colliding type, a bad option and an impossible timeout pair are all reported together.

## What the probes established

Written as one file under `src/`, typechecked, and deleted. `tsc --noEmit` reported nothing, which means every positive case compiled and every `@ts-expect-error` fired.

- **Completeness works in both directions.** A mapped type over `keyof M & ArvoSemanticVersion` rejects a handler declaring fewer versions than the contract and rejects one naming a version the contract does not declare. Neither needs a runtime check to be a compile error.
- **The widening trap is real and silent.** A contract whose versions map was annotated `ArvoContractVersionMapParam` accepts a handler declaring *no* versions at all, because `keyof M` has widened to every semantic version. The runtime check is what catches it, which is why both halves exist.
- **`in` cannot be trusted for `unset`.** `Partial<T>` over `number | null` gives an omitted key, a written `null` and an explicit `undefined` the same property type, and an explicit `undefined` is a present key at runtime. Resolution keys off `value === undefined`, as §3.2 and §3.3 require.
- **A bare `VersionedArvoContract` exposes what the rules need** — `uri`, `type`, `version`, `outputs` and `error.type` — with no cast.
- **Every generic the context needs survives inference from one call.** The services map infers as written rather than widening, so `services.payments.type` is the literal `'com_payment_charge'`. A version's own `state` schema is readable back out of the same object literal that declares it. A version written as the executor alone infers as stateless. `D` and `H` infer off the `types` witness field and fall to the empty record when it is omitted.
- **The union must be written as a union of intersections.** `(Base & InitArm) | (Base & FollowArm)` narrows on `entry`; `Omit<Base & (InitArm | FollowArm), never>` does not. This is the collapse the factories change hit with `span`, confirmed again here.
- **All of it holds against `zod/v4/core`.** A schema written with full zod satisfies `$ZodObject`, and `zc.infer` reads it, so the shipped types use core throughout with no loss.

One thing the probes found that no task anticipated. **`z.infer<M[V]['input']>` does not satisfy `ArvoEvent`'s own `D extends Record<string, any>` constraint generically**, because TypeScript cannot prove a payload inferred from an unresolved schema is an object. A conditional helper that re-establishes it is needed wherever a version's payload types an event, and §2.1 carries it as `PayloadOf`. Without it the context's `event` member does not compile at all, which would have surfaced in change 4 with change 1 already shipped.

One thing the second round of probes established, against the shipped types rather than a sketch. **The chain infers everything the design claimed.** A version created by `createArvoEventHandlerVersion` types its context exactly as the inline form does; a state schema declared inline types `ctx.state` and `ctx.setState`, and a wrong read is caught; a version with no schema reaches `state` as a JSON object; dependencies and hooks infer off `types` and are unreachable when it is omitted; narrowing on `entry` narrows the event both ways; and a version the contract does not declare is a compile error at the `handler` call rather than a surprise at `build`.

## Risks / Trade-offs

- **A typed hole for one release.** An executor written against this change's loose signature will not typecheck against change 4's. Accepted: nothing is published, and an executor that cannot be called has no behaviour to preserve.
- **Named services are a concept the ADR does not have.** A reader moving between the ADR and this package meets a key the protocol never mentions. Mitigated by saying plainly, in the spec and the TSDoc, that the name is local and nothing reads it.
- **The widening trap is inherited, not introduced.** A contract annotated with `ArvoContractVersionMapParam` degrades the handler's compile-time completeness check silently. The runtime check still catches it, so the failure mode is a later error rather than a wrong handler, and the TSDoc names it.
- **Seven defaults are now stated in two places** — ADR-006's options table and `src/ArvoEventHandler/options.ts`. That is unavoidable for any implementation of a specification, and the mitigation is the usual one: the defaults live in exactly one module, the tests assert each against the ADR's stated value, and nothing else spells a default.
- **A declared handler does nothing.** Someone reading the export list after this change will find a primitive that cannot process an event. That is the cost of shipping in slices, and the alternative — one change implementing five ADRs — is worse by every measure `project.md` — *Git* gives for keeping commits reviewable.
