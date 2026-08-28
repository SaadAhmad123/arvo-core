## Context

See `proposal.md` — Why. The constraints that shape the approach, several of them found by sketching the surface before writing this:

- **The constructor already holds every structural rule** and validates in its own body. A factory is a way of reaching it, never a second opinion about what a valid event is.
- **The declaration holds the rest.** A `VersionedArvoContract` carries `type`, `dataschema`, `accepts`, `emits`, `handlerError` and `domain`. All five variants read fields that already exist.
- **An event's stored fields and an event's input fields are different types.** Stored is `string | null`; input is `string | undefined`, `project.md` — *Optional inputs* declining to spell `null` at all. So an event's own fields cannot be handed straight back as input — which is exactly what `.clone` wants to do.
- **`ADR-005` settles `domain` and defers the rest of it.** Copying a contract's static default is what the field is for; resolution strategies belong to the handler-protocol ADR.

## Goals / Non-Goals

**Goals**

- Five utilities, each doing precisely what its name says.
- A payload that cannot reach an event without having satisfied the schema it claims to.
- Every derived value read from the thing that derived it, never re-derived here.
- One reachable construction path, so no variant can produce an event the constructor would have rejected.

**Non-Goals**

- Anything in `proposal.md` — Out of Scope.
- Protecting a caller from what they asked for. These are utilities; a caller who builds an odd event has built the event they asked for.
- Restating a structural rule of an event.

## Decisions

### These are utilities, and that decides the arguments

Each variant does what its name says and nothing more. Where the two conflict, the name wins over the safer behaviour.

That is not a style preference; it changed two decisions. An earlier draft had `.clone` drop `id` and `time` so a clone could never collide with its source under ADR-001's global-uniqueness rule. But a function named `clone` that silently alters two fields is a function whose name argues with its body, and the caller — who is the only one who knows whether both events will be sent — is better placed to decide than a default is. And an earlier draft filled in `source` and `dataschema` when omitted, which made the easiest way to build an event also the way to build one nobody can trace.

*The rule that came out of it:* a utility fills in a field only where nothing else could supply it. That leaves exactly one — `subject`, where omission means this event starts its own execution.

### `.clone` copies every field, and translates `null` to absence

Every field comes across, `id` and `time` included, then overrides are applied over the top.

*Consequence, and it belongs in the TSDoc:* a clone sent alongside its source is two events with one `id`, and ADR-001 makes deduplication key on `id` alone, so one of them will be dropped. The caller overrides `id` when that matters. Stated where they meet it rather than prevented.

*Consequence of the two type surfaces:* an event holds `null` for a field it has no value for, and the input type will not accept `null` at all. A clone therefore drops every null-valued field rather than passing it on, and normalization puts it back. That is a translation between two spellings of the same meaning, not a workaround — and it is the first place `project.md`'s *Optional inputs* decision has cost anything, which is worth recording rather than rediscovering.

*What clone does not do:* infer causality. `parentid`, `initid` and `depth` come across as they stand. A clone is not a child of its source, and a caller who wants a child says so with an override.

### The three contract-aware variants check the payload, and carry what the check produced

`safeParse` against the version's own schema, and **its output is the event's payload**. So a value the schema declares a default for is present on the way out even when the caller omitted it.

*Why the output rather than the input:* the contract is the only participant that knows its defaults. Handing the input through would leave a declared default unreachable, and every call site would end up copying it — the duplication the declaration exists to prevent.

*Why this is not the same decision as the sibling change's:* `assert` reads an event that already exists and discards `safeParse`'s value, because applying defaults there would rewrite someone else's event. A factory is deciding what the payload *is*. The two are the same rule seen from opposite ends.

*Consequence for the types:* `param.data` is the schema's **input** side and the event's `data` is its **output** side. They genuinely differ whenever a schema declares a default or a transform, and typing both the same way would misstate one of them.

*Consequence worth a test:* a transform can produce a value that is not JSON — `z.coerce.date()` yields a `Date`. That reaches the constructor, whose payload walk rejects it. So a transform-bearing schema can fail here where hand-building would have succeeded. That is honest — the contract declared a payload its own canonical form cannot express, per ADR-005's account of authoring-time richness — but the failure has to be legible rather than a crash.

### Nothing derived is derived twice

`.error` reads both the event type and the payload shape off `contract.handlerError` — `['type']` and its schema — rather than rebuilding `handler_${T}_error` and importing the payload type.

