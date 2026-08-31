## MODIFIED Requirements

### Requirement: Contract-Declared Identifier Grammar

The system SHALL require `type`, every key of a version's `outputs`, and `domain` when not null to match `^[a-z0-9]+(_[a-z0-9]+)*$`.

This grammar SHALL constrain only what a contract declares. It SHALL NOT constrain the values `ArvoEvent.type` or `ArvoEvent.domain` may hold.

#### Scenario: Valid identifiers
- **WHEN** an identifier is `com_payment_process`, `payment`, or `v2_order_created`
- **THEN** it is accepted

#### Scenario: Leading or trailing underscore
- **WHEN** an identifier is `_com_payment` or `com_payment_`
- **THEN** declaration fails

#### Scenario: Consecutive underscores
- **WHEN** an identifier is `com__payment`
- **THEN** declaration fails

#### Scenario: Uppercase
- **WHEN** an identifier is `Com_Payment_Process`
- **THEN** declaration fails

#### Scenario: Dotted identifier
- **WHEN** an identifier is `com.payment.process`
- **THEN** declaration fails

#### Scenario: Event values are unaffected
- **WHEN** an ArvoEvent carries a dotted `type` or `domain` from a foreign producer
- **THEN** this grammar does not apply to it
- **AND** the event remains valid under its own rules

### Requirement: Version Definition

The system SHALL require each version definition to supply `input` and `outputs`.

#### Scenario: Both supplied
- **WHEN** a version supplies an `input` schema and an `outputs` map
- **THEN** the version is accepted

#### Scenario: Either omitted
- **WHEN** a version omits `input` or omits `outputs`
- **THEN** declaration fails
- **AND** the failure names the version and the missing field

### Requirement: Object-Shaped Payloads

The system SHALL require a version's `input` schema, and every schema in its `outputs`, to describe an object at its top level. A schema that does not SHALL be rejected at declaration rather than at validation time.

#### Scenario: Object schema
- **WHEN** a version's `input` describes an object
- **THEN** the version is accepted

#### Scenario: Non-object schema
- **WHEN** a version's `input` or any emit describes a string, number, array, or any other non-object
- **THEN** declaration fails
- **AND** the failure names the offending position

### Requirement: Output Key Collisions

The system SHALL reject a version whose `outputs` uses the contract's own `type` as a key, or uses the handler error type for that contract as a key.

#### Scenario: Output key equals the contract type
- **WHEN** a contract of `type` `com_order_create` declares an output keyed `com_order_create`
- **THEN** declaration fails

#### Scenario: Output key equals the handler error type
- **WHEN** a contract of `type` `com_order_create` declares an output keyed `handler_com_order_create_error`
- **THEN** declaration fails

#### Scenario: An unrelated handler-error-shaped key is permitted
- **WHEN** a contract of `type` `com_order_create` declares an output keyed `handler_com_payment_process_error`
- **THEN** declaration succeeds
- **AND** no cross-contract name reservation is applied

### Requirement: Empty Outputs

The system SHALL permit a version to declare an empty `outputs`.

#### Scenario: Version declaring no outputs
- **WHEN** a version declares `outputs` as an empty map
- **THEN** declaration succeeds
- **AND** the version's handler error remains available

### Requirement: Per-Version Materialization

The system SHALL materialize each declared version as a standalone version contract carrying that version's `input` and `outputs` together with the contract's `uri`, `type`, `domain`, `description`, and `metadata`. Each declared version SHALL be individually addressable by its version key.

#### Scenario: Version carries the contract's identity
- **WHEN** a contract declaring version `1.0.0` is declared
- **THEN** that version exposes the contract's `uri`, `type`, `domain`, `description`, and `metadata`
- **AND** it exposes its own `input` and `outputs`
- **AND** it exposes its own version

#### Scenario: Declared version is addressable
- **WHEN** a contract declares versions `1.0.0` and `1.1.0`
- **THEN** each is retrievable by its own key

#### Scenario: Undeclared version is not addressable
- **WHEN** a version key that was not declared is requested
- **THEN** it does not resolve to a version contract

### Requirement: Version Isolation

Versions of one contract SHALL be independent. The system SHALL NOT infer, inherit, or require compatibility between any two versions.

#### Scenario: Versions may differ arbitrarily
- **WHEN** version `1.1.0` declares an `input` with a required field absent from version `1.0.0`
- **THEN** declaration succeeds

#### Scenario: Same output type, different payload
- **WHEN** two versions declare the same output key with different payload schemas
- **THEN** declaration succeeds
- **AND** each version retains its own schema for that key

### Requirement: Handler Error

Every version SHALL carry a handler error, available regardless of what that version's `outputs` declares. Its type SHALL be the contract's `type` in the pattern `handler_{type}_error`. Its payload SHALL be an object with `error_name` (string), `error_message` (string), and `error_stack` (string or null), invariant across versions. Its `dataschema` SHALL be that of the version that carries it.

The handler error SHALL be derived from `type` and the version rather than declared, and SHALL NOT be a stored entry of `outputs`.

