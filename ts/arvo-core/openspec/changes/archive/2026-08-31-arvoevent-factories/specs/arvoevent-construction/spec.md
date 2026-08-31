## ADDED Requirements

### Requirement: Building An Event From Its Fields

The system SHALL build an event from field values supplied by a caller, requiring the event's type, its payload, its source, and its dataschema, and SHALL default its subject to a value unique to that event.

Every other field SHALL be defaulted exactly as constructing an event directly defaults it, and no field SHALL be supplied a value the caller did not give where nothing else can know it.

#### Scenario: The required fields alone
- **WHEN** an event is built from a type, a payload, a source and a dataschema
- **THEN** it is built
- **AND** it carries a subject

#### Scenario: A subject of its own
- **WHEN** two events are built without a subject
- **THEN** each carries a different subject

#### Scenario: A supplied subject is kept
- **WHEN** an event is built with a subject supplied
- **THEN** it carries that subject

#### Scenario: A missing required field
- **WHEN** an event is built without a source
- **THEN** building fails

#### Scenario: Structural rules still apply
- **WHEN** an event is built with a field that breaks a structural rule of an event
- **THEN** building fails on that rule, as constructing the event directly would

### Requirement: Building The Event A Version Accepts

The system SHALL build, from a version of a contract, the event that version accepts.

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

### Requirement: Building An Event A Version Emits

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

### Requirement: Building A Version's Handler Error Event

The system SHALL build, from a version of a contract and an error, that version's handler error event.

Its type and the shape of its payload SHALL be the ones the version's own handler error declares, and SHALL NOT be derived a second time from the contract's type. Its dataschema SHALL be the version's own.

The payload SHALL be composed from the error — its name, its message, and its stack where it has one — so that a caller supplies the error rather than that shape.

No recipient SHALL be defaulted.

#### Scenario: The error becomes the payload
- **WHEN** a handler error event is built from an error
- **THEN** its payload carries that error's name and message
- **AND** its payload carries that error's stack

#### Scenario: An error without a stack
- **WHEN** a handler error event is built from an error carrying no stack
- **THEN** its payload reports no stack rather than omitting the field

#### Scenario: Type and dataschema come from the version
- **WHEN** a handler error event is built for a version of a contract
- **THEN** its type is that version's handler error type
- **AND** its dataschema is that version's dataschema

#### Scenario: Something that is not an error
- **WHEN** a handler error event is built from a value that is not an error
- **THEN** building fails rather than raising
- **AND** the failure reports the payload positions that could not be composed

### Requirement: A Payload Is Checked Before The Event Exists

Where an event is built from a version of a contract, the system SHALL check the payload against the declaration that version holds for that event, and SHALL NOT produce an event whose payload failed that check.

What the check produces SHALL be the event's payload, so that a value the declaration defaults is present on the built event even where the caller omitted it.

A failure SHALL report every position that broke, each naming the position within the payload and which of the version's declarations judged it.

#### Scenario: A payload the declaration accepts
- **WHEN** an event is built from a version with a payload its declaration accepts
- **THEN** the event is built

#### Scenario: A declared default reaches the event
- **WHEN** an event is built from a version whose declaration defaults a value the caller omitted
- **THEN** the built event's payload carries that default

#### Scenario: A supplied value is not replaced by a default
- **WHEN** an event is built from a version with a value supplied for a field its declaration defaults
- **THEN** the built event's payload carries the supplied value

#### Scenario: A payload the declaration rejects
- **WHEN** an event is built from a version with a payload its declaration rejects
- **THEN** building fails
- **AND** no event is produced

#### Scenario: Every broken position reported
- **WHEN** a payload breaks more than one rule of the declaration
- **THEN** every one of them is reported

#### Scenario: A position nested within the payload
- **WHEN** the rule that broke is on a value nested inside the payload
- **THEN** the reported position names that nested value beneath the payload

#### Scenario: The failure names which declaration judged it
- **WHEN** building fails because a payload was rejected
- **THEN** the failure states which of the version's declarations the payload was checked against

### Requirement: Cloning An Event

The system SHALL build an event carrying the same field values as an existing event, with any fields a caller replaces taking the replacement.

Every field SHALL be carried across, the event's identity and its time included.

Nothing SHALL be inferred from the relationship between the two: the causal fields SHALL be carried as they stand, and the clone SHALL NOT be made a descendant of its source.

The event cloned SHALL NOT be altered.

#### Scenario: Every field carried across
- **WHEN** an event is cloned with nothing replaced
- **THEN** the clone carries the same value as its source for every field, identity and time included

#### Scenario: A replaced field
- **WHEN** an event is cloned with a field replaced
- **THEN** the clone carries the replacement
- **AND** carries its source's value for every other field

#### Scenario: Causality is not inferred
- **WHEN** an event is cloned
- **THEN** the clone's causal fields are its source's, not values derived from it

#### Scenario: The source is untouched
- **WHEN** an event is cloned, with or without replacements
- **THEN** the event that was cloned is unchanged

#### Scenario: A clone that breaks a rule
- **WHEN** an event is cloned with a replacement that breaks a structural rule of an event
- **THEN** building fails on that rule

### Requirement: The Trace Context Of A Clone

Where an event is cloned, the system SHALL resolve the clone's trace context by precedence: a span supplied among the replacements first, then a trace header supplied among the replacements, then the header the cloned event carries.

