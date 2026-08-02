## Context

See `proposal.md` — Why, for motivation, and `specs/arvo-event/spec.md` for the obligations this design has to satisfy.

The constraint that shapes everything below: ADR-001 is accepted and specifies the envelope exactly, so this is implementation against a settled specification rather than open design. The decisions here are the ones the ADR deliberately leaves to an implementation, plus those where its requirements have non-obvious consequences for how the code must be arranged.

ADR-000 records that `arvo-core` v4 is unconstrained by earlier majors, so no decision below needs to accommodate the existing shape.

## Goals / Non-Goals

**Goals:**

- Structural conformance provable rule by rule, so a reviewer can trace each requirement to the code enforcing it
- Validation failures a reader can act on without opening the source
- One validation core reachable from every entry point, so the rules cannot drift apart

**Non-Goals:**

- Performance work beyond the trusted-input escape hatch
- Any abstraction anticipating the propagation change that follows. The propagation rules are known but building seams for them now would be speculative

## Decisions

### Execution identity is accepted, never derived

ADR-001 specifies `executionid` propagation as role-dependent but defers the derivation itself to the handler protocol ADR, which does not yet exist. The event layer therefore cannot compute it and must not guess.

It becomes an ordinary input defaulting to `subject`. That default is exactly what the root event constraint requires, so a root event needs no explicit value and every other event supplies one.

**Alternative rejected:** deriving it from `subject` and `parentid`. This would invent a rule a future ADR will contradict, baking a wrong answer into the layer where it is most expensive to change.

### Unrecognised keys are rejected

The failure mode of silent acceptance is not cosmetic. Every field name is lowercase-concatenated — `parentid`, `initid`, `executionid`, `dataschema` — a style that invites camelCase typos. A mistyped `parentId` does not produce a slightly wrong event; it leaves `parentid` null, which makes the event a root event and forces `executionid` to equal `subject` with `depth` zero. The author asked for a child and silently received a root.

Compile-time checking does not cover this. Excess-property checks fire only on object literals, so anything from a variable, parsed data, a fixture, or a cross-language producer passes through untouched. ADR-000 makes the argument directly: types cannot establish validity across independently deployed or cross-language participants.

Strictness also carries the removal of `extensions` and `rootsubject`. Under lax acceptance those values vanish silently; under strict they produce a message naming the removed field, which is the intended experience for a deliberate major.

The single exception is the span used to supply trace context, which is a legitimate input that is not one of the eighteen fields. A useful side effect is that its mutual exclusivity with raw trace values becomes enforceable at runtime, where today it is only a type-level union.

**Alternative rejected:** lax acceptance for forward compatibility with fields added later. That concern belongs to wire data, and ADR-001 defers wire format entirely. Strict-then-relax is safe; lax-then-tighten breaks callers later.

### Payload validity is decided by a domain walk, not a dependency

ADR-001 states that validity is defined by the JSON value domain, "not by whether a particular serializer happens not to throw". Three alternatives were considered before writing a bespoke module, in the order they were ruled out.

**`JSON.stringify` wrapped in try/catch**, what the previous implementation did. Rejected because it is unsound in both directions, not just the one direction the ADR names. It does not throw on `NaN` or `Infinity` — both silently become `null`. It does not throw on a function or a symbol as an object property — the key is silently dropped; as an array element, it silently becomes `null`. It does not throw on a `Date`, `Map`, `Set`, `RegExp`, or class instance — each is silently coerced into something else (a `Date` into a string; a `Map` or `Set` into `{}`, discarding everything inside). It only throws on a circular reference and on a `bigint`, and even then produces one error for the whole value, with no path and no way to report a second problem in the same payload. Every one of the silent cases is worse than an exception: the caller believes their value survived, and it did not.

**An existing npm package**, checked per the reuse convention before anything was written. `deep-freeze` and `is-circular` are the right shape for the freeze and cycle-detection pieces, but each is small enough to be "too trivial for a dependency" on its own, and both are unmaintained — years since their last publish. An unmaintained micro-package is worse than the few lines it would replace: its bug surface is inherited with none of the ability to fix it. `json-strictify` is the closer fit — it validates before serialization and reports a circular reference with a JSON-Pointer path — but its API throws on the first problem rather than aggregating every one, which the spec's Diagnostic Quality requirement rules out, and it has no way to know the normalization rule below, which is Arvo's and not a general JSON-safety concern. Adopting it would mean wrapping its throw and still hand-writing the normalization and freeze passes around it — a dependency added on top of the bespoke code, not instead of it. `flatted` solves the opposite problem, preserving cycles by making them serializable, where this exists to reject them.

