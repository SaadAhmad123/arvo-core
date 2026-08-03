## MODIFIED Requirements

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

### Requirement: Unconstrained Accounting Value

The system SHALL require `executionunits`, when non-null, to be a finite IEEE 754 binary64 value, placing no further constraint on its sign or magnitude, and SHALL attach no interpretation to its value.

#### Scenario: Negative accounting value
- **WHEN** `executionunits` is negative
- **THEN** construction succeeds

#### Scenario: Large finite magnitude accepted
- **WHEN** `executionunits` is a large finite value within binary64's representable range
- **THEN** construction succeeds

## ADDED Requirements

### Requirement: Source and Dataschema Format

The system SHALL require `source` and `dataschema` to satisfy the URI-reference grammar defined by RFC 3986.

The system SHALL NOT require either value to be dereferenceable, resolvable, or backed by any real resource.

The system SHALL reject a value that satisfies the grammar but is not already in canonical form, specifically a scheme or host differing in case from its canonical lowercase form, or a path containing an unresolved `.` or `..` segment.

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

### Requirement: Negative Zero Normalization

The system SHALL normalize a supplied `executionunits` value of negative zero to positive zero at construction.

#### Scenario: Negative zero normalized
- **WHEN** `executionunits` is supplied as `-0`
- **THEN** the constructed event's `executionunits` is `0`
- **AND** the two are indistinguishable by every means the event exposes
