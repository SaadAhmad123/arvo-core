## Context

See `proposal.md` — Why. The constraints that shape the approach:

- **The event constructor already holds every structural rule**, and validates in its own body. So a factory is a way of *reaching* it, never a second place that decides what a valid event is.
- **The declaration holds the rest.** A `VersionedArvoContract` carries `type`, `uri`, `version`, `dataschema`, `accepts`, `emits`, `handlerError` and `domain`. Nothing new has to be stored or derived; all five variants read fields that already exist.
- **The parts to reuse exist.** `ErrorIssue` as the shared reporting vocabulary, zod's standalone `safeParse` for a payload, `project.md`'s `Result`/`try` pairing, and the sibling assertion path as an independent check on what this produces.
- **`ADR-005` settles `domain` and defers the rest of it.** *Domain* says the field exists so events a contract's factories construct inherit a default; inheritance chains and context-dependent routing are the handler-protocol ADR's. This sits on the near side of that line by copying a static value and doing nothing else with it.

## Goals / Non-Goals

**Goals**

- One reachable place to build an event, with the contract supplying everything it knows.
- A payload that cannot reach an event without having satisfied the schema it claims to.
- Precision out follows precision in, the same rule the assertion path obeys: the result is as precise as the input justifies and no more.
- Five variants that are five thin readings of one declaration, not five implementations.

**Non-Goals**

- Anything in `proposal.md` — Out of Scope.
- Re-stating a structural rule of an event. The constructor owns those, and a factory that repeated one would be a second copy to drift.
- A builder or fluent chain. One call, one event.

## Decisions

### The constructor stays the only place that validates structure

Every variant ends in `new ArvoEvent(param)`. A factory assembles the parameter and checks the payload against a contract; it never decides whether a `subject` is acceptable or a `depth` is in range.

*Why it matters here specifically:* the contract-aware variants supply fields the caller did not — `type`, `dataschema`, sometimes `domain` — and it would be easy to validate those on the way in "to give a better message". That would put a rule in two places, and the two would eventually disagree. The assembled parameter is handed over exactly as a caller's own would be.

*Consequence:* a factory can produce a structural failure that has nothing to do with the contract — a bad `source`, say. That failure arrives as issues on the factory's own error, with the constructor's error as `cause`, so nothing is lost and the caller still has one thing to catch.

### One error, and it wraps rather than re-labels

`ArvoEventFactoryError`: a `_tag`, a frozen `readonly issues`, a message from `buildErrorIssueMessage`, and `cause` for the `ArvoEventValidationError` it wrapped when the failure came from the constructor.

*Why not reuse `ArvoEventValidationError`:* its own TSDoc says, verbatim, that it does not mean the payload failed contract validation. Two of the three failures here are exactly that, so reusing it would make a shipped doc comment false — the same mistake the assertion change rejected for the same reason.

*Why not `ArvoContractAssertionError`:* nothing is being asserted. That error means "an event you already have does not match this contract"; this means "the payload you gave me cannot become that event". A caller catching one should not have to wonder which operation produced it.

*Why `cause` rather than re-labelling:* the constructor's error already names every structural rule that broke, in issues with positions. Rebuilding those into new issues would restate them; discarding them would lose them. Carrying the issues across and keeping the original as `cause` does neither.

### Construction materializes defaults, unlike assertion

The payload handed to the contract-aware variants is checked with `safeParse`, and **the value it produces is what the event carries** — so a field the schema defaults and the caller omitted is present on the way out.

This is the exact opposite of the sibling change, where `assert` discards `safeParse`'s value and returns the event it was given. The two are consistent rather than contradictory, and the distinction is the whole reason both exist:

| | reads | produces |
|---|---|---|
| `assert` | an event that already exists | nothing — it hands back what it was given |
| a factory | a payload that is not yet an event | the event, so it decides what the payload is |

An assertion applying defaults would rewrite someone else's event. A factory *not* applying them would make the contract's declared default unreachable — a caller would have to copy the default to their own call site, which is the duplication the field exists to prevent.

*Consequence, and it needs a test:* a schema carrying a transform can produce a value that is not JSON — `z.coerce.date()` yields a `Date`. That value reaches `ArvoEvent`'s constructor, whose payload walk rejects it. So a transform-bearing schema can make a factory fail where hand-building would have succeeded. That is the honest outcome: the contract declared a payload its own canonical form cannot express, per ADR-005's own account of authoring-time richness. The failure must be legible rather than a crash.

*Consequence for the types:* `param.data` is typed as the schema's **input** and the event's `data` as its **output**. The assertion path uses input on both sides because nothing is produced there. Here the two genuinely differ, and pretending otherwise would mistype one of them.

### Precision out follows precision in, variant by variant

