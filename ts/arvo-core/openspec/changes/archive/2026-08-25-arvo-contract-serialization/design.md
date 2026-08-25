## Context

See `proposal.md` — Why. The constraints that shape the approach:

- **Zod is the only mechanism available in both directions.** `z.toJSONSchema` is stable; `z.fromJSONSchema` is documented as experimental and likely to change. Zod is a *peer* dependency, so that churn arrives in a consumer's build rather than this package's.
- **Zod's documentation covers less than half of what the boundary does.** The five refused keywords and the unrepresentable type list are documented. The typeless-subschema drop, the `propertyNames` and `uniqueItems` drops, the `format`-before-`pattern` decay, and the `additionalProperties` round-trip asymmetry were all found by measurement against zod 4.4.3. Any design that assumes the documentation is complete is wrong on arrival.
- **The parts this needs already exist.** `ErrorIssue` as the shared reporting vocabulary, `validateArvoContract` for the contract's own rules, and `ArvoEventSerializer` as the established shape for a serializer with a `try`/throwing pair.
- **ADR-005 was amended mid-design.** Conversion is now best-effort in *both* directions, with omission the only permitted response to inexpressibility and a SHOULD that omissions be discoverable. The inbound design exists to satisfy that SHOULD.

## Goals / Non-Goals

**Goals**

- A contract crosses to JSON and back once without losing anything the canonical form can express.
- Every loss is reported, in both directions, naming the position it occupied.
- A form this implementation cannot read fails loudly rather than becoming a contract that enforces less than it declares.
- One attempt reports every problem that can be evaluated, form-level and contract-level together.

**Non-Goals**

- Anything in `proposal.md` — Out of Scope.
- Round-trip idempotence. Not promised by ADR-005, and measurably false for `format`-backed checks.
- Reading every form ADR-005 permits. See **Known gaps** in the proposal; the gap is named, not closed.
- Insulating consumers from zod's experimental API. The exposure is documented and bounded, not removed.

## Decisions

### Loss is measured in both directions, not looked up

Neither direction gets told. Inbound has no hook at all — a dropped constraint raises nothing. Outbound has one in zod's current documentation, but not in the version this package builds against: `unrepresentable` is typed `"throw" | "any"` there, and a function passed to it is **silently ignored** — verified, the handler is never called and the output is produced as though `'any'` had been given. A design resting on it would report nothing while appearing to work, which is the exact failure it existed to prevent.

So both directions read the result instead. Outbound, the `override` hook is used as an observer: it is called for every node with that node's zod type, its path, and the JSON Schema produced for it, so an empty result identifies a construct the dialect could not carry, by name and position. Inbound, each converted schema is re-exported and its constraint keywords diffed against the input, with anything present going in and absent coming out treated as lost.

The alternative for inbound was a pre-scan of the JSON for keywords known to be unsupported; for outbound, a walk of the zod schema for types known to be unrepresentable. Both are the same idea and both were rejected together.

Observation wins, and not marginally. A pre-scan encodes *what zod cannot do*, which is exactly the thing its documentation says will change; the list would rot silently and its rot would look like everything working. Observation encodes *what a constraint keyword is*, or *what an empty schema means* — JSON Schema's own vocabulary, far more stable — and reports what zod actually did on this call, in this version. A behaviour change surfaces as a new warning rather than as silence. It also removes any dependence on a hook being present in whichever zod a consumer resolved.

Verified in both directions: outbound, `z.date()`, `z.bigint()`, `z.map()`, `z.set()`, `z.nan()` and `z.custom()` are each caught with exact paths, nested and inside arrays included, and a fully-expressible schema reports nothing. Inbound, the three known silent drops are caught with exact paths, and a fully-supported schema reports nothing.

*What it costs, outbound:* `unknown` and `any` convert to `{}` exactly as a loss does, so both are excluded by name — nothing was lost where an author asked for no constraint. That exclusion is a small list, and unlike a support list its staleness is visible: a new intentionally-unconstrained type would show up as a spurious warning rather than as silence.

