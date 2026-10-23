## MODIFIED Requirements

### Requirement: Building A Version's Handler Error Event

The system SHALL build, from a version of a contract and an error, that version's handler error event.

The payload SHALL be composed from the error — its name, its message, and its stack where it has one — so that a caller supplies the error rather than the shape of its payload.

No recipient SHALL be defaulted.

#### Scenario: The error becomes the payload
- **WHEN** a handler error event is built from an error
- **THEN** its payload carries that error's name and message
- **AND** its payload carries that error's stack

#### Scenario: An error without a stack
- **WHEN** a handler error event is built from an error carrying no stack
- **THEN** its payload reports no stack rather than omitting the field

#### Scenario: Something that is not an error
- **WHEN** a handler error event is built from a value that is not an error
- **THEN** building fails rather than raising
- **AND** the failure reports the payload positions that could not be composed

### Requirement: A Payload Is Checked Before The Event Exists

Where an event is built from a version of a contract, the system SHALL check the payload against the declaration that version holds for that event, and SHALL NOT produce an event whose payload failed that check.

What the check produces SHALL be the event's payload, so that a value the declaration defaults is present on the built event even where the caller omitted it.

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

### Requirement: Mutating An Event

The system SHALL build, from an existing event and a set of replacements, the same event with each replaced field taking its replacement and every other field carried across, the event's identity and its time included. Any field an event is built from MAY be replaced, alone or with others.

The replacements SHALL be given in the shape an event is built from on its own. A replacement given as absent SHALL replace nothing.

#### Scenario: Nothing replaced

- **WHEN** an event is mutated with no replacements
- **THEN** the result carries the same value as the event for every field, identity and time included

#### Scenario: One field replaced

- **WHEN** an event is mutated with its recipient replaced
- **THEN** the result carries the new recipient
- **AND** carries the event's own value for every other field, identity and time included

#### Scenario: Several fields replaced at once

- **WHEN** an event is mutated with its recipient, its domain and its execution units replaced together
- **THEN** the result carries all three replacements
- **AND** carries the event's own value for every other field

#### Scenario: A replacement given as absent

- **WHEN** an event is mutated with its time given as absent
- **THEN** the result carries the event's own time, not a new one

#### Scenario: A mutation that breaks a rule

- **WHEN** an event is mutated with a replacement that breaks a structural rule of an event
- **THEN** building fails on that rule

### Requirement: The Trace Context Of A Mutation

Where an event is mutated, the system SHALL resolve the result's trace context by precedence: a span supplied among the replacements first, then a trace header supplied among the replacements, then the header the event carries.

A span SHALL replace the trace context whole, the event's own contributing nothing. A supplied header SHALL replace only itself, the other being carried across.

#### Scenario: A span supplied among the replacements
- **WHEN** an event carrying a trace context is mutated with a span supplied
- **THEN** the result's trace context is the one derived from that span
- **AND** every other field is the event's own, identity included

#### Scenario: A span replaces the trace context whole
- **WHEN** an event carrying both trace headers is mutated with a span carrying no trace state
- **THEN** the result reports no trace state, rather than the event's

#### Scenario: Both headers supplied
- **WHEN** an event carrying a trace context is mutated with both trace headers supplied
- **THEN** the result carries both supplied headers

#### Scenario: One header supplied
- **WHEN** an event carrying both trace headers is mutated with only one of them supplied
- **THEN** the result carries the supplied one
- **AND** carries the event's own for the other

#### Scenario: Neither supplied
- **WHEN** an event carrying a trace context is mutated with no span and no trace header supplied
- **THEN** the result carries the event's trace context

#### Scenario: Nothing to carry and nothing supplied
- **WHEN** an event carrying no trace context is mutated with nothing trace-related supplied
- **THEN** the result carries none

### Requirement: The Domain Of An Event Built From A Contract

Where an event is built from a version of a contract, the system SHALL accept for its domain either a value or a request to read one from a named source, and SHALL resolve any such request before the event exists.

A domain not supplied SHALL mean the event has no domain. A value supplied SHALL be used as it stands.

#### Scenario: No domain supplied
- **WHEN** an event is built from a version of a contract declaring a domain, with no domain supplied
- **THEN** the built event has no domain