**Zod**, used in `validator.ts` for the one field that genuinely benefits from it — `time`'s RFC 3339-with-offset grammar, real parsing complexity that is easy to get subtly wrong by hand. The other sixteen field rules there are single boolean expressions with no parsing involved, and every one needs a message in the project's own voice regardless of what checks it, so routing them through a Zod schema would add ceremony without removing any hand-written code. Zod does not fit the payload walk specifically, for a documented reason rather than a guess: Zod's own documentation states that passing cyclical data into a Zod schema causes an infinite loop, so cycle detection must run as a bespoke pass before any validation touches the value, regardless of what validates the rest. Once that pass is bespoke, the only remaining piece Zod would replace is classifying a value as a scalar, array, or object. The normalization and the freeze are Arvo-specific and are not produced by a schema for free — expressing them as a `.transform()` at every recursive level is still hand-written recursive code, wrapped in Zod's API rather than removed by it. Routing all four concerns through Zod would mean a bespoke cycle check, then a Zod parse, then a bespoke normalize pass, then a bespoke freeze pass — four traversals in place of the one this module does.

**What the module is, given the above**: one recursive pass doing four things together — classify, detect cycles, normalize per the rule below, and freeze — because none of the four could be removed by an existing tool without either losing a required guarantee or adding traversals for no benefit.

Because none of this rode in on a dependency's own test suite, it carries none of a dependency's track record either. Every rejected value class above gets its own test — see `tasks.md` §9 — not a representative sample of them.

### Undefined follows serialization semantics

JSON has no undefined, but TypeScript optional properties and partial-object spreads produce it constantly, and it is almost never a value an author wrote deliberately.

Defining a payload should feel like ordinary TypeScript. An author writing an optional property should not have to think about the envelope's value domain, nor be handed a validation error for something the language treats as normal. So a map key whose value is undefined is omitted, and an undefined array element becomes null, since omitting it would shift every later index and corrupt the array.

This is the one place the design accepts silent loss, and it is bounded: the result is exactly what serialization would have produced anyway, so no receiver can distinguish an event built this way from the same event round-tripped through a wire format. That equivalence is what makes the loss acceptable here and unacceptable for unrecognised keys.

**Alternative rejected:** rejecting undefined outright. Safer against a key vanishing unnoticed, but it fails ordinary spread-built payloads and pushes defensive cleanup onto every call site.

### A value with its own `toJSON()` is honoured, not rejected

Found during a developer-usage exercise after the walk was first built (`developer-usage-findings.md`, Finding 3): a class implementing its own `toJSON()` — a money type, a branded ID, a custom date wrapper — was rejected outright, the same as a bare `Date` or a `Map`. `JSON.stringify` would have called it and serialized the result without complaint; that's precisely how `Date` itself serializes.

The original rejection was reasoned about a different case: an *implicit*, caller-didn't-ask-for-it coercion (`Date` silently becoming a string, a `Map` silently becoming `{}`, discarding its contents). A caller's own `toJSON()` is the opposite — an explicit statement of how they want their value to serialize. Rejecting it overrides a choice the caller made on purpose, which is a different act from refusing to guess on their behalf.

So: when a non-plain object is encountered and `typeof value.toJSON === 'function'` — checked the same way `JSON.stringify` checks it, which finds a method inherited from the prototype chain just as readily as one set directly on the instance — it is invoked and its return value is walked in the object's place, at the same path, subject to every normal rule. A `toJSON()` that returns something still outside the JSON domain is rejected exactly as if that value had been supplied directly, and a `toJSON()` that throws is reported as an issue rather than escaping the walk as an uncaught exception. `Date` is accepted as a consequence, not a special case: its `toJSON` lives on `Date.prototype`, not on any one instance, and the check finds it there exactly as it would find one a user-defined class declared on itself.

**Alternative rejected:** keep rejecting everything without a `toJSON` check, and document the omission as deliberate. Simpler, and consistent with the original `Date`/`Map`/`Set` reasoning taken at face value — but leaves a common, unremarkable TypeScript pattern (a value class with `toJSON`) failing in a way that surprises anyone whose intuition comes from `JSON.stringify`, for no corresponding safety benefit: the caller already told the walker exactly what to do with the value.

### Trusted input skips only the payload walk

The escape hatch disables the recursive walk and its accompanying freeze — the only work whose cost scales with payload size. Field and cross-field rules always run; they are eighteen cheap checks, and skipping them would remove the guarantees the type exists to provide for no measurable gain.

It should read as a claim the caller is making about their input rather than a performance switch, and its documentation must state the consequence plainly: a trusted event carrying a non-finite number is structurally invalid and will fail later, at serialization, far from the call site that introduced it.

