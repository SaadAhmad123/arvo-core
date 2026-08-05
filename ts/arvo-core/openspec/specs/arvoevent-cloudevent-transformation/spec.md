# arvoevent-cloudevent-transformation Specification

## Purpose
Defines the bidirectional transformation between an ArvoEvent and a CloudEvent, so that any Arvo participant's events are legible to CloudEvents-aware tooling — a router, a broker, a tracing bridge, or a foreign system's boundary — without that tooling needing to understand Arvo itself.
## Requirements
### Requirement: Forward Transformation Totality

The system SHALL transform every structurally valid ArvoEvent into a CloudEvent conforming to CloudEvents 1.0.2. Producing the CloudEvent SHALL NOT fail for structural reasons.

Per [ADR-003](../../../../docs/adr/003-arvoevent-cloudevent-transformation.md), this direction is total because ADR-002's field-domain narrowing closes the gap between ArvoEvent's field domains and CloudEvents' own attribute type system for every field but `depth`, which needs no narrowing since it is already a non-negative integer with an exact decimal-string form.

#### Scenario: Every structurally valid event transforms successfully
- **WHEN** a structurally valid ArvoEvent, taking any combination of legal field values, is transformed
- **THEN** a CloudEvent conforming to CloudEvents 1.0.2 is produced
- **AND** the transformation does not fail or raise for structural reasons

### Requirement: Forward Transformation Losslessness

The system SHALL make the round trip ArvoEvent → CloudEvent → ArvoEvent lossless: reversing a CloudEvent produced by this transformation SHALL yield an ArvoEvent identical, field for field, to the original.

#### Scenario: Round trip preserves every field
- **WHEN** an ArvoEvent is transformed into a CloudEvent and that CloudEvent is then reversed
- **THEN** the resulting ArvoEvent is identical, field for field, to the original

#### Scenario: A supplied negative zero survives the round trip as zero
- **WHEN** an ArvoEvent whose `executionunits` was constructed from a supplied `-0` is transformed and reversed
- **THEN** the resulting ArvoEvent's `executionunits` is `0`, consistent with ArvoEvent's own construction-time normalization

### Requirement: Native Attribute Placement

The system SHALL place `id`, `source`, `type`, `subject`, and `time` on the CloudEvent's context attributes of the same name, without transformation.

#### Scenario: Native fields carry through unchanged
- **WHEN** an ArvoEvent is transformed into a CloudEvent
- **THEN** the CloudEvent's `id`, `source`, `type`, `subject`, and `time` attributes equal the ArvoEvent's own values exactly

### Requirement: Protocol-Level Constants

The system SHALL fix the produced CloudEvent's `specversion` at `1.0`, `datacontenttype` at `application/vnd.arvo.event+json;version=1`, and `dataschema` at `https://www.arvo.land/schemas/cloudevent-data/v1`. The system SHALL NOT use `data_base64`; the CloudEvent's data SHALL always be a JSON object.

No ArvoEvent field carries any of these three values; they are constants of the transformation itself.

#### Scenario: Constants are present regardless of the source event
- **WHEN** any structurally valid ArvoEvent is transformed into a CloudEvent
- **THEN** the CloudEvent's `specversion` is `1.0`, `datacontenttype` is `application/vnd.arvo.event+json;version=1`, and `dataschema` is `https://www.arvo.land/schemas/cloudevent-data/v1`

### Requirement: Established Tracing Extension Placement

The system SHALL carry `traceparent` and `tracestate` as CloudEvents extension attributes under those exact, unprefixed names, reusing the CloudEvents Distributed Tracing Extension.

#### Scenario: Trace context uses the established convention
- **WHEN** an ArvoEvent carrying non-null `traceparent` and `tracestate` is transformed
- **THEN** the CloudEvent carries `traceparent` and `tracestate` extension attributes with the same values

### Requirement: Arvo-Defined Extension Placement

The system SHALL carry `parentid`, `initid`, `executionid`, `category`, `depth`, `to`, `domain`, and `executionunits` as CloudEvents extension attributes, each namespaced with an `arvo` prefix: `arvoparentid`, `arvoinitid`, `arvoexecutionid`, `arvocategory`, `arvodepth`, `arvoto`, `arvodomain`, `arvoexecutionunits`.

#### Scenario: Arvo-only fields land as prefixed extensions
- **WHEN** an ArvoEvent is transformed into a CloudEvent
- **THEN** its `parentid`, `initid`, `executionid`, `category`, `depth`, `to`, `domain`, and `executionunits` values appear on the CloudEvent's correspondingly `arvo`-prefixed extension attributes

### Requirement: Canonical Depth Encoding

The system SHALL encode `arvodepth` as a CloudEvents `String` containing the canonical unsigned-decimal representation of `depth`, matching the grammar `0|[1-9][0-9]*` — no sign, leading zero, decimal point, or exponent. The system SHALL parse `arvodepth` as an arbitrarily large non-negative integer when reversing a CloudEvent, before applying ArvoEvent's own structural validation.