#### Scenario: A domain supplied outright
- **WHEN** an event is built with a domain value supplied
- **THEN** the built event carries that value

## ADDED Requirements

### Requirement: The Type And Dataschema Of A Version's Handler Error Event

The handler error event's type and the shape of its payload SHALL be the ones the version's own handler error declares, and SHALL NOT be derived a second time from the contract's type. The handler error event's dataschema SHALL be the version's own.

#### Scenario: Type and dataschema come from the version
- **WHEN** a handler error event is built for a version of a contract
- **THEN** its type is that version's handler error type
- **AND** its dataschema is that version's dataschema

### Requirement: A Rejected Payload Reports Every Broken Position

A failure SHALL report every position that broke, each naming the position within the payload and which of the version's declarations judged it.

#### Scenario: Every broken position reported
- **WHEN** a payload breaks more than one rule of the declaration
- **THEN** every one of them is reported

#### Scenario: A position nested within the payload
- **WHEN** the rule that broke is on a value nested inside the payload
- **THEN** the reported position names that nested value beneath the payload

#### Scenario: The failure names which declaration judged it
- **WHEN** building fails because a payload was rejected
- **THEN** the failure states which of the version's declarations the payload was checked against

### Requirement: A Mutation Infers Nothing

Nothing SHALL be inferred: a field not replaced SHALL be carried as it stands, and the result SHALL NOT be made a descendant of the event mutated.

#### Scenario: A field the event holds as null

- **WHEN** an event holding no recipient, no domain and no parent is mutated with another field replaced
- **THEN** the result still holds no recipient, no domain and no parent

#### Scenario: Causality is not inferred

- **WHEN** an event is mutated
- **THEN** the result's causal fields are the event's own, not values derived from it

### Requirement: The Type And Payload Of A Mutation

Where the type or the payload is replaced, the result SHALL carry the replacement; where neither is, the result SHALL carry the event's own type and payload.

#### Scenario: The type and payload replaced

- **WHEN** an event is mutated with a new type and a new payload
- **THEN** the result carries both replacements

#### Scenario: The type and payload carried

- **WHEN** an event is mutated with neither its type nor its payload replaced
- **THEN** the result carries the event's own type and payload

### Requirement: The Event Mutated Is Not Altered

The event mutated SHALL NOT be altered.

#### Scenario: The event mutated is untouched

- **WHEN** an event is mutated, with or without replacements
- **THEN** the event that was mutated is unchanged

### Requirement: A Span With No Valid Trace In A Mutation

A span whose context carries no valid trace SHALL be treated as not supplied, and the result SHALL carry the event's own trace context.

#### Scenario: A span with no valid trace
- **WHEN** an event carrying a trace context is mutated with a span whose context carries no valid trace
- **THEN** the result carries the event's own trace context

#### Scenario: A span with no valid trace and nothing to carry
- **WHEN** an event carrying no trace context is mutated with a span whose context carries no valid trace
- **THEN** the result carries no trace context

### Requirement: The Sources A Domain Request May Name

The sources a request may name SHALL be: no domain at all, the domain of the contract the event is built from, the domain of the contract of whoever is building it, and the domain of the event that caused it.

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

### Requirement: Domain Sources Are Bound Once

The sources a request may read from SHALL be supplied once, where the version is bound for building, and SHALL apply to every event built from that binding. The sources a request may read from SHALL NOT be accepted per event, so no two events of one binding can resolve the same request differently.

#### Scenario: Sources bound once serve every event built
- **WHEN** several events are built from one binding that was given a source, each requesting a domain from it
- **THEN** every built event carries that source's domain

### Requirement: A Domain Requested From A Source Not Supplied

A request naming a source the caller did not supply SHALL resolve to no domain.

#### Scenario: Requested from a source that was not supplied
- **WHEN** an event is built requesting a domain from a source the caller did not supply
- **THEN** the built event has no domain

### Requirement: A Domain Request Never Reaches The Event

The built event's domain SHALL always be a plain value or absent; a request SHALL never reach the event.

#### Scenario: A request never reaches the event
- **WHEN** an event is built with any request for its domain
- **THEN** the built event's domain is a value or absent, never the request
