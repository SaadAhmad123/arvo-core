## Context

See `proposal.md` — Why. The constraints that shape the approach, most of them found by sketching the surface to compilation before writing this:

- **The constructor already holds every structural rule** and validates in its own body. A factory is a way of reaching it, never a second opinion about what a valid event is.
- **The declaration holds the rest.** A `VersionedArvoContract` carries `type`, `dataschema`, `accepts`, `emits`, `handlerError` and `domain`. All five variants read fields that already exist.
- **An event's stored fields and an event's input fields are different types.** Stored is `string | null`; input is `string | undefined`, `project.md` — *Optional inputs* declining to spell `null` at all. So an event's own fields cannot be handed straight back as input — which is exactly what `.clone` wants to do.
- **Everything zod is `zod/v4/core`.** The one entry point a library may depend on. Core schemas carry no methods, so payloads are checked with the standalone `z.safeParse`, and core's constructors accept no type arguments — both facts leave marks on the design below.
- **`ArvoDomain` is already shipped.** Four symbols naming where a `domain` may be read from, and an internal resolver. This change consumes it rather than defining it.

## Goals / Non-Goals

**Goals**

- Five utilities, each doing precisely what its name says.
- A payload that cannot reach an event without having satisfied the schema it claims to.
- Every derived value read from the thing that derived it, never re-derived here.
- One reachable construction path, so no variant can produce an event the constructor would have rejected.
- Nothing that throws out of a `tryX`, including on inputs only JavaScript can produce.

**Non-Goals**

- Anything in `proposal.md` — Out of Scope.
- Protecting a caller from what they asked for. These are utilities; a caller who builds an odd event has built the event they asked for.
- Restating a structural rule of an event.

## Decisions

### These are utilities, and that decides the arguments

Each variant does what its name says and nothing more. Where the two conflict, the name wins over the safer behaviour.

That is not a style preference; it changed two decisions. An earlier draft had `.clone` drop `id` and `time` so a clone could never collide with its source under ADR-001's global-uniqueness rule. But a function named `clone` that silently alters two fields is a function whose name argues with its body, and the caller — who is the only one who knows whether both events will be sent — is better placed to decide than a default is. And an earlier draft filled in `source` and `dataschema` when omitted, which made the easiest way to build an event also the way to build one nobody can trace.

*The rule that came out of it:* a utility fills in a field only where nothing else could supply it. That leaves exactly one — `subject`, where omission means this event starts its own execution.

### `.clone` copies every field, and its typing always survives

Every field comes across, `id` and `time` included, then overrides are applied over the top.

One signature, not two: `clone<T, D>(event: ArvoEvent<T, D>, overrides?: Partial<ArvoEventParam<T, D>>)`. The overrides are typed against the source event's own `T` and `D`, so a clone is always an `ArvoEvent<T, D>` and an override that changes the payload's shape does not typecheck. An earlier draft had a second, widening overload — overridden means untyped — and the sketch showed it was unnecessary: constraining overrides to the source's types is both simpler and stricter.

*Consequence, and it belongs in the TSDoc:* a clone sent alongside its source is two events with one `id`, and ADR-001 makes deduplication key on `id` alone, so one of them will be dropped. The caller overrides `id` when that matters. Stated where they meet it rather than prevented.

*Consequence of the two type surfaces:* an event holds `null` for a field it has no value for, and the input type declines to spell `null` at all. An earlier draft dropped every null-valued field on the way across, translating one spelling into the other by hand — unnecessarily, because normalization already reads either: every nullable field arrives as `input.field ?? null`. So the fields cross as they stand, behind the one cast that bridges the two type surfaces. `project.md` — *Optional inputs* says this outright, and the draft that hand-rolled it had not read far enough.

*What clone does not do:* infer causality. `parentid`, `initid` and `depth` come across as they stand. A clone is not a child of its source, and a caller who wants a child says so with an override.

### One generic, taken from the value

Each contract-aware variant is generic in the contract it is handed — `<V extends VersionedArvoContract>` — and every other type is read off it: `V['type']`, `V['accepts']`, `V['emits'][E]`, `V['handlerError']['schema']`. `.by` adds one more, `E extends keyof V['emits'] & string`.

An earlier draft threaded the class's own three parameters — `<T, V, C>` — because that is how the class is declared. That was copying, not designing: the factory does not need the class's decomposition, and the three-parameter form also failed to compile against `domainFor`, the class being invariant since its generic assert methods. One parameter read off the value is smaller, and it is what makes the return type honest — `ArvoEvent<V['type'], z.output<V['accepts']>>` rather than `ArvoEvent<T, any>`.

*One cast rides along:* indexing a generic's own property does not carry the mapped type — `contract.emits[param.type]` widens to "a schema" — so the lookup is restated as `V['emits'][E]` on one line, with a comment saying why.

### The three contract-aware variants check the payload, and carry what the check produced

`z.safeParse` against the version's own schema, and **its output is the event's payload**. So a value the schema declares a default for is present on the way out even when the caller omitted it.

