## Context

See `proposal.md` — Why. The constraints that shape the approach:

- **The contract already holds everything needed.** `dataschema` is `{uri}/{version}`, the version map is keyed by exactly that version, the handler error type is a fixed function of `type`, and each version's schemas are already object schemas. Nothing new has to be stored; this is reading a declaration that is already complete.
- **The parts to reuse exist.** `ErrorIssue` as the shared reporting vocabulary, `ArvoEvent`'s own constructor for rebuilding a parsed event, `ArvoContractValidationError` and `ArvoEventValidationError` for the two failure kinds, and the prerequisite-then-aggregate pattern the declaration validator already uses.
- **ADR-005 defers handler behaviour, and this sits next to that line.** Reading a declaration is not handler protocol; selecting among versions by range is. The design has to hold that distinction rather than blur it.
- **`accepts` and `emits` are core zod schemas.** They have no `safeParse` method of their own — parsing goes through zod's standalone form. A consumer hitting this is the reason it is worth stating.

## Goals / Non-Goals

**Goals**

- One implementation of what "this event matches this contract" means, reachable from both classes.
- A caller who asserts a type gets a narrowed payload; a caller who asks gets facts — the version and the category — and a plain event.
- A result that is self-describing: which version validated it, and which category matched.
- The three prerequisite failures distinguishable from each other, not merged into "did not match".

**Non-Goals**

- Anything in `proposal.md` — Out of Scope, particularly version resolution beyond an exact lookup.
- Constructing events from a contract. That is the sibling change, and keeping it out keeps this one about reading.
- Re-validating an event's structure. It arrives as an `ArvoEvent`, so ADR-001's rules already hold; parsing checks it against a *contract*, which is a different question.

## Decisions

### Precision out follows precision in

The rule every signature here obeys: the result is as precise as the input justifies and no more, and as precise as what is known and no less.

It is worth stating as a principle rather than deriving each signature separately, because the alternatives are both wrong in ways that are easy to reach for. Returning a precise type from a vague question asserts something nobody established — a caller who asked "what is this?" and got back a typed payload has been handed a claim the contract cannot support. Returning a vague type from a precise question throws away what the caller supplied, which is the more tempting mistake because it is simpler to implement.

Applied, it produces three outcomes rather than a matrix of special cases:

| Input | Known | Output |
|---|---|---|
| version + asserted type | both | typed event, narrowed category |
| version, no assertion | the version | that version, wide category, plain event |
| contract, no assertion | the version set | union of declared versions, wide category, plain event |

The third row is where the principle does real work. It would be simpler to type the container's `version` as `ArvoSemanticVersion` and be done, but the container *does* know its own version list, so anything wider discards information. Wide is not the same as vague — and the difference is what makes the discovery-then-assert flow possible at all.

*Consequence accepted:* the ask path gives an unparameterised `ArvoEvent`, so a caller who wants a typed payload has to assert. That is the point rather than a shortcoming.

### The container resolves, the version validates

`ArvoContract.tryParse` does no checking of its own beyond finding the version. It splits `dataschema`, confirms the `uri` is its own and the version is declared, then calls that `VersionedArvoContract`'s `tryParse` and returns what it returns.

That keeps one definition of "matches". The alternative — the container reimplementing the checks across every version — is the same failure the declaration validator already avoids by having both classes share one version-level function: two rule sets that can disagree, where the disagreement is invisible until a contract accepts an event one of its own versions would reject.

*Consequence worth naming:* the container's failure modes are a superset of the version's, not a different set. Everything a version can report, the container can report by delegation, plus the two resolution failures that are its own.

### The three prerequisite failures are told apart by `path`, not by prose

Three things can go wrong before a payload is ever looked at, and each has a different fix. They are distinguished by the `path` on the reported issue, so a caller compares a field rather than reading a message:

| What went wrong | `path` | What the caller does about it |
|---|---|---|
| asserted a type this version does not declare | `expectedType` | fix the assertion |
| the event belongs to a different contract | `dataschema.uri` | find the right contract |
| the version is not one this contract declares | `dataschema.version` | look at the version list |

The messages still differ, and still name the offending value — the version list, the expected `uri` — but nothing about telling them apart depends on parsing prose.

*Why not one "does not match this contract" failure:* the middle and bottom rows carry the same severity and completely different next actions. One means the caller is holding the wrong object; the other means they are holding the right object at an interface it does not have. A message covering both sends half its readers the wrong way.

`blockingReason` carries the "nothing after this ran" part, as it already does for a malformed `type` in a declaration.

### Assert stops, ask aggregates

An `expectedType` naming something the version does not declare is a **contract** error and blocks. There is no schema to check the payload against, so every check below it would be checking against nothing — the same reason a malformed `type` blocks a declaration.

`event.type` not matching, and `event.data` failing its schema, are **event** errors and aggregate. A caller with both a wrong type and a bad payload should learn both in one call.

