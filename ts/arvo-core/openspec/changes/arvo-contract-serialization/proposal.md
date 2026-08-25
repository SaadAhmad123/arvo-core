## Why

[ADR-005](../../../docs/adr/005-arvocontract-structure.md) requires every implementation to produce a contract's canonical form — a plain JSON object whose schema-bearing positions are JSON Schema 2020-12 — and to construct a working contract from one produced elsewhere, including by another language. `arvo-core` implements neither. `build-arvocontract` declared this out of scope openly and promised not to make it harder; this is the change that promise pointed at.

Until it lands the package cannot claim ADR-005 conformance, which also leaves it nothing truthful to record as the release metadata [ADR-004](../../../docs/adr/004-multi-language-implementation-governance.md) requires of a conformance claim. Both gaps close behind this one.

There is a second reason not to defer it further. A contract today *is* the zod code that declares it — the conflation ADR-005 exists to break. While that stays true, more of the package gets written assuming a contract is a TypeScript object rather than a portable declaration that happens to have a TypeScript materialization.

## Status of this proposal

**The outbound direction is settled and specified below. The inbound direction is not.**

Reading a canonical form back into a contract has one mechanism, `z.fromJSONSchema`, and it throws on legal 2020-12 constructs — `dependentSchemas`, `dependentRequired`, `not`, and `unevaluatedProperties`, all verified against the installed version. It offers no equivalent of the `unrepresentable` hook the outbound direction uses to degrade gracefully. ADR-005 now forbids rejecting a canonical form because part of it was inexpressible, so an exception is not an acceptable response, and the design has to answer what is.

That question is being worked separately and will be added to this proposal once settled. Nothing here forecloses it: the class, the error type, and the option-narrowing policy are all direction-agnostic.

## What Changes

- **New capability**: `arvo-contract-serialization` — converting an `ArvoContract` to its canonical JSON form and back.
- **New class `ArvoContractSerializer`.** Its surface, stated rather than cross-referenced to the event serializer:
  - `trySerialize(contract)` — the primitive. Returns a `Result` and does not raise for an expected failure. On success the value is `{ schema, warnings }`: `schema` is the canonical form as a JSON string, `warnings` is an `ErrorIssue[]` naming every constraint that could not cross into JSON Schema.
  - `serialize(contract)` — a wrapper with no logic of its own: calls `trySerialize`, unwraps, throws the failure. Returns the same `{ schema, warnings }` on success.
  - The inbound pair is deliberately unspecified here. See **Status of this proposal**.
- **New class `ArvoContractSerializerError`**, carrying via `cause` any failure this class originates at its own boundary — a `JSON.stringify` `TypeError`, or a conversion error zod raises that the configured `unrepresentable` handling did not absorb. A failure raised by the contract itself passes through unwrapped, so one `instanceof` check each separates "this class's boundary failed" from "the contract was not valid".
- **New function `buildWarningFromErrorIssues`**, in the serializer's own directory, rendering a list of omissions as one message. `buildErrorIssueMessage` is left alone: it hardcodes "The following N problems were found:", which is wrong for omissions ADR-005 mandates — a contract that dropped a `z.date()` did not have a problem, it did what it was told — and widening a function four error types already depend on, for one new caller with different prose, buys nothing. Warning prose and error prose are supposed to read differently, so two renderers is the point rather than duplication.
- **Warnings are not failures.** A constraint omitted because JSON Schema 2020-12 cannot express it is the outcome ADR-005 mandates — omission, never approximation — so it belongs in the success value. `warnings` reuses `ErrorIssue` because zod's own handler supplies a `path` and a `message`, which is that type's shape and the package's shared vocabulary for "which part, what is wrong". A warning is never blocking.
- **The canonical form's own rules, implemented rather than assumed.** Every schema-bearing position declares `"$schema"` explicitly and targets 2020-12. Optional contract fields are materialized at their defaults rather than omitted. The handler error appears nowhere, being a fixed function of `type` and version.

### Conversion options: a narrowed passthrough

A caller may supply `Pick<ToJSONSchemaParams, 'unrepresentable' | 'io' | 'cycles' | 'reused' | 'uri'>`. Everything outside that set is the serializer's own, and two are excluded for reasons rather than convenience:

- **`target` is forced to `draft-2020-12`.** ADR-005 pins the dialect so two languages cannot disagree about the same bytes. A form emitted against draft-07 is not a canonical form, so this is a correctness boundary, not an ergonomic default.
- **`metadata` and `override` are not exposed**, and `metadata` is not passed. Zod's own registry behaviour therefore applies and `.meta()` fields flow into the output untouched. A caller who uses `.meta()` to override a generated keyword is describing their own contract as they choose; the serializer does not police it.

