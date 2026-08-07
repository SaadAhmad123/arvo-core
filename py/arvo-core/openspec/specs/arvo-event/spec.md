# arvo-event Specification

## Purpose
The ArvoEvent is the sole medium through which Arvo participants interact, so every node in an application must be able to agree on whether one is well formed. This capability defines the event's field set, its defaults, and its structural validity — properties of a single event, checkable without a contract, a store, or any other event — as ADR-001 (amended by ADR-002) requires, implemented idiomatically for Python.
## Requirements
### Requirement: Field Set

An ArvoEvent SHALL consist of exactly eighteen fields and no others: `id`, `parentid`, `initid`, `subject`, `executionid`, `category`, `depth`, `source`, `to`, `domain`, `type`, `data`, `dataschema`, `baggage`, `time`, `traceparent`, `tracestate`, `executionunits`.

#### Scenario: Event exposes exactly the defined fields
- **WHEN** an event is constructed successfully
- **THEN** it carries all eighteen fields and no additional field

#### Scenario: An unrecognized key is rejected
- **WHEN** construction input carries a key that is not a defined field
- **THEN** construction raises `ArvoEventValidationError` naming the offending key

### Requirement: Required Inputs

The system SHALL require `subject`, `source`, `type`, `data`, and `dataschema` to be supplied.

#### Scenario: All required inputs supplied
- **WHEN** an author supplies `subject`, `source`, `type`, `data`, and `dataschema`
- **THEN** construction succeeds

#### Scenario: A required input is omitted
- **WHEN** any required input is absent
- **THEN** construction raises `ArvoEventValidationError` naming the missing field

### Requirement: Defaulted Inputs

The system SHALL default `id` to a randomly generated globally unique value, `executionid` to the value of `subject`, `depth` to `0`, `baggage` to an empty map, `time` to the current instant (RFC 3339, UTC, `Z`-suffixed), and `parentid`, `initid`, `category`, `to`, `domain`, `traceparent`, `tracestate`, and `executionunits` to `None`.

#### Scenario: Minimal construction yields a well-formed root event
- **WHEN** an event is constructed from only the required inputs, taking every default
- **THEN** construction succeeds, `parentid` is `None`, `executionid` equals `subject`, and `depth` is `0`

#### Scenario: Generated identifiers are distinct
- **WHEN** two events are constructed without an explicit `id`
- **THEN** their `id` values differ

#### Scenario: Default time is Z-suffixed, not offset-suffixed
- **WHEN** an event is constructed without an explicit `time`
- **THEN** the resulting `time` ends in `Z`, not `+00:00` or any other numeric offset

### Requirement: Immutability

An ArvoEvent SHALL be immutable once constructed.

#### Scenario: Field assignment after construction fails
- **WHEN** a caller attempts to assign to any field of an already-constructed event
- **THEN** the assignment raises an error and the event's fields are unchanged

### Requirement: URI-Reference Domain for `source` and `dataschema`

`source` and `dataschema` SHALL each be a non-empty string satisfying RFC 3986's URI-reference grammar, in exactly RFC 3986 §6.2.2 canonical form. A value satisfying the grammar but not already in canonical form SHALL be rejected, not normalized.

#### Scenario: A canonical URI-reference is accepted
- **WHEN** `source` (or `dataschema`) is `"api/users"`, `"order-service"`, `"https://example.com/"`, or `"#/contracts/user"`
- **THEN** construction succeeds with the value unchanged

#### Scenario: A non-canonical but grammatically valid value is rejected
- **WHEN** `source` (or `dataschema`) is grammatically a valid URI-reference but not in canonical form (e.g. a mixed-case scheme, a non-canonical percent-encoding, or an unresolved dot-segment)
- **THEN** construction raises `ArvoEventValidationError` naming the field, without silently normalizing the value

#### Scenario: A malformed value is rejected
- **WHEN** `source` (or `dataschema`) is not a valid URI-reference at all
- **THEN** construction raises `ArvoEventValidationError` naming the field

### Requirement: String Character-Domain Exclusion

