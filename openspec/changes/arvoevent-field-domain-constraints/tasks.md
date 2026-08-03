## 1. Character-domain check

- [x] 1.1 In `src/ArvoEvent/validator.ts`, add a helper that checks a non-empty string for the forbidden code points: C0 controls (U+0000–U+001F), `DEL` (U+007F), C1 controls (U+0080–U+009F), Unicode noncharacters (U+FDD0–U+FDEF and the last two code points of every plane), and unpaired UTF-16 surrogates — iterating by code point (`for...of` / `Array.from`), not by UTF-16 code unit, per `design.md`
- [x] 1.2 Return enough detail from the helper (the offending code point, or an indication of which class it violates) for the diagnostic message in step 3.2 to name it specifically

## 2. URI-reference check

- [x] 2.1 In `src/ArvoEvent/validator.ts`, add a helper that checks a non-empty string against RFC 3986's `URI-reference` grammar, accepting a hierarchical path, a bare relative token, a fragment-only reference, and an absolute URI, and rejecting whitespace and raw non-ASCII byte sequences — do not use the platform `URL` constructor for this check; see `design.md` for why
- [x] 2.2 No normalization or rewriting: a value that satisfies the grammar passes through unchanged, and a value that does not fails construction rather than being percent-encoded into validity

## 3. Validator integration

- [x] 3.1 In `src/ArvoEvent/validator.ts`, apply the character-domain check (task 1) to `id`, `parentid`, `initid`, `subject`, `executionid`, `category`, `source`, `to`, `domain`, `type`, `dataschema`, `traceparent`, and `tracestate`, skipping null values for the nullable fields among them
- [x] 3.2 **REPLACE** the comment `// traceparent and tracestate are deliberately unvalidated — no check here.` — they are no longer fully unvalidated; state precisely what's still unvalidated (format and content) versus what now applies (the character-domain check)
- [x] 3.3 Apply the URI-reference check (task 2) to `source` and `dataschema`, in addition to their existing non-empty-string check
- [x] 3.4 Confirm field-level failures still aggregate rather than stopping at the first one — both new checks report through the same `issues` array the existing checks already use

## 4. Execution units normalization

- [x] 4.1 In `src/ArvoEvent/validator.ts` (or wherever defaults are applied — see `design.md`), normalize a supplied `executionunits` of `-0` to `0` before the value is returned from `validateArvoEvent`
- [x] 4.2 Confirm this runs whether the event is constructed directly or admitted as plain data, since both paths share `validateArvoEvent`
- [x] 4.3 Update the doc comment on `checkExecutionUnits` (or wherever the domain is documented) to state the domain as finite IEEE 754 binary64, not merely "a finite number" — no new rejection behavior follows from this in a JavaScript runtime, only the documentation and the normalization in 4.1

## 5. Tests

- [x] 5.1 In `tests/ArvoEvent/validator.spec.ts`, add cases for the character-domain check: one per forbidden class (C0 control, `DEL`, C1 control, BMP noncharacter, a noncharacter in a non-BMP plane, an unpaired high surrogate, an unpaired low surrogate) against at least one nullable and one required field, not a representative sample
- [x] 5.2 Add a case confirming the character-domain check is skipped for a null nullable field, and is not applied to strings nested inside `data` or `baggage`
- [x] 5.3 Add cases for the URI-reference check: a hierarchical path, a bare token, a fragment-only reference, and an absolute URI all accepted for both `source` and `dataschema`; whitespace and a raw non-ASCII sequence rejected for both
- [x] 5.4 Add cases for `traceparent`/`tracestate`: an arbitrary non-empty value with no forbidden code points still accepted without further format validation; a forbidden code point rejected
- [x] 5.5 Add cases for `executionunits`: `-0` normalized to `0` on both the direct-construction and admit-as-data paths; a large finite magnitude still accepted; existing finite/non-finite cases unchanged
- [x] 5.6 In `tests/ArvoEvent/index.spec.ts`, add at least one end-to-end construction case per new rule, confirming `ArvoEventValidationError` names the field and the violated rule per the existing Diagnostic Quality convention
- [x] 5.7 **NOT DONE — found unnecessary.** Audited `tests/ArvoEvent/` (no fixture needed a change — every existing value already satisfied the new rules; the full suite passed unmodified before any test was added) and `tests/factory/` (all 18 failures are `dataschema: is required`, the pre-existing breakage the ADR-001 rebuild change already documented as separate and out of scope — unrelated to URI-reference or character-domain rules, so nothing here to fix under this change)

## 6. Close out

- [x] 6.1 `pnpm lint` clean (25 files, no fixes needed beyond what was already applied per-file during implementation)
- [x] 6.2 **NOT fully clean project-wide, by design.** `pnpm test`: 6/7 files, 381/399 tests pass; the 18 failures in `tests/factory/index.spec.ts` are all `dataschema: is required`. `pnpm build`: `src/factory/index.ts` references the removed `rootsubject` field, and `src/factory/types.ts` imports `JSONPrimitive`/`NoKnownKeys`, neither exported since the ADR-001 rebuild. Identical error set before and after this change's edits — confirmed by running both prior to touching any file. This is the same pre-existing, separately-tracked `src/factory/` breakage the ADR-001 rebuild change's own tasks.md (§10.1) already documented as a release prerequisite outside that change's scope, not a regression introduced here. Everything this change touches — `src/ArvoEvent/validator.ts` and its tests — is clean in isolation (`pnpm exec vitest run tests/ArvoEvent tests/utils.spec.ts`: 6/6 files, 381/381 pass)
- [x] 6.3 `pnpm exec openspec validate arvoevent-field-domain-constraints --strict` — passes
- [x] 6.4 No changeset added — this change merges into `v4`, which is not being released imminently; see `design.md`
