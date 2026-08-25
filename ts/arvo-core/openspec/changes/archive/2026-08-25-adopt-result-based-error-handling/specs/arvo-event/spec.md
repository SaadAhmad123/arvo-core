## MODIFIED Requirements

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

### Requirement: Construction-Time Validity

The system SHALL establish structural validity before an event is exposed to a caller through either means of creating one. A structurally invalid event SHALL NOT come into existence.

An event already in hand SHALL NOT require rechecking.

#### Scenario: Invalid input never yields an event
- **WHEN** input violates any structural rule, through either means of creating an event
- **THEN** no event is produced
