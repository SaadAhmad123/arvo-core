## Why

[ADR-005](../../../docs/adr/005-arvocontract-structure.md) requires every implementation to produce a contract's canonical form — a plain JSON object whose schema-bearing positions are JSON Schema 2020-12 — and to construct a working contract from one produced elsewhere, including by another language. `arvo-core` implements neither. `build-arvocontract` declared this out of scope openly and promised not to make it harder; this is the change that promise pointed at.

Until it lands the package cannot claim ADR-005 conformance, which also leaves it nothing truthful to record as the release metadata [ADR-004](../../../docs/adr/004-multi-language-implementation-governance.md) requires of a conformance claim.

There is a second reason not to defer it further. A contract today *is* the zod code that declares it — the conflation ADR-005 exists to break. While that stays true, more of the package gets written assuming a contract is a TypeScript object rather than a portable declaration that happens to have a TypeScript materialization.

## What Changes

- **New capability**: `arvo-contract-serialization` — a contract to its canonical JSON form, and back.
- **New class `ArvoContractSerializer`**, synchronous. `ArvoEventSerializer` is async only because a `CloudEventConverter` may carry async enrichment stages; nothing here has anything to await.
  - `trySerialize(contract)` / `serialize(contract)` — primitive and throwing wrapper.
  - `tryDeserialize(json)` / `deserialize(json)` — the same pair inbound.
  - Both directions return warnings alongside their result. See **Both directions report what was lost**.
- **New class `ArvoContractSerializerError`**, carrying via `cause` any failure originating at this class's own boundary — a `JSON.parse` `SyntaxError`, a `JSON.stringify` `TypeError`, or a conversion zod refuses. Contract-level problems are reported as `ErrorIssue`s rather than wrapped, in the same vocabulary every validating boundary in the package already uses.
- **New function `buildWarningFromErrorIssues`**, in the serializer's own directory. `buildErrorIssueMessage` is left alone: it hardcodes "The following N problems were found:", which is wrong for omissions ADR-005 mandates — a contract that dropped a `z.date()` did not have a problem, it did what it was told — and widening a function four error types already depend on, for one caller needing different prose, buys nothing. Warning prose and error prose are supposed to read differently.
- **The canonical form's own rules, implemented rather than assumed.** Every schema-bearing position declares `"$schema"` explicitly and targets 2020-12. Optional contract fields are materialized at their defaults. The handler error appears nowhere, being a fixed function of `type` and version.
- **BREAKING**: none. New capability, nothing published.

### The inbound sequence

Reading a form runs in a fixed order, and the order is the design:

1. **Parse the string.** A `SyntaxError` becomes `ArvoContractSerializerError`.
2. **Check the form itself, on the JSON, before any conversion** — the container's fields, and per schema position the literal `"type": "object"` and the `$schema` declaration. Only the serializer can do this: zod erases those distinctions the moment it imports, so a check performed afterwards is checking the wrong artifact.
3. **Convert each schema position to zod.** A construct zod's importer refuses fails here, naming the keyword and the position — see **Known gaps**.
4. **Detect what the conversion lost**, by re-exporting each converted schema and diffing constraint keywords against the input. Anything present going in and absent coming out becomes a warning.
5. **Call `validateArvoContract` directly** rather than constructing an `ArvoContract` and catching. Its issues merge with the serializer's own, so one attempt reports form-level and contract-level problems together instead of making a caller fix the form only to discover the identifiers are wrong. The prerequisite gate on `type` comes along for free, and a foreign form with a malformed `type` stops the run and says why, exactly as a local declaration does.

### Both directions report what was lost

Outbound, zod's `unrepresentable` hook names each construct JSON Schema cannot carry.

Inbound has no such hook, so loss is measured rather than announced: convert, re-export, and diff the constraint keywords. That catches constraints zod's importer silently drops — a `minLength` inside a typeless `allOf` subschema, a `propertyNames`, a `uniqueItems` — none of which raise anything on their own.

Measuring beats maintaining a list of what zod cannot do. It observes what zod actually did, so it stays correct as the importer changes, which is the one thing its documentation tells us to expect.

