## MODIFIED Requirements

### Requirement: Both Directions Report What Was Lost

The system SHALL report, on every successful conversion in either direction, each constraint that did not survive it. A report SHALL identify the position the constraint occupied.

A lost constraint SHALL NOT be reported as a failure. Conversion is best-effort in both directions per ADR-005, so a constraint that could not cross is the mandated outcome rather than an error.

#### Scenario: An unrepresentable type is reported, not raised
- **WHEN** a contract whose `input` contains a constraint JSON Schema 2020-12 cannot express is serialized
- **THEN** serialization succeeds
- **AND** the result reports that constraint and the position it occupied

#### Scenario: A silently dropped inbound constraint is reported
- **WHEN** a form carries a constraint the conversion drops without raising
- **THEN** deserialization succeeds
- **AND** the result reports that constraint and its position

#### Scenario: Nothing lost reports nothing
- **WHEN** a contract whose every constraint is expressible is serialized
- **THEN** the result reports no losses
- **AND** the rendered form of the report is absent rather than empty

## ADDED Requirements

### Requirement: A Demoted Check Is Distinguished From A Dropped Constraint

The system SHALL distinguish a constraint **dropped** from a check **demoted** — one that survives in the form as an annotation no implementation is permitted to enforce.

#### Scenario: A demotion reads differently from a drop
- **WHEN** a check survives as an annotation nothing may enforce
- **THEN** the report distinguishes it from a constraint that was dropped entirely