*Why it matters beyond tidiness:* the sketch did rebuild it, and so did three type helpers in `ArvoContract/types.ts`. Each copy is a place the rule can drift from the contract that owns it. The same reasoning already applies to the assertion path, where the handler error arrives as an argument rather than being derived inside the check.

*Where the rule lives:* one type for the handler error's event type, beside the function that builds the string. Everything else refers to it.

### `.by` reads `emits`, so the handler error is not reachable through it

`.by`'s `type` is constrained to `keyof C['emits']`, and a handler error is derived rather than declared — it is not an entry of `emits`. So its exclusion is a consequence of what `.by` reads, not a policy `.by` enforces.

*Why that framing matters:* a policy would need defending and could be argued away. A consequence cannot be argued away, and the error message a caller gets — "not one of this version's emits keys" — is true rather than a rule someone chose.

### `type` is a field of the param, not an argument of its own

`.by(contract, { type, source, data })`, not `.by(contract, type, { source, data })`.

Both work and both constrain `type` to the declared emit keys. As a field it sits where every other event field sits, so a caller writing one variant can move to another without rearranging their call. As an argument it reads as more special than the eighteen fields beside it.

### One error, wrapping rather than re-labelling

`ArvoEventFactoryError`: a `_tag`, a frozen `readonly issues`, a message from `buildErrorIssueMessage`, and `cause` carrying the `ArvoEventValidationError` when the failure came from the constructor.

*Why not reuse `ArvoEventValidationError`:* its own TSDoc says, verbatim, that it "does not mean the payload failed contract validation, which is a separate check". A payload failure is one of the two things that can go wrong here, so reusing it would make a shipped comment false — the same defect the assertion change rejected for the same reason.

*Why not `ArvoContractAssertionError`:* nothing is asserted. That error means an event does not match a contract; this means a payload cannot become one.

*Why `cause` rather than rebuilding:* the constructor's error already names every structural rule that broke, with positions. Its issues are carried across and the original kept as `cause`, so nothing is restated and nothing is lost.

An unexpected throw is not converted, matching the contract factory: an error type is a claim about what kind of failure occurred, and a bug elsewhere on the call path is not a factory failure.

### One file per variant, one surface assembled over them

`src/factories/createArvoEvent/` holds `raw.ts`, `clone.ts`, `for-contract.ts`, `by-contract.ts`, `handler-error.ts`, a shared `payload.ts`, and `index.ts` which assembles the two callable objects.

*Why named files rather than one module:* a stack trace, a test name and a coverage report all read better against a named function than an anonymous property. The dotted surface is for the caller's fingers, not the implementation's identity.

*How it is assembled:* `Object.assign` on the plain function, frozen, described by an interface with a call signature plus members. A namespace object would make the plain form a property too — `createArvoEvent.raw(...)` — which is worse to read.

*Consequence worth naming:* properties on a function are not tree-shakeable. Importing `createArvoEvent` for the plain form pulls in all five variants and the payload check with them. Acceptable at this size.

*Why the explicit names stay internal:* two ways to call one function is what `project.md` — *Dependencies and reuse* rejects.

### The throwing form wraps the non-throwing one, five times

`createArvoEvent` and each of its four properties call their `tryX` counterpart and unwrap. No variant holds logic in both forms, so there is one implementation per variant regardless of which form a caller reaches for.

### What connects building to reading is a test

Nothing in the implementation shares code with the assertion path — it takes an event, and here there is no event yet; calling it would mean constructing an event to find out whether it may be constructed.

So the connection is a property the suite holds: an event any variant produces, asserted back against the contract that produced it, matches — with the scope that variant implies. `.for` gives `accepts`, `.by` gives `emits`, `.error` gives `handlerError`. If either direction changes its mind about what matches, that test fails rather than the two silently diverging.

## Risks / Trade-offs

**A transform-bearing schema can fail at construction** → `safeParse`'s output becomes the payload, and a non-JSON output is rejected by the event's own walk. Mitigated by reporting it as issues rather than a crash, and pinned by a test so it is a known limitation rather than a surprise.

**A clone can collide with its source on `id`** → Deliberate: the name promises a copy. Documented where the caller meets it, and one override away.

**Function properties defeat tree-shaking** → Named above, accepted at this size.

**`data` out can differ from `data` in** → Only by defaults the contract declared, and only on the contract-aware variants. Stated in their TSDoc, because a caller comparing what they passed with what they got will otherwise be surprised.

**Two directions over one declaration could drift** → The agreement test is the guard, and it is the reason to write it rather than assert the property in prose.

## Migration Plan

None. New exports; nothing published.
