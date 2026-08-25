# arvo-event Specification

## Purpose

The ArvoEvent is the sole medium through which Arvo participants interact, so every node in an application must be able to agree on whether one is well formed. This capability defines the event's field set, its defaults, and its structural validity — properties of a single event, checkable without a contract, a store, or any other event.

## Requirements

### Requirement: Field Set

An ArvoEvent SHALL consist of exactly eighteen fields and no others: `id`, `parentid`, `initid`, `subject`, `executionid`, `category`, `depth`, `source`, `to`, `domain`, `type`, `data`, `dataschema`, `baggage`, `time`, `traceparent`, `tracestate`, `executionunits`.

The system SHALL NOT provide any general-purpose facility for attaching data outside this set.

#### Scenario: Event exposes exactly the defined fields
- **WHEN** an event is constructed successfully
- **THEN** it carries all eighteen fields
- **AND** it carries no additional field

### Requirement: Required Inputs

The system SHALL require `subject`, `source`, `type`, `data`, and `dataschema` to be supplied.

#### Scenario: All required inputs supplied
- **WHEN** an author supplies `subject`, `source`, `type`, `data`, and `dataschema`
- **THEN** construction succeeds

#### Scenario: A required input is omitted
- **WHEN** any required input is absent
- **THEN** construction fails
- **AND** the failure names the missing field

### Requirement: Defaulted Inputs

The system SHALL default `id` to a randomly generated globally unique value, `executionid` to the value of `subject`, `depth` to `0`, `baggage` to an empty map, `time` to the current instant, and `parentid`, `initid`, `category`, `to`, `domain`, `traceparent`, `tracestate`, and `executionunits` to null.

#### Scenario: Minimal construction yields a well-formed root event
- **WHEN** an event is constructed from only the required inputs, taking every default
- **THEN** construction succeeds
- **AND** `parentid` is null
- **AND** `executionid` equals `subject`
- **AND** `depth` is `0`

#### Scenario: Generated identifiers are distinct
- **WHEN** two events are constructed without an explicit `id`
- **THEN** their `id` values differ

### Requirement: Strict Input Rejection

The system SHALL reject input containing any key that is not a defined field, except for an input-only value supplying trace context from a span.

#### Scenario: Unrecognised key
- **WHEN** input carries a key that is not a defined field
- **THEN** construction fails
- **AND** the failure names the offending key

#### Scenario: Misspelled field name
- **WHEN** input carries `parentId` rather than `parentid`
- **THEN** construction fails
- **AND** the event is not silently treated as a root event

#### Scenario: Field removed from the envelope
- **WHEN** input carries `extensions` or `rootsubject`
- **THEN** construction fails
- **AND** the failure identifies the field as no longer part of the event

### Requirement: Non-Empty String Fields

The system SHALL require `id`, `subject`, `executionid`, `source`, `type`, and `dataschema` to be non-empty strings.

#### Scenario: Empty value for a required string
- **WHEN** any of these fields is an empty string
- **THEN** construction fails
- **AND** the failure names the field

### Requirement: Source and Dataschema Format

The system SHALL require `source` and `dataschema` to satisfy the URI-reference grammar defined by RFC 3986.

The system SHALL NOT require either value to be dereferenceable, resolvable, or backed by any real resource.

The system SHALL reject a value that satisfies the grammar but is not already in the canonical form RFC 3986 §6.2.2 ("Syntax-Based Normalization") defines: a scheme or host differing in case from its canonical lowercase form, a percent-encoded octet using lowercase hex digits or unnecessarily encoding an unreserved character, or a path containing an unresolved `.` or `..` segment.

The system is NOT REQUIRED to reject a value solely for carrying non-canonical scheme-based normalization (RFC 3986 §6.2.3, e.g. an explicit default port) — RFC 3986 states this class of normalization is optional and scheme-specific, not a property every URI-reference shares.

#### Scenario: Hierarchical path accepted
- **WHEN** `source` or `dataschema` is a hierarchical path such as `api/users`
- **THEN** construction succeeds

