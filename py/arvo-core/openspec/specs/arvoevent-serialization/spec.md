# arvoevent-serialization Specification

## Purpose
Defines converting an `ArvoEvent` to and from a wire string, in either of two selectable formats, so a consumer does not have to own the format-specific boundary handling (JSON encode/decode, CloudEvent construction) themselves.
## Requirements
### Requirement: Selectable Wire Format, Defaulting to CloudEvent

The system SHALL support two wire formats for an `ArvoEvent`: the event's own default JSON shape (`"arvoevent"`), and the CloudEvent-shaped JSON the CloudEvent transformation produces (`"cloudevent"`). The system SHALL select the format per call, via a `mode` parameter, and SHALL default to `"cloudevent"` when `mode` is not supplied.

#### Scenario: No mode supplied defaults to CloudEvent format
- **WHEN** `serialize` or `deserialize` is called with no `mode` argument
- **THEN** it serializes or deserializes using the CloudEvent wire format

#### Scenario: ArvoEvent mode never involves a CloudEvent
- **WHEN** `serialize` or `deserialize` is called with `mode="arvoevent"`
- **THEN** `serialize` produces the event's own default JSON shape and `deserialize` parses it back with no CloudEvent construction at any point

### Requirement: Deserialization Accepts a Wire String Directly

The system SHALL construct any wire-parsed value as a CloudEvent without requiring the caller to construct a CloudEvent instance themselves before calling `deserialize`.

#### Scenario: A wire string round-trips without extra caller steps
- **WHEN** `deserialize` is called, in either mode, with a string produced by that same mode's `serialize`
- **THEN** the original `ArvoEvent` is reconstructed with no additional caller-side wrapping

### Requirement: Malformed Wire Input Is Reported Through ArvoEventSerializerError, Not an Unrelated Exception

The system SHALL provide `ArvoEventSerializerError`, with the original failure available via `.__cause__`. The system SHALL raise it, wrapping the original error, for a wire string that is not valid JSON, for a JSON value that does not parse to an object at the top level, and for an `ArvoEventValidationError` raised while constructing the result from an already-parsed value. The system SHALL NOT wrap a `CloudEventTransformationError` raised while reverting a CloudEvent to an `ArvoEvent`; that error SHALL propagate unchanged, so a caller can distinguish this module's own boundary failing from the underlying transformation failing with one `isinstance` check on each.

#### Scenario: Non-JSON input raises ArvoEventSerializerError
- **WHEN** `deserialize` is called with a string that is not valid JSON
- **THEN** it raises `ArvoEventSerializerError` with the original JSON-decoding error as `.__cause__`

#### Scenario: A top-level JSON array or scalar raises ArvoEventSerializerError
- **WHEN** `deserialize` is called with valid JSON whose top-level value is not an object
- **THEN** it raises `ArvoEventSerializerError`

#### Scenario: An ArvoEventValidationError in arvoevent mode is wrapped
- **WHEN** `deserialize` is called with `mode="arvoevent"` and a parsed value that is not a structurally valid `ArvoEvent`
- **THEN** it raises `ArvoEventSerializerError` with the original `ArvoEventValidationError` as `.__cause__`

#### Scenario: A CloudEventTransformationError is never wrapped
- **WHEN** `deserialize` is called with `mode="cloudevent"` and the underlying CloudEvent transformation raises `CloudEventTransformationError`
- **THEN** that same `CloudEventTransformationError` propagates, not wrapped in `ArvoEventSerializerError`

### Requirement: Foreign Fallback Applies Only in CloudEvent Mode

The system SHALL accept foreign-event fallback keyword arguments on `deserialize` unconditionally. The system SHALL consult them only when deserializing in `"cloudevent"` mode, forwarding them to the underlying CloudEvent transformation's own foreign-adaptation path. The system SHALL ignore them when deserializing in `"arvoevent"` mode.

#### Scenario: A fallback is ignored in ArvoEvent mode
- **WHEN** `deserialize` is called with `mode="arvoevent"` and fallback keyword arguments supplied
- **THEN** the fallback has no effect on the outcome

#### Scenario: A fallback reaches foreign adaptation in CloudEvent mode
- **WHEN** `deserialize` is called with `mode="cloudevent"` on wire JSON representing a foreign (non-Arvo-shaped) CloudEvent, with fallback keyword arguments supplied
- **THEN** the fallback is used exactly as the underlying CloudEvent transformation's own foreign-adaptation rules specify

### Requirement: Serialization Is Total

The system SHALL produce a wire string for any structurally valid `ArvoEvent`, in either mode, without failure.

#### Scenario: Any valid ArvoEvent serializes successfully in either mode
- **WHEN** `serialize` is called with a structurally valid `ArvoEvent`, in either mode
- **THEN** it returns a string, without raising