Every ArvoEvent string field held to the CloudEvents `String` domain (`id`, `type`, `subject`, `traceparent`, `tracestate`, and this package's own string fields with no CloudEvents-native attribute) SHALL exclude control characters (U+0000–U+001F, U+007F–U+009F), Unicode noncharacters, and unpaired UTF-16 surrogates.

#### Scenario: A control character is rejected
- **WHEN** any CloudEvents-`String`-domain field contains a control character
- **THEN** construction raises `ArvoEventValidationError` naming the field

### Requirement: Finite Binary64 `executionunits`

`executionunits`, when not `None`, SHALL be a finite number.

#### Scenario: A finite value is accepted
- **WHEN** `executionunits` is any finite number, of any sign or magnitude
- **THEN** construction succeeds

#### Scenario: A non-finite value is rejected
- **WHEN** `executionunits` is `NaN`, positive infinity, or negative infinity
- **THEN** construction raises `ArvoEventValidationError` naming the field

### Requirement: JSON Validity of `data` and `baggage`

Every numeric value within `data`, at any depth, and every value within `baggage`, SHALL be finite. `baggage` SHALL be a flat map of scalars, with no nesting at any depth.

#### Scenario: A non-finite number nested in data is rejected
- **WHEN** `data` contains `NaN`, positive infinity, or negative infinity at any depth
- **THEN** construction raises `ArvoEventValidationError` identifying the offending path

#### Scenario: A nested value in baggage is rejected
- **WHEN** `baggage` contains a value that is itself an object or array, at any depth
- **THEN** construction raises `ArvoEventValidationError` naming the offending key

### Requirement: Root Event Rule

When `parentid` is `None`, `executionid` SHALL equal `subject` and `depth` SHALL be `0`.

#### Scenario: A root event satisfies the rule by default
- **WHEN** an event is constructed with `parentid` omitted (or explicitly `None`) and no explicit `executionid`/`depth`
- **THEN** `executionid` equals `subject` and `depth` is `0`

#### Scenario: An inconsistent root event is rejected
- **WHEN** `parentid` is `None` but an explicit `executionid` not equal to `subject`, or an explicit `depth` not equal to `0`, is supplied
- **THEN** construction raises `ArvoEventValidationError`

### Requirement: Completion Correlation Rule

When `category` is `"io.arvo.complete"`, `initid` SHALL be non-`None`.

#### Scenario: A completion without initid is rejected
- **WHEN** `category` is `"io.arvo.complete"` and `initid` is `None`
- **THEN** construction raises `ArvoEventValidationError`

### Requirement: OpenTelemetry Span-Derived Trace Context

The system SHALL NOT validate `traceparent` or `tracestate`'s format or content beyond the character-domain restriction placed on every CloudEvents-`String`-domain field. The system SHALL provide a standalone function deriving W3C `traceparent`/`tracestate` header strings from an OpenTelemetry `Span` or `SpanContext`, for a caller to pass into `ArvoEvent` construction explicitly.

#### Scenario: Arbitrary trace values are accepted
- **WHEN** `traceparent` or `tracestate` carries a value of any shape that excludes the restricted code points
- **THEN** construction succeeds with the value unchanged

#### Scenario: Trace context is derived from a Span or SpanContext
- **WHEN** the trace-context helper is called with an OpenTelemetry `Span` or `SpanContext`
- **THEN** it returns a `traceparent` string in W3C format and a `tracestate` string (or `None` if the span carries no trace state)

#### Scenario: No trace context supplied
- **WHEN** neither `traceparent`/`tracestate` nor a span is supplied to `ArvoEvent` construction
- **THEN** both fields default to `None`

### Requirement: Error Reporting Preserves the Original Cause

The system SHALL report every construction failure as `ArvoEventValidationError`, a message naming what failed, and the original underlying error preserved and reachable (via Python's native exception chaining), never `pydantic.ValidationError` raised directly to the caller.

#### Scenario: A validation failure is wrapped, not passed through raw
- **WHEN** construction fails for any reason under this capability
- **THEN** the raised error is `ArvoEventValidationError`, and its `__cause__` is the original error that caused the failure

#### Scenario: A caller does not need to import Pydantic to handle a validation failure
- **WHEN** a caller catches `ArvoEventValidationError`
- **THEN** every attribute needed to identify and act on the failure is available without importing or referencing `pydantic` directly