*Costs, accepted:* an extra export per import, which is nothing for something that happens at module load. And the diff must ignore *additions*, since `additionalProperties: {}` appears on re-export for every plain object.

*Residual risk:* the constraint-keyword list is still ours. Missing an entry costs a missed warning, never incorrect behaviour — a strictly better failure mode than a stale support list.

### `io: 'input'`, on two independent grounds

Not ergonomics. Under `'output'`, zod emits `additionalProperties: false` for a plain `z.object()` — but `z.object()` *strips* unknown keys rather than rejecting them, so the keyword asserts a check zod never performs. ADR-005 forbids exactly that: "never a fabricated stand-in implying a check the schema doesn't actually perform."

Independently, the round trips differ in direction. Measured with `{ a: 'x', extra: 'kept?' }` against `z.object({ a: z.string() })`:

| | round-tripped behaviour |
|---|---|
| `io: 'output'` | **rejects** the payload the original accepted |
| `io: 'input'` | **keeps** `extra`, where the original stripped it |

ADR-005 permits a "true, if weaker" materialization. It does not permit a stricter one — a contract that rejects what its author's contract accepts is not a weaker subset, it is a different contract. So `'input'` is the only setting whose drift points in the sanctioned direction.

One wrinkle it dissolves: `accepts` and `emits` might have seemed to want different settings. They do not. Both describe a wire payload, and a wire payload is always the input to whoever validates it.

### `cycles: 'ref'`, not `'throw'`

A recursive payload is a legitimate contract — a comment tree, a nested category — and `$ref: '#'` is legal 2020-12. ADR-005 discusses `$ref` alongside sibling keywords as a dialect concern, so it plainly expects `$ref` to appear in canonical forms.

`'throw'` would leave a recursive contract with **no canonical form at all**, while ADR-005 requires every implementation to be able to produce one from a natively-authored contract. Verified that `$ref: '#'` round-trips.

### `target` is withheld from callers; `metadata` and `override` are not exposed

`target` is a correctness boundary. A form emitted against draft-07 is not a canonical form, and ADR-005 pins the dialect precisely so two languages cannot disagree about identical bytes. Exposing it would let a caller produce something that looks canonical and is not.

`metadata` and `override` are simply not this class's business. `metadata` is not passed either, so zod's registry behaviour applies and `.meta()` fields flow through. An author who uses `.meta()` to override a generated keyword is describing their own contract; policing that would mean deciding which of an author's own annotations are legitimate.

*Known consequence:* `.meta({ type: 'number' })` on a string schema emits `type: "number"`, so an author can produce a form contradicting their own validator. Not defended against. Doing so would require the serializer to adjudicate the author's intent.

### A caller's `override` replaces ours

`override` is exposed, and is also the mechanism this serializer inspects losses through. A caller supplying their own replaces it rather than composing with it, so nothing is reported for that conversion.

Composition was implemented first and then rejected. Running the caller's hook before the inspection would keep reporting alive whatever they passed, and would describe what the form ended up lacking rather than what zod originally dropped — defensible, but it means a caller cannot fully control a hook they explicitly reached for, and it quietly makes their substitutions this serializer's business. Replacement matches the rule `unrepresentable` already follows and puts the consequence where the decision was made.

`unrepresentable` needs no such rule: in this zod version it is only `'throw'` or `'any'`, so there is nothing of ours for a caller to displace.

### The error carries issues as well as a cause

`ArvoContractSerializerError` has both: a `cause` for a failure originating at this boundary — `JSON.parse`'s `SyntaxError`, `JSON.stringify`'s `TypeError` — and a frozen `issues` array in the shared `ErrorIssue` vocabulary for everything position-shaped: a form-level rule broken, a construct the conversion refuses, a contract rule broken.