Two kinds of finding, reported differently. A constraint **dropped** is gone. A check **demoted** survives in the form as an annotation nothing is permitted to enforce — what happens to `z.email()`, whose `format` keyword is dropped on the first crossing while the `pattern` beside it survives. Both are losses; conflating them would train a reader to ignore the frequent one and miss the serious one.

### Conversion options: a narrowed passthrough

A caller may supply `Pick<ToJSONSchemaParams, 'unrepresentable' | 'io' | 'cycles' | 'reused' | 'uri'>` for the outbound direction. Two options are withheld for reasons rather than convenience:

- **`target` is forced to `draft-2020-12`.** ADR-005 pins the dialect so two languages cannot disagree about the same bytes. A form emitted against draft-07 is not a canonical form, so this is a correctness boundary.
- **`metadata` and `override` are not exposed**, and `metadata` is not passed. Zod's registry behaviour therefore applies and `.meta()` fields flow into the output untouched. An author using `.meta()` to override a generated keyword is describing their own contract as they choose.

Defaults for what a caller may set:

| Option | Default | Why |
|---|---|---|
| `unrepresentable` | a function substituting `{}` and recording an `ErrorIssue` | `{}` is JSON Schema's "unknown", so the constraint is omitted rather than approximated, as ADR-005 requires. The function form rather than `'any'` is what makes the omission reportable. |
| `io` | `'input'` | Two reasons. Under `'output'` zod emits `additionalProperties: false` for a plain `z.object()`, but `z.object()` *strips* unknown keys rather than rejecting them — so that keyword would assert a check zod never performs, the fabricated stand-in ADR-005 forbids. And a round trip under `'output'` produces a contract that **rejects** payloads the original accepted; under `'input'` it accepts more. ADR-005 permits a weaker materialization, never a stricter one. Both `accepts` and `emits` describe a wire payload, and a wire payload is always the input to whoever validates it, so one setting is right for both. |
| `cycles` | `'ref'` | A recursive payload is a legitimate contract and `$ref: '#'` is legal 2020-12 — ADR-005 discusses `$ref` alongside sibling keywords, so it expects `$ref` in canonical forms. Throwing would leave a recursive contract with no canonical form at all, which ADR-005 requires every implementation to be able to produce. |
| `reused` | `'inline'` | Self-contained output, and byte-level canonicalization is deferred anyway, so `$defs` extraction buys nothing. |
| `uri` | unset | Only reached when a schema carries a registered id. |

**A caller-supplied `unrepresentable` replaces the default outright.** No wrapping, so supplying one means no warnings are collected, and a handler returning a fabricated stand-in departs from ADR-005. That departure is the caller's, made deliberately.

**The inbound direction takes no options.** Nothing about reading a form is configurable, and the option bag is keyed by direction so a `deserialize` key can be added later without reshaping anything. An empty key shipped now would only invite a use to be invented for it.

### The surface, sketched

Illustrative, not normative — the spec governs.

```ts
/** What a caller may configure for the outbound direction. */
export type ArvoContractSerializeOptions = Pick<
  ToJSONSchemaParams,
  'unrepresentable' | 'io' | 'cycles' | 'reused' | 'uri'
>;

/**
 * Keyed by direction, so a `deserialize` key can be added later rather than
 * reshaping this one.
 */
export type ArvoContractSerializerOptions = {
  serialize?: ArvoContractSerializeOptions;
};

/** What a crossing cost, in whichever direction it was made. */
export type ArvoContractSerializerWarnings = {
  /** Every constraint dropped or demoted. Empty when nothing was lost. */
  readonly warnings: readonly ErrorIssue[];
  /** The same, rendered as one message. `null` when there are none. */
  readonly warningString: string | null;
};

export type SerializedArvoContract = ArvoContractSerializerWarnings & {
  /** The canonical form, as JSON. */
  readonly schema: string;
};

export type DeserializedArvoContract = ArvoContractSerializerWarnings & {
  /** The reconstructed contract. */
  readonly contract: ArvoContract;
};

export class ArvoContractSerializer {
  constructor(options?: ArvoContractSerializerOptions);

  trySerialize(
    contract: ArvoContract,
  ): Result<SerializedArvoContract, ArvoContractSerializerError>;

  serialize(contract: ArvoContract): SerializedArvoContract;

  tryDeserialize(
    json: string,
  ): Result<DeserializedArvoContract, ArvoContractSerializerError>;

  deserialize(json: string): DeserializedArvoContract;
}
```