*Why the output rather than the input:* the contract is the only participant that knows its defaults. Handing the input through would leave a declared default unreachable, and every call site would end up copying it — the duplication the declaration exists to prevent.

*Why this is not the same decision as the sibling change's:* `assert` reads an event that already exists and discards `safeParse`'s value, because applying defaults there would rewrite someone else's event. A factory is deciding what the payload *is*. The two are the same rule seen from opposite ends.

*Consequence for the types:* `param.data` is the schema's **input** side and the event's `data` is its **output** side, and `checkPayload<S>` returning `z.output<S>` is what carries the second half — an earlier draft returned `Record<string, any>` and threw away exactly what the check had established.

*Consequence worth a test, and it splits in two.* Probed rather than assumed, because the two halves behave differently:

| the transform produces | what happens |
|---|---|
| a value with a JSON form — a `Date` | the event's payload walk serializes it, and the event is built carrying a string |
| a value with none — a `Set` | the walk reports it, at the position within the payload |

The second is the honest failure the design wanted: the contract declared a payload its own canonical form cannot express, per ADR-005's account of authoring-time richness, and the caller is told where.

The first is a type lie and the more dangerous of the two. `z.output` types the field as `Date`, the built event holds the serialized string, and a caller writing `event.data.at.getTime()` compiles and fails at runtime.

*Why it is accepted rather than fixed:* the only fix at the type level is to describe the payload with the schema's input side, and that breaks the common case — a declared default is present on the built event, so typing it optional would be a second lie in the opposite direction. No single type is right for both, and a default is the reason this feature exists while a transform is a contract author's own choice. So the payload keeps its output type, the divergence is documented where a caller meets it, and both halves are pinned by tests so neither can drift into looking accidental.