### Freezing happens during the walk

Deep-freeze the payload and ambient context as the walk unwinds, and shallow-freeze the event itself. This makes immutability free rather than a second traversal, and it is why trusted input necessarily skips the deep freeze — the two share a pass. Trusted construction still receives the shallow freeze.

### Two entry points over one validation core

Creation raises; admitting plain data reports. Both run the identical core.

The reporting entry point exists because ADR-001 binds the structural rules wherever an event enters as data — replay, fixtures, foreign producers — and exception control flow is wrong for bulk or untrusted input. It is not a wire-format decoder; it validates plain data against the structural rules and nothing more.

The hard rule is one core. Two validators both claiming to implement ADR-001 will diverge, and the divergence will be discovered in production.

### Validation is ordered for diagnostics

Unrecognised keys, then field rules, then cross-field rules, then the payload walk.

Unrecognised keys first because a typo otherwise surfaces as a confusing downstream failure — a mistyped `parentid` reports as a root-constraint violation, pointing at the wrong field entirely. Field rules before cross-field rules because a cross-field message is meaningless when one of its operands is itself invalid. The payload walk last because it is the expensive step and there is no reason to pay for it when the envelope is already known bad.

Field-level failures aggregate rather than short-circuit. Fixing one field per run is a poor experience with eighteen of them.

### The `data` generic's constraint stays `Record<string, any>`

The original plan was to tighten `ArvoEventParam`'s `D extends Record<string, any>` toward something shaped like the JSON value domain, so a caller's concrete `data` interface would be checked at compile time as well as at runtime. This turned out not to be achievable without breaking the common case.

TypeScript exempts a concrete interface — one declared without its own index signature — from needing one to satisfy a generic constraint that has one, but only when the constraint's index signature value type is exactly `any`. Verified directly: the identical interface satisfies `D extends Record<string, any>` and fails `D extends Record<string, unknown>` and `D extends JSONObject` (whose value type is the `JSONValue` union), with the same "does not satisfy the constraint" error in both stricter cases. Since almost every real `data` interface is declared this way — the class's own example is `data: { orderId: '123' }` — any constraint tighter than `any` rejects ordinary usage, not just malformed usage.

Nor does the nullability transformation compose into something a generic utility type could express even if this worked. Going from `ArvoEventParam` to a materialized shape isn't a uniform "make every optional field required": `id`, `executionid`, `depth`, and `time` resolve to a concrete non-null value when omitted, while `parentid`, `initid`, `category`, `to`, `domain`, `traceparent`, `tracestate`, and `executionunits` resolve to `null`. `Required<T>` only removes the `?`; it does not add `| null` where defaulting introduces one. A mapped type covering this would need to special-case eight of the eighteen fields individually, at which point it is no shorter or safer than declaring the materialized shape directly, and considerably harder to read.

`D` stays `Record<string, any>`, matching what was already there. Compile-time typing was never the enforcement mechanism for JSON-domain validity in this design — the runtime walk in `json.ts` is, for every `data` regardless of how precisely its caller-supplied interface happened to be typed, which is consistent with ADR-000: compile-time types must not replace runtime validation.

## Risks / Trade-offs

- **Full-depth validation is a new per-event cost proportional to payload size** → The trusted-input escape hatch exists for hot paths. The default remains the safe one, so large payloads will notice; accepted, because the ADR requires the guarantee and correctness precedes throughput here.
- **Strict rejection breaks every existing call site** → Intended, and the reason this ships as a major. The real risk is messages poor enough to make the break confusing rather than instructive, which the diagnostic requirements exist to prevent.
- **The package will conform structurally but not behaviourally** → With propagation unenforced, a reader may assume "conforms to ADR-001" means more than it does. Stated in the proposal's Impact and to be repeated in the release notes.
- **The payload walk and the freeze are coupled** → Sharing a pass is what makes immutability free, but it means the trusted path silently gives up deep immutability as well as deep validation. Documented on the option rather than designed around.
- **The payload walk is bespoke and carries no upstream battle-testing** → This is public package code; a missed edge case here does not surface as a caught exception, it surfaces as silently wrong data in a consumer's event. Mitigated by testing every rejected value class individually rather than sampling — see `tasks.md` §9 — and by the comparison above being recorded so the coverage can be checked against it.

## Migration Plan

No migration. ADR-000 records that v4 is a deliberate rebuild unconstrained by earlier majors, and no released version implements ADR-001, so there is no persisted data and no consumer to carry forward.

Ships as a major version. Rollback is reverting the release; nothing is written to durable storage by this change.