#### Scenario: Depth round-trips through its canonical string form
- **WHEN** an ArvoEvent with any non-negative integer `depth` is transformed and then reversed
- **THEN** the resulting ArvoEvent's `depth` equals the original exactly

#### Scenario: A non-canonical depth encoding is rejected
- **WHEN** a CloudEvent's `arvodepth` extension carries a sign, a leading zero, a decimal point, or an exponent
- **THEN** reversing that CloudEvent fails
- **AND** the failure names the extension and the rule it violates

### Requirement: Canonical Execution Units Encoding

The system SHALL encode `arvoexecutionunits` as a CloudEvents `String` containing the RFC 8785 JSON Canonicalization Scheme's number serialization of the finite IEEE 754 binary64 `executionunits` value. The system SHALL reject an `arvoexecutionunits` value when reversing a CloudEvent unless serializing the value parsed from it under RFC 8785 reproduces the identical string.

#### Scenario: Execution units round-trip through their canonical string form
- **WHEN** an ArvoEvent with a non-null, finite `executionunits` is transformed and then reversed
- **THEN** the resulting ArvoEvent's `executionunits` equals the original exactly

#### Scenario: A non-canonical execution-units encoding is rejected
- **WHEN** a CloudEvent's `arvoexecutionunits` extension is a numeric string that does not match its own RFC 8785 re-serialization
- **THEN** reversing that CloudEvent fails
- **AND** the failure names the extension and the rule it violates

### Requirement: Nullable Extension Omission

The system SHALL omit a nullable extension-mapped field — `parentid`, `initid`, `category`, `to`, `domain`, `executionunits`, `traceparent`, and `tracestate` — from the CloudEvent's extension attributes entirely when its ArvoEvent value is `null`. The system SHALL read an omitted extension back as `null` when reversing a CloudEvent, never as an error.

#### Scenario: A null field is omitted, not encoded as an empty or null extension
- **WHEN** an ArvoEvent with a null `to` is transformed
- **THEN** the CloudEvent carries no `arvoto` extension attribute at all

#### Scenario: An omitted extension reverses to null
- **WHEN** a CloudEvent has no `arvoto` extension attribute
- **THEN** reversing it succeeds
- **AND** the resulting ArvoEvent's `to` is `null`

### Requirement: Data Wrapper Placement

The system SHALL carry `data`, `dataschema`, and `baggage` together inside the CloudEvent's `data` attribute, as a JSON object with exactly three keys: `arvoeventdata` (an object of JSON values, equal to the ArvoEvent's `data`), `arvoeventdataschema` (a non-empty string, equal to the ArvoEvent's `dataschema`), and `arvoeventbaggage` (a flat map, equal to the ArvoEvent's `baggage`).

The system SHALL NOT place any other ArvoEvent field inside this wrapper.

#### Scenario: The wrapper carries exactly the three payload-related fields
- **WHEN** an ArvoEvent is transformed into a CloudEvent
- **THEN** the CloudEvent's `data` attribute is an object with exactly the keys `arvoeventdata`, `arvoeventdataschema`, and `arvoeventbaggage`
- **AND** their values equal the ArvoEvent's `data`, `dataschema`, and `baggage` respectively

#### Scenario: A malformed wrapper is rejected on reversal
- **WHEN** a CloudEvent claiming Arvo shape carries a `data` attribute missing one of the three required keys, carrying an extra key, or carrying a value of the wrong type for one of them
- **THEN** reversing that CloudEvent fails
- **AND** the failure identifies which part of the wrapper is malformed

### Requirement: Arvo-Shaped Discrimination

The system SHALL treat a CloudEvent as Arvo-shaped only when all of the following hold: `specversion` is `1.0`; `datacontenttype` has media type `application/vnd.arvo.event+json`, exactly one `version` parameter equal to `1`, and no other parameters; `dataschema` is exactly `https://www.arvo.land/schemas/cloudevent-data/v1`; `subject` and `time` are present with their defined types; `data` satisfies the wrapper shape; `arvoexecutionid` and `arvodepth` are present with their defined types and encodings; and every other recognized Arvo or distributed-tracing extension present has the type and encoding this specification assigns it.

The system SHALL treat a CloudEvent whose `datacontenttype` matches the Arvo media type or whose `dataschema` matches the Arvo wrapper-schema URI, but which fails any other condition above, as a malformed Arvo-shaped event. The system SHALL reject a malformed Arvo-shaped event. The system SHALL NOT treat a malformed Arvo-shaped event as foreign.

A CloudEvent claiming neither the Arvo media type nor the Arvo wrapper-schema URI SHALL be treated as foreign.

#### Scenario: A fully conforming CloudEvent is recognized as Arvo-shaped
- **WHEN** a CloudEvent satisfies every condition above
- **THEN** it is treated as Arvo-shaped

