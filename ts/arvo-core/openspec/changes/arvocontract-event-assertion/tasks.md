## 1. Probes before types

- [ ] 1.1 Probe the narrowing path's conditional types against the real generic shape, not a mock: the contract's `type`, an emit key, and the handler error type each narrow the reported scope to a single literal, the payload type follows the expected type, and an undeclared type is rejected at the call site. Recorded in design.md as already probed on a mock — repeat it against the actual classes, since a conditional that resolves on a hand-written shape can still collapse when the emit keys arrive through a generic.
- [ ] 1.2 Probe the container's result: the version it reports is the union of its declared versions, and narrowing that to a literal permits an `assert` call on `versions[version]` with an expected type while the un-narrowed union does not. The second half is the surprising one and the usage sketch depends on it.
- [ ] 1.3 Probe that `expectedType` rejects a plain `string` variable. If a `string` is accepted the union has been widened somewhere and the expectation has stopped checking anything.

## 2. Types and the error

- [ ] 2.1 Add `ArvoContractAssertionError` to `src/ArvoContract/errors.ts`, shaped on `ArvoContractValidationError`: a `_tag`, a frozen `readonly issues`, and a message from `buildErrorIssueMessage`. One error for the whole operation — asserting does not borrow the declaration or event errors. Its heading says the assertion failed, not that the contract is invalid; the most common failure is a wrong expectation against a valid contract.
- [ ] 2.2 Add `ArvoContractEventScope`, `AssertedArvoEvent`, `NarrowedArvoEvent`, and the `ScopeOf` / `PayloadFor` helpers to `src/ArvoContract/types.ts`. `PayloadFor` resolves through `z.input`, not `z.infer` — the payload returned is the one that arrived, so a transform's output type would describe a value nobody produced.
- [ ] 2.3 Type the container's reported version as the union of its declared versions rather than any semantic version. It costs nothing — the container knows which key it matched — and it is what makes the discovery-then-narrow flow type-check.
- [ ] 2.4 Document on the ask-path result that its event is deliberately unparameterised: the contract knows the version and the scope, not the payload type, until a caller says what they expect.

## 3. The shared checking logic

- [ ] 3.1 Create `src/ArvoContract/assert.ts` holding the checks both classes reach: reading `dataschema` as an identifier and a version, which of the three shapes a type names, the payload check against the selected schema, and building the result. Both classes call this so an event a contract accepts is exactly an event one of its versions accepts.
- [ ] 3.2 Report failures as `ErrorIssue`s in the shared vocabulary, carried by `ArvoContractAssertionError`, at exactly the positions the spec pins: `expectedType`, `event.dataschema.structure`, `event.dataschema.uri`, `event.dataschema.version`, `event.type`, and payload positions beneath `event.data`. These strings are the observable contract, so they are written once here and asserted verbatim in tests.
- [ ] 3.3 Split `dataschema` at the last `/` — the version is the final segment, the identifier is everything before it. Anything not of the form `{uri}/{version}` reports at `event.dataschema.structure` and blocks, there being no halves to attribute a failure to.
- [ ] 3.3a Compare the `uri` half against the contract's own `uri` by equality only. Nothing reads `#/`, counts segments, or reconstructs a `uri` from `type` — derivation is ADR-005's, applies only where authoring omits the value, and an explicit `uri` may bear no relation to `type`. A test covers a contract whose `uri` was supplied explicitly and shares nothing with its `type`.
- [ ] 3.4 Mark all five prerequisite failures with a `blockingReason`, so a partial list says it is partial. Same mechanism the declaration validator uses for a malformed `type`.
- [ ] 3.5 Check payloads with zod's standalone `safeParse`, since a version's `accepts` is a core schema with no parse method of its own. Translate its issues one for one — zod's `path` prefixed to sit under `event.data`, zod's message carried across as it stands. No check zod already performs is re-implemented and no message it produced is paraphrased.
- [ ] 3.6 Discard the value `safeParse` produces. Only the verdict and the issues are used; the result carries the event that came in.

## 4. VersionedArvoContract