Defaults for what a caller may set:

| Option | Default | Why |
|---|---|---|
| `unrepresentable` | a function that substitutes `{}` and records an `ErrorIssue` | `{}` is JSON Schema's "unknown", so the constraint is omitted rather than approximated, exactly as ADR-005 requires. The function form rather than `'any'` is what makes the omission reportable, satisfying the SHOULD that omissions not be silent. |
| `io` | `'input'` | Under `'output'`, zod emits `additionalProperties: false` for a plain `z.object()`. But `z.object()` *strips* unknown keys rather than rejecting them, so that keyword would assert a check zod never performs — the fabricated stand-in ADR-005 forbids. Under `'input'` the keyword is simply absent: weaker, and true. Both `accepts` and `emits` describe a wire payload, and a wire payload is always the input to whoever validates it, so one setting is correct for both positions. |
| `cycles` | `'ref'` | A recursive payload is a legitimate contract, and `$ref: '#'` is legal 2020-12 — ADR-005 discusses `$ref` alongside sibling keywords, so it plainly expects `$ref` in canonical forms. Throwing would leave a recursive contract with no canonical form at all, which ADR-005 requires every implementation to be able to produce. |
| `reused` | `'inline'` | Self-contained output, and byte-level canonicalization is deferred by ADR-005 anyway, so `$defs` extraction buys nothing here. |
| `uri` | unset | Only reached when a schema carries a registered id; no default behaviour worth imposing. |

**A caller-supplied `unrepresentable` replaces the default outright.** It does not wrap it, so supplying one means no warnings are collected, and a handler that returns a fabricated stand-in departs from ADR-005. That departure is the caller's, made deliberately, and is documented as such rather than prevented.

### The surface, sketched

Illustrative, not normative — the spec governs. Synchronous, unlike `ArvoEventSerializer`, which is async only because a `CloudEventConverter` may carry async enrichment stages; producing a canonical form has nothing to await.

```ts
/** What a caller may configure for the outbound direction. */
export type ArvoContractSerializeOptions = Pick<
  ToJSONSchemaParams,
  'unrepresentable' | 'io' | 'cycles' | 'reused' | 'uri'
>;

/**
 * Keyed by direction, so the inbound half gains a `deserialize` key rather
 * than reshaping this one.
 */
export type ArvoContractSerializerOptions = {
  serialize?: ArvoContractSerializeOptions;
};

/** A contract's canonical form, and what did not survive the crossing. */
export type SerializedArvoContract = {
  /** The canonical form, as JSON. */
  readonly schema: string;
  /** Every constraint omitted on the way out. Empty when nothing was lost. */
  readonly warnings: readonly ErrorIssue[];
  /** The same warnings rendered as one message. `null` when there are none. */
  readonly warningString: string | null;
};

export class ArvoContractSerializer {
  constructor(options?: ArvoContractSerializerOptions);

  /** The primitive. Never raises for an expected failure. */
  trySerialize(
    contract: ArvoContract,
  ): Result<SerializedArvoContract, ArvoContractSerializerError>;

  /** `trySerialize` unwrapped, for a caller who wants throw/catch. */
  serialize(contract: ArvoContract): SerializedArvoContract;
}
```

Reading it back:

```ts
const { schema, warningString } = new ArvoContractSerializer().serialize(contract);

if (warningString) console.warn(warningString);
// Some constraints could not be represented in JSON Schema.
// The following 1 constraint was omitted:
//   - versions["1.0.0"].accepts.createdAt: Date cannot be represented in JSON Schema
```

Three things the shape is saying. `warnings` sits in the success value because an omission is the outcome ADR-005 mandates, not a failure — a contract with a `z.date()` in it serializes, and says so. It is not optional: a caller destructuring the result meets it whether or not they act on it, which is as far as a type can push the SHOULD that omissions not be silent. And `warningString` is `null` rather than empty when nothing was lost, so the common case is one falsy check rather than a length comparison.

`warningString` is derived from `warnings` and both are returned, so in principle the two could disagree. They cannot: the result is built once, frozen, and handed back — `Object.freeze` on the returned object and on the `warnings` array, the same shallow-plus freezing `ArvoContract` already applies to its `metadata`, `versions`, and each version's `emits`. `readonly` says it to a TypeScript consumer and the freeze says it to everyone else, since ADR-000 is explicit that types establish nothing for a JavaScript caller.

`readonly ErrorIssue[]` rather than `Readonly<ErrorIssue[]>`: the latter maps over the array's own properties, which leaves `push` callable and so protects nothing. `Readonly<string>` is identical to `string`. The form used here is the one the package's error classes already use for the same job.

