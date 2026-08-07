# Known Issues

This document records confirmed gaps in the paused Python foundation. The package is unpublished and its API remains unsettled, but these issues still matter because the implemented capabilities claim conformance with the shared Arvo ADRs and have already been archived into `openspec/specs/`.

The existing test suite has 100% statement and branch coverage. These findings are missing cases or incorrect assumptions within covered code, demonstrating that coverage alone does not establish behavioral conformance.

## Resolve Before Publication

### 1. `data` does not enforce the JSON value domain

- **Severity:** High
- **Area:** [`src/arvo_core/event/util.py`](src/arvo_core/event/util.py)
- **Observed:** `ArvoEvent` accepts arbitrary objects, sets, tuples, datetimes, and bytes inside `data`. Some values are silently transformed by Pydantic serialization; an arbitrary `object()` raises `PydanticSerializationError` from `serialize`.
- **Impact:** Violates ADR-001's JSON-value domain and the serialization capability's claim that every structurally valid event serializes successfully.
- **Direction:** Replace the finite-number-only walk with recursive JSON-domain validation and normalization, with tests for unsupported objects, cycles, arrays, map keys, and non-finite numbers.

### 2. Explicit falsey `executionid` values are defaulted

- **Severity:** High
- **Area:** [`src/arvo_core/event/model.py`](src/arvo_core/event/model.py)
- **Observed:** `executionid=""`, `executionid=0`, and `executionid=False` are replaced with `subject` and accepted.
- **Impact:** Invalid explicit input bypasses required-string validation.
- **Direction:** Apply the default only when the field is absent, or when an explicitly documented null-defaulting rule permits it; preserve other supplied values for validation.

### 3. Timestamp validation accepts values outside RFC 3339

- **Severity:** High
- **Area:** [`src/arvo_core/event/util.py`](src/arvo_core/event/util.py)
- **Observed:** `datetime.fromisoformat` accepts ISO week dates, a space instead of `T`, comma fractional separators, and offsets containing seconds.
- **Impact:** Events outside ADR-001's timestamp domain construct successfully.
- **Direction:** Use an RFC 3339-specific parser or constrain syntax before parsing, while retaining the required UTC-offset check.

### 4. Negative zero is not normalized

- **Severity:** High
- **Area:** [`src/arvo_core/event/model.py`](src/arvo_core/event/model.py)
- **Observed:** `executionunits=-0.0` remains negative zero in the event, while CloudEvent conversion canonicalizes it to positive zero.
- **Impact:** Violates ADR-002's construction-time normalization rule and changes the stored value across a round trip.
- **Direction:** Normalize either signed zero to positive zero during `ArvoEvent` construction.

### 5. Malformed content-type parameters can pass strict discrimination

- **Severity:** High
- **Area:** [`src/arvo_core/cloudevent/codecs.py`](src/arvo_core/cloudevent/codecs.py)
- **Observed:** Bare parameters are ignored and duplicate names overwrite earlier entries. Values such as `application/vnd.arvo.event+json;garbage;version=1` and duplicate `version` parameters are accepted.
- **Impact:** Contradicts ADR-003's requirement for exactly one `version=1` parameter and no others.
- **Direction:** Reject malformed, empty, and duplicate parameter segments before constructing the parsed parameter map.

### 6. Large finite JSON integers can leak `OverflowError`

- **Severity:** Medium
- **Area:** [`src/arvo_core/event/util.py`](src/arvo_core/event/util.py)
- **Observed:** Applying `math.isfinite` to an integer such as `10**309` raises `OverflowError` while converting it to binary64.
- **Impact:** A valid finite JSON integer is rejected through an unwrapped implementation exception.
- **Direction:** Treat Python integers as finite directly and call `math.isfinite` only for floating-point values.

### 7. Pydantic coercion weakens field-domain validation

- **Severity:** Medium
- **Area:** [`src/arvo_core/event/model.py`](src/arvo_core/event/model.py)
- **Observed:** Examples include `depth=True`, `depth="1"`, `executionunits="1.5"`, and byte strings being coerced into accepted field values.
- **Impact:** Runtime trust boundaries do not consistently distinguish JSON booleans, strings, and numbers as the ADR field domains require.
- **Direction:** Adopt strict field types or targeted `mode="before"` validators, then document any intentional coercions explicitly.

### 8. CloudEvent wire parsing applies producer-side defaults

- **Severity:** High
- **Area:** [`src/arvo_core/serializer/deserialize.py`](src/arvo_core/serializer/deserialize.py)
- **Observed:** `CloudEvent.model_validate` synthesizes missing `id`, `specversion`, and `time`. Malformed wire can therefore acquire a random identity and current timestamp, and a supplied fallback `time` can be ignored.
- **Impact:** Deserialization can silently manufacture required wire attributes rather than rejecting or applying foreign-event fallback rules.
- **Direction:** Validate required wire attributes on the parsed mapping before constructing the SDK model, or use a parsing path that does not apply producer defaults.

### 9. Non-standard JSON constants can be accepted

- **Severity:** Medium
- **Area:** [`src/arvo_core/serializer/deserialize.py`](src/arvo_core/serializer/deserialize.py)
- **Observed:** Python's `json.loads` accepts `NaN` and infinities by default. A `NaN` placed in an ignored foreign CloudEvent extension can survive parsing without reaching ArvoEvent payload validation.
- **Impact:** Input documented as invalid JSON can deserialize successfully.
- **Direction:** Reject non-standard constants through `parse_constant` and wrap the resulting failure in `ArvoEventSerializerError`.

### 10. Some serializer errors do not preserve a cause

- **Severity:** Low
- **Area:** [`src/arvo_core/serializer/deserialize.py`](src/arvo_core/serializer/deserialize.py)
- **Observed:** Top-level arrays and scalars raise `ArvoEventSerializerError` with `.__cause__ is None`.
- **Impact:** This differs from the serializer specification's general cause-preservation contract.
- **Direction:** Create and chain an underlying type/value error, or narrow the documented cause guarantee for failures with no originating exception.

## CI Gap

### 11. Python CI does not run for pull requests targeting `v4`

- **Severity:** High for this branch; configuration-dependent afterward
- **Area:** [`../../.github/workflows/ci-py.yml`](../../.github/workflows/ci-py.yml)
- **Observed:** The workflow listens only for pull requests whose base branch is `main`, while this foundation PR targets `v4`.
- **Impact:** The new Python checks do not run on the pull request that introduces them.
- **Direction:** Include `v4` while it is an active integration target, or change the repository's branch flow so the workflow executes before merge.

## Resumption Process

When Python work resumes:

1. Reproduce each unresolved item with a focused test.
2. Determine whether the fix changes an archived capability's specified behavior.
3. Use a new OpenSpec change for behavioral corrections rather than editing archived history silently.
4. Update this file as issues are resolved, linking the relevant change or commit.
5. Run lint, formatting, type checking, tests, coverage, package build, and a clean-environment installation check before considering publication.
