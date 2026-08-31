## 1. Groundwork

- [x] 1.1 Create `src/serializers/ArvoContractSerializer/errors.ts` with `ArvoContractSerializerError`: a `_tag` discriminant, an optional `cause` for a failure originating at this boundary, and a frozen `issues` array in the `ErrorIssue` vocabulary for everything position-shaped. Per design.md, one type carries both channels — a caller should not have to know which layer failed to know what to catch.
- [x] 1.2 Create `src/serializers/ArvoContractSerializer/warnings.ts` with `buildWarningFromErrorIssues`, rendering a list of losses as one message. Do not modify `buildErrorIssueMessage`. Distinguish a constraint **dropped** from a check **demoted** in the wording — the demotion fires on most real contracts, so if it reads like a defect callers will learn to ignore warnings entirely.
- [x] 1.3 Add `tests/serializers/ArvoContractSerializer/warnings.spec.ts`: no losses renders nothing, one loss, several losses, and a drop reading differently from a demotion.

## 2. Types

- [x] 2.1 Create `src/serializers/ArvoContractSerializer/types.ts` with `ArvoContractSerializeOptions` (the narrowed `Pick` of zod's conversion params), `ArvoContractSerializerOptions` keyed by direction, `ArvoContractSerializerWarnings`, and the two result types extending it.
- [x] 2.2 Document on `ArvoContractSerializerOptions` why it is keyed by direction, so a later `deserialize` key is additive rather than a reshape.
- [x] 2.3 Use `readonly` on every result field and `readonly ErrorIssue[]` for the collection — not `Readonly<ErrorIssue[]>`, which leaves `push` callable and protects nothing.

## 3. Outbound

- [x] 3.1 Build the default conversion params: `target: 'draft-2020-12'` forced, `io: 'input'`, `cycles: 'ref'`, `reused: 'inline'`, and an `unrepresentable` **function** that substitutes `{}` and records an `ErrorIssue` from zod's supplied `path` and `message`. The function rather than `'any'` is the whole mechanism for reporting; `'any'` would omit silently.
- [x] 3.2 Merge caller-supplied options over the defaults, with `target` not overridable. A caller-supplied `unrepresentable` **replaces** ours rather than wrapping it, so no losses are collected in that case.
- [x] 3.3 Implement `trySerialize`: convert each schema position, assemble the container with every field materialized at its default, exclude the handler error, stringify, and return `{ schema, warnings, warningString }` frozen to its leaves.
- [x] 3.4 Add `tests/serializers/ArvoContractSerializer/serialize.spec.ts`: the 2020-12 `$schema` at every position, defaults materialized, explicit-null indistinguishable from omitted, no handler error key anywhere, and a recursive schema expressed by reference rather than refused.
- [x] 3.5 Extend it with the loss cases: an unrepresentable type reported rather than raised, the position named, and nothing reported when nothing was lost — with `warningString` absent rather than empty.
- [x] 3.6 Add a test that `target` cannot be overridden by a caller.

## 4. Inbound — form checks

- [x] 4.1 Implement the form-level checks against the parsed JSON, before any conversion: container fields present, `versions` non-empty, and per schema position the literal `"type": "object"` and the `$schema` declaration. These cannot run after conversion — zod erases the distinction, so a form built from `allOf` may import as something object-ish while never having carried the keyword.
- [x] 4.2 Add `tests/serializers/ArvoContractSerializer/form.spec.ts`: a position describing an object but lacking the literal keyword is rejected and named; a missing `type`, missing `versions`, and empty `versions` each fail naming what is missing.

## 5. Inbound — conversion and loss detection

- [x] 5.1 Convert each schema position, failing with construct and position named when zod refuses one. Cover the five documented keywords and the two composition shapes from the proposal's **Known gaps**.
- [x] 5.2 Implement the loss diff: re-export each converted schema and compare constraint keywords by path against the input, reporting anything present going in and absent coming out. Ignore *additions* — `additionalProperties: {}` appears on re-export for every plain object.
- [x] 5.3 Define the constraint-keyword set from 2020-12's assertion keywords plus `format`, excluding annotations and anything that only widens. Missing an entry costs a warning, never correctness — err toward including.
- [x] 5.4 Add `tests/serializers/ArvoContractSerializer/losses.spec.ts` covering each measured silent drop individually: a constraint in a typeless `allOf` subschema, `propertyNames`, and `uniqueItems`. Assert the reported path, and assert a fully-supported schema reports nothing.
- [x] 5.5 Add tests for each unreadable construct: the five keywords, plus top-level `allOf` and `patternProperties`. Each fails naming the construct and the position, never silently admitting a contract that enforces less than it declares. **The five keywords are covered in `losses.spec.ts`. The two composition shapes are not refused by the conversion — they convert to an intersection and a record, and are refused by the contract's own object-shape check — so they need the full deserialize path and are covered in section 6.**

## 6. Inbound — assembly

- [x] 6.1 Call `validateArvoContract` on the assembled param rather than constructing an `ArvoContract` and catching, merging its issues with the serializer's own into one report.
- [x] 6.2 Construct the contract when nothing is reported, and return `{ contract, warnings, warningString }` frozen to its leaves.
- [x] 6.3 Implement `deserialize` and `serialize` as throwing wrappers with no logic beyond unwrapping their primitive.
- [x] 6.4 Add `tests/serializers/ArvoContractSerializer/deserialize.spec.ts`: a form this system produced reads back with identity fields and version keys intact; a form it did not produce reads back; a bad `outputs` key is rejected and named; a non-JSON string fails at this boundary with the original parse failure retrievable.
- [x] 6.5 Add the aggregation test: a form breaking a form-level rule *and* an evaluable contract-level rule reports both in one attempt.
- [x] 6.6 Add the pair tests: each primitive does not raise for an expected failure, each companion raises what its primitive reported, and both agree on the same input.

## 7. Round trip

- [x] 7.1 Add `tests/serializers/ArvoContractSerializer/round-trip.spec.ts` pinning that one crossing is faithful: string length, numeric range, and set membership each still reject a violating payload after serialize-then-deserialize, and a payload the original accepts is accepted after.
- [x] 7.2 Add the recursive round trip: a self-referencing `input` serializes and reads back.
- [x] 7.3 Do **not** add a test asserting repeated crossings preserve constraints. They do not — `email` and `uuid` stop being enforced after two. Record that in a comment beside the single-crossing tests so the absence reads as deliberate rather than as missing coverage.

## 8. Immutability

- [x] 8.1 Freeze both result objects and their `warnings` arrays. `ErrorIssue` already freezes itself, so the value is immutable to its leaves.
- [x] 8.2 Add tests that a returned result, its collection of losses, and an individual loss all resist mutation.

## 9. Public surface

- [x] 9.1 Export `ArvoContractSerializer`, `ArvoContractSerializerError`, and the result and options types from `src/index.ts`.
- [x] 9.2 Write the TSDoc for the public surface per `project.md` — rules, not provenance. State on `tryDeserialize`/`deserialize` that the inbound conversion rests on zod's experimental `z.fromJSONSchema`, so a consumer meets that at the signature rather than in a changelog. Cite `docs/` paths only, never `openspec/`.
- [x] 9.3 Add a section to `ts/sandbox/src/playground.ts`: a contract serialized and read back, a contract carrying a `z.date()` showing the loss report, and a form this implementation cannot read failing with its construct named.

## 10. Close out

- [x] 10.1 Run `pnpm test --coverage`, `pnpm lint`, and `tsc --noEmit`; hold `src/serializers/` at the 100% line and function coverage the rest of the package holds.
- [x] 10.2 Re-run the measurements this change was designed from against the installed zod, confirming the five refused keywords, the three silent drops, and the two-crossing decay are all still what the proposal says. Any divergence means zod moved and the proposal's numbers need correcting rather than the tests being adjusted to match.
