## MODIFIED Requirements

### Requirement: Non-CloudEventTransformationError Failures Are Wrapped In ArvoEventSerializerError

The system SHALL provide a dedicated `ArvoEventSerializerError` class with a general `Error`-typed `cause` property (not narrowed to a closed set of concrete error types). The system SHALL wrap any failure `trySerialize`/`tryDeserialize` themselves originate — currently a `JSON.parse` `SyntaxError`, a `JSON.stringify` `TypeError`, or an `ArvoEvent.tryParse` `ArvoEventValidationError` — in `ArvoEventSerializerError`, exposing the original error via its `cause` property.

#### Scenario: A JSON.stringify TypeError from a custom stage is wrapped in ArvoEventSerializerError
- **WHEN** `trySerialize` is called against a `CloudEventConverter` whose custom stage produces a CloudEvent containing a circular reference
- **THEN** the outcome is reported as a failed `Result` whose error is `instanceof ArvoEventSerializerError`, with the original `TypeError` available via `.cause`

#### Scenario: A JSON.parse SyntaxError is wrapped in ArvoEventSerializerError
- **WHEN** `tryDeserialize` is called with a string that is not valid JSON
- **THEN** the outcome is reported as a failed `Result` whose error is `instanceof ArvoEventSerializerError`, with the original `SyntaxError` available via `.cause`

#### Scenario: An ArvoEventValidationError in arvoevent mode is wrapped in ArvoEventSerializerError
- **WHEN** an `arvoevent`-mode `tryDeserialize` is called with a parsed value that is not a structurally valid `ArvoEvent`
- **THEN** the outcome is reported as a failed `Result` whose error is `instanceof ArvoEventSerializerError`, with the original `ArvoEventValidationError` available via `.cause`

## ADDED Requirements

### Requirement: A CloudEventTransformationError Is Passed Through Unchanged

The system SHALL NOT wrap a `CloudEventTransformationError` produced by `CloudEventConverter`; that error type SHALL be passed through unchanged, so a caller can distinguish "this class's own boundary work failed" from "the underlying transformation failed" with a single `instanceof` check on each.

#### Scenario: A CloudEventTransformationError is never wrapped
- **WHEN** `trySerialize` or `tryDeserialize` is called and the underlying `CloudEventConverter` reports a `CloudEventTransformationError`
- **THEN** the outcome is reported as a failed `Result` whose error is that same `CloudEventTransformationError` instance, not wrapped in `ArvoEventSerializerError`
