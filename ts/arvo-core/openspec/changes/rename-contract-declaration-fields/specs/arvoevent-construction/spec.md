## MODIFIED Requirements

### Requirement: Building The Event A Version Takes In

The system SHALL build, from a version of a contract, the event that version takes in.

Its type and its dataschema SHALL be the version's own, and a caller SHALL NOT supply either.

Its recipient SHALL default to the contract's type, that being the type whose handler accepts the event, and a supplied recipient SHALL be kept.

#### Scenario: Type and dataschema come from the version
- **WHEN** an event is built for a version of a contract
- **THEN** its type is the contract's type
- **AND** its dataschema is that version's dataschema

#### Scenario: The recipient defaults to the accepting handler
- **WHEN** an event is built for a version with no recipient supplied
- **THEN** its recipient is the contract's type

#### Scenario: A supplied recipient wins
- **WHEN** an event is built for a version with a recipient supplied
- **THEN** it carries the supplied recipient

### Requirement: Building An Event A Version Puts Out

The system SHALL build, from a version of a contract, any event that version declares it emits, the caller naming which one.

Only a type that version declares among its emitted events SHALL be accepted. Its dataschema SHALL be the version's own.

No recipient SHALL be defaulted: where an emitted event goes is the caller's to state.

#### Scenario: An emitted event
- **WHEN** an event is built for a type the version declares it emits
- **THEN** its type is that type
- **AND** its dataschema is that version's dataschema

#### Scenario: The payload is judged by that type's own declaration
- **WHEN** an event is built for one of two declared emitted types
- **THEN** the payload is checked against the declaration of the type named, not of the other

#### Scenario: A type the version does not emit
- **WHEN** an event is built for a type the version does not declare among its emitted events
- **THEN** building fails
- **AND** the failure reports the type as the position, naming the types that version does declare

#### Scenario: A version declaring no emitted events
- **WHEN** an event is built for any type against a version declaring no emitted events
- **THEN** building fails
- **AND** the failure states that the version declares none

#### Scenario: No recipient is invented
- **WHEN** an event is built for an emitted type with no recipient supplied
- **THEN** it carries no recipient

#### Scenario: The handler error is not among the emitted events
- **WHEN** an event is built for a version's handler error type as though it were an emitted event
- **THEN** building fails, the handler error not being a declared emitted event
