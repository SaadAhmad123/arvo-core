## 1. Shared value types

- [x] 1.1 In `src/types.ts`, align the JSON type family's names and documentation with ADR-001's value vocabulary — scalar, object, JSON value, flat map
- [x] 1.2 In `src/types.ts`, add a flat-map type for scalar-only string-keyed maps so ambient context is not spelled inline in several places
- [x] 1.3 **DELETE** `NoKnownKeys` from `src/types.ts` — it exists solely to police the removed `extensions` field
- [x] 1.4 Confirm nothing outside `src/ArvoEvent/` references the deleted type
- [x] 1.5 Write the TSDoc in `src/types.ts` for the package consumer — one line per alias, no provenance, no citation. Nothing in this file warrants one

## 2. Errors

- [x] 2.1 In `src/ArvoEvent/errors.ts`, keep the existing discriminant and cause-chaining shape
- [x] 2.2 In `src/ArvoEvent/errors.ts`, establish the message conventions the Diagnostic Quality requirement demands — field name, value received, rule violated, and for cross-field rules why the combination is illegal
- [x] 2.3 In `src/ArvoEvent/errors.ts`, support reporting several field-level failures in one message rather than only the first
- [x] 2.4 Write the TSDoc in `src/ArvoEvent/errors.ts` for the package consumer — that this error means the event is malformed rather than that contract validation failed, plus a `docs/adr/` citation. Not an explanation of what structural validity is

## 3. Payload walk

- [x] 3.1 Add a module under `src/ArvoEvent/` that walks a value against the JSON value domain and reports the path to any offending value
- [x] 3.2 Reject non-finite numbers at any depth
- [x] 3.3 Reject values outside the JSON domain — functions, symbols, arbitrary-precision integers
- [x] 3.4 Treat undefined as absent: omit the key within a map, substitute null within an array so later positions do not shift
- [x] 3.5 Detect reference cycles and report them as cycles rather than exhausting memory
- [x] 3.6 Enforce that the payload's top level is a map, not an array or scalar
- [x] 3.7 Enforce that ambient context is flat and scalar-valued
- [x] 3.8 Deep-freeze as the walk unwinds, so immutability costs no second traversal

## 4. Validator

- [x] 4.1 **REPLACE** `src/ArvoEvent/validator.ts` entirely — the current schema encodes the superseded design and is not adapted
- [x] 4.2 Reject unrecognised keys, permitting only the span alongside the eighteen fields
- [x] 4.3 Non-empty string rules for `id`, `subject`, `executionid`, `source`, `type`, `dataschema`
- [x] 4.4 Null-or-non-empty rules for `parentid`, `initid`, `category`, `to`, `domain` — note `domain` currently has no non-empty check
- [x] 4.5 `depth` as a non-negative integer; `time` as RFC 3339 with an offset
- [x] 4.6 **REMOVE** the non-negative constraint on `executionunits`; require finite with no constraint on sign
- [x] 4.7 **REMOVE** the minimum-length check on `tracestate`; leave both trace fields entirely unvalidated
- [x] 4.8 **REPLACE** the rootness rule: one-directional on `parentid`, deleting the existing biconditional over `depth` and `rootsubject` rather than adapting it
- [x] 4.9 Add the completion correlation constraint, one-directional from `category` to `initid`
- [x] 4.10 Compose the payload walk from section 3
- [x] 4.11 Order the stages per the design — unrecognised keys, field rules, cross-field rules, payload walk — aggregating field-level failures

## 5. Input types

- [x] 5.1 In `src/ArvoEvent/types.ts`, redefine the input shape over the eighteen fields, with `dataschema` now required
- [x] 5.2 Add `executionid`, `initid`, `category` to `src/ArvoEvent/types.ts`
- [x] 5.3 **DELETE** `extensions` and `rootsubject` from `src/ArvoEvent/types.ts`
- [x] 5.4 **NOT DONE — found unachievable.** Tightening `D`'s constraint beyond `Record<string, any>` rejects ordinary concrete interfaces; TypeScript only exempts a no-index-signature interface from a constraint's index signature when its value type is exactly `any`. See design.md, "The `data` generic's constraint stays `Record<string, any>`". Constraint left unchanged.
- [x] 5.5 Preserve the discriminated union making a span mutually exclusive with raw trace values
- [x] 5.6 **REWRITE** every documentation comment in `src/ArvoEvent/types.ts` — several describe superseded semantics, in particular the ambient-context comment licensing handlers to append keys, which is no longer permitted. Consumer-facing: state each field's rule and default, cite no reasoning