A span SHALL replace the trace context whole, the cloned event's own contributing nothing. A supplied header SHALL replace only itself, the other being carried across.

#### Scenario: A span supplied among the replacements
- **WHEN** an event carrying a trace context is cloned with a span supplied
- **THEN** the clone's trace context is the one derived from that span

#### Scenario: A span replaces the trace context whole
- **WHEN** an event carrying both trace headers is cloned with a span carrying no trace state
- **THEN** the clone reports no trace state, rather than the cloned event's

#### Scenario: Both headers supplied
- **WHEN** an event carrying a trace context is cloned with both trace headers supplied
- **THEN** the clone carries both supplied headers

#### Scenario: One header supplied
- **WHEN** an event carrying both trace headers is cloned with only one of them supplied
- **THEN** the clone carries the supplied one
- **AND** carries the cloned event's own for the other

#### Scenario: Neither supplied
- **WHEN** an event carrying a trace context is cloned with no span and no trace header supplied
- **THEN** the clone carries the cloned event's trace context

#### Scenario: Nothing to carry and nothing supplied
- **WHEN** an event carrying no trace context is cloned with nothing supplied
- **THEN** the clone carries none

### Requirement: The Domain Of An Event Built From A Contract

Where an event is built from a version of a contract, the system SHALL accept for its domain either a value or a request to read one from a named source, and SHALL resolve any such request before the event exists.

A domain not supplied SHALL mean the event has no domain. A value supplied SHALL be used as it stands.

The sources a request may name SHALL be: no domain at all, the domain of the contract the event is built from, the domain of the contract of whoever is building it, and the domain of the event that caused it.

A request naming a source the caller did not supply SHALL resolve to no domain.

The built event's domain SHALL always be a plain value or absent; a request SHALL never reach the event.

#### Scenario: No domain supplied
- **WHEN** an event is built from a version of a contract declaring a domain, with no domain supplied
- **THEN** the built event has no domain

#### Scenario: A domain supplied outright
- **WHEN** an event is built with a domain value supplied
- **THEN** the built event carries that value

#### Scenario: Read from the contract the event is built from
- **WHEN** an event is built requesting the domain of the contract it is built from
- **THEN** the built event carries that contract's domain

#### Scenario: Read from a contract declaring no domain
- **WHEN** an event is built requesting the domain of a contract that declares none
- **THEN** the built event has no domain

#### Scenario: Read from the building contract
- **WHEN** an event is built requesting the domain of the building contract, and that contract is supplied
- **THEN** the built event carries that contract's domain

#### Scenario: Read from the causing event
- **WHEN** an event is built requesting the domain of the event that caused it, and that event is supplied
- **THEN** the built event carries that event's domain

#### Scenario: Requested from a source that was not supplied
- **WHEN** an event is built requesting a domain from a source the caller did not supply
- **THEN** the built event has no domain

#### Scenario: A request never reaches the event
- **WHEN** an event is built with any request for its domain
- **THEN** the built event's domain is a value or absent, never the request

### Requirement: Non-Throwing Primitive, Throwing Convenience

The system SHALL provide, for building an event and for every variant of it, a primitive reporting its outcome as a value rather than raising, and a companion that raises on failure and returns the event directly on success. The companion SHALL contain no logic beyond unwrapping the primitive.

Neither SHALL raise for any input a caller can supply: a failure to build SHALL always be reported through the outcome the caller asked for.

#### Scenario: The primitive does not raise
- **WHEN** the primitive is called and the event cannot be built
- **THEN** the outcome is reported as a value rather than raised

#### Scenario: The companion raises what the primitive reported
- **WHEN** the companion is called and the primitive would report a failure
- **THEN** the companion raises that same failure

#### Scenario: Both agree
- **WHEN** the same input is given to both
- **THEN** they agree on success or failure
- **AND** on success both produce an equivalent event

#### Scenario: No input raises from the primitive
- **WHEN** the primitive is given a payload, an error, or a type that it cannot use
- **THEN** the failure is reported rather than raised

### Requirement: Every Failure Is Reported As An Event Validation Failure

The system SHALL report every failure to build an event, whichever rule caught it, as the same kind of failure an event reports when it cannot be constructed. It SHALL NOT introduce a separate kind of failure for building.

#### Scenario: A structural failure and a payload failure alike
- **WHEN** building fails on a structural rule of an event, and again because a payload was rejected by a contract
- **THEN** both are reported as the same kind of failure

#### Scenario: One kind across every variant
- **WHEN** building fails in each variant in turn
- **THEN** each reports that same kind of failure

#### Scenario: Positions are preserved
- **WHEN** building fails
- **THEN** each reported position names the field or payload position that broke, as it would when constructing an event directly

### Requirement: An Event Built From A Contract Satisfies That Contract

An event the system builds from a version of a contract SHALL be an event that version accepts as its own, in the role the variant that built it implies.

#### Scenario: The accepted request
- **WHEN** an event built for what a version accepts is checked against that version
- **THEN** it matches, in the role of the accepted request

#### Scenario: An emitted event
- **WHEN** an event built for one of a version's emitted types is checked against that version
- **THEN** it matches, in the role of an emitted event

#### Scenario: The handler error
- **WHEN** an event built as a version's handler error is checked against that version
- **THEN** it matches, in the role of the handler error
