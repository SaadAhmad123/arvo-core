## Context

See `proposal.md` — Why. The constraints that shape the approach:

- **The contract already holds everything needed.** `dataschema` is `{uri}/{version}`, the version map is keyed by exactly that version, the handler error type is a fixed function of `type`, and each version's schemas are already object schemas. Nothing new has to be stored; this is reading a declaration that is already complete.
- **The parts to reuse exist.** `ErrorIssue` as the shared reporting vocabulary, `ArvoContractValidationError` as the shape a new assertion error is modelled on, and the prerequisite-then-aggregate pattern the declaration validator already uses.
- **ADR-005 defers handler behaviour, and this sits next to that line.** Reading a declaration is not handler protocol; selecting among versions by range is. The design has to hold that distinction rather than blur it.
- **`accepts` and `emits` are core zod schemas.** They have no `safeParse` method of their own — checking goes through zod's standalone form. A consumer hitting this is the reason it is worth stating.

## Goals / Non-Goals

**Goals**

- One implementation of what "this event matches this contract" means, reachable from both classes.
- A caller who names the type they expect gets a narrowed payload; a caller who asks gets facts — the version and the scope — and a plain event.
- A result that is self-describing: which version validated it, and which scope matched.
- The four prerequisite failures distinguishable from each other, not merged into "did not match".
- The event unchanged. Whatever a caller learns, they learn about the thing they already had.

**Non-Goals**

- Anything in `proposal.md` — Out of Scope, particularly version resolution beyond an exact lookup, and materializing schema defaults.
- Constructing events from a contract. That is the sibling change, and keeping it out keeps this one about reading.
- Re-validating an event's structure. It arrives as an `ArvoEvent`, so ADR-001's rules already hold; asserting checks it against a *contract*, which is a different question.

## Decisions

### It asserts, so it returns what it was given

The operation is named `assert` because that is what it does: it establishes that a claim about an event holds. It does not produce a new or changed event. The instance that comes back is the instance that went in — `result.event === input` — and the only thing that differs is what the compiler knows.

`safeParse` still runs, because that is what decides whether the payload satisfies the schema. Its *verdict* and its *issues* are used; the value it returns is discarded.

That discarded value is the whole of the decision. It is the payload with schema defaults filled in, and keeping it would mean returning an event whose `data` differs from the event supplied — which forces the event to be rebuilt through `ArvoEvent`'s constructor, forces a rule about which of an event's eighteen-odd fields carry across, and hands the caller something that compares unequal to what they passed in.

*Consequence, accepted:* schema defaults are not materialized. A sender's omission stays an omission. A caller who wants defaults applied is asking for a transformation, which is a different operation and named separately if it is ever wanted.

*What this removes:* every question about rebuilding. No field-carrying rule, no ADR-001 question about whether two events may share an `id`, no re-running the event's own validation. There is one event throughout.

### One error for one operation

Asserting reports every failure as `ArvoContractAssertionError`, modelled on `ArvoContractValidationError`: a `_tag` discriminant, a frozen `readonly issues`, and a message built by `buildErrorIssueMessage` so it names every rule that was evaluated and says when the list is partial.

*Why not reuse the two existing errors:* they were the obvious reach, and they partition the wrong thing. `ArvoEventValidationError` belongs to constructing an event and `ArvoContractValidationError` to declaring a contract — neither is what an assertion did. Worse, a union of the two makes the error *class* a second channel for what the issues already say, and it does not divide cleanly: a `dataschema` naming another contract is a fact about the event, discovered by a contract method, and either error would be defensible. A caller writing `catch` would have to know that one call can produce two types and then decide which mattered.

So distinguishing lives entirely in `path`. One position, `expectedType`, names the request the caller made; the four others name the event they supplied. `blockingReason` still says whether the list is partial. Both classes throw and return the one type, so a `catch` has one shape to know.

*Consequence:* a caller cannot separate their own misuse from a bad event with an `instanceof`. They compare a field instead — which is what telling the prerequisite failures apart already required, so this makes one rule out of two rather than adding one.

### Precision out follows precision in

The rule every signature here obeys: the result is as precise as the input justifies and no more, and as precise as what is known and no less.

It is worth stating as a principle rather than deriving each signature separately, because the alternatives are both wrong in ways that are easy to reach for. Returning a precise type from a vague question claims something nobody established — a caller who asked "what is this?" and got back a typed payload has been handed a claim the contract cannot support. Returning a vague type from a precise question throws away what the caller supplied, which is the more tempting mistake because it is simpler to implement.

