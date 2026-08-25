# arvoevent-serialization Specification

## Purpose

Defines converting an `ArvoEvent` to and from a wire string, in either of two selectable formats, so a consumer does not have to own the format-specific boundary handling (JSON parsing, CloudEvent wrapping) themselves.

## Requirements

### Requirement: Selectable Wire Format, Defaulting to CloudEvent

The system SHALL support two wire formats for an `ArvoEvent`: the event's own default JSON shape (`arvoevent`), and the CloudEvent-shaped JSON `CloudEventConverter` produces (`cloudevent`). The system SHALL select the format at construction time, not per call. The system SHALL default to the `cloudevent` format, with a default-constructed `CloudEventConverter`, when no mode is supplied.

#### Scenario: No mode supplied defaults to CloudEvent format
- **WHEN** an `ArvoEventSerializer` is constructed with no arguments
- **THEN** it serializes and deserializes using the CloudEvent wire format, via a default-constructed `CloudEventConverter`

#### Scenario: A caller-supplied converter is used in CloudEvent mode
- **WHEN** an `ArvoEventSerializer` is constructed with `{ type: 'cloudevent', converter }` naming a specific `CloudEventConverter` instance
- **THEN** that instance, including any enrichment stages it carries, is used for every `serialize`/`deserialize` call

#### Scenario: ArvoEvent mode never involves a CloudEvent
- **WHEN** an `ArvoEventSerializer` is constructed with `{ type: 'arvoevent' }`
- **THEN** `serialize` produces the event's own default JSON shape and `deserialize` parses it back with no CloudEvent conversion at any point

### Requirement: Non-Throwing Primitive, Throwing Convenience

The system SHALL provide `trySerialize`/`tryDeserialize` as non-throwing primitives reporting failure as a `Result`, and `serialize`/`deserialize` as throwing convenience wrappers with no logic beyond unwrapping the corresponding `tryX`.

#### Scenario: trySerialize never throws
- **WHEN** `trySerialize` is called, regardless of wire format or outcome
- **THEN** it resolves to a `Result` rather than rejecting for an expected failure

#### Scenario: serialize throws the same failure tryDeserialize would have reported
- **WHEN** `serialize` is called and the underlying `trySerialize` would report a failure
- **THEN** `serialize` throws that same error

#### Scenario: tryDeserialize never throws
- **WHEN** `tryDeserialize` is called with any string input, well-formed or not
- **THEN** it resolves to a `Result` rather than rejecting for an expected failure

### Requirement: CloudEvent-Mode Deserialization Accepts a Plain Object Without a Caller-Side Workaround

The system SHALL construct any wire-parsed value as a CloudEvent internally, bypassing CloudEvent's own construction-time conformance check, before evaluating it as Arvo-shaped or foreign. The system SHALL NOT require a caller to construct a CloudEvent instance themselves before calling `deserialize`/`tryDeserialize`.

#### Scenario: A plain JSON object round-trips without extra caller steps
- **WHEN** a CloudEvent-mode `ArvoEventSerializer`'s `deserialize` is called with a JSON string produced by that same serializer's `serialize`
- **THEN** the original `ArvoEvent` is reconstructed with no additional caller-side wrapping

### Requirement: Malformed Wire Input Is Reported, Not Thrown Uncaught

The system SHALL report a wire string that is not valid JSON through the same `Result`/throwing mechanism as any other deserialization failure, not as an uncaught exception escaping `tryDeserialize`.

#### Scenario: Non-JSON input is reported through tryDeserialize's Result
- **WHEN** `tryDeserialize` is called with a string that is not valid JSON
- **THEN** the outcome is reported as a failed `Result` (wrapped in `ArvoEventSerializerError` — see the dedicated wrapping requirement below), not an uncaught exception

### Requirement: A Non-Serializable Stage Output Is Reported, Not Thrown Uncaught

The system SHALL report a value that cannot itself be converted to a JSON string (a circular reference, a `BigInt`, or any other value `JSON.stringify` itself rejects) through `trySerialize`'s `Result`, not as an uncaught exception, when that value originates from a caller-supplied `CloudEventConverter` stage's own output.

#### Scenario: A circular reference from a custom stage is reported through trySerialize's Result
- **WHEN** `trySerialize` is called against a `CloudEventConverter` whose custom stage produces a CloudEvent containing a circular reference
- **THEN** the outcome is reported as a failed `Result`, not an uncaught exception

### Requirement: Non-CloudEventTransformationError Failures Are Wrapped In ArvoEventSerializerError

