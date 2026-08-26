## ADDED Requirements

### Requirement: Parsing An Event Against A Version

A version contract SHALL determine whether an event matches one of the three shapes it declares — its `accepts`, one of its `emits`, or its handler error — and SHALL report which of the three matched.

#### Scenario: An event matching accepts
- **WHEN** an event whose `type` is the contract's `type` and whose payload satisfies that version's `accepts` is parsed
- **THEN** parsing succeeds
- **AND** the result reports the category as the accepted request

#### Scenario: An event matching a declared emit
- **WHEN** an event whose `type` is one of the version's `emits` keys and whose payload satisfies that emit's schema is parsed
- **THEN** parsing succeeds
- **AND** the result reports the category as an emit

#### Scenario: An event matching the handler error
- **WHEN** an event whose `type` is the version's handler error type and whose payload satisfies the handler error shape is parsed
- **THEN** parsing succeeds
- **AND** the result reports the category as the handler error

#### Scenario: The handler error is parsable for a version declaring no emits
- **WHEN** a version declaring an empty `emits` parses its handler error event
- **THEN** parsing succeeds

#### Scenario: An event matching none of the three
- **WHEN** an event whose `type` is none of the version's declared types is parsed
- **THEN** parsing fails
- **AND** the failure names the type it was given

### Requirement: A Parse Result Names The Version That Validated It

Every successful parse SHALL report the version whose declaration the event was checked against.

#### Scenario: A version contract reports its own version
- **WHEN** a version contract parses an event successfully
- **THEN** the result names that version

#### Scenario: A contract reports the version it selected
- **WHEN** a contract declaring several versions parses an event successfully
- **THEN** the result names the version the event belonged to, not the contract's other versions

### Requirement: Parsing An Event Against A Contract

A contract SHALL determine which of its declared versions an event belongs to from that event's `dataschema`, and SHALL then apply that version's own parsing rules.

The contract SHALL NOT apply parsing rules of its own beyond selecting the version, so that an event a contract accepts is exactly an event one of its versions accepts.

#### Scenario: The version is taken from the event
- **WHEN** a contract declaring versions `1.0.0` and `1.1.0` parses an event whose `dataschema` names version `1.1.0`
- **THEN** the event is checked against version `1.1.0`
- **AND** the result names version `1.1.0`

#### Scenario: A contract agrees with its own version
- **WHEN** the same event is parsed by a contract and by the version that contract would select
- **THEN** both succeed or both fail
- **AND** on success both report the same category

#### Scenario: An event from a contract this is not
- **WHEN** an event whose `dataschema` names a different contract's `uri` is parsed
- **THEN** parsing fails

#### Scenario: An event from a version this contract does not declare
- **WHEN** an event whose `dataschema` names a version the contract does not declare is parsed
- **THEN** parsing fails
- **AND** the failure names the versions the contract does declare

### Requirement: Asserting An Expected Type

A version contract SHALL accept an optional assertion of which type the caller expects, and SHALL confirm or contradict it.

The assertion SHALL be limited to what that version declares: its `type`, one of its `emits` keys, or its handler error type. An assertion naming anything else SHALL fail.

A contract SHALL NOT accept such an assertion, the version it would be checked against not yet being known.

#### Scenario: A correct assertion
- **WHEN** an event is parsed with an assertion naming the type the event actually carries
- **THEN** parsing succeeds

#### Scenario: An assertion the event contradicts
- **WHEN** an event is parsed with an assertion naming a type this version declares but the event does not carry
- **THEN** parsing fails
- **AND** the failure names both what was asserted and what was found

#### Scenario: An assertion the version does not declare
- **WHEN** an event is parsed with an assertion naming a type the version does not declare
- **THEN** parsing fails
- **AND** the failure identifies the assertion as the problem

#### Scenario: Parsing without an assertion
- **WHEN** an event is parsed with no assertion supplied
- **THEN** any of the version's three shapes may match
- **AND** the result reports which one did

### Requirement: Prerequisite Failures Report Distinct Positions

Four failures SHALL be reported before any payload is examined, and each SHALL identify a different position, so that they are distinguishable without reading the failure's wording:

- an assertion naming a type the version does not declare
- an event whose `dataschema` names a different contract
- an event whose `dataschema` names a version the contract does not declare
- an event whose `type` matches none of the version's declared shapes

Each SHALL state that the remaining rules were not evaluated.

#### Scenario: An undeclared assertion is attributed to the assertion
- **WHEN** parsing fails because the asserted type is not declared by the version
- **THEN** the reported position is the assertion, not the event

#### Scenario: A foreign contract is attributed to the identifier
- **WHEN** parsing fails because the event's `dataschema` names a different contract
- **THEN** the reported position identifies the contract identifier within `dataschema`

#### Scenario: An unknown version is attributed to the version
- **WHEN** parsing fails because the event's `dataschema` names an undeclared version
- **THEN** the reported position identifies the version within `dataschema`