#### Scenario: Bare token accepted
- **WHEN** `source` or `dataschema` is a bare token such as `order-service`
- **THEN** construction succeeds

#### Scenario: Fragment-only reference accepted
- **WHEN** `source` or `dataschema` is a fragment-only reference such as `#/contracts/user`
- **THEN** construction succeeds

#### Scenario: Absolute URI accepted
- **WHEN** `source` or `dataschema` is a full absolute URI such as `https://arvo.land/contracts/user`
- **THEN** construction succeeds

#### Scenario: Value violating URI-reference syntax rejected
- **WHEN** `source` or `dataschema` contains whitespace or a raw non-ASCII byte sequence
- **THEN** construction fails
- **AND** the failure names the field and the URI-reference rule it violates

#### Scenario: Grammatically valid but non-canonical scheme or host casing rejected
- **WHEN** `source` or `dataschema` has a scheme or host differing in case from its canonical lowercase form
- **THEN** construction fails, even though the value satisfies the URI-reference grammar

#### Scenario: Grammatically valid but unresolved dot-segment rejected
- **WHEN** `source` or `dataschema` contains a `.` or `..` path segment that has not been resolved
- **THEN** construction fails, even though the value satisfies the URI-reference grammar

#### Scenario: Grammatically valid but non-canonical percent-encoding rejected
- **WHEN** `source` or `dataschema` contains a percent-encoded octet using lowercase hex digits, or a percent-encoded octet that unnecessarily encodes an unreserved character
- **THEN** construction fails, even though the value satisfies the URI-reference grammar

### Requirement: String Field Character Domain

The system SHALL require `id`, `parentid`, `initid`, `subject`, `executionid`, `category`, `source`, `to`, `domain`, `type`, `dataschema`, `traceparent`, and `tracestate`, when non-null, to contain none of: a C0 control character (U+0000–U+001F), `DEL` (U+007F), a C1 control character (U+0080–U+009F), a Unicode noncharacter (U+FDD0–U+FDEF, or either of the last two code points of any plane), or an unpaired UTF-16 surrogate (a code unit in the U+D800–U+DFFF range with no matching pair).

The system SHALL NOT apply this restriction to string values nested within `data` or `baggage`.

#### Scenario: Ordinary identifier accepted
- **WHEN** every top-level string field contains only printable, non-surrogate characters
- **THEN** construction succeeds

#### Scenario: Control character rejected
- **WHEN** any of these fields contains a C0 or C1 control character
- **THEN** construction fails
- **AND** the failure names the field and the offending code point

#### Scenario: Unicode noncharacter rejected
- **WHEN** any of these fields contains a Unicode noncharacter
- **THEN** construction fails

#### Scenario: Unpaired surrogate rejected
- **WHEN** any of these fields contains a UTF-16 code unit in the surrogate range with no matching pair
- **THEN** construction fails

#### Scenario: Restriction does not apply to nested payload strings
- **WHEN** `data` or `baggage` contains a string value with a control character at any depth
- **THEN** construction succeeds

### Requirement: Nullable String Fields

The system SHALL require `parentid`, `initid`, `category`, `to`, and `domain` to be either null or a non-empty string.

#### Scenario: Null accepted
- **WHEN** any of these fields is null or absent
- **THEN** construction succeeds

#### Scenario: Empty string rejected
- **WHEN** any of these fields is an empty string
- **THEN** construction fails
- **AND** the failure distinguishes an empty value from an absent one

### Requirement: Nesting Level

The system SHALL require `depth` to be a non-negative integer.

#### Scenario: Valid nesting level
- **WHEN** `depth` is `0` or a positive integer
- **THEN** construction succeeds

#### Scenario: Invalid nesting level
- **WHEN** `depth` is negative, fractional, or not a number
- **THEN** construction fails

### Requirement: Timestamp Validity

The system SHALL require `time` to be an RFC 3339 timestamp carrying a UTC offset.

The system SHALL NOT treat `time` as authoritative for ordering.

