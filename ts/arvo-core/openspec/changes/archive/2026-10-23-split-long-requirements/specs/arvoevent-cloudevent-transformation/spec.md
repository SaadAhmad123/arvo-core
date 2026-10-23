## MODIFIED Requirements

### Requirement: Forward Transformation Totality

The system SHALL transform every structurally valid ArvoEvent into a CloudEvent conforming to CloudEvents 1.0.2. Producing the CloudEvent SHALL NOT fail for structural reasons.

Per [ADR-003](../../../../../docs/adr/003-arvoevent-cloudevent-transformation.md), this direction is total because ADR-002's field-domain narrowing closes the gap between ArvoEvent's field domains and CloudEvents' own attribute type system for every field but `depth`.

#### Scenario: Every structurally valid event transforms successfully
- **WHEN** a structurally valid ArvoEvent, taking any combination of legal field values, is transformed
- **THEN** a CloudEvent conforming to CloudEvents 1.0.2 is produced
- **AND** the transformation does not fail or raise for structural reasons

#### Scenario: `depth` needs no narrowing
- **WHEN** an ArvoEvent's `depth` is transformed
- **THEN** `depth` needs no narrowing, since it is already a non-negative integer with an exact decimal-string form

### Requirement: Arvo-Shaped Discrimination

The system SHALL treat a CloudEvent as Arvo-shaped only when all of the following hold: `specversion` is `1.0`; `datacontenttype` has media type `application/vnd.arvo.event+json`, exactly one `version` parameter equal to `1`, and no other parameters; `dataschema` is exactly `https://www.arvo.land/schemas/cloudevent-data/v1`; `subject` and `time` are present with their defined types; `data` satisfies the wrapper shape; `arvoexecutionid` and `arvodepth` are present with their defined types and encodings; and every other recognized Arvo or distributed-tracing extension present has the type and encoding this specification assigns it.

#### Scenario: A fully conforming CloudEvent is recognized as Arvo-shaped
- **WHEN** a CloudEvent satisfies every condition above
- **THEN** it is treated as Arvo-shaped

### Requirement: Foreign-Event Adaptation

The system SHALL, for a CloudEvent treated as foreign, map its `id`, `source`, and `type` attributes unconditionally, and map its `subject`, `time`, and object-valued `data` attributes when present. The system SHALL map its `traceparent` and `tracestate` extensions when present. The system SHALL NOT interpret any Arvo-prefixed extension or the Arvo data-wrapper convention on a foreign CloudEvent.

#### Scenario: A foreign CloudEvent adapts using its own native attributes
- **WHEN** a foreign CloudEvent carrying `id`, `source`, `type`, `subject`, `time`, and object-valued `data` is adapted with a caller-supplied `dataschema`
- **THEN** the resulting ArvoEvent's `id`, `source`, `type`, `subject`, `time`, and `data` equal the foreign CloudEvent's own values

## ADDED Requirements

### Requirement: A Malformed Arvo-Shaped Event Is Rejected

The system SHALL treat a CloudEvent whose `datacontenttype` matches the Arvo media type or whose `dataschema` matches the Arvo wrapper-schema URI, but which fails any other condition of *Arvo-Shaped Discrimination*, as a malformed Arvo-shaped event. The system SHALL reject a malformed Arvo-shaped event. The system SHALL NOT treat a malformed Arvo-shaped event as foreign.

#### Scenario: A partial match is rejected, not treated as foreign
- **WHEN** a CloudEvent's `datacontenttype` matches the Arvo media type, or its `dataschema` matches the Arvo wrapper-schema URI, but at least one other required condition fails
- **THEN** reversing that CloudEvent fails
- **AND** the outcome is not the same as reversing a foreign CloudEvent

### Requirement: A CloudEvent Claiming Neither Marker Is Foreign

A CloudEvent claiming neither the Arvo media type nor the Arvo wrapper-schema URI SHALL be treated as foreign.

#### Scenario: A CloudEvent claiming neither marker is treated as foreign
- **WHEN** a CloudEvent's `datacontenttype` is not the Arvo media type and its `dataschema` is not the Arvo wrapper-schema URI
- **THEN** it is treated as foreign, regardless of any other attribute it carries

### Requirement: Fields A Caller Must Supply For A Foreign CloudEvent

The system SHALL NOT reuse a foreign CloudEvent's own `dataschema` attribute as the resulting ArvoEvent's `dataschema`. The system SHALL require the caller to supply `dataschema`. The system SHALL require the caller to supply any other required field still absent after native mapping and ArvoEvent's own defaults.

#### Scenario: A missing caller-supplied dataschema fails adaptation
- **WHEN** a foreign CloudEvent is adapted without a caller-supplied `dataschema`
- **THEN** adaptation fails
- **AND** the failure names `dataschema` as missing

### Requirement: Caller-Supplied Values For A Foreign CloudEvent

The system SHALL accept caller-supplied values alongside a foreign CloudEvent for any ArvoEvent field the foreign CloudEvent's own mapping does not provide. A caller-supplied value SHALL NOT replace a value the foreign CloudEvent's own mapping provides.

#### Scenario: A present foreign value wins over a caller-supplied fallback
- **WHEN** a foreign CloudEvent carries `subject` and a caller also supplies a fallback `subject`
- **THEN** the resulting ArvoEvent's `subject` is the foreign CloudEvent's own value, not the caller-supplied one

### Requirement: Non-Object Foreign Data Fails Adaptation

The system SHALL fail adaptation, rather than silently discarding the value, when a foreign CloudEvent's `data` attribute is present and not an object.

#### Scenario: Non-object foreign data fails adaptation rather than being discarded
- **WHEN** a foreign CloudEvent's `data` attribute is present and is a scalar or an array
- **THEN** adaptation fails
- **AND** the failure identifies `data` as the cause