```ts
const s = new ArvoContractSerializer();
const { schema, warningString } = s.serialize(contract);
if (warningString) console.warn(warningString);

const { contract: back, warningString: inbound } = s.deserialize(schema);
if (inbound) console.warn(inbound);
```

`warnings` sits in the success value because an omission is the outcome ADR-005 mandates, not a failure — a contract carrying a `z.date()` serializes, and says so. It is not optional, so a caller destructuring the result meets it whether or not they act on it, which is as far as a type can push the SHOULD that omissions not be silent. `warningString` is `null` rather than empty when nothing was lost, making the common case one falsy check.

The shape is shared rather than written twice: both directions report the same pair, and two hand-maintained copies of one concept is the drift this package argues against everywhere else.

`warningString` is derived from `warnings` and both are returned, so in principle they could disagree. They cannot: the result is built once, frozen, and handed back. `readonly` says so to a TypeScript consumer and the freeze says it to everyone else, since ADR-000 is explicit that types establish nothing for a JavaScript caller. `readonly ErrorIssue[]` rather than `Readonly<ErrorIssue[]>` — the latter maps over the array's own properties, leaving `push` callable, so it protects nothing. The issues inside are frozen too, since `ErrorIssue` freezes itself, so the whole value is immutable to its leaves.

## Capabilities

### New Capabilities

- `arvo-contract-serialization`: producing a contract's canonical JSON form and reading one back — what the form contains, what is omitted from it, how a loss is reported, how failure is reported, and what is not guaranteed to survive a crossing.

### Modified Capabilities

None.

## Known gaps

Forms ADR-005 permits that this implementation cannot read. Each fails with a clear `ErrorIssue` naming the keyword and the position — loudly, never silently.

Zod's [JSON Schema documentation](https://zod.dev/json-schema) is the source of truth for what its conversion supports, and the keyword list below comes from it. It does not cover everything: the losses under **What does not cross** were found by measurement against **zod 4.4.3**, not from the documentation, and several are not mentioned there at all. So the limitations of this serializer are the documented ones *plus* whatever a given zod version actually does — which is why the inbound direction measures rather than assumes.

**Five keywords zod's importer refuses:** `not` (except `{"not":{}}`, which it handles), `dependentRequired`, `dependentSchemas`, `unevaluatedProperties`, and `if`/`then`/`else`.

**Two composition shapes:** a top-level `allOf`, and `patternProperties`. Both carry the literal `"type": "object"` and so are legal canonical forms, but zod imports them as an intersection and a record respectively, which `arvo-contract`'s object-shape lookup refuses.

`arvo-contract`'s check is deliberately not widened to admit them. ADR-005 chose a literal keyword lookup precisely because a rule phrased as "must not permit a non-object" cannot be checked mechanically, and asking whether an arbitrary zod schema *describes* an object reintroduces exactly that problem. Paying that to admit two shapes no typical model-to-schema exporter emits is the wrong trade.

**What this costs.** A gap against a MUST — ADR-005 says an implementation must not reject a canonical form because part of it was inexpressible. ADR-004 permits shipping in this state; it forbids claiming conformance while it stands, and MUSTs are not departable the way SHOULDs are, so no amount of documenting makes the claim true. That is the whole cost: one named gap, recorded in the pin whenever a pin is written.

Worth knowing how narrow it is, measured against zod 4.4.3. None of these are reachable from a contract authored here — verified across thirteen shapes, the only one of the five keywords zod ever emits is `{"not":{}}` for `z.never()`, which its own importer handles. And the ordinary foreign shapes are fine: `dict[str, int]`, an open dictionary, a plain model, and a closed model all import and declare. The gap is reachable only from hand-authored or OpenAPI-derived JSON using composition-style schemas.

## What does not cross

The canonical form is a floor, and a floor has a shape. These are consequences, not defects, and the list will grow as more of the boundary is exercised.

