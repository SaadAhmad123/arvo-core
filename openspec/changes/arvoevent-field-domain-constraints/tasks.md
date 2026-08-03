## 1. Character-domain check

- [ ] 1.1 In `src/ArvoEvent/validator.ts`, add a helper that checks a non-empty string for the forbidden code points: C0 controls (U+0000–U+001F), `DEL` (U+007F), C1 controls (U+0080–U+009F), Unicode noncharacters (U+FDD0–U+FDEF and the last two code points of every plane), and unpaired UTF-16 surrogates — iterating by code point (`for...of` / `Array.from`), not by UTF-16 code unit, per `design.md`
- [ ] 1.2 Return enough detail from the helper (the offending code point, or an indication of which class it violates) for the diagnostic message in step 3.2 to name it specifically

## 2. URI-reference check

- [ ] 2.1 In `src/ArvoEvent/validator.ts`, add a helper that checks a non-empty string against RFC 3986's `URI-reference` grammar, accepting a hierarchical path, a bare relative token, a fragment-only reference, and an absolute URI, and rejecting whitespace and raw non-ASCII byte sequences — do not use the platform `URL` constructor for this check; see `design.md` for why
- [ ] 2.2 No normalization or rewriting: a value that satisfies the grammar passes through unchanged, and a value that does not fails construction rather than being percent-encoded into validity

## 3. Validator integration

- [ ] 3.1 In `src/ArvoEvent/validator.ts`, apply the character-domain check (task 1) to `id`, `parentid`, `initid`, `subject`, `executionid`, `category`, `source`, `to`, `domain`, `type`, `dataschema`, `traceparent`, and `tracestate`, skipping null values for the nullable fields among them
- [ ] 3.2 **REPLACE** the comment `// traceparent and tracestate are deliberately unvalidated — no check here.` — they are no longer fully unvalidated; state precisely what's still unvalidated (format and content) versus what now applies (the character-domain check)
- [ ] 3.3 Apply the URI-reference check (task 2) to `source` and `dataschema`, in addition to their existing non-empty-string check
- [ ] 3.4 Confirm field-level failures still aggregate rather than stopping at the first one — both new checks report through the same `issues` array the existing checks already use

## 4. Execution units normalization

- [ ] 4.1 In `src/ArvoEvent/validator.ts` (or wherever defaults are applied — see `design.md`), normalize a supplied `executionunits` of `-0` to `0` before the value is returned from `validateArvoEvent`
- [ ] 4.2 Confirm this runs whether the event is constructed directly or admitted as plain data, since both paths share `validateArvoEvent`
- [ ] 4.3 Update the doc comment on `checkExecutionUnits` (or wherever the domain is documented) to state the domain as finite IEEE 754 binary64, not merely "a finite number" — no new rejection behavior follows from this in a JavaScript runtime, only the documentation and the normalization in 4.1

## 5. Tests

- [ ] 5.1 In `tests/ArvoEvent/validator.spec.ts`, add cases for the character-domain check: one per forbidden class (C0 control, `DEL`, C1 control, BMP noncharacter, a noncharacter in a non-BMP plane, an unpaired high surrogate, an unpaired low surrogate) against at least one nullable and one required field, not a representative sample
- [ ] 5.2 Add a case confirming the character-domain check is skipped for a null nullable field, and is not applied to strings nested inside `data` or `baggage`
- [ ] 5.3 Add cases for the URI-reference check: a hierarchical path, a bare token, a fragment-only reference, and an absolute URI all accepted for both `source` and `dataschema`; whitespace and a raw non-ASCII sequence rejected for both
- [ ] 5.4 Add cases for `traceparent`/`tracestate`: an arbitrary non-empty value with no forbidden code points still accepted without further format validation; a forbidden code point rejected
- [ ] 5.5 Add cases for `executionunits`: `-0` normalized to `0` on both the direct-construction and admit-as-data paths; a large finite magnitude still accepted; existing finite/non-finite cases unchanged
- [ ] 5.6 In `tests/ArvoEvent/index.spec.ts`, add at least one end-to-end construction case per new rule, confirming `ArvoEventValidationError` names the field and the violated rule per the existing Diagnostic Quality convention
- [ ] 5.7 Audit existing fixtures across `tests/ArvoEvent/` and `tests/factory/` for `source`/`dataschema`/other string-field values that are no longer valid (non-URI-reference, containing a control character), and update them — this is expected fallout from the breaking change, not a regression to work around

## 6. Close out

- [ ] 6.1 `pnpm lint` clean
- [ ] 6.2 `pnpm test` and `pnpm build` clean, including `src/factory/` and its tests — do not reintroduce the pre-existing `src/factory/` breakage the ADR-001 rebuild change already documented as a separate, prerequisite concern; if this change's new rules newly break `src/factory/` fixtures, fix the fixtures, not the rules
- [ ] 6.3 `pnpm exec openspec validate arvoevent-field-domain-constraints --strict`
- [ ] 6.4 No changeset added — this change merges into `v4`, which is not being released imminently; see `design.md`
