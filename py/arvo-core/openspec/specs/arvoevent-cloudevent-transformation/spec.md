# arvoevent-cloudevent-transformation Specification

## Purpose
Implements the ArvoEvent↔CloudEvent transformation ADR-003 defines: a total forward mapping, a lossless round trip for Arvo-produced events, and a reverse direction with two behaviorally distinct cases — strict Arvo-shaped deserialization and foreign-event adaptation.
## Requirements
### Requirement: Forward Transformation Is Total

`to_cloud_event` SHALL produce a CloudEvent from any structurally valid `ArvoEvent`, without failure.

#### Scenario: Any valid ArvoEvent converts successfully
- **WHEN** `to_cloud_event` is called with a structurally valid `ArvoEvent`, regardless of which optional fields are null or populated
- **THEN** it returns a CloudEvent, without raising

### Requirement: Native Attribute Placement

`id`, `source`, `type`, `subject`, and `time` SHALL be carried as CloudEvents context attributes of the same name, unchanged.

#### Scenario: Native fields map directly
- **WHEN** an ArvoEvent is converted
- **THEN** the CloudEvent's `id`, `source`, `type`, `subject`, and `time` equal the ArvoEvent's own

### Requirement: Protocol-Level Constants

The system SHALL set `specversion` to `"1.0"`, `datacontenttype` to `"application/vnd.arvo.event+json;version=1"`, and `dataschema` to `"https://www.arvo.land/schemas/cloudevent-data/v1"` on every produced CloudEvent, independent of any ArvoEvent field.

#### Scenario: Constants are always set
- **WHEN** any ArvoEvent is converted
- **THEN** the CloudEvent's `specversion`, `datacontenttype`, and `dataschema` equal these fixed values

### Requirement: Arvo-Defined Extension Attributes

`parentid`, `initid`, `executionid`, `category`, `depth`, `to`, `domain`, and `executionunits` SHALL be carried as extension attributes named `arvoparentid`, `arvoinitid`, `arvoexecutionid`, `arvocategory`, `arvodepth`, `arvoto`, `arvodomain`, and `arvoexecutionunits` respectively. `traceparent`/`tracestate` SHALL be carried as extension attributes under those exact, unprefixed names. `depth` SHALL be encoded as a canonical unsigned-decimal string (`0|[1-9][0-9]*`). `executionunits`, when not null, SHALL be encoded as an RFC 8785 canonical number string. A null nullable field SHALL be omitted from the CloudEvent's extension attributes entirely, not set to any null-like value.

#### Scenario: Non-null extension-mapped fields are present with the correct name and encoding
- **WHEN** an ArvoEvent with every nullable field populated is converted
- **THEN** every corresponding extension attribute is present, correctly named, and `arvodepth`/`arvoexecutionunits` are canonically encoded strings

#### Scenario: Null nullable fields are omitted, not present as null
- **WHEN** an ArvoEvent with a nullable field set to `None` is converted
- **THEN** the corresponding extension attribute is absent from the CloudEvent entirely

### Requirement: The `data` Wrapper

`data`, `dataschema`, and `baggage` SHALL be carried together inside the CloudEvent's `data` attribute as an object with exactly the keys `arvoeventdata`, `arvoeventdataschema`, and `arvoeventbaggage`, holding the ArvoEvent's `data`, `dataschema`, and `baggage` respectively.

#### Scenario: The wrapper has exactly the required shape
- **WHEN** an ArvoEvent is converted
- **THEN** the CloudEvent's `data` is an object with exactly `arvoeventdata`, `arvoeventdataschema`, and `arvoeventbaggage`, matching the ArvoEvent's `data`, `dataschema`, and `baggage`

### Requirement: Lossless Round Trip for Arvo-Produced Events

For any structurally valid `ArvoEvent`, `from_cloud_event(to_cloud_event(event))` SHALL yield an `ArvoEvent` identical, field for field, to the original, with one exception: `time` SHALL represent the identical instant, not necessarily the identical string — matching the same guarantee `ts/arvo-core` provides for the same field, for consistency across language implementations of the same ADR.

#### Scenario: A round trip reproduces every field exactly
- **WHEN** an ArvoEvent is converted to a CloudEvent and back
- **THEN** every one of the eighteen fields on the result equals the corresponding field on the original, except that `time` is compared as an instant, not as a string