**A zod type JSON Schema cannot express becomes `{}`, with a warning.** `z.date()`, `z.bigint()`, `z.map()`, `z.transform()` and the rest. The contract still serializes; the reader of the form learns less than the author wrote.

**A constraint in a typeless subschema is dropped on the way in.** Zod drops any constraint group with no `type` of its own to attach to — `allOf: [{"type":"string"},{"minLength":3}]` imports as a plain string. Reported by the diff, never silent. Unreachable from anything this package writes, since zod's own exports always carry `type`.

**`propertyNames` and `uniqueItems` are dropped on the way in.** Same mechanism, same reporting. Neither touches Arvo's own identifier grammar, which lives on contract fields rather than inside schemas and is re-validated on import regardless.

**A check expressible only as an annotation stops being a check.** ADR-005 forbids enforcing an annotation keyword. Where zod emits a `pattern` beside its `format` the enforcement survives on the assertion; where it does not, the check becomes documentation — including for this package reading its own output back.

**One crossing is faithful; repeated crossings are not.** Measured: `email` and `uuid` stop being enforced after two round trips. `format` is gone after one crossing, the `pattern` that carried the actual enforcement is gone after the second, and what remains accepts any string. Everything else tested — `minLength`, numeric bounds, `integer`, `pattern`, `enum`, array bounds — survives five. Nothing in ADR-005 promises idempotence and this change does not either; it is stated so nobody assumes it.

**`additionalProperties` is absent outbound.** A consequence of `io: 'input'`, so the form does not assert a rejection zod never performs. The form therefore permits keys a `z.object()` would strip.

**Byte shape is not canonical.** ADR-005 defers key ordering and number formatting, so two semantically identical contracts may serialize to different bytes.

## Impact

**Affected code**

- `src/serializers/ArvoContractSerializer/` (new) — the class, its error type, and `buildWarningFromErrorIssues`
- `src/index.ts` — new public exports
- `tests/serializers/ArvoContractSerializer/` (new)

**Dependencies**

`zod` is already a peer dependency and none is added. Its [JSON Schema documentation](https://zod.dev/json-schema) governs both directions and is the reference for every limitation this change inherits. `z.toJSONSchema` is stable API. **`z.fromJSONSchema` is documented there as experimental and explicitly not part of zod's stable surface**, and because zod is a *peer* dependency a change in a zod minor release lands in a consumer's build rather than this package's. Accepted rather than mitigated: the method's TSDoc says so plainly, so a consumer reading the signature learns it from the signature. The loss-detection diff is what limits the exposure — it measures what the importer did rather than assuming what it can do, so a behaviour change surfaces as warnings rather than as silence.

**Not touched**

- `src/utils/error-issue.ts` — `ErrorIssue` is reused as-is and `buildErrorIssueMessage` is unchanged.
- `src/ArvoContract/` — the classes and the validator are unchanged. `validateArvoContract` is called, not modified.
- `src/ArvoEvent/`, `src/cloudevent/`, `src/serializers/ArvoEventSerializer/` — a contract is a declaration; nothing about events changes.

**Release**: additive. Nothing published yet.

## Out of Scope

- **The published ArvoContract meta-schema.** ADR-005 marks it SHOULD, to be developed alongside this implementation, and leaves its hosting and version-management deferred. A schema describing the contract container is separable from producing contract JSON, and bundling them would import an unresolved hosting question into a change that otherwise has none.
- **The AAM conformance pin.** This change moves the package closer to being able to claim conformance but does not get it there — see **Known gaps**. Writing the pin is a decision about a release, not about this code.
- **Byte-level canonicalization.** Deferred by ADR-005 itself.
- **Requiring an assertion beside an annotation** so an annotation-only check survives as enforceable. ADR-005 asks only that the demotion be reportable, and mandating more would put one library's regex into the canonical form.
- **Widening `arvo-contract`'s object-shape check.** See **Known gaps** for why it stays as it is.
- **Guaranteeing round-trip idempotence.** Not promised by ADR-005 and not promised here.
- **Validating an event's payload against a contract**, and **contract resolution, dependency declaration, and binding.** Handler-protocol work, deferred by ADR-005 and untouched.