#### Scenario: Handler error type
- **WHEN** a contract of `type` `com_payment_process` is declared
- **THEN** every version's handler error type is `handler_com_payment_process_error`

#### Scenario: Handler error payload is invariant
- **WHEN** a contract declares versions `1.0.0` and `1.1.0`
- **THEN** both versions' handler error payloads have the same shape

#### Scenario: Handler error dataschema follows its version
- **WHEN** version `1.1.0` of a contract with `uri` `#/com/order/create` carries a handler error
- **THEN** that handler error's `dataschema` is `#/com/order/create/1.1.0`

#### Scenario: Handler error is available to a version declaring no outputs
- **WHEN** a version declares an empty `outputs`
- **THEN** its handler error is still available

#### Scenario: Handler error is not a declared output
- **WHEN** a version is declared
- **THEN** its `outputs` does not contain the handler error

### Requirement: Declaration-Time Rejection Reports Every Failure

The system SHALL validate a contract when it is declared, and SHALL report every rule the declaration broke that can be meaningfully evaluated, rather than only the first. Each reported failure SHALL identify the position within the contract that broke it.

A rule SHALL NOT be reported when the value it would judge could not be established because a prerequisite failed — see **Prerequisite Validity Of `type`**. The system SHALL NOT report a derived value as a failure when that value could not be derived.

#### Scenario: Multiple independent failures
- **WHEN** a contract is declared with a malformed `domain`, two malformed `outputs` keys, and a malformed version key
- **THEN** declaration fails
- **AND** the failure names all four problems

#### Scenario: Failures across versions
- **WHEN** a contract declares two versions and each breaks a rule
- **THEN** the failure names the problem in both versions

#### Scenario: Failure positions are identified
- **WHEN** a version's output key is malformed
- **THEN** the reported failure identifies the version and the offending key

#### Scenario: Aggregation is unaffected when `type` is valid
- **WHEN** a contract with a valid `type` is declared with faults in several other positions
- **THEN** the failure names every one of them

### Requirement: Standalone Version Declaration

A version contract SHALL be declarable directly, without a containing contract, and SHALL be validated by the same version-level rules applied when it is materialized from a contract.

#### Scenario: Valid standalone version
- **WHEN** a version contract is declared directly with a valid type, uri, version, input, and outputs
- **THEN** declaration succeeds

#### Scenario: Invalid standalone version
- **WHEN** a version contract is declared directly with a malformed output key
- **THEN** declaration fails on the same rule that would have rejected it within a contract

#### Scenario: A contract's own materialization never fails version validation
- **WHEN** a contract is declared successfully
- **THEN** every version it materializes satisfies the version-level rules

### Requirement: Asserting An Event Against A Version

A version contract SHALL determine whether an event matches one of the three shapes it declares — its `input`, one of its `outputs`, or its handler error — and SHALL report which of the three matched.

#### Scenario: An event matching the input
- **WHEN** an event whose `type` is the contract's `type` and whose payload satisfies that version's `input` is asserted
- **THEN** the assertion succeeds
- **AND** the result reports the scope as the accepted request

#### Scenario: An event matching a declared output
- **WHEN** an event whose `type` is one of the version's `outputs` keys and whose payload satisfies that emit's schema is asserted
- **THEN** the assertion succeeds
- **AND** the result reports the scope as an output

#### Scenario: An event matching the handler error
- **WHEN** an event whose `type` is the version's handler error type and whose payload satisfies the handler error shape is asserted
- **THEN** the assertion succeeds
- **AND** the result reports the scope as the handler error

#### Scenario: The handler error is assertable for a version declaring no outputs
- **WHEN** a version declaring an empty `outputs` asserts its handler error event
- **THEN** the assertion succeeds

#### Scenario: An event matching none of the three
- **WHEN** an event whose `type` is none of the version's declared types is asserted
- **THEN** the assertion fails
- **AND** the failure names the type it was given

### Requirement: Expecting A Particular Type

A version contract SHALL accept an optional statement of which type the caller expects, and SHALL confirm or contradict it.

What may be expected SHALL be limited to what that version declares: its `type`, one of its `outputs` keys, or its handler error type. Expecting anything else SHALL fail.

A contract SHALL NOT accept such a statement.

#### Scenario: A correct expectation
- **WHEN** an event is asserted against the type the event actually carries
- **THEN** the assertion succeeds

#### Scenario: An expectation the event contradicts
- **WHEN** an event is asserted against a type this version declares but the event does not carry
- **THEN** the assertion fails
- **AND** the failure names both what was expected and what was found
- **AND** the failure is reported at the event's type, the expectation itself being declarable

#### Scenario: An expectation the version does not declare
- **WHEN** an event is asserted against a type the version does not declare
- **THEN** the assertion fails
- **AND** the failure identifies the expectation as the problem

#### Scenario: Asserting without an expectation
- **WHEN** an event is asserted with no expected type supplied
- **THEN** any of the version's three shapes may match
- **AND** the result reports which one did
