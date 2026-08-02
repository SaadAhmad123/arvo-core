## 1. Shared value types

- [ ] 1.1 In `src/types.ts`, align the JSON type family's names and documentation with ADR-001's value vocabulary — scalar, object, JSON value, flat map
- [ ] 1.2 In `src/types.ts`, add a flat-map type for scalar-only string-keyed maps so ambient context is not spelled inline in several places
- [ ] 1.3 **DELETE** `NoKnownKeys` from `src/types.ts` — it exists solely to police the removed `extensions` field
- [ ] 1.4 Confirm nothing outside `src/ArvoEvent/` references the deleted type

## 2. Errors

- [ ] 2.1 In `src/ArvoEvent/errors.ts`, keep the existing discriminant and cause-chaining shape
- [ ] 2.2 In `src/ArvoEvent/errors.ts`, establish the message conventions the Diagnostic Quality requirement demands — field name, value received, rule violated, and for cross-field rules why the combination is illegal
- [ ] 2.3 In `src/ArvoEvent/errors.ts`, support reporting several field-level failures in one message rather than only the first

## 3. Payload walk

- [ ] 3.1 Add a module under `src/ArvoEvent/` that walks a value against the JSON value domain and reports the path to any offending value
- [ ] 3.2 Reject non-finite numbers at any depth
- [ ] 3.3 Reject values outside the JSON domain — functions, symbols, arbitrary-precision integers
- [ ] 3.4 Treat undefined as absent: omit the key within a map, substitute null within an array so later positions do not shift
- [ ] 3.5 Detect reference cycles and report them as cycles rather than exhausting memory
- [ ] 3.6 Enforce that the payload's top level is a map, not an array or scalar
- [ ] 3.7 Enforce that ambient context is flat and scalar-valued
- [ ] 3.8 Deep-freeze as the walk unwinds, so immutability costs no second traversal

## 4. Validator

- [ ] 4.1 **REPLACE** `src/ArvoEvent/validator.ts` entirely — the current schema encodes the superseded design and is not adapted
- [ ] 4.2 Reject unrecognised keys, permitting only the span alongside the eighteen fields
- [ ] 4.3 Non-empty string rules for `id`, `subject`, `executionid`, `source`, `type`, `dataschema`
- [ ] 4.4 Null-or-non-empty rules for `parentid`, `initid`, `category`, `to`, `domain` — note `domain` currently has no non-empty check
- [ ] 4.5 `depth` as a non-negative integer; `time` as RFC 3339 with an offset
- [ ] 4.6 **REMOVE** the non-negative constraint on `executionunits`; require finite with no constraint on sign
- [ ] 4.7 **REMOVE** the minimum-length check on `tracestate`; leave both trace fields entirely unvalidated
- [ ] 4.8 **REPLACE** the rootness rule: one-directional on `parentid`, deleting the existing biconditional over `depth` and `rootsubject` rather than adapting it
- [ ] 4.9 Add the completion correlation constraint, one-directional from `category` to `initid`
- [ ] 4.10 Compose the payload walk from section 3
- [ ] 4.11 Order the stages per the design — unrecognised keys, field rules, cross-field rules, payload walk — aggregating field-level failures

## 5. Input types

- [ ] 5.1 In `src/ArvoEvent/types.ts`, redefine the input shape over the eighteen fields, with `dataschema` now required
- [ ] 5.2 Add `executionid`, `initid`, `category` to `src/ArvoEvent/types.ts`
- [ ] 5.3 **DELETE** `extensions` and `rootsubject` from `src/ArvoEvent/types.ts`
- [ ] 5.4 Tighten the payload generic's constraint toward a JSON object while keeping ordinary interfaces assignable
- [ ] 5.5 Preserve the discriminated union making a span mutually exclusive with raw trace values
- [ ] 5.6 **REWRITE** every documentation comment in `src/ArvoEvent/types.ts` — several describe superseded semantics, in particular the ambient-context comment licensing handlers to append keys, which ADR-001's write-once rule forbids

## 6. Event class

- [ ] 6.1 In `src/ArvoEvent/index.ts`, declare the eighteen fields and no others
- [ ] 6.2 **DELETE** the `extensions` and `rootsubject` fields and the second constructor parameter carrying extensions
- [ ] 6.3 Apply the defaults — generated `id`, `executionid` from `subject`, `depth` zero, empty ambient context, current `time`, null elsewhere
- [ ] 6.4 Retain span-derived trace context, which ADR-001 explicitly permits at creation
- [ ] 6.5 Add the trusted-input option, skipping only the payload walk and its deep freeze
- [ ] 6.6 Shallow-freeze the instance on every path, including the trusted one
- [ ] 6.7 **REPLACE** the serialization try/catch with the walk from section 3
- [ ] 6.8 **REWRITE** the class and field documentation in `src/ArvoEvent/index.ts` against ADR-001

## 7. Events arriving as data

- [ ] 7.1 Add an entry point under `src/ArvoEvent/` accepting plain data and reporting validity rather than raising
- [ ] 7.2 Run the identical validation core as creation — no second schema
- [ ] 7.3 Document that it validates structure only and is not a wire-format decoder

## 8. Exports

- [ ] 8.1 In `src/index.ts`, export the new types and the data-admitting entry point
- [ ] 8.2 **REMOVE** exports for deleted types from `src/index.ts`
- [ ] 8.3 Confirm the public surface exposes nothing referencing removed fields

## 9. Tests

- [ ] 9.1 **REPLACE** `tests/ArvoEvent/index.spec.ts` wholesale — its 542 lines target the superseded shape
- [ ] 9.2 A block per field's rules
- [ ] 9.3 Root constraint, covering the permitted cases as well as the forbidden ones — a caused event at depth zero, and a caused event whose `executionid` equals `subject`. An implementation rejecting these has recreated the biconditional ADR-001 argues against
- [ ] 9.4 Correlation constraint, including the permitted case of a non-null `initid` with no `category`
- [ ] 9.5 Strictness — unrecognised keys, removed fields, camelCase typos
- [ ] 9.6 Payload validity — non-finite values nested several levels deep, reference cycles, values outside the JSON domain, a non-map top level
- [ ] 9.7 Undefined handling — omitted map keys, array elements becoming null with positions preserved, equivalence with serialization
- [ ] 9.8 Immutability — field assignment and nested payload mutation both ineffective
- [ ] 9.9 Trusted input — the payload walk is skipped, field and cross-field rules still enforced
- [ ] 9.10 Diagnostics — messages name field, value, and rule, and several field failures aggregate
- [ ] 9.11 Acceptance test — an event built from only the required fields, taking every default, is a well-formed root event

## 10. Close out

- [ ] 10.1 `pnpm lint`, `pnpm test`, `pnpm build` all clean
- [ ] 10.2 Changeset for a major release
- [ ] 10.3 Release notes state that conformance is structural only, since propagation remains unenforced while `src/factory/` is untouched
- [ ] 10.4 `openspec validate rebuild-arvoevent-structure --strict`