#### Scenario: A CloudEvent claiming neither marker is treated as foreign
- **WHEN** a CloudEvent's `datacontenttype` is not the Arvo media type and its `dataschema` is not the Arvo wrapper-schema URI
- **THEN** it is treated as foreign, regardless of any other attribute it carries

#### Scenario: A partial match is rejected, not treated as foreign
- **WHEN** a CloudEvent's `datacontenttype` matches the Arvo media type, or its `dataschema` matches the Arvo wrapper-schema URI, but at least one other required condition fails
- **THEN** reversing that CloudEvent fails
- **AND** the outcome is not the same as reversing a foreign CloudEvent

### Requirement: Strict Arvo-Shaped Deserialization

The system SHALL, for an Arvo-shaped CloudEvent, map the five native attributes, decode every Arvo and tracing extension, unwrap the three data-wrapper members, restore an omitted nullable extension as `null`, and validate the assembled candidate against ArvoEvent's own structural rules. The system SHALL treat values carried by the CloudEvent as authoritative; caller-supplied values SHALL NOT participate in this case.

#### Scenario: An Arvo-shaped CloudEvent reverses without caller input
- **WHEN** an Arvo-shaped CloudEvent is reversed with no caller-supplied values
- **THEN** the resulting ArvoEvent is assembled entirely from the CloudEvent's own attributes

#### Scenario: A caller-supplied value cannot override the CloudEvent's own value
- **WHEN** an Arvo-shaped CloudEvent is reversed alongside a caller-supplied value for a field the CloudEvent already carries
- **THEN** the CloudEvent's own value is used, not the caller-supplied one

### Requirement: Foreign-Event Adaptation

The system SHALL, for a CloudEvent treated as foreign, map its `id`, `source`, and `type` attributes unconditionally, and map its `subject`, `time`, and object-valued `data` attributes when present. The system SHALL map its `traceparent` and `tracestate` extensions when present. The system SHALL NOT interpret any Arvo-prefixed extension or the Arvo data-wrapper convention on a foreign CloudEvent. The system SHALL NOT reuse a foreign CloudEvent's own `dataschema` attribute as the resulting ArvoEvent's `dataschema`.

The system SHALL accept caller-supplied values alongside a foreign CloudEvent for any ArvoEvent field the mapping above does not provide. The system SHALL require the caller to supply `dataschema`. The system SHALL require the caller to supply any other required field still absent after native mapping and ArvoEvent's own defaults. A caller-supplied value SHALL NOT replace a value the foreign CloudEvent's own mapping provides.

The system SHALL fail adaptation, rather than silently discarding the value, when a foreign CloudEvent's `data` attribute is present and not an object.

#### Scenario: A foreign CloudEvent adapts using its own native attributes
- **WHEN** a foreign CloudEvent carrying `id`, `source`, `type`, `subject`, `time`, and object-valued `data` is adapted with a caller-supplied `dataschema`
- **THEN** the resulting ArvoEvent's `id`, `source`, `type`, `subject`, `time`, and `data` equal the foreign CloudEvent's own values

#### Scenario: A present foreign value wins over a caller-supplied fallback
- **WHEN** a foreign CloudEvent carries `subject` and a caller also supplies a fallback `subject`
- **THEN** the resulting ArvoEvent's `subject` is the foreign CloudEvent's own value, not the caller-supplied one

#### Scenario: A missing caller-supplied dataschema fails adaptation
- **WHEN** a foreign CloudEvent is adapted without a caller-supplied `dataschema`
- **THEN** adaptation fails
- **AND** the failure names `dataschema` as missing

#### Scenario: Non-object foreign data fails adaptation rather than being discarded
- **WHEN** a foreign CloudEvent's `data` attribute is present and is a scalar or an array
- **THEN** adaptation fails
- **AND** the failure identifies `data` as the cause

### Requirement: Shared Structural Validation On Reversal

The system SHALL pass the candidate assembled by either reverse case through the same non-throwing structural-validation entry point ArvoEvent already defines for events arriving as data. The system SHALL NOT define a second ArvoEvent validity rule set for either reverse case.

#### Scenario: A structurally invalid assembled candidate is rejected
- **WHEN** a candidate assembled from either reverse case violates one of ArvoEvent's own structural rules, such as the root event constraint
- **THEN** reversal fails
- **AND** the failure reports the same explanation a direct ArvoEvent construction failure would

#### Scenario: Reversal never throws for an invalid CloudEvent
- **WHEN** either reverse case is given a CloudEvent that cannot become a valid ArvoEvent
- **THEN** the outcome is reported as a failure
- **AND** no exception escapes the reversal

### Requirement: CloudEvents Conformance Delegated

The system SHALL establish that a produced or consumed value conforms to the CloudEvents specification using a conformant CloudEvents implementation, rather than a reimplementation of CloudEvents' own validity rules.

#### Scenario: CloudEvents-level conformance is not independently reimplemented
- **WHEN** the transformation produces or consumes a CloudEvent
- **THEN** conformance to the CloudEvents specification is established via a conformant CloudEvents implementation

