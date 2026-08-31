## Purpose

A contract's portable identity is its canonical JSON form, not the code that declared it. This capability defines converting a contract to that form and reading one back — what the form contains, what a crossing costs, how a loss is reported, and what a caller may configure.

## ADDED Requirements

### Requirement: Canonical Form Production

The system SHALL produce a contract's canonical form as JSON, with every schema-bearing position — a version's `input` and each entry in its `outputs` — expressed as JSON Schema 2020-12 per [ADR-005](../../../../../docs/adr/005-arvocontract-structure.md).

The system SHALL declare `"$schema": "https://json-schema.org/draft/2020-12/schema"` explicitly at every schema-bearing position. The system SHALL NOT emit a form targeting any other dialect, and SHALL NOT accept a caller instruction to do so.

#### Scenario: Every schema position declares the dialect
- **WHEN** a contract with two versions, each declaring outputs, is serialized
- **THEN** every `input` and every emit schema carries the 2020-12 `$schema` declaration

#### Scenario: The dialect is not caller-selectable
- **WHEN** a caller supplies conversion options
- **THEN** no option among them can change the target dialect

### Requirement: Canonical Form Field Set

The system SHALL emit every contract field ADR-005 defines, including an optional field left at its default. The system SHALL NOT omit a field because it was never set.

The system SHALL NOT include the handler error anywhere in the form, that being a fixed function of `type` and the producing version.

#### Scenario: Defaults are materialized
- **WHEN** a contract declared with only `type` and `versions` is serialized
- **THEN** the form carries `description` as null, `domain` as null, and `metadata` as an empty object

#### Scenario: Explicit default is indistinguishable from omission
- **WHEN** one contract sets `description` to null explicitly and another never sets it
- **THEN** both produce the same form

#### Scenario: The handler error has no position in the form
- **WHEN** a contract of any `type` is serialized
- **THEN** no key derived from the handler error type appears anywhere in the form

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

### Requirement: Losses Are Reported As Values And As Text

The system SHALL report losses both as individually addressable items, each naming a position and what was lost, and as a single rendered message. The rendered message SHALL be absent when there were no losses.

#### Scenario: Both forms describe the same losses
- **WHEN** a conversion loses two constraints
- **THEN** both are individually addressable
- **AND** the rendered message names both

### Requirement: Results Are Immutable

The system SHALL return a result that cannot be altered by its receiver, to the depth of the individual loss reports it contains.

#### Scenario: A returned result resists mutation
- **WHEN** a caller attempts to alter a returned result, the collection of losses within it, or an individual loss
- **THEN** the alteration does not take effect

### Requirement: Non-Throwing Primitive, Throwing Convenience

The system SHALL provide, for each direction, a primitive reporting its outcome as a value rather than raising, and a companion that raises on failure and returns the value directly on success. The companion SHALL contain no logic beyond unwrapping the primitive.

#### Scenario: The primitive does not raise for an expected failure
- **WHEN** the primitive is called in either direction and the conversion cannot be completed
- **THEN** the outcome is reported as a value rather than raised

#### Scenario: The companion raises what the primitive reported
- **WHEN** the companion is called and the primitive would report a failure
- **THEN** the companion raises that same failure

#### Scenario: Both agree
- **WHEN** the same input is given to both
- **THEN** they agree on success or failure
- **AND** on success both produce the same value

### Requirement: Failure At This Boundary Is Distinguishable

The system SHALL report a failure originating at its own boundary — input that is not JSON, or a value that cannot be rendered as JSON — distinguishably from a failure of the contract's own rules. A failure of the contract's own rules SHALL be reported in the same vocabulary any other validating boundary in the package uses.

#### Scenario: Input that is not JSON
- **WHEN** deserialization is given a string that is not valid JSON
- **THEN** the failure is attributable to this boundary
- **AND** the original parse failure is retrievable from it

#### Scenario: A contract rule violation carries its positions
- **WHEN** a form parses but breaks the contract's own rules
- **THEN** the failure names every position that broke a rule

#### Scenario: Several contract problems arrive together
- **WHEN** a form parses and breaks more than one of the contract's own rules
- **THEN** one attempt reports all of them

#### Scenario: A malformed form stops before the contract is checked
- **WHEN** a form breaks a form-level rule
- **THEN** the contract's own rules are not evaluated
- **AND** the failure states that the list is partial and why

### Requirement: Conversion Options Are Narrowed, Not Passed Through

The system SHALL accept caller configuration for the outbound direction covering only the handling of unrepresentable constructs, input-versus-output shape, cycles, reuse, and identifier-to-URI mapping. The system SHALL NOT accept configuration that would change the target dialect.

Where a caller supplies its own handling of unrepresentable constructs, that handling SHALL replace the default rather than compose with it.

#### Scenario: A caller-supplied handler takes over
- **WHEN** a caller supplies its own handling of unrepresentable constructs
- **THEN** that handling is used
- **AND** the default's loss reporting does not also occur

#### Scenario: Defaults apply when nothing is supplied
- **WHEN** no options are supplied
- **THEN** unrepresentable constructs are omitted and reported, cycles are expressed by reference, reused schemas are inlined, and the shape describes the value as received

### Requirement: A Recursive Schema Has A Canonical Form

The system SHALL express a self-referencing schema by reference rather than refusing to produce a form for it.

#### Scenario: A recursive input schema serializes
- **WHEN** a contract whose `input` refers to itself is serialized
- **THEN** serialization succeeds
- **AND** the form expresses the recursion by reference

#### Scenario: That form reads back
- **WHEN** such a form is deserialized
- **THEN** a contract is produced

### Requirement: A Form The Conversion Cannot Read Fails Loudly

The system SHALL fail, naming the construct and the position, when a form contains a construct the conversion cannot represent at all. The system SHALL NOT silently admit such a form as a contract enforcing less than it declares.

#### Scenario: An unreadable construct is named
- **WHEN** a form contains a construct the conversion cannot represent
- **THEN** deserialization fails
- **AND** the failure names both the construct and the position it occupied

### Requirement: One Crossing Is Faithful

The system SHALL preserve, across a single outbound-then-inbound crossing, every constraint the canonical form can express.

The system does not guarantee that repeated crossings preserve a constraint.

#### Scenario: A constraint survives one crossing
- **WHEN** a contract whose `input` constrains a string's length, a number's range, or a value's membership of a set is serialized and deserialized once
- **THEN** the reconstructed contract still rejects a payload violating that constraint

#### Scenario: A payload valid before a crossing is valid after
- **WHEN** a payload the original contract accepts is checked against the reconstructed contract
- **THEN** it is accepted
