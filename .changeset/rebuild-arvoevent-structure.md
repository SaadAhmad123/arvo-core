---
"arvo-core": major
---

Rebuilds `ArvoEvent` to conform to [ADR-001](../docs/adr/001-arvoevent-structure.md), the accepted specification of the AAM 1 event envelope.

**Breaking changes:**

- `extensions` is removed. An open per-event extension map was rejected by ADR-001 as the second payload channel the envelope exists to prevent — anything a handler needs to communicate now travels in `data`, under a contract.
- `rootsubject` is removed. `subject` is now the workflow-wide constant directly; per-execution identity moved to the new `executionid` field.
- `dataschema` is now required. No legitimate event lacks a contract.
- Unrecognised keys in constructor input are now rejected, not silently dropped. A misspelled field name (`parentId` instead of `parentid`) previously produced a silently-wrong root event; it now throws, naming the offending key.
- `executionunits` no longer requires a non-negative value — any finite number is accepted, matching ADR-001's "no constraint on sign or magnitude."
- `tracestate` no longer requires a minimum length — both trace fields are entirely unvalidated, per ADR-001.
- The rootness rule changed from a biconditional (`depth === 0 ⟺ rootsubject === subject`) to ADR-001's one-directional constraint keyed on `parentid`. Two cases previously rejected are now correctly accepted: a caused event at depth 0, and a caused event whose `executionid` equals `subject` — both legitimate per the ADR.
- The constructor's second parameter is no longer `extensions` — it is now `{ skipPayloadValidation?: boolean }`.
- `JSONPrimitive` and `JSONRecord` are renamed to `JSONScalar` and `JSONObject`. `NoKnownKeys` is removed with no replacement.

**Added:**

- `executionid`, `initid`, and `category` — the three coordination fields ADR-001 introduces.
- The completion correlation constraint: an event whose `category` is `io.arvo.complete` must carry `initid`.
- `ArvoEvent.safeParse(input)` — validates plain data (from replay, a fixture, or a foreign producer) and reports the outcome rather than throwing.
- Full-depth validation of `data` and `baggage` against the JSON value domain, replacing a serializer try/catch that silently admitted non-finite numbers. An `undefined` value is treated as absent, matching JSON serialization semantics, so payloads built from optional TypeScript properties construct without friction.
- Runtime immutability: a constructed event, and its `data`/`baggage` contents, are frozen.
- An explicit trusted-input option (`skipPayloadValidation`) for callers who can assert their input is already well formed, for use on hot paths.
- Validation failures now name every broken rule together, with the field, the value received, and the rule violated — not just the first problem found.

**Conformance to ADR-001 is structural only.** This change implements the event's field set, defaults, and structural validity rules. It does not implement ADR-001's propagation table — the rules for how each field flows from a causing event to a caused one. `src/factory/` still merges `baggage` across a parent/child boundary where ADR-001 permits exactly one writer at the root, and still increments `depth` on every derived event where the ADR increments only when a new execution opens. Propagation is a separate change against the same capability.

**Known limitation, prerequisite to release:** independent of the propagation gap above, `src/factory/` also fails to build outright — it still constructs events using `rootsubject` and without `dataschema`, both removed or newly required by this change. Its 18 tests fail as a result. A follow-up fixing `src/factory/`'s field usage (a mechanical fix, distinct from the propagation change above) is required before this package can be published.