#### Scenario: Timestamp carrying an offset
- **WHEN** `time` carries a UTC offset
- **THEN** construction succeeds

#### Scenario: Timestamp without an offset
- **WHEN** `time` is a valid date carrying no UTC offset
- **THEN** construction fails

### Requirement: Root Event Constraint

When `parentid` is null, the system SHALL require that `executionid` equals `subject` and that `depth` is `0`.

The system SHALL NOT treat either condition as implying that an event is a root event. An event carrying either condition alongside a non-null `parentid` SHALL be accepted.

#### Scenario: Root event satisfying both conditions
- **WHEN** `parentid` is null, `executionid` equals `subject`, and `depth` is `0`
- **THEN** construction succeeds

#### Scenario: Root event at a non-zero nesting level
- **WHEN** `parentid` is null and `depth` is greater than `0`
- **THEN** construction fails

#### Scenario: Root event with a divergent execution identity
- **WHEN** `parentid` is null and `executionid` differs from `subject`
- **THEN** construction fails

#### Scenario: Caused event at nesting level zero
- **WHEN** `parentid` is non-null and `depth` is `0`
- **THEN** construction succeeds

#### Scenario: Caused event whose execution identity equals the workflow identifier
- **WHEN** `parentid` is non-null and `executionid` equals `subject`
- **THEN** construction succeeds

### Requirement: Completion Correlation Constraint

When `category` is `io.arvo.complete`, the system SHALL require `initid` to be non-null.

The system SHALL NOT require any particular `category` when `initid` is non-null.

#### Scenario: Completion carrying its correlation
- **WHEN** `category` is `io.arvo.complete` and `initid` is non-null
- **THEN** construction succeeds

#### Scenario: Completion missing its correlation
- **WHEN** `category` is `io.arvo.complete` and `initid` is null
- **THEN** construction fails
- **AND** the failure explains that a completion must name the request it answers

#### Scenario: Correlation without a declared category
- **WHEN** `initid` is non-null and `category` is null
- **THEN** construction succeeds

### Requirement: Open Classification

The system SHALL accept any non-empty string as `category` and SHALL NOT restrict it to the values Arvo recognises.

The system SHALL NOT use `category` to resolve behaviour, route an event, or override any other field.

#### Scenario: Classification defined by a domain
- **WHEN** `category` carries a value outside the `io.arvo.` namespace
- **THEN** construction succeeds
- **AND** no ecosystem meaning is attached to the value

### Requirement: Payload Structure

The system SHALL require `data` to be a string-keyed map whose values are, recursively, scalars, arrays of JSON values, or further string-keyed maps of JSON values.

The system SHALL determine payload validity by membership of the JSON value domain, and SHALL NOT determine it by whether serialization raises an error.

#### Scenario: Nested payload
- **WHEN** `data` contains nested maps and arrays of JSON values
- **THEN** construction succeeds

#### Scenario: Payload that is not a map
- **WHEN** `data` is an array or a scalar
- **THEN** construction fails

#### Scenario: Value outside the JSON domain
- **WHEN** `data` contains a function, symbol, or arbitrary-precision integer at any depth
- **THEN** construction fails
- **AND** the failure identifies the path to the offending value

#### Scenario: Reference cycle
- **WHEN** `data` contains a reference cycle
- **THEN** construction fails
- **AND** the failure reports a cycle rather than exhausting available memory

### Requirement: Custom Serialization via `toJSON`

When a value that is not itself a JSON value has a callable `toJSON` method, whether declared on the value itself or inherited through its prototype chain, the system SHALL invoke it and evaluate its return value against the JSON value domain in the original value's place, at the same path.

The system SHALL apply this at any depth, in both map and array position.

#### Scenario: A value with `toJSON` is accepted
- **WHEN** `data` contains, at any depth, a value that is not a JSON value but has a `toJSON` method returning one
- **THEN** construction succeeds
- **AND** the constructed payload carries the return value of `toJSON` in that position

