## 1. Probes before types

- [ ] 1.1 Probe the assert path's conditional types against the real generic shape, not a mock: asserting the contract's `type`, an emit key, and the handler error type each narrow the reported category to a single literal, the payload type follows the assertion, and an undeclared type is rejected at the call site. Recorded in design.md as already probed on a mock — repeat it against the actual classes, since a conditional that resolves on a hand-written shape can still collapse when the emit keys arrive through a generic.
- [ ] 1.2 Probe the container's result: the version it reports is the union of its declared versions, and narrowing that to a literal permits an assert call on `versions[version]` while the un-narrowed union does not. The second half is the surprising one and the usage sketch depends on it.
- [ ] 1.3 Probe that `expectedType` rejects a plain `string` variable. If a `string` is accepted the union has been widened somewhere and the assertion has stopped checking anything.

## 2. Types

- [ ] 2.1 Add `ArvoContractEventCategory`, `ParsedArvoEvent`, `AssertedArvoEvent`, and the `CategoryOf` / `PayloadFor` helpers to `src/ArvoContract/types.ts`.
- [ ] 2.2 Type the container's reported version as the union of its declared versions rather than any semantic version. It costs nothing — the container knows which key it matched — and it is what makes the discovery-then-assert flow type-check.
- [ ] 2.3 Document on the ask-path result that its event is deliberately unparameterised: the contract knows the version and the category, not the payload type, until a caller asserts one.

## 3. The shared checking logic

- [ ] 3.1 Create `src/ArvoContract/parse.ts` holding the checks both classes reach: which of the three shapes a type names, the payload check against the matched schema, and building the result. Both classes call this so an event a contract accepts is exactly an event one of its versions accepts.
- [ ] 3.2 Report failures as `ErrorIssue`s in the shared vocabulary, with the positions the spec pins — the assertion, the contract identifier within `dataschema`, the version within `dataschema`, the event's type, and a path into the payload.
- [ ] 3.3 Mark the three prerequisite failures with a `blockingReason`, so a partial list says it is partial. Same mechanism the declaration validator uses for a malformed `type`.
- [ ] 3.4 Check payloads with zod's standalone `safeParse`, since a version's `accepts` is a core schema with no parse method of its own.

## 4. VersionedArvoContract

- [ ] 4.1 Add `tryParse` and `parse` with both overloads — ask, and assert. The throwing companion carries no logic beyond unwrapping.
- [ ] 4.2 Build the returned event through `ArvoEvent`'s own constructor, so a parsed event cannot bypass a rule a constructed one obeys, and carry `id`, `subject`, `source`, `type` and `dataschema` across unchanged.
- [ ] 4.3 Add `tests/ArvoContract/parse-version.spec.ts`: each of the three shapes matching, the handler error parsable when `emits` is empty, an event matching none, a correct assertion, an assertion the event contradicts, an assertion the version does not declare, and no assertion at all.
- [ ] 4.4 Extend it with the aggregation cases: a wrong type and a bad payload reported together, and a payload failure naming its position within the payload.

## 5. ArvoContract

- [ ] 5.1 Add `tryParse` and `parse`. Split `dataschema`, check the identifier half is this contract's, check the version half is declared, then delegate. No assertion parameter and no checking of its own.
- [ ] 5.2 Add `tests/ArvoContract/parse-contract.spec.ts`: the version taken from the event, a foreign contract rejected, an undeclared version rejected with the declared versions named, and the result naming the version selected.
- [ ] 5.3 Add the agreement test: the same event given to a contract and to the version that contract selects produces the same verdict and the same category. This is what makes "one definition of matches" checkable rather than asserted.

## 6. Defaults and immutability

- [ ] 6.1 Apply the matched schema's declared defaults to the returned payload, leaving a supplied value alone.
- [ ] 6.2 Add `tests/ArvoContract/parse-defaults.spec.ts`: an omitted default present afterwards, a supplied value not replaced, and the event that was parsed unchanged.

## 7. Distinguishable failures

- [ ] 7.1 Add `tests/ArvoContract/parse-failures.spec.ts` asserting the position each of the three prerequisite failures reports, and that the three differ from one another. The spec pins these positions because a caller writes code against them, so a reworded message must not be able to break that.
- [ ] 7.2 Assert each prerequisite failure states the remaining rules did not run.
- [ ] 7.3 Assert a contract misuse and an event failure are distinguishable — one `instanceof` check each, with no string matching.

## 8. Public surface

- [ ] 8.1 Export the result and category types from `src/index.ts`. The helper conditional types stay internal unless a consumer needs to name one.
- [ ] 8.2 Write the TSDoc per `project.md` — rules, not provenance. State on `parse` that the event returned is a new event carrying the contract's defaults, so a caller comparing it to the one they supplied is not surprised. Say on the ask path that a typed payload requires asserting.
- [ ] 8.3 Add type-level tests for what the probes in section 1 established, so the narrowing cannot regress silently.
- [ ] 8.4 Add a section to `ts/sandbox/src/playground.ts`: asking and switching on the category, asserting for a known type, the discovery-then-assert flow with its narrowing step, and each of the three prerequisite failures printing its own position.

## 9. Close out

- [ ] 9.1 Run `pnpm test --coverage`, `pnpm lint`, and `tsc --noEmit`; hold `src/ArvoContract/` at the 100% line, branch and function coverage the package holds.
- [ ] 9.2 Confirm nothing here reaches past an exact version lookup. No range, `latest` or `oldest` handling should have appeared; a version key is a bare triple, so an undeclared string simply misses. If any resolution logic crept in, it is a separate decision and belongs in its own change.