Applied, it produces three outcomes rather than a matrix of special cases:

| Input | Known | Output |
|---|---|---|
| version + expected type | both | typed event, narrowed scope |
| version, no expected type | the version | that version, wide scope, plain event |
| contract, no expected type | the version set | union of declared versions, wide scope, plain event |

The third row is where the principle does real work. It would be simpler to type the container's `version` as `ArvoSemanticVersion` and be done, but the container *does* know its own version list, so anything wider discards information. Wide is not the same as vague — and the difference is what makes the discovery-then-narrow flow possible at all.

*Consequence accepted:* the ask path gives an unparameterised `ArvoEvent`, so a caller who wants a typed payload has to name the type they expect. That is the point rather than a shortcoming.

### The container resolves, the version checks

`ArvoContract.tryAssert` does no checking of its own beyond finding the version. It splits `dataschema`, confirms the `uri` is its own and the version is declared, then calls that `VersionedArvoContract`'s `tryAssert` and returns what it returns.

That keeps one definition of "matches". The alternative — the container reimplementing the checks across every version — is the same failure the declaration validator already avoids by having both classes share one version-level function: two rule sets that can disagree, where the disagreement is invisible until a contract accepts an event one of its own versions would reject.

*Consequence worth naming:* the container's failure modes are a superset of the version's, not a different set. Everything a version can report, the container can report by delegation, plus the two resolution failures that are its own.

*What the spec should not say:* nothing about version ranges. A version key is a bare `MAJOR.MINOR.PATCH` triple, so a range-shaped string is simply not a declared key and the lookup misses as it would for any other undeclared version. A scenario ruling ranges out would imply the concept exists.

### Failures are told apart by `path`, not by prose

Each failure has a different fix, and they are distinguished by the `path` on the reported issue, so a caller compares a field rather than reading a message:

| What went wrong | `path` | What the caller does about it |
|---|---|---|
| expected a type this version does not declare | `expectedType` | fix the expectation |
| the event belongs to a different contract | `event.dataschema.uri` | find the right contract |
| the version is not one this contract declares | `event.dataschema.version` | look at the version list |
| the type is none of the version's shapes | `event.type` | look at what the version declares |
| the payload breaks a rule | `event.data.…` | fix the payload at that position |

The messages still differ, and still name the offending value — the version list, the expected `uri` — but nothing about telling them apart depends on parsing prose.

*Why not one "does not match this contract" failure:* the two `dataschema` rows carry the same severity and completely different next actions. One means the caller is holding the wrong object; the other means they are holding the right object at an interface it does not have. A message covering both sends half its readers the wrong way.

`blockingReason` carries the "nothing after this ran" part, as it already does for a malformed `type` in a declaration.

*What the spec must pin:* the position each of these reports. It is observable behaviour a caller writes code against, so leaving it to implementation would make a reworded message a breaking change.

### Everything before the payload is a prerequisite

Four things establish what the payload is checked against, and each blocks when it fails, because the checks below it would be checking against nothing:

| What failed | What it was establishing |
|---|---|
| `expectedType` names an undeclared type | which shape the caller claims |
| `dataschema`'s `uri` is not this contract's | that this contract is the right one to ask |
| `dataschema`'s version is not declared | which version's declaration applies |
| `event.type` matches none of the shapes | which of that version's three shapes to use |

The last row is the one worth arguing. It would be possible to try the payload against every shape the version declares and report what came back — but that produces a list of failures for schemas the event never claimed to satisfy, which reads as several problems where there is one: the type is wrong. There is also no useful answer in the case that matters, since a payload matching some *other* shape does not make the event valid. So an unmatched type blocks, and the caller fixes the type before learning anything about the payload.

That leaves one non-blocking failure, and it aggregates within itself: a payload can break several rules at once and all of them are reported.

*Consequence:* a caller cannot learn about a wrong type and a bad payload in the same call. Accepted — those are not two independent problems, and reporting the second requires guessing which shape was meant.

### Payload issues come from zod, unaltered

`safeParse`'s failure is translated into `ErrorIssue`s one for one: zod's `path` becomes the position, prefixed to sit under `event.data`, and zod's message is carried across as it stands.

Nothing here re-implements a check zod already performs, and nothing paraphrases what it reported. A hand-rolled equivalent would be a second validator that drifts from the schema it claims to describe, and a rewritten message would lose the detail zod puts in it — which value, which constraint, which position in a nested object.

