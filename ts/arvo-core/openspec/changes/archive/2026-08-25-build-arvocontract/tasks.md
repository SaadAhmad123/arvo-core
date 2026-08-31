## 1. Shared groundwork

- [x] 1.1 **Move** `isUriReference` out of `src/ArvoEvent/validator.ts` into `src/utils/uri.ts` and export it; update `src/ArvoEvent/validator.ts` to import it. This relocates existing behaviour — the event validator's URI checking must be unchanged, verified by the existing `tests/ArvoEvent/validator.spec.ts` still passing untouched.
- [x] 1.2 Add `tests/utils/uri.spec.ts` covering `isUriReference` directly: canonical accept, non-canonical percent-encoding, wrong case, unresolved dot-segment, empty string.

## 2. Types

- [x] 2.1 Create `src/ArvoContract/types.ts` with `ArvoContractVersionParam` (`input`, `outputs`), `ArvoContractVersionMapParam`, `ArvoContractParam`, and `VersionedArvoContractParam`, using `zod/v4/core` types for schema positions.
- [x] 2.2 Document on `ArvoContractVersionMapParam` that annotating a versions map with it collapses literal keys and loses per-version inference, per design.md — Risks.

## 3. Handler error

- [x] 3.1 Create `src/ArvoContract/handler-error.ts` with the payload schema as a single module-level frozen constant and a function deriving `handler_{type}_error` from `type`.
- [x] 3.2 Add `tests/ArvoContract/handler-error.spec.ts`: type derivation for single- and multi-segment `type`, payload shape, and that the schema instance is shared rather than rebuilt per call.

## 4. Validator

- [x] 4.1 Create `src/ArvoContract/errors.ts` with `ArvoContractValidationError` — `_tag`, frozen `issues`, message via `buildErrorIssueMessage`.
- [x] 4.2 Create `src/ArvoContract/validator.ts` with the identifier-grammar check used by `type`, `outputs` keys, and `domain`.
- [x] 4.3 Add the contract-level checks to `src/ArvoContract/validator.ts`: `uri` non-empty and canonical via `src/utils/uri.ts`, `versions` non-empty, and every version key validated through `ArvoSemanticVersion.tryCheck` with its issues re-anchored under `versions.<key>`.
- [x] 4.4 Add the version-level check function to `src/ArvoContract/validator.ts`: `outputs` key grammar, structural object-shape check on `input` and every emit, and collision of an `outputs` key with `type` or the handler error type. This is the single function both classes call.
- [x] 4.5 Add normalization to `src/ArvoContract/validator.ts` — derive `uri` from `type`, default `description`/`domain` to null and `metadata` to `{}` — running before any check, and expose the entry point returning `{ value, issues }`.
- [x] 4.6 Add `tests/ArvoContract/validator.spec.ts` covering every rejection condition individually: each grammar violation, each version-key violation, non-object schemas, both collision cases, empty `versions`, empty and non-canonical `uri`.
- [x] 4.7 Extend `tests/ArvoContract/validator.spec.ts` with the multi-failure cases: several problems in one declaration reported together, problems in two versions both reported, and issue paths naming the exact position.

## 5. VersionedArvoContract

- [x] 5.1 Create `src/ArvoContract/versioned/index.ts` with the class, its generics, and its fields — `type`, `version`, `uri`, `description`, `domain`, `metadata`, `input`, `outputs`, and the handler error exposed in emit shape.
- [x] 5.2 Add the `dataschema` getter returning `` `${uri}/${version}` ``, deriving rather than storing.
- [x] 5.3 Add constructor validation calling the shared version-level function, throwing `ArvoContractValidationError` on any issue, and freeze the instance plus its `metadata` and `outputs`.
- [x] 5.4 Add `tests/ArvoContract/versioned.spec.ts`: standalone construction accepted and rejected on the same rules as within a container, `dataschema` composition, handler error availability including when `outputs` is empty, and immutability.

## 6. ArvoContract

- [x] 6.1 Create `src/ArvoContract/index.ts` with the class, its generics, and its fields — `type`, `uri`, `description`, `domain`, `metadata`, `versions`.
- [x] 6.2 Add constructor normalization and full validation across all versions before any `VersionedArvoContract` is constructed, throwing once with every issue.
- [x] 6.3 Materialize each version into a `VersionedArvoContract` carrying the container's identity fields, and freeze the instance, its `metadata`, and its `versions` map.
- [x] 6.4 Add `tests/ArvoContract/index.spec.ts`: minimal declaration and its defaults, `uri` derivation including multi-underscore and explicit override, per-version materialization and addressability, version isolation, and immutability.
- [x] 6.5 Add a test asserting a contract that declares successfully never produces a version that fails version-level validation.

## 7. Public surface

- [x] 7.1 Export `ArvoContract`, `VersionedArvoContract`, `ArvoContractValidationError`, and the parameter types from `src/index.ts`.
- [x] 7.2 Add a section to `ts/sandbox/src/playground.ts` declaring a contract, showing per-version `z.infer`, `dataschema`, the handler error, and a rejected declaration reporting several problems at once.

## 8. Close out

- [x] 8.1 **Delete** `src/proposal/` — the sketch is superseded by this implementation.
- [x] 8.2 Run `pnpm test --coverage`, `pnpm lint`, and `tsc --noEmit`; bring `src/ArvoContract/` to the 100% line and function coverage the rest of the package holds.

## 9. `type` as a prerequisite

- [x] 9.1 Give `ErrorIssue` an optional `blockingReason`, with `isBlocking` derived from it, so the issue that stopped the run is the thing that says so. `buildErrorIssueMessage` reads the list rather than taking a separate argument, and no error type carries a flag of its own.
- [x] 9.2 In `src/ArvoContract/validator.ts`, validate `type` before `normalize` derives anything, and return immediately with only that issue when it fails.
- [x] 9.3 **Delete** the three non-string-`type` placeholders now that nothing downstream can see an unusable `type`: the `''` fallback in `uri` derivation, and the `''` substitutions at both `checkVersionInterface` call sites. Not gated — removed.
- [x] 9.4 Apply the same ordering in `validateVersionedArvoContract`, which has the same structure and the same placeholder.
- [x] 9.5 Add tests: an invalid `type` yields exactly one issue; the message states the remaining rules did not run; no issue names `uri` when derivation could not happen; a supplied-but-invalid `uri` alongside a valid `type` still reports.
- [x] 9.6 Add the test that guards the narrowing: a **valid** `type` with faults in several other positions still reports every one of them. This is the property being traded against, so it is pinned rather than assumed.
- [x] 9.7 Update the existing multi-failure tests that use a malformed `type` as their aggregation example — the spec scenario now uses `domain`, and a test still asserting four issues from a bad `type` would contradict it.

## 10. Close out, again

- [x] 10.1 Re-run `pnpm test --coverage`, `pnpm lint`, and `tsc --noEmit`; hold `src/ArvoContract/` at 100% line and function coverage, including both sides of the new prerequisite gate.
- [x] 10.2 Exercise the new behaviour in `ts/sandbox/src/playground.ts`: a declaration rejected for its `type` showing the single issue and the stopped-early message.