#### Scenario: `toJSON`'s return value is still invalid
- **WHEN** a value's `toJSON` method returns something that is not a JSON value
- **THEN** construction fails
- **AND** the failure identifies the same path the original value occupied

#### Scenario: `toJSON` throws
- **WHEN** invoking a value's `toJSON` method raises an error
- **THEN** construction fails
- **AND** the failure is reported as a validation issue at that path rather than escaping as an uncaught exception

#### Scenario: A value with no `toJSON` is rejected as before
- **WHEN** `data` contains a value that is not a JSON value and has no callable `toJSON` method
- **THEN** construction fails, exactly as for any other value outside the JSON domain

### Requirement: Ambient Context Structure

The system SHALL require `baggage` to be a string-keyed map whose values are all scalars, with no nesting at any depth.

#### Scenario: Flat scalar map
- **WHEN** `baggage` contains only string, number, boolean, and null values
- **THEN** construction succeeds

#### Scenario: Nested ambient context
- **WHEN** any `baggage` value is a map or an array
- **THEN** construction fails
- **AND** the failure names the offending key

### Requirement: Undefined Value Handling

The system SHALL treat an undefined value as absent rather than as a validation failure, so that payloads assembled from optional properties construct without friction.

Within a map, the system SHALL omit any key whose value is undefined. Within an array, the system SHALL substitute null for any undefined element, since omitting it would shift the position of every later element.

#### Scenario: Undefined map value omitted
- **WHEN** `data` contains a key whose value is undefined
- **THEN** construction succeeds
- **AND** the constructed payload does not carry that key

#### Scenario: Undefined array element becomes null
- **WHEN** `data` contains an array with an undefined element
- **THEN** construction succeeds
- **AND** that element is null in the constructed payload
- **AND** every other element keeps its position

#### Scenario: Undefined ambient context value omitted
- **WHEN** `baggage` contains a key whose value is undefined
- **THEN** construction succeeds
- **AND** the constructed ambient context does not carry that key

#### Scenario: Result matches serialization
- **WHEN** an event carrying undefined values is constructed
- **THEN** its payload is identical to what serializing the supplied input would have produced

### Requirement: Numeric Finiteness

The system SHALL require every number anywhere within an event to be finite, covering `executionunits`, every value in `baggage`, and every number at any depth within `data`.

#### Scenario: Non-finite accounting value
- **WHEN** `executionunits` is infinite or not a number
- **THEN** construction fails

#### Scenario: Non-finite value nested in the payload
- **WHEN** `data` contains an infinite or not-a-number value at any depth
- **THEN** construction fails
- **AND** the failure identifies the path to the offending value

### Requirement: Unconstrained Accounting Value

The system SHALL require `executionunits`, when non-null, to be a finite IEEE 754 binary64 value, placing no further constraint on its sign or magnitude, and SHALL attach no interpretation to its value.

#### Scenario: Negative accounting value
- **WHEN** `executionunits` is negative
- **THEN** construction succeeds

#### Scenario: Large finite magnitude accepted
- **WHEN** `executionunits` is a large finite value within binary64's representable range
- **THEN** construction succeeds

### Requirement: Negative Zero Normalization

The system SHALL normalize a supplied `executionunits` value of negative zero to positive zero at construction.

#### Scenario: Negative zero normalized
- **WHEN** `executionunits` is supplied as `-0`
- **THEN** the constructed event's `executionunits` is `0`
- **AND** the two are indistinguishable by every means the event exposes

### Requirement: Unvalidated Trace Context

The system SHALL NOT validate `traceparent` or `tracestate`'s format or content, beyond the character-domain restriction placed on every top-level string field.

The system SHALL NOT populate either field automatically, and MAY derive both from a span supplied at the moment of creation.

#### Scenario: Arbitrary trace values accepted
- **WHEN** `traceparent` or `tracestate` carries a value of any shape that excludes the restricted code points
- **THEN** construction succeeds

#### Scenario: Trace context derived from a span
- **WHEN** a span is supplied at creation
- **THEN** `traceparent` and `tracestate` are derived from it