#### Scenario: A non-default, non-UTC time string survives the round trip as the same instant
- **WHEN** an ArvoEvent is constructed with an explicit `time` in a non-UTC offset and non-default precision (e.g. `"2026-01-01T12:00:00.5+05:30"`), then converted to a CloudEvent and back
- **THEN** the result's `time` names the identical instant as the original, even if its textual form differs

### Requirement: Strict Arvo-Shaped Deserialization

`from_cloud_event` SHALL, for a CloudEvent satisfying every Arvo-shaped discriminator (correct `specversion`, `datacontenttype`, `dataschema`, required native attributes, required extensions `arvoexecutionid`/`arvodepth` with correct encoding, and `data` wrapper shape), reconstruct the ArvoEvent from the CloudEvent's own values exclusively, ignoring any caller-supplied fallback.

#### Scenario: An Arvo-shaped CloudEvent reverses using only its own values
- **WHEN** `from_cloud_event` is called on an Arvo-shaped CloudEvent, with or without fallback values supplied
- **THEN** the result is derived entirely from the CloudEvent; any supplied fallback has no effect

#### Scenario: A malformed Arvo-shaped CloudEvent is rejected, never treated as foreign
- **WHEN** a CloudEvent claims the Arvo media type or wrapper schema but fails some other Arvo-shaped condition (e.g. a malformed `arvodepth`, a missing required extension, an unexpected wrapper key)
- **THEN** `from_cloud_event` raises `CloudEventTransformationError` with `kind="strict"`, and does not fall back to foreign-event adaptation

### Requirement: Foreign-Event Adaptation

For a CloudEvent that is not Arvo-shaped, `from_cloud_event` SHALL map `id`, `source`, `type` natively, map `subject`, `time`, and object-valued `data` when present, map the established `traceparent`/`tracestate` extensions when present, and accept caller-supplied fallback values for every other required field. A value the CloudEvent itself provides SHALL take precedence over a supplied fallback for the same field. `dataschema` SHALL always come from the supplied fallback, never from the foreign CloudEvent's own `dataschema`.

#### Scenario: A foreign CloudEvent adapts with caller-supplied fallback
- **WHEN** `from_cloud_event` is called on a non-Arvo-shaped CloudEvent with a fallback supplying `dataschema` and every other field the mapping doesn't provide
- **THEN** the result is a valid ArvoEvent combining the CloudEvent's own mapped values with the supplied fallback

#### Scenario: A foreign CloudEvent's own values win over a supplied fallback
- **WHEN** a foreign CloudEvent has its own `subject` and a fallback also supplies `subject`
- **THEN** the result's `subject` is the CloudEvent's own value, not the fallback

#### Scenario: A missing required fallback is rejected
- **WHEN** a foreign CloudEvent is adapted without a `dataschema` fallback supplied
- **THEN** `from_cloud_event` raises `CloudEventTransformationError` with `kind="foreign"`

#### Scenario: A present non-object data value cannot be adapted
- **WHEN** a foreign CloudEvent's `data` is present but not an object
- **THEN** `from_cloud_event` raises `CloudEventTransformationError` with `kind="foreign"`, not silently discarding it

### Requirement: Deserialization Reuses ArvoEvent's Own Structural Validation

Both strict and foreign reverse paths SHALL pass their assembled candidate through `ArvoEvent`'s own construction, not a second, independently defined validity rule set.

#### Scenario: An assembled candidate that fails ArvoEvent's own rules is rejected the same way
- **WHEN** either reverse path assembles a candidate that would fail `ArvoEvent`'s own structural validation
- **THEN** `from_cloud_event` raises `CloudEventTransformationError` wrapping that same underlying validation failure

### Requirement: Error Reporting Preserves the Original Cause

`CloudEventTransformationError` SHALL always preserve the original underlying error as its cause, and SHALL carry a `kind` of `"strict"` or `"foreign"` identifying which reverse case produced it.

#### Scenario: The original cause is preserved
- **WHEN** `from_cloud_event` raises for any reason
- **THEN** `CloudEventTransformationError.__cause__` is the original underlying error