- [ ] 4.1 Add `tryAssert` and `assert` with both overloads — with an expected type, and without. The throwing companion carries no logic beyond unwrapping.
- [ ] 4.1a Check the event's `dataschema` here too: the identifier is this contract's and the version is this version. Routed through the container this cannot fail — the version was found in the map a moment earlier — so it is a direct call that exercises it, and a direct call the test must make.
- [ ] 4.2 Return the event by reference, so `result.event === input` holds. Nothing is constructed, nothing is copied, and no field has to be carried across.
- [ ] 4.3 Add `tests/ArvoContract/assert-version.spec.ts`: each of the three shapes matching, the handler error assertable when `emits` is empty, an event matching none, a correct expectation, an expectation the event contradicts, an expectation the version does not declare, and no expectation at all.
- [ ] 4.4 Extend it with the payload cases: several broken rules reported together, a position nested inside the payload named as such, and a payload no shape would accept reported as an unmatched type alone when the type does not match.

## 5. ArvoContract

- [ ] 5.1 Add `tryAssert` and `assert`. Split `dataschema`, check the identifier half is this contract's, check the version half is one it declares, then delegate. No expected type, and nothing beyond that check of its own.
- [ ] 5.2 Add `tests/ArvoContract/assert-contract.spec.ts`: the version taken from the event, a foreign contract rejected, an undeclared version rejected with the declared versions named, a `dataschema` of the wrong shape rejected at `event.dataschema.structure`, an identifier containing separators read whole rather than truncated, and the result naming the version selected.
- [ ] 5.2a Add the guarded-direct-path test: a version contract asked about an event from a sibling version rejects it at `event.dataschema.version`, and one asked about a foreign contract's event rejects it at `event.dataschema.uri`.
- [ ] 5.2b Assert a successful result never disagrees with the event it carries — the version reported is the version the `dataschema` names, from both classes.
- [ ] 5.3 Add the agreement test: the same event given to a contract and to the version that contract selects produces the same verdict and the same scope. This is what makes "one definition of matches" checkable rather than asserted.

## 6. The event is untouched

- [ ] 6.1 Add `tests/ArvoContract/assert-identity.spec.ts`: the result's event is the same instance that went in, from both classes and on both overloads.
- [ ] 6.2 Assert a field the selected schema defaults and the payload omitted is still absent afterwards, and that the event is unchanged by having been asserted.

## 7. Distinguishable failures

- [ ] 7.1 Add `tests/ArvoContract/assert-failures.spec.ts` asserting the literal `path` each of the five prerequisite failures reports — `expectedType`, `event.dataschema.structure`, `event.dataschema.uri`, `event.dataschema.version`, `event.type` — and that the five differ from one another. Compare the strings, not a description of them: they are what a caller's code contains, so a rename must fail a test.
- [ ] 7.2 Assert each prerequisite failure states the remaining rules did not run.
- [ ] 7.3 Assert every failure arrives as `ArvoContractAssertionError`, from both classes and for every one of the six situations, and that a caller separates their own bad expectation from a bad event by comparing `path` rather than by matching a message.

## 8. Public surface

- [ ] 8.1 Export `ArvoContractAssertionError` and the result and scope types from `src/index.ts`. The helper conditional types stay internal unless a consumer needs to name one.
- [ ] 8.2 Write the TSDoc per `project.md` — rules, not provenance. State on `assert` that the event returned is the event supplied and that schema defaults are not applied, so a caller expecting a filled payload is not surprised. Say on the ask path that a typed payload requires naming the type expected.
- [ ] 8.3 Add type-level tests for what the probes in section 1 established, so the narrowing cannot regress silently.
- [ ] 8.4 Add a section to `ts/sandbox/src/playground.ts`: asking and switching on the scope, naming an expected type, the discovery-then-narrow flow with its narrowing step, and each of the five prerequisite failures printing its own position.

## 9. Close out

- [ ] 9.1 Run `pnpm test --coverage`, `pnpm lint`, and `tsc --noEmit`; hold `src/ArvoContract/` at the 100% line, branch and function coverage the package holds.
- [ ] 9.2 Confirm nothing here reaches past an exact version lookup. No range, `latest` or `oldest` handling should have appeared; a version key is a bare triple, so an undeclared string simply misses. If any resolution logic crept in, it is a separate decision and belongs in its own change.
- [ ] 9.3 Confirm nothing constructs an `ArvoEvent`. If it does, the operation has stopped being an assertion.
- [ ] 9.4 Confirm neither deferral was settled: nothing decides where the check runs or what a handler does when it fails, and nothing decides a trust boundary. Providing a check is the whole of the scope.