#### Scenario: Trace context absent by default
- **WHEN** neither trace values nor a span are supplied
- **THEN** `traceparent` and `tracestate` are null

### Requirement: Construction-Time Validity

The system SHALL establish structural validity before an event is exposed to a caller through either means of creating one. A structurally invalid event SHALL NOT come into existence.

An event already in hand SHALL NOT require rechecking.

#### Scenario: Invalid input never yields an event
- **WHEN** input violates any structural rule, through either means of creating an event
- **THEN** no event is produced

### Requirement: Validity Of Events Arriving As Data

The system SHALL apply the identical structural rules wherever an event enters as data rather than as something already created.

The system SHALL provide a means that raises on failure and returns the event directly on success, for a caller that wants ordinary throw/catch. This means evaluates every structural rule exactly once.

The system SHALL provide a second means, built entirely on the first, that reports its outcome as a value representing success or failure rather than raising, for a caller that wants to inspect or recover from failure without exception handling. This second means SHALL contain no validation logic of its own — it invokes the first and converts a raised failure into the failure representation, a returned event into the success representation.

#### Scenario: Valid plain data, throwing means
- **WHEN** plain data satisfying every structural rule is admitted through the throwing means
- **THEN** the event is returned directly, with no exception raised

#### Scenario: Invalid plain data, throwing means
- **WHEN** plain data violating a structural rule is admitted through the throwing means
- **THEN** an exception is raised
- **AND** the exception carries an explanation of every structural rule violated

#### Scenario: Valid plain data, outcome as a value
- **WHEN** plain data satisfying every structural rule is admitted through the value-returning means
- **THEN** the returned value represents success
- **AND** the event it carries is indistinguishable from one produced by the throwing means

#### Scenario: Invalid plain data, outcome as a value
- **WHEN** plain data violating a structural rule is admitted through the value-returning means
- **THEN** the returned value represents failure
- **AND** the failure carries the same explanation the throwing means would have raised

#### Scenario: Both means agree
- **WHEN** the same plain data is admitted through both means
- **THEN** they agree on success or failure
- **AND** on success, both produce an event with identical field values

### Requirement: Trusted Input

The system SHALL validate payloads to their full depth by default.

The system SHALL provide an explicit means for a caller to assert that input is already trusted, which SHALL skip only full-depth payload validation and SHALL NOT skip field-level or cross-field validation.

#### Scenario: Default creation validates fully
- **WHEN** an event is created without asserting trust
- **THEN** the payload is validated to its full depth

#### Scenario: Trusted creation skips payload validation
- **WHEN** an event is created with trust asserted
- **THEN** the payload is not validated to depth

#### Scenario: Trusted creation still enforces field rules
- **WHEN** an event is created with trust asserted and violates a field or cross-field rule
- **THEN** creation fails

### Requirement: Runtime Immutability

The system SHALL make a created event immutable at runtime, including the contents of `data` and `baggage` to any depth.

#### Scenario: Field mutation has no effect
- **WHEN** an attempt is made to assign to any field of a created event
- **THEN** the event is unchanged

#### Scenario: Nested payload mutation has no effect
- **WHEN** an attempt is made to modify a value nested within `data` or `baggage`
- **THEN** the event is unchanged

### Requirement: Diagnostic Quality

Every validation failure SHALL name the field involved, the value received, and the rule violated. A failure arising from a rule spanning several fields SHALL explain why the combination is invalid.

Every validation failure SHALL preserve the underlying cause.

#### Scenario: Field failure is self-explanatory
- **WHEN** a field-level rule is violated
- **THEN** the failure names the field, the value received, and the rule
- **AND** a reader can correct the input without consulting the source

#### Scenario: Multiple field failures reported together
- **WHEN** one input violates several field-level rules
- **THEN** the failure reports all of them rather than only the first

#### Scenario: Cross-field failure explains the combination
- **WHEN** the root or correlation constraint is violated
- **THEN** the failure explains which combination of values is illegal and why