*One deliberate wording:* each payload issue's message carries a suffix naming which schema judged it — "(against the contract's accepts)", "(against the contract's emits[com_order_created])" — because the same payload shape can exist under several keys and the position alone does not say which declaration was consulted.

### `.for` addresses the event; `.by` and `.error` do not

`.for` defaults `to` to `contract.type` when the caller says nothing. The event it builds is a request, Arvo routes by type, and the handler bound to this contract is who accepts events of that type — so the destination is a fact the contract holds, the same category of knowledge as `type` and `dataschema`, not a placeholder invented on the caller's behalf.

`.by` and `.error` default nothing. Where an emitted event or an error goes is fully the caller's decision: the contract knows what those events *are*, not who is waiting for them, and a default aimed at `contract.type` would address them back at the very handler that produced them.

*Why this does not break the fills-in rule:* the rule bans filling a field with a value nothing knows. `to` on `.for` is a value the contract does know — the line stays where it was, between supplied knowledge and invented placeholders.

### `domain` is absent, a value, or an instruction

Omitted, the event has no domain — nothing is inherited silently, including the contract's own. A string is used as it stands. One of `ArvoDomain`'s symbols is resolved before the event is built: the factory supplies the contract it already holds as the event-contract source, and the caller supplies the other two sources — the building handler's contract, the triggering event — in `options.domainCtx`. A symbol whose source is absent resolves to `null`, which becomes omission at the constructor.

*Why omission is not the contract's domain:* an earlier draft defaulted it that way, leaning on ADR-005's line that the field exists so factory-built events can inherit it. But that makes omission mean something, and a caller who wants the contract's domain can say so in one symbol — `ArvoDomain.FROM_EVENT_CONTRACT`. Explicit beats inherited, and the guard is `domain === undefined` rather than falsiness, so an empty string still reaches the resolver and fails validation loudly instead of being swallowed.

*Why the sources live in `options`, not the param:* the param is the event's fields. `selfContract` and `triggeringEvent` are machinery for resolving one field and never appear on an event — putting them beside `subject` and `data` makes the param two things at once. `error` stays in the param for the opposite reason: it *is* the payload.

### Nothing derived is derived twice

`.error` reads both the event type and the payload shape off `contract.handlerError` — `V['handlerError']['type']` and `V['handlerError']['schema']` — rather than rebuilding `handler_${T}_error` and importing the payload type.

*Why it matters beyond tidiness:* the first sketch did rebuild it, and so did three type helpers in `ArvoContract/types.ts`. Each copy is a place the rule can drift from the contract that owns it. The same reasoning already applies to the assertion path, where the handler error arrives as an argument rather than being derived inside the check.

### `.error` checks the payload it built itself

The three fields are read off the error — `error?.name`, `error?.message`, `error?.stack ?? null` — and then checked against the handler error schema like any supplied payload.

An earlier draft skipped the check on the grounds that a payload built here is built into the declared shape. The sketch showed why that is wrong: a JavaScript caller can pass anything as `error`, the optional-chained reads then yield `undefined`, and without the check the factory either builds an event no consumer can read or throws a `TypeError` out of a `tryX`. With it, the failure is two issues naming `data.error_name` and `data.error_message`.

### `.by` guards its schema lookup at runtime

An undeclared `type` cannot compile — `E extends keyof V['emits']` — but JavaScript callers and casts exist, and without a guard the missing schema reaches `safeParse`, which throws. The guard reports at position `type`, naming the keys the version does declare, with distinct wording for a version declaring none at all (`join` on an empty list would otherwise end the message mid-sentence).

The comment on the guard states that it is unreachable from TypeScript and reachable from JavaScript — otherwise it reads as dead code, and coverage pressure deletes it.

*Why the handler error is not reachable here:* `.by` reads `emits`, and a handler error is derived rather than declared — it is not an entry of `emits`. A consequence of what `.by` reads, not a policy it enforces.

### `type` is a field of the param, not an argument of its own

`.by(contract, { type, source, data })`, not `.by(contract, type, { source, data })`. As a field it sits where every other event field sits, so a caller moving between variants never rearranges their call — and it stays in the spread on the way to the constructor, being the event's own field that the caller chose.

### The event's own error, everywhere — no factory error exists

Every failure, from every variant and both forms, is `ArvoEventValidationError`. A factory does exactly two things — build an event and validate its creation — and each failure is the event failing to come into being, whichever rule caught it: a structural rule in the constructor, or the contract's schema at the door. One operation, one error, one `catch`.

*What this costs, and how it is paid:* the error's own TSDoc currently says it "does not mean the payload failed contract validation, which is a separate check". That sentence was written when construction and contract validation genuinely were separate, and the factories end that separation — for an event built from a contract, the schema is part of what creation means. The sentence is amended as part of this change rather than left to become false. An earlier draft introduced a dedicated `ArvoEventFactoryError` to avoid touching it; a new public error type for the same operation-shaped failure is the heavier fix for a one-sentence problem, and hands callers two types to catch where one suffices.

*Why not `ArvoContractAssertionError`:* nothing is asserted. That error means an event that exists does not match a contract; this means a payload could not become an event at all.

*How the two sources stay one error:* the payload check builds the error itself, issues under `data.…`; a constructor failure is the error already, passed through untouched. Nothing is wrapped and nothing re-labelled, so an issue's position and message read the same whichever rule produced them.

An unexpected throw is not converted, matching the contract factory: an error type is a claim about what kind of failure occurred, and a bug elsewhere on the call path is not a validation failure.

### One file per variant, one surface assembled over them

`src/factories/createArvoEvent/` holds `raw.ts`, `clone.ts`, `for-contract.ts`, `by-contract.ts`, `handler-error.ts`, the shared `payload.ts` and `domain.ts`, `types.ts`, and `index.ts` assembling the two callable objects — `Object.assign` on the plain function, frozen.

*Why named files rather than one module:* a stack trace, a test name and a coverage report all read better against a named function than an anonymous property. The dotted surface is for the caller's fingers, not the implementation's identity.

*Consequence worth naming:* properties on a function are not tree-shakeable. Importing `createArvoEvent` for the plain form pulls in all five variants and the payload check with them. Acceptable at this size.

*Why the explicit names stay internal:* two ways to call one function is what `project.md` — *Dependencies and reuse* rejects.

### The throwing form wraps the non-throwing one, five times

`createArvoEvent` and each of its four properties call their `tryX` counterpart and unwrap. No variant holds logic in both forms.

### What connects building to reading is a test

Nothing in the implementation shares code with the assertion path — it takes an event, and here there is no event yet; calling it would mean constructing an event to find out whether it may be constructed.

So the connection is a property the suite holds: an event any variant produces, asserted back against the contract that produced it, matches — with the scope that variant implies. `.for` gives `accepts`, `.by` gives `emits`, `.error` gives `handlerError`. If either direction changes its mind about what matches, that test fails rather than the two silently diverging.

## Risks / Trade-offs

**A transform-bearing schema can fail at construction** → `safeParse`'s output becomes the payload, and a non-JSON output is rejected by the event's own walk. Mitigated by reporting it as issues rather than a crash, and pinned by a test so it is a known limitation rather than a surprise.

**A clone can collide with its source on `id`** → Deliberate: the name promises a copy. Documented where the caller meets it, and one override away.

**Omitting `domain` builds a domainless event even when the contract declares one** → Deliberate, and the likeliest surprise on the surface: a caller must ask for inheritance with `ArvoDomain.FROM_EVENT_CONTRACT`. Stated in every contract-aware variant's TSDoc.

**A symbol whose source was not supplied resolves to `null` silently** → Indistinguishable from a source that had no domain. Recorded in the `ArvoDomain` module's own tests; the factories inherit it.

**Function properties defeat tree-shaking** → Named above, accepted at this size.

**`data` out can differ from `data` in** → Only by the schema's declared defaults and transforms, and only on the contract-aware variants. Stated in their TSDoc, because a caller comparing what they passed with what they got will otherwise be surprised.

**Two directions over one declaration could drift** → The agreement test is the guard, and it is the reason to write it rather than assert the property in prose.

## Migration Plan

None. New exports; nothing published.