## 6. Event class

- [x] 6.1 In `src/ArvoEvent/index.ts`, declare the eighteen fields and no others
- [x] 6.2 **DELETE** the `extensions` and `rootsubject` fields and the second constructor parameter carrying extensions
- [x] 6.3 Apply the defaults — generated `id`, `executionid` from `subject`, `depth` zero, empty ambient context, current `time`, null elsewhere
- [x] 6.4 Retain span-derived trace context, which ADR-001 explicitly permits at creation
- [x] 6.5 Add the trusted-input option, skipping only the payload walk and its deep freeze
- [x] 6.6 Shallow-freeze the instance on every path, including the trusted one
- [x] 6.7 **REPLACE** the serialization try/catch with the walk from section 3
- [x] 6.8 **REWRITE** the class and field documentation in `src/ArvoEvent/index.ts` — consumer-facing, one `docs/adr/001-arvoevent-structure.md` citation on the class for the full field definitions
- [x] 6.9 Document the finiteness rule on `data`, `baggage`, and `executionunits` in `src/ArvoEvent/index.ts`, where a caller meets it, rather than on the value types

## 7. Events arriving as data

- [x] 7.1 Add an entry point under `src/ArvoEvent/` accepting plain data and reporting validity rather than raising
- [x] 7.2 Run the identical validation core as creation — no second schema
- [x] 7.3 Document that it validates structure only and is not a wire-format decoder

## 8. Exports

- [x] 8.1 In `src/index.ts`, export the new types and the data-admitting entry point
- [x] 8.2 **REMOVE** exports for deleted types from `src/index.ts`
- [x] 8.3 Confirm the public surface exposes nothing referencing removed fields

## 9. Tests

- [ ] 9.1 **REPLACE** `tests/ArvoEvent/index.spec.ts` wholesale — its 542 lines target the superseded shape
- [ ] 9.2 A block per field's rules
- [ ] 9.3 Root constraint, covering the permitted cases as well as the forbidden ones — a caused event at depth zero, and a caused event whose `executionid` equals `subject`. An implementation rejecting these has recreated the biconditional ADR-001 argues against
- [ ] 9.4 Correlation constraint, including the permitted case of a non-null `initid` with no `category`
- [ ] 9.5 Strictness — unrecognised keys, removed fields, camelCase typos
- [ ] 9.6 Payload validity, one test per rejected value class rather than a representative sample — `NaN` and `Infinity` at the top level, nested in an object, and nested in an array; a function, a symbol, and a bigint as an object property and as an array element; a `Date`, a `Map`, a `Set`, a `RegExp`, and a class instance; a non-map top level (array, string, number)
- [ ] 9.7 Cycle detection — a self-referential object, a self-referential array, mutual reference between two objects, and a value legitimately repeated in two branches without a cycle, which must be accepted
- [ ] 9.8 Undefined handling — an omitted map key, an array element becoming null with every other position preserved, equivalence between the constructed payload and serializing the original input
- [ ] 9.9 Deeply nested valid structures accepted without false rejection, exercising the walk's recursion in both directions
- [ ] 9.10 Path reporting — a failure several levels deep in `data` names the exact path, including array indices and non-identifier keys
- [ ] 9.11 Immutability — field assignment and nested payload mutation both ineffective
- [ ] 9.12 Trusted input — the payload walk is skipped, field and cross-field rules still enforced
- [ ] 9.13 Diagnostics — messages name field, value, and rule, and several field failures aggregate
- [ ] 9.14 Acceptance test — an event built from only the required fields, taking every default, is a well-formed root event

## 10. Close out

- [ ] 10.1 `pnpm lint`, `pnpm test`, `pnpm build` all clean
- [ ] 10.2 Changeset for a major release
- [ ] 10.3 Release notes state that conformance is structural only, since propagation remains unenforced while `src/factory/` is untouched
- [ ] 10.4 `openspec validate rebuild-arvoevent-structure --strict`
