## 1. Probes before types

- [ ] 1.1 Probe the narrowing path's conditional types against the real generic shape, not a mock: the contract's `type`, an emit key, and the handler error type each narrow the reported scope to a single literal, the payload type follows the expected type, and an undeclared type is rejected at the call site. Recorded in design.md as already probed on a mock — repeat it against the actual classes, since a conditional that resolves on a hand-written shape can still collapse when the emit keys arrive through a generic.
- [ ] 1.2 Probe the container's result: the version it reports is the union of its declared versions, and narrowing that to a literal permits an `assert` call on `versions[version]` with an expected type while the un-narrowed union does not. The second half is the surprising one and the usage sketch depends on it.
- [ ] 1.3 Probe that `expectedType` rejects a plain `string` variable. If a `string` is accepted the union has been widened somewhere and the expectation has stopped checking anything.

## 2. Types and the error

- [ ] 2.1 Add `ArvoContractAssertionError` to `src/ArvoContract/errors.ts`, shaped on `ArvoContractValidationError`: a `_tag`, a frozen `readonly issues`, and a message from `buildErrorIssueMessage`. One error for the whole operation — asserting does not borrow the declaration or event errors.
- [ ] 2.2 Add `ArvoContractEventScope`, `AssertedArvoEvent`, `NarrowedArvoEvent`, and the `ScopeOf` / `PayloadFor` helpers to `src/ArvoContract/types.ts`.
- [ ] 2.3 Type the container's reported version as the union of its declared versions rather than any semantic version. It costs nothing — the container knows which key it matched — and it is what makes the discovery-then-narrow flow type-check.
- [ ] 2.4 Document on the ask-path result that its event is deliberately unparameterised: the contract knows the version and the scope, not the payload type, until a caller says what they expect.

## 3. The shared checking logic

- [ ] 3.1 Create `src/ArvoContract/assert.ts` holding the checks both classes reach: which of the three shapes a type names, the payload check against the selected schema, and building the result. Both classes call this so an event a contract accepts is exactly an event one of its versions accepts.
- [ ] 3.2 Report failures as `ErrorIssue`s in the shared vocabulary, carried by `ArvoContractAssertionError`, with the positions the spec pins — the expectation, the contract identifier within `dataschema`, the version within `dataschema`, the event's type, and a path into the payload.
- [ ] 3.3 Mark all four prerequisite failures with a `blockingReason`, so a partial list says it is partial. Same mechanism the declaration validator uses for a malformed `type`.
- [ ] 3.4 Check payloads with zod's standalone `safeParse`, since a version's `accepts` is a core schema with no parse method of its own. Translate its issues one for one — zod's `path` prefixed to sit under `event.data`, zod's message carried across as it stands. No check zod already performs is re-implemented and no message it produced is paraphrased.
- [ ] 3.5 Discard the value `safeParse` produces. Only the verdict and the issues are used; the result carries the event that came in.

## 4. VersionedArvoContract

- [ ] 4.1 Add `tryAssert` and `assert` with both overloads — with an expected type, and without. The throwing companion carries no logic beyond unwrapping.
- [ ] 4.2 Return the event by reference, so `result.event === input` holds. Nothing is constructed, nothing is copied, and no field has to be carried across.
- [ ] 4.3 Add `tests/ArvoContract/assert-version.spec.ts`: each of the three shapes matching, the handler error assertable when `emits` is empty, an event matching none, a correct expectation, an expectation the event contradicts, an expectation the version does not declare, and no expectation at all.
- [ ] 4.4 Extend it with the payload cases: several broken rules reported together, a position nested inside the payload named as such, and a payload no shape would accept reported as an unmatched type alone when the type does not match.

## 5. ArvoContract

- [ ] 5.1 Add `tryAssert` and `assert`. Split `dataschema`, check the identifier half is this contract's, check the version half is declared, then delegate. No expected type and no checking of its own.
- [ ] 5.2 Add `tests/ArvoContract/assert-contract.spec.ts`: the version taken from the event, a foreign contract rejected, an undeclared version rejected with the declared versions named, and the result naming the version selected.
- [ ] 5.3 Add the agreement test: the same event given to a contract and to the version that contract selects produces the same verdict and the same scope. This is what makes "one definition of matches" checkable rather than asserted.

## 6. The event is untouched

- [ ] 6.1 Add `tests/ArvoContract/assert-identity.spec.ts`: the result's event is the same instance that went in, from both classes and on both overloads.
- [ ] 6.2 Assert a field the selected schema defaults and the payload omitted is still absent afterwards, and that the event is unchanged by having been asserted.

## 7. Distinguishable failures

- [ ] 7.1 Add `tests/ArvoContract/assert-failures.spec.ts` asserting the position each of the four prerequisite failures reports, and that the four differ from one another. The spec pins these positions because a caller writes code against them, so a reworded message must not be able to break that.
- [ ] 7.2 Assert each prerequisite failure states the remaining rules did not run.
- [ ] 7.3 Assert every failure arrives as `ArvoContractAssertionError`, from both classes and for every one of the five situations, and that a caller separates their own bad expectation from a bad event by comparing `path` rather than by matching a message.

## 8. Public surface

- [ ] 8.1 Export `ArvoContractAssertionError` and the result and scope types from `src/index.ts`. The helper conditional types stay internal unless a consumer needs to name one.
- [ ] 8.2 Write the TSDoc per `project.md` — rules, not provenance. State on `assert` that the event returned is the event supplied and that schema defaults are not applied, so a caller expecting a filled payload is not surprised. Say on the ask path that a typed payload requires naming the type expected.
- [ ] 8.3 Add type-level tests for what the probes in section 1 established, so the narrowing cannot regress silently.
- [ ] 8.4 Add a section to `ts/sandbox/src/playground.ts`: asking and switching on the scope, naming an expected type, the discovery-then-narrow flow with its narrowing step, and each of the four prerequisite failures printing its own position.

## 9. Close out

- [ ] 9.1 Run `pnpm test --coverage`, `pnpm lint`, and `tsc --noEmit`; hold `src/ArvoContract/` at the 100% line, branch and function coverage the package holds.
- [ ] 9.2 Confirm nothing here reaches past an exact version lookup. No range, `latest` or `oldest` handling should have appeared; a version key is a bare triple, so an undeclared string simply misses. If any resolution logic crept in, it is a separate decision and belongs in its own change.
- [ ] 9.3 Confirm nothing constructs an `ArvoEvent`. If it does, the operation has stopped being an assertion.