*Why the two error types rather than one:* they answer different questions. A contract error says the caller used the contract wrongly; an event error says the event does not satisfy a contract that was used correctly. One `instanceof` check each tells a caller which of those they are looking at, and they belong in different places in a log.

### A parsed event is a new event

The payload is re-parsed through the matched schema, which materializes defaults the contract declared and the sender omitted. That produces a different payload, so it produces a different event — built through `ArvoEvent`'s own constructor, so every structural rule still applies and nothing bypasses validation by coming in through this door.

The input event is untouched, being frozen anyway.

*Why the contract is the right place to do this:* it is the only participant that knows what the defaults are. A handler filling them itself would be duplicating the declaration, and two handlers doing it would eventually disagree.

*Open consequence:* an event that crossed the wire and an event that came out of `parse` can differ in `data`. That is intended — one is what was sent, the other is what the contract says it means — but any code comparing the two for equality will be surprised. Worth a sentence in the TSDoc where a caller meets it.

### `expectedType` is a literal union, never widened with `string`

The sketch in `proposal.md` deliberately omits `string` from the union. Including it would swallow every literal member, collapse the parameter to `string`, and give an assertion that type-checks against anything and narrows nothing — which is worse than no assertion, because it looks like one.

*Cost:* a caller holding a `string` variable rather than a literal cannot use the assert overload without narrowing it first. That is the correct trade — the whole value of asserting is that the compiler checks the assertion.

### Whether the assert overload also narrows `category`

Asserting the contract's `type` implies `'accepts'`; an emit key implies `'emits'`; the handler error type implies `'handlerError'`. So the category is derivable from the assertion and could be narrowed rather than left as the three-way union.

**Decision: narrow it.** A conditional type mapping the asserted type to its category is a handful of lines, and the alternative hands back a value less precise than the input justifies — a caller who asserted an emit key still has to prove to the compiler that `category` is not `'handlerError'`.

*Risk:* one more conditional type in a class that already carries several. It is verified by probe, not assumed, the same way literal version keys were.

### The container takes no `expectedType`

Not an omission. Asserting a type requires knowing which version declares it, and finding the version is what the container's `parse` is for — so the parameter would have to be validated against a version the method has not selected yet.

A caller who knows what they are waiting for does not need the container: they index `versions` and assert there. A caller who does not know asks the container, and asserts afterwards if they want types.

*Consequence, and it surprises people:* indexing `versions` with the returned `version` gives a **union** of version contracts, and an assert call against a union only accepts a type every member declares. So the discovery-then-assert flow needs the version narrowed to a literal first — verified by probe, not assumed. That is correct rather than awkward: you cannot assert an emit type before knowing which version declares it. The usage sketch shows the narrowing step explicitly so nobody meets it by surprise.

### Parsing goes through zod's standalone form

A version's `accepts` is typed as a core zod schema, which carries no `safeParse` method. So checking a payload uses `z.safeParse(schema, data)` rather than a method call.

Worth recording because a consumer will hit the same thing the moment they touch `accepts` themselves, and because it is the sort of detail that looks like an oversight when it is a consequence of keeping the schema type narrow at the contract boundary.

## Risks / Trade-offs

**The ask path returns an untyped payload** → A caller who wants `event.data` typed must assert, which means holding a version contract. That is the principle working as intended, not a gap — but it does mean the container alone never yields a typed payload, and a reader expecting it to will be briefly puzzled. The usage sketch leads with the two-step flow for that reason.

**This is adjacent to deferred territory** → An exact-version lookup is not resolution, but it is one increment away from it, and the increment would be easy to make without noticing. The proposal states the line and the spec should pin it with a scenario asserting a range-shaped input is not treated as a range.

**A parsed event differs from the event supplied** → Defaults make this unavoidable if the contract is to be the thing that knows them. Documented at the call site rather than defended against.

**Two conditional types on the assert path** → Payload-for-asserted-type, and category-for-asserted-type. Both verified by probe before adoption, and both fail loudly at compile time rather than silently at runtime if wrong. The ask path needs neither, which is most of why dropping narrowing there was worth it.

**No re-validation of event structure** → `parse` trusts that an `ArvoEvent` is structurally valid, because constructing one proves it. If a caller casts their way to an invalid event, parsing will report a payload failure rather than a structural one. Deliberate: re-checking ADR-001's rules here would duplicate the event's own constructor.

## Migration Plan

None. Additive methods on two existing classes; nothing published.

## Open Questions

None that would change the specs or the task breakdown.

One thing the spec must pin rather than leave to implementation: that the three prerequisite failures report distinct positions, since that is observable behaviour a caller depends on.

Two things the spec must **not** try to pin, recorded so nobody adds them later. Version ranges need no scenario — a version key is a bare triple, so a range-shaped string is simply not a declared key, and a scenario ruling out ranges would imply the concept exists. And how precisely a result is typed is not spec material: specs here describe observable behaviour rather than type shapes, the way `arvo-event`'s spec never mentions a TypeScript type. That belongs in this document and in a type-level test.
