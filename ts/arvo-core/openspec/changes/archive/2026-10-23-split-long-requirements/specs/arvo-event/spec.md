## MODIFIED Requirements

### Requirement: Source and Dataschema Format

The system SHALL require `source` and `dataschema` to satisfy the URI-reference grammar defined by RFC 3986.

The system SHALL NOT require either value to be dereferenceable, resolvable, or backed by any real resource.

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

### Requirement: String Field Character Domain

The system SHALL require `id`, `parentid`, `initid`, `subject`, `executionid`, `category`, `source`, `to`, `domain`, `type`, `dataschema`, `traceparent`, and `tracestate`, when non-null, to contain none of: a C0 control character (U+0000–U+001F), `DEL` (U+007F), a C1 control character (U+0080–U+009F), a Unicode noncharacter (U+FDD0–U+FDEF, or either of the last two code points of any plane), or an unpaired UTF-16 surrogate (a code unit in the U+D800–U+DFFF range with no matching pair).

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

### Requirement: Validity Of Events Arriving As Data

The system SHALL apply the identical structural rules wherever an event enters as data rather than as something already created.

The system SHALL provide a means that raises on failure and returns the event directly on success, for a caller that wants ordinary throw/catch. This means evaluates every structural rule exactly once.

#### Scenario: Valid plain data, throwing means
- **WHEN** plain data satisfying every structural rule is admitted through the throwing means
- **THEN** the event is returned directly, with no exception raised

#### Scenario: Invalid plain data, throwing means
- **WHEN** plain data violating a structural rule is admitted through the throwing means
- **THEN** an exception is raised
- **AND** the exception carries an explanation of every structural rule violated

## ADDED Requirements

### Requirement: Source and Dataschema Canonical Form

The system SHALL reject a `source` or `dataschema` value that satisfies the URI-reference grammar but is not already in the canonical form RFC 3986 §6.2.2 ("Syntax-Based Normalization") defines: a scheme or host differing in case from its canonical lowercase form, a percent-encoded octet using lowercase hex digits or unnecessarily encoding an unreserved character, or a path containing an unresolved `.` or `..` segment.

#### Scenario: Grammatically valid but non-canonical scheme or host casing rejected
- **WHEN** `source` or `dataschema` has a scheme or host differing in case from its canonical lowercase form
- **THEN** construction fails, even though the value satisfies the URI-reference grammar

#### Scenario: Grammatically valid but unresolved dot-segment rejected
- **WHEN** `source` or `dataschema` contains a `.` or `..` path segment that has not been resolved
- **THEN** construction fails, even though the value satisfies the URI-reference grammar

#### Scenario: Grammatically valid but non-canonical percent-encoding rejected
- **WHEN** `source` or `dataschema` contains a percent-encoded octet using lowercase hex digits, or a percent-encoded octet that unnecessarily encodes an unreserved character
- **THEN** construction fails, even though the value satisfies the URI-reference grammar

### Requirement: Character Domain Does Not Apply To Nested Payload Strings

The system SHALL NOT apply the restriction of *String Field Character Domain* to string values nested within `data` or `baggage`.

#### Scenario: Restriction does not apply to nested payload strings
- **WHEN** `data` or `baggage` contains a string value with a control character at any depth
- **THEN** construction succeeds

### Requirement: Outcome Of Events Arriving As Data As A Value

The system SHALL provide a second means, built entirely on the means that raises on failure, that reports its outcome as a value representing success or failure rather than raising, for a caller that wants to inspect or recover from failure without exception handling. This second means SHALL contain no validation logic of its own — it invokes the means that raises on failure and converts a raised failure into the failure representation, a returned event into the success representation.

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