*Alternative considered:* keep `cause` for boundary failures and re-throw `ArvoContractValidationError` for anything issue-shaped, reusing the existing class. Rejected — a caller would have to know which of two error types a bad file produces, and the distinction they would be discriminating on is which layer failed, which is exactly what they do not know at the point of asking. One type, one `instanceof`, both channels populated as applicable.

This also makes step 5 below expressible: form-level and contract-level issues merge into one list rather than needing two error types to carry them.

### The inbound sequence, and why it is ordered

1. Parse. A `SyntaxError` becomes `ArvoContractSerializerError` via `cause`.
2. **Check the form's own rules against the JSON**, before conversion. Only possible here: zod erases the distinction the moment it imports, so the literal `"type": "object"` requirement checked afterwards is checking the wrong artifact — a form built from `allOf` may import as something object-ish while never having carried the keyword.
3. Convert each schema position. A refused construct fails, naming construct and position.
4. Diff for losses, per the decision above.
5. **Call `validateArvoContract` directly** rather than constructing an `ArvoContract` and catching.

Step 5 is deliberate. Catching would work — `ArvoContractValidationError` carries its `issues` — but calling the validator avoids exception control flow for an expected outcome, which is what the `try`-prefix convention asks for, and it lets the serializer's own issues merge with the contract's into one report. Without that, a caller fixes the form, runs again, and only then discovers the identifiers are wrong.

It also inherits the prerequisite gate: a foreign form with a malformed `type` stops the run and says why, exactly as a local declaration does.

### Synchronous

`ArvoEventSerializer` is async only because a `CloudEventConverter` may carry async enrichment stages. Nothing in producing or reading a canonical form has anything to await, and making it async to match a sibling would put a `Promise` in every call site for symmetry alone.

### Inbound takes no options

Nothing about reading a form is configurable today. The option bag is keyed by direction, so a `deserialize` key is additive whenever something needs one. Shipping an empty key now would invite a use to be invented for it.

### Warnings render through their own function

`buildWarningFromErrorIssues` lives in the serializer's directory. `buildErrorIssueMessage` is untouched: it hardcodes "The following N problems were found:", which is wrong for omissions ADR-005 mandates, and widening a function four error types depend on — for one caller that needs different prose — buys nothing. Warning prose and error prose are meant to read differently, so two renderers is the intent rather than duplication.

The demotion wording matters more than it looks. `format` is dropped on the first crossing for `z.email()`, `z.uuid()`, and `z.url()`, so the demotion warning will fire on most real contracts. If it reads like a defect, callers will learn to ignore warnings, and the drops will go with them.

## Risks / Trade-offs

**`z.fromJSONSchema` is experimental and zod is a peer dependency** → A behaviour change lands in a consumer's build. Mitigated in the only way available: the loss diff measures what the importer did rather than assuming what it can do, so a regression surfaces as warnings rather than silence. The method's TSDoc states the instability, so a consumer meets it at the signature. Pinning zod harder was rejected — it is a peer dependency precisely so the consumer chooses.

**The known gaps block the conformance claim** → Seven legal forms this implementation cannot read. A MUST is not departable, so no documentation makes the claim true. Accepted because ADR-004 explicitly permits shipping in this state, none of it is reachable from a contract authored here, and the ordinary foreign shapes all work.

**Losses are reported but easy to ignore** → `warnings` is non-optional in the return type, which is as far as a type can push a SHOULD. A caller may still discard it. Making it throw would turn ADR-005's mandated outcome into an error.

**The constraint-keyword list is ours to maintain** → Missing an entry means a missed warning. Chosen deliberately over a support list whose staleness would be invisible.

**Repeated crossings degrade** → `email` and `uuid` stop being enforced after two. Documented, tested for the single crossing, not defended against — defending would need provenance a canonical form has nowhere to carry.

## Migration Plan

None. New capability, additive, nothing published.

## Open Questions

None that would change the specs, the approach, or the task breakdown.