#### Scenario: An unmatched type is attributed to the type
- **WHEN** parsing fails because the event's `type` matches none of the version's declared shapes
- **THEN** the reported position is the event's type

#### Scenario: The four are not interchangeable
- **WHEN** each of the four failures occurs in turn
- **THEN** each reports a position distinct from the other three

#### Scenario: Nothing further is evaluated
- **WHEN** any of the four occurs
- **THEN** the failure states that the remaining rules did not run

### Requirement: An Unmatched Type Stops Before The Payload

Where the event's `type` matches none of the version's declared shapes, the system SHALL NOT examine the payload, no shape having been selected to examine it against.

#### Scenario: A bad payload is not reported alongside an unmatched type
- **WHEN** an event carrying an undeclared type and a payload no shape would accept is parsed
- **THEN** the failure names the unmatched type
- **AND** reports no failure of the payload

### Requirement: Payload Failures Are Reported Together, As The Schema Reported Them

Where a shape has been selected and the payload does not satisfy it, the system SHALL report every rule the payload broke rather than only the first.

Each SHALL identify the position within the payload that broke, as the schema identified it, and SHALL carry the schema's own account of what was wrong rather than a restatement of it.

#### Scenario: A payload failure names its position
- **WHEN** an event whose type matches but whose payload violates that schema is parsed
- **THEN** the failure identifies the offending position within the payload

#### Scenario: A payload breaking several rules
- **WHEN** an event's payload breaks more than one of the selected shape's rules
- **THEN** every one of them is reported

#### Scenario: A position nested within the payload
- **WHEN** the rule that broke is on a value nested inside the payload
- **THEN** the reported position names that nested value, not the payload as a whole

### Requirement: A Parsed Event Carries The Contract's Declared Defaults

On success the system SHALL return an event whose payload includes any value the matched schema declares as a default and the incoming event omitted.

The incoming event SHALL NOT be altered.

#### Scenario: An omitted default is present afterwards
- **WHEN** an event omitting a field the matched schema defaults is parsed
- **THEN** the returned event's payload carries that default

#### Scenario: A supplied value is not replaced by a default
- **WHEN** an event supplies a value for a field the matched schema defaults
- **THEN** the returned event's payload carries the supplied value

#### Scenario: The event that was parsed is unchanged
- **WHEN** an event is parsed
- **THEN** the event that was supplied is the same afterwards as before

### Requirement: A Parsed Event Satisfies Every Event Rule

An event returned by parsing SHALL satisfy every structural rule an event is required to satisfy, so that parsing cannot produce an event that could not have been constructed directly.

#### Scenario: The returned event is a well-formed event
- **WHEN** an event is parsed successfully
- **THEN** the returned event satisfies the same structural rules as any other event

#### Scenario: Identity is carried across
- **WHEN** an event is parsed successfully
- **THEN** the returned event carries the same `id`, `subject`, `source`, `type` and `dataschema` as the event supplied

### Requirement: Non-Throwing Primitive, Throwing Convenience

The system SHALL provide, on both a contract and a version contract, a primitive reporting its outcome as a value rather than raising, and a companion that raises on failure and returns the value directly on success. The companion SHALL contain no logic beyond unwrapping the primitive.

#### Scenario: The primitive does not raise
- **WHEN** the primitive is called and the event cannot be parsed
- **THEN** the outcome is reported as a value rather than raised

#### Scenario: The companion raises what the primitive reported
- **WHEN** the companion is called and the primitive would report a failure
- **THEN** the companion raises that same failure

#### Scenario: Both agree
- **WHEN** the same event is given to both
- **THEN** they agree on success or failure
- **AND** on success both produce the same result

### Requirement: Every Parse Failure Is Reported As One Kind Of Failure

The system SHALL report every parse failure, from either a contract or a version contract, as a single kind of failure carrying the positions that broke. It SHALL NOT vary the kind of failure by what went wrong.

Within that failure, the position SHALL distinguish a caller's own request from the event they supplied: an assertion the version does not declare is reported at the assertion, and every other failure is reported at a position on the event.

#### Scenario: The same kind of failure for a request problem and an event problem
- **WHEN** parsing fails because the asserted type is not declared, and again because the event's payload does not satisfy its schema
- **THEN** both are reported as the same kind of failure

#### Scenario: A contract and a version contract fail alike
- **WHEN** parsing fails on a contract and on a version contract
- **THEN** both report the same kind of failure

#### Scenario: The caller's own request is identifiable by position
- **WHEN** parsing fails because the asserted type is not declared by the version
- **THEN** the reported position is the assertion

#### Scenario: An event problem is identifiable by position
- **WHEN** parsing fails because the event is addressed elsewhere, carries an undeclared type, or carries a payload its schema rejects
- **THEN** the reported position is on the event, not on the assertion
