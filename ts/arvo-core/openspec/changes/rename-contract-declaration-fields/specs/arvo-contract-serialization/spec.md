## MODIFIED Requirements

### Requirement: Canonical Form Production

The system SHALL produce a contract's canonical form as JSON, with every schema-bearing position — a version's `input` and each entry in its `outputs` — expressed as JSON Schema 2020-12 per [ADR-005](../../../../../docs/adr/005-arvocontract-structure.md).

The system SHALL declare `"$schema": "https://json-schema.org/draft/2020-12/schema"` explicitly at every schema-bearing position. The system SHALL NOT emit a form targeting any other dialect, and SHALL NOT accept a caller instruction to do so.

#### Scenario: Every schema position declares the dialect
- **WHEN** a contract with two versions, each declaring outputs, is serialized
- **THEN** every `input` and every emit schema carries the 2020-12 `$schema` declaration

#### Scenario: The dialect is not caller-selectable
- **WHEN** a caller supplies conversion options
- **THEN** no option among them can change the target dialect

### Requirement: Contract Reconstruction

The system SHALL construct a working contract from a canonical form, including one produced by another implementation.

The system SHALL apply the contract's own declaration rules to the reconstructed contract, so that a form which would not be declarable is not admitted by being read rather than written.

#### Scenario: A form produced by this system reads back
- **WHEN** a contract is serialized and the resulting form deserialized
- **THEN** a contract is produced carrying the same `uri`, `type`, `description`, `domain`, `metadata`, and version keys

#### Scenario: A foreign form reads back
- **WHEN** a form not produced by this system, valid under ADR-005, is deserialized
- **THEN** a contract is produced

#### Scenario: Declaration rules still apply on the way in
- **WHEN** a form carries an `outputs` key that violates the contract-declared identifier grammar
- **THEN** deserialization fails
- **AND** the failure names that key

### Requirement: Form Validity Is Checked Before Conversion

The system SHALL check a form's own structural rules against the JSON, before converting any schema to a native representation. This SHALL include the literal `"type": "object"` keyword required at each schema-bearing position.

#### Scenario: A schema position without the literal keyword is rejected
- **WHEN** a form's `input` describes an object but carries no top-level `"type": "object"` keyword
- **THEN** deserialization fails
- **AND** the failure names that position

#### Scenario: A malformed container is rejected
- **WHEN** a form is missing `type`, or `versions`, or declares no versions
- **THEN** deserialization fails naming what is missing

### Requirement: Both Directions Report What Was Lost

The system SHALL report, on every successful conversion in either direction, each constraint that did not survive it. A report SHALL identify the position the constraint occupied.

A lost constraint SHALL NOT be reported as a failure. Conversion is best-effort in both directions per ADR-005, so a constraint that could not cross is the mandated outcome rather than an error.

The system SHALL distinguish a constraint **dropped** from a check **demoted** — one that survives in the form as an annotation no implementation is permitted to enforce.

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

#### Scenario: A demotion reads differently from a drop
- **WHEN** a check survives as an annotation nothing may enforce
- **THEN** the report distinguishes it from a constraint that was dropped entirely

### Requirement: A Recursive Schema Has A Canonical Form

The system SHALL express a self-referencing schema by reference rather than refusing to produce a form for it.

#### Scenario: A recursive input schema serializes
- **WHEN** a contract whose `input` refers to itself is serialized
- **THEN** serialization succeeds
- **AND** the form expresses the recursion by reference

#### Scenario: That form reads back
- **WHEN** such a form is deserialized
- **THEN** a contract is produced

### Requirement: One Crossing Is Faithful

The system SHALL preserve, across a single outbound-then-inbound crossing, every constraint the canonical form can express.

The system does not guarantee that repeated crossings preserve a constraint.

#### Scenario: A constraint survives one crossing
- **WHEN** a contract whose `input` constrains a string's length, a number's range, or a value's membership of a set is serialized and deserialized once
- **THEN** the reconstructed contract still rejects a payload violating that constraint

#### Scenario: A payload valid before a crossing is valid after
- **WHEN** a payload the original contract accepts is checked against the reconstructed contract
- **THEN** it is accepted