The system SHALL provide a dedicated `ArvoEventSerializerError` class with a general `Error`-typed `cause` property (not narrowed to a closed set of concrete error types). The system SHALL wrap any failure `trySerialize`/`tryDeserialize` themselves originate — currently a `JSON.parse` `SyntaxError`, a `JSON.stringify` `TypeError`, or an `ArvoEvent.tryParse` `ArvoEventValidationError` — in `ArvoEventSerializerError`, exposing the original error via its `cause` property. The system SHALL NOT wrap a `CloudEventTransformationError` produced by `CloudEventConverter`; that error type SHALL be passed through unchanged, so a caller can distinguish "this class's own boundary work failed" from "the underlying transformation failed" with a single `instanceof` check on each.

#### Scenario: A JSON.stringify TypeError from a custom stage is wrapped in ArvoEventSerializerError
- **WHEN** `trySerialize` is called against a `CloudEventConverter` whose custom stage produces a CloudEvent containing a circular reference
- **THEN** the outcome is reported as a failed `Result` whose error is `instanceof ArvoEventSerializerError`, with the original `TypeError` available via `.cause`

#### Scenario: A JSON.parse SyntaxError is wrapped in ArvoEventSerializerError
- **WHEN** `tryDeserialize` is called with a string that is not valid JSON
- **THEN** the outcome is reported as a failed `Result` whose error is `instanceof ArvoEventSerializerError`, with the original `SyntaxError` available via `.cause`

#### Scenario: An ArvoEventValidationError in arvoevent mode is wrapped in ArvoEventSerializerError
- **WHEN** an `arvoevent`-mode `tryDeserialize` is called with a parsed value that is not a structurally valid `ArvoEvent`
- **THEN** the outcome is reported as a failed `Result` whose error is `instanceof ArvoEventSerializerError`, with the original `ArvoEventValidationError` available via `.cause`

#### Scenario: A CloudEventTransformationError is never wrapped
- **WHEN** `trySerialize` or `tryDeserialize` is called and the underlying `CloudEventConverter` reports a `CloudEventTransformationError`
- **THEN** the outcome is reported as a failed `Result` whose error is that same `CloudEventTransformationError` instance, not wrapped in `ArvoEventSerializerError`

### Requirement: CloudEvent-Mode Deserialization Rejects Input Claiming No CloudEvent Shape At All

The system SHALL reject, before attempting foreign adaptation, a `cloudevent`-mode `deserialize`/`tryDeserialize` input that lacks a `specversion` string — the one context attribute every CloudEvent, strict or foreign, is required to carry. The system SHALL report this the same way it reports any other foreign-adaptation structural failure.

#### Scenario: Input with no specversion at all is rejected before foreign adaptation is attempted
- **WHEN** a `cloudevent`-mode `tryDeserialize` is called with a parsed value that has no `specversion` field
- **THEN** the outcome is reported as a failed `Result` naming `specversion`, without attempting foreign adaptation on the rest of the value

#### Scenario: ArvoEvent-shaped JSON deserialized in the wrong mode fails clearly rather than silently misadapting
- **WHEN** JSON produced by an `arvoevent`-mode `serialize` is passed to a `cloudevent`-mode `deserialize`
- **THEN** the outcome is reported as a failed `Result`, not a plausible-looking but incorrect `ArvoEvent`

### Requirement: Foreign Fallback Applies Only in CloudEvent Mode

The system SHALL accept a foreign-event fallback parameter on `deserialize`/`tryDeserialize` unconditionally. The system SHALL consult it only when deserializing in `cloudevent` mode. The system SHALL ignore it when deserializing in `arvoevent` mode, since that mode has no foreign-event concept.

#### Scenario: A fallback is ignored in ArvoEvent mode
- **WHEN** an `arvoevent`-mode `deserialize` is called with a fallback argument supplied
- **THEN** the fallback has no effect on the outcome

### Requirement: Generic Type Narrowing on Deserialization

The system SHALL allow a caller to assert the expected event type and payload shape on `deserialize`/`tryDeserialize` via type parameters, mirroring `ArvoEvent.parse`/`ArvoEvent.tryParse` and `CloudEventConverter.revert`/`tryRevert`'s own shape. This assertion SHALL be compile-time only; the system SHALL NOT validate the payload against the asserted shape at runtime.

#### Scenario: A caller-asserted type narrows the returned ArvoEvent
- **WHEN** `deserialize<T, D>` is called with explicit type parameters
- **THEN** the returned value is typed `ArvoEvent<T, D>`, without runtime verification that the payload actually matches `D`
