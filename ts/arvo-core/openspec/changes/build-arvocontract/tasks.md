## 1. Shared groundwork

- [x] 1.1 **Move** `isUriReference` out of `src/ArvoEvent/validator.ts` into `src/utils/uri.ts` and export it; update `src/ArvoEvent/validator.ts` to import it. This relocates existing behaviour — the event validator's URI checking must be unchanged, verified by the existing `tests/ArvoEvent/validator.spec.ts` still passing untouched.
- [x] 1.2 Add `tests/utils/uri.spec.ts` covering `isUriReference` directly: canonical accept, non-canonical percent-encoding, wrong case, unresolved dot-segment, empty string.

## 2. Types

- [x] 2.1 Create `src/ArvoContract/types.ts` with `ArvoContractVersionParam` (`accepts`, `emits`), `ArvoContractVersionMapParam`, `ArvoContractParam`, and `VersionedArvoContractParam`, using `zod/v4/core` types for schema positions.
- [x] 2.2 Document on `ArvoContractVersionMapParam` that annotating a versions map with it collapses literal keys and loses per-version inference, per design.md — Risks.

## 3. Handler error

- [x] 3.1 Create `src/ArvoContract/handler-error.ts` with the payload schema as a single module-level frozen constant and a function deriving `handler_{type}_error` from `type`.
- [x] 3.2 Add `tests/ArvoContract/handler-error.spec.ts`: type derivation for single- and multi-segment `type`, payload shape, and that the schema instance is shared rather than rebuilt per call.

## 4. Validator

- [x] 4.1 Create `src/ArvoContract/errors.ts` with `ArvoContractValidationError` — `_tag`, frozen `issues`, message via `buildErrorIssueMessage`.
- [x] 4.2 Create `src/ArvoContract/validator.ts` with the identifier-grammar check used by `type`, `emits` keys, and `domain`.
- [x] 4.3 Add the contract-level checks to `src/ArvoContract/validator.ts`: `uri` non-empty and canonical via `src/utils/uri.ts`, `versions` non-empty, and every version key validated through `ArvoSemanticVersion.tryCheck` with its issues re-anchored under `versions.<key>`.
- [x] 4.4 Add the version-level check function to `src/ArvoContract/validator.ts`: `emits` key grammar, structural object-shape check on `accepts` and every emit, and collision of an `emits` key with `type` or the handler error type. This is the single function both classes call.
- [x] 4.5 Add normalization to `src/ArvoContract/validator.ts` — derive `uri` from `type`, default `description`/`domain` to null and `metadata` to `{}` — running before any check, and expose the entry point returning `{ value, issues }`.
- [x] 4.6 Add `tests/ArvoContract/validator.spec.ts` covering every rejection condition individually: each grammar violation, each version-key violation, non-object schemas, both collision cases, empty `versions`, empty and non-canonical `uri`.
- [x] 4.7 Extend `tests/ArvoContract/validator.spec.ts` with the multi-failure cases: several problems in one declaration reported together, problems in two versions both reported, and issue paths naming the exact position.

## 5. VersionedArvoContract

- [x] 5.1 Create `src/ArvoContract/versioned/index.ts` with the class, its generics, and its fields — `type`, `version`, `uri`, `description`, `domain`, `metadata`, `accepts`, `emits`, and the handler error exposed in emit shape.
- [x] 5.2 Add the `dataschema` getter returning `` `${uri}/${version}` ``, deriving rather than storing.
- [x] 5.3 Add constructor validation calling the shared version-level function, throwing `ArvoContractValidationError` on any issue, and freeze the instance plus its `metadata` and `emits`.
- [x] 5.4 Add `tests/ArvoContract/versioned.spec.ts`: standalone construction accepted and rejected on the same rules as within a container, `dataschema` composition, handler error availability including when `emits` is empty, and immutability.

## 6. ArvoContract

- [x] 6.1 Create `src/ArvoContract/index.ts` with the class, its generics, and its fields — `type`, `uri`, `description`, `domain`, `metadata`, `versions`.
- [x] 6.2 Add constructor normalization and full validation across all versions before any `VersionedArvoContract` is constructed, throwing once with every issue.
- [x] 6.3 Materialize each version into a `VersionedArvoContract` carrying the container's identity fields, and freeze the instance, its `metadata`, and its `versions` map.
- [x] 6.4 Add `tests/ArvoContract/index.spec.ts`: minimal declaration and its defaults, `uri` derivation including multi-underscore and explicit override, per-version materialization and addressability, version isolation, and immutability.
- [x] 6.5 Add a test asserting a contract that declares successfully never produces a version that fails version-level validation.

## 7. Public surface

- [ ] 7.1 Export `ArvoContract`, `VersionedArvoContract`, `ArvoContractValidationError`, and the parameter types from `src/index.ts`.
- [ ] 7.2 Add a section to `ts/sandbox/src/playground.ts` declaring a contract, showing per-version `z.infer`, `dataschema`, the handler error, and a rejected declaration reporting several problems at once.

## 8. Close out

- [ ] 8.1 **Delete** `src/proposal/` — the sketch is superseded by this implementation.
- [ ] 8.2 Run `pnpm test --coverage`, `pnpm lint`, and `tsc --noEmit`; bring `src/ArvoContract/` to the 100% line and function coverage the rest of the package holds.
- [ ] 8.3 Add a changeset describing the new capability.