*Consequence:* the exact wording of a payload failure is zod's to change, and a version bump can change it. That is the right trade: `path` is what a caller writes code against, and it is stable.

### `expectedType` is a literal union, never widened with `string`

The sketch in `proposal.md` deliberately omits `string` from the union. Including it would swallow every literal member, collapse the parameter to `string`, and give an expectation that type-checks against anything and narrows nothing — which is worse than none, because it looks like one.

*Cost:* a caller holding a `string` variable rather than a literal cannot use that overload without narrowing it first. That is the correct trade — the whole value of naming the type is that the compiler checks it.

### `scope`, and why it is not called a category

`scope` names which part of a version's declaration an event belongs to: its `accepts`, one of its `emits`, or its handler error. "Category" reads as a property of the event itself, which it is not — an event carries a `type`, and the same `type` string means nothing until a contract is named. What is being reported is where the event sits within *this* declaration, which is a scope rather than a classification.

The narrowing decision that goes with it: expecting the contract's `type` implies `'accepts'`, an emit key implies `'emits'`, the handler error type implies `'handlerError'`. So `scope` is derivable from an expected type and could be left as the three-way union instead.

**Decision: narrow it.** A conditional type mapping the expected type to its scope is a handful of lines, and the alternative hands back a value less precise than the input justifies — a caller who named an emit key still has to prove to the compiler that `scope` is not `'handlerError'`.

Probed before adoption, the same way literal version keys were: the contract's `type`, an emit key, and the handler error type each narrow `scope` to a single literal, and an undeclared type is rejected at the call site.

*What the spec should say about it:* nothing. How precisely a result is typed is not spec material — specs here describe observable behaviour rather than type shapes, the way `arvo-event`'s spec never mentions a TypeScript type. This belongs here and in a type-level test.

### The container takes no `expectedType`

Not an omission. Naming a type requires knowing which version declares it, and finding the version is what the container's `assert` is for — so the parameter would have to be checked against a version the method has not selected yet.

A caller who knows what they are waiting for does not need the container: they index `versions` and name it there. A caller who does not know asks the container, and names it afterwards if they want types.

*Consequence, and it surprises people:* indexing `versions` with the returned `version` gives a **union** of version contracts, and a call against a union only accepts a type every member declares. So the discovery-then-narrow flow needs the version narrowed to a literal first — verified by probe, not assumed. That is correct rather than awkward: you cannot name an emit type before knowing which version declares it. The usage sketch shows the narrowing step explicitly so nobody meets it by surprise.

### Checking goes through zod's standalone form

A version's `accepts` is typed as a core zod schema, which carries no `safeParse` method. So checking a payload uses `z.safeParse(schema, data)` rather than a method call.

Worth recording because a consumer will hit the same thing the moment they touch `accepts` themselves, and because it is the sort of detail that looks like an oversight when it is a consequence of keeping the schema type narrow at the contract boundary.

## Risks / Trade-offs

**The ask path returns an untyped payload** → A caller who wants `event.data` typed must name the type they expect, which means holding a version contract. That is the principle working as intended, not a gap — but it does mean the container alone never yields a typed payload, and a reader expecting it to will be briefly puzzled. The usage sketch leads with the two-step flow for that reason.

**Defaults are not applied** → A schema's declared defaults stay undeclared in the event, so a handler reading `event.data` sees exactly what the sender sent. The contract is the only participant that knows the defaults, so declining to apply them does leave that knowledge unused. Accepted: applying them means returning a different event than was supplied, and that cost is higher. Stated in the TSDoc so nobody expects otherwise.

**This is adjacent to deferred territory** → An exact-version lookup is not resolution, but it is one increment away from it, and the increment would be easy to make without noticing. The proposal states the line, and the closing task checks no range handling appeared.

**Two conditional types on the narrowing path** → Payload-for-expected-type, and scope-for-expected-type. Both verified by probe before adoption, and both fail loudly at compile time rather than silently at runtime if wrong. The ask path needs neither, which is most of why dropping narrowing there was worth it.

**No re-validation of event structure** → `assert` trusts that an `ArvoEvent` is structurally valid, because constructing one proves it. If a caller casts their way to an invalid event, asserting will report a payload failure rather than a structural one. Deliberate: re-checking ADR-001's rules here would duplicate the event's own constructor — and since the same instance is returned, there is nothing new to validate either.

## Migration Plan

None. Additive methods on two existing classes; nothing published.