| Variant | Type | Payload |
|---|---|---|
| plain | whatever the param says | whatever the param says |
| `.for` | the contract's `type` | the `accepts` output |
| `.by` | the emit key the caller named | that emit's output |
| `.error` | `handler_${type}_error` | the handler error payload |
| `.clone`, nothing replaced | the source event's | the source event's |
| `.clone`, something replaced | `string` | `Record<string, any>` |

`.by` takes the emit type as its own argument rather than as a field of the param, so it can constrain it to `keyof C['emits']` and reject anything else at the call site. Putting it inside the param object would work but reads as though it were one field among eighteen, when it is the thing being chosen.

The `emits` union deliberately excludes the handler error, even though a handler error is shaped like an emit. `.error` exists for it and builds its payload from an `Error`; allowing it through `.by` too would be two ways to build one event, the second worse.

### `.clone` is loose by construction, and says so

An override can replace `type` or `data`, so what comes back cannot be typed from the source event. Two overloads: no overrides, and the source event's types survive; overrides, and the result is a plain `ArvoEvent`.

*Alternative considered:* narrowing on whether the override object mentions `type` or `data` — expressible with a conditional type, and it would preserve typing for the common case of replacing `to` or `domain`. Rejected for now: it makes the rule "the typing survives unless you replace the type or the payload", which is two sentences and a conditional type, where the current rule is one sentence. Worth revisiting if callers hit it.

*What clone does not do:* infer causality. It does not set `parentid` from the source event's `id`, does not increment `depth`, and does not treat the source as a parent in any way. That is an execution model, and ADR-005 defers it. A clone is the same event with fields replaced — if a caller wants a child event, they say so with an override.

*What it must decide:* `id` and `time`. Copying both produces two events sharing an `id`, which ADR-001 makes a producer obligation not to do. So **`id` and `time` are re-derived unless overridden**, exactly as they are for any other construction, and every other field is copied. A caller who genuinely wants the same `id` passes it.

### One file per variant, one surface assembled over them

`src/factories/createArvoEvent/` holds `plain.ts`, `clone.ts`, `for-contract.ts`, `by-contract.ts`, `handler-error.ts`, each exporting an explicitly named `tryCreateArvoEventForContract` and so on, and `index.ts` assembles the two callable objects.

*Why explicit names inside:* a stack trace, a test name and a coverage report all read better with `tryCreateArvoEventForContract` than with an anonymous property. The dotted surface is for the caller's fingers, not for the implementation's identity.

*How the surface is assembled:* an interface with a call signature plus members, satisfied by `Object.assign` on the plain function and frozen. A namespace-style object would need the plain form to be a property too — `createArvoEvent.create(...)` — which is worse to type and to read.

*Consequence worth naming:* properties on a function are not tree-shakeable. A consumer importing `createArvoEvent` for the plain form pulls in all five variants and, through them, the contract payload check. For a package this size that is acceptable; it would not be if the variants grew heavy.

*Why not export the explicit names publicly too:* two ways to call one function, and `project.md` — *Dependencies and reuse* rejects exactly that. They stay internal.

### The throwing form wraps the non-throwing one, five times

`createArvoEvent` and each of its four properties call their `tryX` counterpart and unwrap. No variant holds logic in both forms.

An unexpected throw is not converted, matching what the contract factory already does: the error type is a claim about what kind of failure occurred, and a bug elsewhere on the call path is not a factory failure.

### Checking the payload reuses the schema, not the assertion path

A factory checks `param.data` against the version's own schema with `safeParse`, and translates issues the way the assertion path does: zod's path beneath `data`, zod's message verbatim, and the value found at that position.

*Why not call the assertion path:* it takes an `ArvoEvent`, and at this point there is no event — that is what is being built. Calling it would mean constructing an event to check whether it may be constructed.

*What connects the two instead:* a test. An event any variant produces is asserted back against the contract that produced it, and must match, with the scope the variant implies. That makes "a factory produces what the assertion accepts" a property the suite holds rather than a claim in this document.

## Risks / Trade-offs

**A transform-bearing schema can fail at construction** → `safeParse`'s output becomes the payload, and a non-JSON output is rejected by the event's own walk. Mitigated by reporting it as issues rather than a crash, and by a test that pins the behaviour so it is a known limitation instead of a surprise.

**Function properties defeat tree-shaking** → Named above. Accepted at this size; the alternative is a worse surface for every caller to save bytes for a few.

**`.clone` re-derives `id`** → A caller expecting a byte-identical copy gets a different `id` and `time`. Stated in its TSDoc where they meet it, and the alternative — two events sharing an `id` — breaks an ADR-001 obligation.

**Five variants over one declaration invites a sixth** → Every plausible next one (build for an `ArvoContract`, emit several at once, derive causality) is already named in `proposal.md` — Out of Scope, with the reason. The closing task checks none appeared.

**Two directions over one contract could drift** → The agreement test is the guard: what a factory builds, the assertion path accepts. If either side changes its mind about what matches, that test fails rather than the two silently diverging.

## Migration Plan

None. New exports; nothing published.