The issues inside are frozen too, since `ErrorIssue` freezes itself on construction — so the whole returned value is immutable to its leaves, not just at the top.

## Capabilities

### New Capabilities

- `arvo-contract-serialization`: producing a contract's canonical JSON form and reading one back — what the form contains, what is omitted from it, how an omission is reported, how failure is reported, and what is not guaranteed to survive a crossing.

### Modified Capabilities

None.

## Impact

**Affected code**

- `src/serializers/ArvoContractSerializer/` (new) — the class, its error type, and `buildWarningFromErrorIssues`
- `src/index.ts` — new public exports
- `tests/serializers/ArvoContractSerializer/` (new)

**Dependencies**

`zod` is already a peer dependency and none is added. `z.toJSONSchema` is stable API. `z.fromJSONSchema`, which the inbound direction will need, is documented as experimental and explicitly not part of zod's stable surface — and because zod is a *peer* dependency, a change in a zod minor release lands in a consumer's build rather than this package's. That cost belongs to the inbound half and will be recorded with it.

**Not touched**

- `src/utils/error-issue.ts` — `ErrorIssue` is reused as-is and `buildErrorIssueMessage` is unchanged.
- `src/ArvoEvent/`, `src/cloudevent/`, `src/serializers/ArvoEventSerializer/` — a contract is a declaration; nothing about events or their transformation changes.
- `src/ArvoContract/` — the classes and the validator are unchanged by the outbound direction.

**Release**: additive. Nothing published yet.

## Out of Scope

- **The inbound direction, for now.** Not deferred indefinitely — unsettled, and named as such above rather than specified vaguely.
- **The published ArvoContract meta-schema.** ADR-005 marks it SHOULD, to be developed alongside this implementation, and leaves its hosting and version-management deferred. A schema describing the contract container is separable from producing contract JSON, and bundling them would import an unresolved hosting question into a change that otherwise has none.
- **The AAM conformance pin.** ADR-004 requires a release claiming conformance to record the AAM version, its ADR cutoff, and any SHOULD departures still in effect. This change is what eventually makes such a claim possible; making it is a decision about a release, not about this code.
- **Byte-level canonicalization.** Key ordering, number formatting, and any JCS-style scheme are deferred by ADR-005 itself. Two semantically identical contracts may serialize to different bytes and nothing here changes that.
- **Requiring an assertion beside an annotation** so that an annotation-only check survives as enforceable. ADR-005 asks only that the demotion be reportable, and mandating more would put one library's regex into the canonical form.
- **Validating an event's payload against a contract**, and **contract resolution, dependency declaration, and binding.** Handler-protocol work, deferred by ADR-005 and untouched here.

## What does not cross

The canonical form is a floor, and a floor has a shape. These are the consequences of that, not defects, and the list will grow as more of the boundary is exercised — every one of them is a case where the JSON carries less than the zod schema does.

**A schema whose top level is not literally an object cannot be declared, so cannot be serialized.** ADR-005 requires the literal keyword `"type": "object"` at the top of every schema-bearing position, and says why: a rule phrased as "must not permit a non-object" cannot be checked mechanically, since `allOf` composition can permit only objects while carrying no top-level `type` at all. `ArvoContract` performs the same lookup on the zod side, so an intersection of two object schemas is refused at declaration. That is the rule working, not failing.

**A zod type JSON Schema cannot express becomes `{}`, with a warning.** `z.date()`, `z.bigint()`, `z.map()`, `z.transform()` and the rest. `{}` is JSON Schema's "unknown", so the constraint is omitted rather than approximated. The contract still serializes; the reader of the form learns less than the author wrote.

**A check expressible only as an annotation stops being a check.** Zod emits `format` for `z.email()` and friends, and ADR-005 forbids any implementation from enforcing an annotation keyword. Where zod also emits a `pattern` the enforcement survives on the assertion; where it does not, the check becomes documentation — including for this package reading its own output back.

**`additionalProperties` is absent.** A consequence of `io: 'input'`, chosen so the form does not assert a rejection zod never performs. The form therefore permits keys a `z.object()` would strip.

**Byte shape is not canonical.** ADR-005 defers key ordering and number formatting, so two semantically identical contracts may serialize to different bytes.

One case is genuinely unsettled rather than decided: a `z.record()` exports with a top-level `"type": "object"`, which would make it a legal canonical form, yet it is refused at declaration by the same lookup that correctly refuses an intersection. Whether the lookup should admit it is a question for `arvo-contract`, not for this change, and is not settled here.
