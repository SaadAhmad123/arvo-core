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

Where an event is mutated, the system SHALL resolve the result's trace context exactly as it resolves a clone's: a span supplied among the replacements first, then a trace header supplied among the replacements, then the header the event carries; a span replacing the trace context whole, a header replacing only itself; and a span whose context carries no valid trace treated as not supplied.

#### Scenario: Trace context resolved as for a clone

- **WHEN** the same event is mutated and cloned with the same trace replacements
- **THEN** the two results carry the same trace context

#### Scenario: A trace replacement keeps the event's identity

- **WHEN** an event is mutated with only a span supplied
- **THEN** the result carries the trace context derived from that span
- **AND** every other field is the event's own, identity included

## MODIFIED Requirements

### Requirement: The Trace Context Of A Clone

Where an event is cloned, the system SHALL resolve the clone's trace context by precedence: a span supplied among the replacements first, then a trace header supplied among the replacements, then the header the cloned event carries.

A span SHALL replace the trace context whole, the cloned event's own contributing nothing. A supplied header SHALL replace only itself, the other being carried across.

A span whose context carries no valid trace SHALL be treated as not supplied, and the clone SHALL carry the cloned event's own trace context.

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

#### Scenario: A span with no valid trace
- **WHEN** an event carrying a trace context is cloned with a span whose context carries no valid trace
- **THEN** the clone carries the cloned event's trace context
