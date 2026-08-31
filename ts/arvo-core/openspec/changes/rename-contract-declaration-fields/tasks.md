## 1. Records

- [x] 1.1 Amend `docs/adr/005-arvocontract-structure.md`: the version-definition table, the canonical-form prose, every rule stating a field by name, and the three example JSON documents. Leave the **Handler error** section's type pattern, dataschema rule and payload keys untouched — all three are model-level and none is renamed. Replaces existing text rather than adding to it.
- [x] 1.2 Reword the three capability specs: `arvo-contract`, `arvo-contract-serialization`, `arvoevent-construction`. Retitle the requirement and scenario headings that carry a field name — `Emit Key Collisions`, `Empty Emits`, `Building The Event A Version Accepts`, `Building An Event A Version Emits`, and the scenarios naming "no emits".

## 2. The canonical form

- [x] 2.1 `src/serializers/ArvoContractSerializer/serialize.ts`: the emitted object's key names, and the two warning-path templates.
- [x] 2.2 `src/serializers/ArvoContractSerializer/deserialize.ts`: the `CheckedForm` type describing parsed JSON, the reads off it, and two issue-path templates.
- [x] 2.3 `src/serializers/ArvoContractSerializer/form.ts`: three issue-path templates and the reads they guard.

## 3. The contract

- [x] 3.1 `src/ArvoContract/types.ts` — the two param fields, every `C['input']` / `keyof C['outputs']` in `ScopeOf`, `PayloadFor` and `AssertableType`, and the `scope` union.
- [x] 3.2 `src/ArvoContract/versioned/types.ts` and `versioned/index.ts` — the class fields, and `handlerError` → `error`. Watch the indexed accesses: `C['outputs']`, not `C['output']`.
- [x] 3.3 `src/ArvoContract/index.ts` — the container's materialization and the JSDoc examples.
- [x] 3.4 `src/ArvoContract/validator.ts` — three issue-path templates and the message naming what a contract already declares.
- [x] 3.5 `src/ArvoContract/assert.ts` — the scope literals returned and compared, and `checkAgainstVersion`'s parameters.

## 4. The factory

- [x] 4.1 `git mv accepted.ts input.ts` (`buildAccepted` → `buildInput`) and `emitted.ts output.ts` (`buildEmitted` → `buildOutput`).
- [x] 4.2 `factory.ts` — `createInput`/`tryCreateInput` and `createOutput`/`tryCreateOutput` replace the old four. `createError` unchanged.
- [x] 4.3 The labels a caller reads: `'input'`, `` `outputs[${type}]` ``, the undeclared-type message, and `'error payload'`.

## 5. Tests

- [x] 5.1 Declaration shapes across the contract, factory and serializer specs.
- [x] 5.2 The pinned strings — issue paths, message labels and `scope` values — updated, never loosened. They are what prove the rename reached the observable surface.
- [x] 5.3 Rename `accepted.spec.ts` / `emitted.spec.ts` to `input.spec.ts` / `output.spec.ts`, mirroring `src`.
- [x] 5.4 Restore the English verb in the test titles the rename made ungrammatical.

## 6. Documentation and the archive

- [x] 6.1 `ts/arvo-core/README.md` — the contract example.
- [x] 6.2 `ts/sandbox/src/playground.ts` — declaration shapes, property reads, and five reads of parsed canonical JSON that only work if the wire key moved. Requires `pnpm build` here then `pnpm install` in the sandbox.
- [x] 6.3 `openspec/changes/archive/**` — normalize the text in place, dated directory names unchanged, so no record anywhere names a field that does not exist.
- [x] 6.4 `py/arvo-core/**` — checked and nothing to do. Every occurrence there is the English verb, about `ArvoEvent` or `json.loads` accepting a value; the Python package names no contract field.

## 7. Close out

- [x] 7.1 `npx tsc --noEmit`, `pnpm lint`, `pnpm test:coverage` — 1141 tests and 100% on all four metrics. Coverage is what proves no renamed branch was dropped.
- [x] 7.2 `openspec validate --specs` and `openspec validate rename-contract-declaration-fields --strict`.
- [x] 7.3 Run the sandbox playground end to end, confirming the canonical-form sections read the renamed keys back out of parsed JSON.
- [x] 7.4 Grep the repository for `accepts`, `emits` and `handlerError` outside `src-v3/`. Every surviving hit must be ordinary English, ADR-005's untouched **Handler error** section, or one of the deliberately-kept `HandlerError*` names. Read them all rather than trusting the count.
- [x] 7.5 Confirm nothing behavioural changed: no test expectation was weakened, and the three model-level handler-error rules are exactly as ADR-005 had them.
