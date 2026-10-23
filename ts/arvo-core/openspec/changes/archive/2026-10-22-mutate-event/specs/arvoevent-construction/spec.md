## ADDED Requirements

### Requirement: Mutating An Event

The system SHALL build, from an existing event and a set of replacements, the same event with each replaced field taking its replacement and every other field carried across, the event's identity and its time included. Any field an event is built from MAY be replaced, alone or with others.

The replacements SHALL be given in the shape an event is built from on its own. A replacement given as absent SHALL replace nothing. Nothing SHALL be inferred: a field not replaced SHALL be carried as it stands, and the result SHALL NOT be made a descendant of the event mutated.

Where the type or the payload is replaced, the result SHALL carry the replacement; where neither is, the result SHALL carry the event's own type and payload.

The event mutated SHALL NOT be altered.

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

#### Scenario: The type and payload replaced

- **WHEN** an event is mutated with a new type and a new payload
- **THEN** the result carries both replacements

#### Scenario: The type and payload carried

- **WHEN** an event is mutated with neither its type nor its payload replaced
- **THEN** the result carries the event's own type and payload

#### Scenario: A field the event holds as null

- **WHEN** an event holding no recipient, no domain and no parent is mutated with another field replaced
- **THEN** the result still holds no recipient, no domain and no parent

#### Scenario: A replacement given as absent

- **WHEN** an event is mutated with its time given as absent
- **THEN** the result carries the event's own time, not a new one

#### Scenario: Causality is not inferred

- **WHEN** an event is mutated
- **THEN** the result's causal fields are the event's own, not values derived from it

#### Scenario: The event mutated is untouched

- **WHEN** an event is mutated, with or without replacements
- **THEN** the event that was mutated is unchanged

#### Scenario: A mutation that breaks a rule

- **WHEN** an event is mutated with a replacement that breaks a structural rule of an event
- **THEN** building fails on that rule

### Requirement: The Trace Context Of A Mutation

Where an event is mutated, the system SHALL resolve the result's trace context by precedence: a span supplied among the replacements first, then a trace header supplied among the replacements, then the header the event carries.

A span SHALL replace the trace context whole, the event's own contributing nothing. A supplied header SHALL replace only itself, the other being carried across.

A span whose context carries no valid trace SHALL be treated as not supplied, and the result SHALL carry the event's own trace context.

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

#### Scenario: A span with no valid trace
- **WHEN** an event carrying a trace context is mutated with a span whose context carries no valid trace
- **THEN** the result carries the event's own trace context

#### Scenario: A span with no valid trace and nothing to carry
- **WHEN** an event carrying no trace context is mutated with a span whose context carries no valid trace
- **THEN** the result carries no trace context

## MODIFIED Requirements

### Requirement: Cloning An Event

The system SHALL build an event carrying the same field values as an existing event, every field included, the event's identity, its time and its trace context among them. Cloning SHALL take no replacements: a field is replaced by mutating an event.

Nothing SHALL be inferred from the relationship between the two: the causal fields SHALL be carried as they stand, and the clone SHALL NOT be made a descendant of its source.

The event cloned SHALL NOT be altered.

#### Scenario: Every field carried across
- **WHEN** an event is cloned
- **THEN** the clone carries the same value as its source for every field, identity, time and trace context included

#### Scenario: Causality is not inferred
- **WHEN** an event is cloned
- **THEN** the clone's causal fields are its source's, not values derived from it

#### Scenario: The source is untouched
- **WHEN** an event is cloned
- **THEN** the event that was cloned is unchanged

## REMOVED Requirements

### Requirement: The Trace Context Of A Clone
**Reason**: A clone takes no replacements, so it has no trace context to resolve beyond carrying its source's. Replacing trace context, by a span or by header, is a mutation.
**Migration**: Replace `cloneArvoEvent(event, { span })`, and any clone with replacements, with `mutateArvoEvent(event, { span })`; the precedence and every other rule are those of *The Trace Context Of A Mutation*.
