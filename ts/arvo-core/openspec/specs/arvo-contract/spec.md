# arvo-contract Specification

## Purpose

An ArvoContract is the versioned interface declaration through which independently built participants agree on what a handler accepts and what it may emit. This capability defines a contract's field set, its defaults, the per-version isolation model, the grammar its declared identifiers must follow, the handler error every version carries, and what makes a declaration valid or rejected.

## Requirements

### Requirement: Contract Field Set

A contract SHALL consist of exactly six fields and no others: `uri`, `type`, `versions`, `description`, `domain`, `metadata`.

#### Scenario: Contract exposes exactly the defined fields
- **WHEN** a contract is declared successfully
- **THEN** it carries all six fields
- **AND** it carries no additional field

### Requirement: Required and Defaulted Inputs

The system SHALL require `type` and `versions` to be supplied. The system SHALL default `uri` to the value derived from `type`, `description` to null, `domain` to null, and `metadata` to an empty object.

#### Scenario: Minimal declaration
- **WHEN** a contract is declared with only `type` and a non-empty `versions`
- **THEN** declaration succeeds
- **AND** `description` is null
- **AND** `domain` is null
- **AND** `metadata` is an empty object

#### Scenario: A required input is omitted
- **WHEN** `type` or `versions` is absent
- **THEN** declaration fails
- **AND** the failure names the missing field

#### Scenario: Defaults are materialized, not absent
- **WHEN** a contract is declared without `description`, `domain`, or `metadata`
- **THEN** each is present at its default value rather than undefined

### Requirement: URI Derivation

When `uri` is not supplied, the system SHALL derive it from `type` by replacing every occurrence of `_` with `/` and prepending `#/`. A supplied `uri` SHALL be stored as given and SHALL NOT be overridden by derivation.

#### Scenario: Every underscore is replaced, not only the first
- **WHEN** a contract is declared with `type` of `com_payment_process` and no `uri`
- **THEN** `uri` is `#/com/payment/process`

#### Scenario: Single-segment type
- **WHEN** a contract is declared with `type` of `payment` and no `uri`
- **THEN** `uri` is `#/payment`

#### Scenario: Explicit uri wins over derivation
- **WHEN** a contract is declared with `type` of `com_user_register` and an explicit `uri` of `#/services/identity/user/registration`
- **THEN** `uri` is `#/services/identity/user/registration`

### Requirement: URI Validity

The system SHALL require `uri` to be a non-empty, valid RFC 3986 URI-reference in canonical form. A non-canonical value SHALL be rejected rather than normalized.

#### Scenario: Empty uri
- **WHEN** a contract is declared with an explicit empty-string `uri`
- **THEN** declaration fails

#### Scenario: Non-canonical uri
- **WHEN** a contract is declared with a `uri` whose percent-encoding, case, or dot-segments are not already canonical
- **THEN** declaration fails
- **AND** the value is not silently normalized

#### Scenario: Derived uri is canonical
- **WHEN** `uri` is derived from a valid `type`
- **THEN** the derived value satisfies this requirement without further adjustment

### Requirement: Contract-Declared Identifier Grammar

The system SHALL require `type`, every key of a version's `emits`, and `domain` when not null to match `^[a-z0-9]+(_[a-z0-9]+)*$`.

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

### Requirement: Version Keys

The system SHALL require every key of `versions` to be a bare `MAJOR.MINOR.PATCH` triple of non-negative integers without leading zeros, carrying no pre-release suffix and no build metadata. The system SHALL require `versions` to contain at least one entry.

#### Scenario: Valid version key
- **WHEN** a version key is `1.0.0` or `0.0.0` or `10.20.30`
- **THEN** it is accepted

#### Scenario: Pre-release suffix
- **WHEN** a version key is `1.0.0-beta`
- **THEN** declaration fails

#### Scenario: Build metadata
- **WHEN** a version key is `1.0.0+build`
- **THEN** declaration fails

#### Scenario: Leading zeros
- **WHEN** a version key is `01.0.0`
- **THEN** declaration fails

#### Scenario: Partial version
- **WHEN** a version key is `1.0`
- **THEN** declaration fails

#### Scenario: No versions declared
- **WHEN** `versions` is empty
- **THEN** declaration fails

### Requirement: Version Definition

The system SHALL require each version definition to supply `accepts` and `emits`.

#### Scenario: Both supplied
- **WHEN** a version supplies an `accepts` schema and an `emits` map
- **THEN** the version is accepted

#### Scenario: Either omitted
- **WHEN** a version omits `accepts` or omits `emits`
- **THEN** declaration fails
- **AND** the failure names the version and the missing field

### Requirement: Object-Shaped Payloads

The system SHALL require a version's `accepts` schema, and every schema in its `emits`, to describe an object at its top level. A schema that does not SHALL be rejected at declaration rather than at validation time.

#### Scenario: Object schema
- **WHEN** a version's `accepts` describes an object
- **THEN** the version is accepted

#### Scenario: Non-object schema
- **WHEN** a version's `accepts` or any emit describes a string, number, array, or any other non-object
- **THEN** declaration fails
- **AND** the failure names the offending position

### Requirement: Emit Key Collisions

The system SHALL reject a version whose `emits` uses the contract's own `type` as a key, or uses the handler error type for that contract as a key.

#### Scenario: Emit key equals the contract type
- **WHEN** a contract of `type` `com_order_create` declares an emit keyed `com_order_create`
- **THEN** declaration fails

#### Scenario: Emit key equals the handler error type
- **WHEN** a contract of `type` `com_order_create` declares an emit keyed `handler_com_order_create_error`
- **THEN** declaration fails

#### Scenario: An unrelated handler-error-shaped key is permitted
- **WHEN** a contract of `type` `com_order_create` declares an emit keyed `handler_com_payment_process_error`
- **THEN** declaration succeeds
- **AND** no cross-contract name reservation is applied

### Requirement: Empty Emits

The system SHALL permit a version to declare an empty `emits`.

#### Scenario: Version declaring no emits
- **WHEN** a version declares `emits` as an empty map
- **THEN** declaration succeeds
- **AND** the version's handler error remains available

### Requirement: Per-Version Materialization

The system SHALL materialize each declared version as a standalone version contract carrying that version's `accepts` and `emits` together with the contract's `uri`, `type`, `domain`, `description`, and `metadata`. Each declared version SHALL be individually addressable by its version key.

#### Scenario: Version carries the contract's identity
- **WHEN** a contract declaring version `1.0.0` is declared
- **THEN** that version exposes the contract's `uri`, `type`, `domain`, `description`, and `metadata`
- **AND** it exposes its own `accepts` and `emits`
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
- **WHEN** version `1.1.0` declares an `accepts` with a required field absent from version `1.0.0`
- **THEN** declaration succeeds

#### Scenario: Same emit type, different payload
- **WHEN** two versions declare the same emit key with different payload schemas
- **THEN** declaration succeeds
- **AND** each version retains its own schema for that key

### Requirement: Version Dataschema

A version contract SHALL expose a `dataschema` value formed as the contract's `uri`, a `/`, and that version.

#### Scenario: Dataschema composition
- **WHEN** a contract with `uri` of `#/com/order/create` declares version `1.0.0`
- **THEN** that version's `dataschema` is `#/com/order/create/1.0.0`

#### Scenario: Dataschema is per version
- **WHEN** a contract declares versions `1.0.0` and `1.1.0`
- **THEN** each version's `dataschema` ends with its own version

### Requirement: Handler Error

Every version SHALL carry a handler error, available regardless of what that version's `emits` declares. Its type SHALL be the contract's `type` in the pattern `handler_{type}_error`. Its payload SHALL be an object with `error_name` (string), `error_message` (string), and `error_stack` (string or null), invariant across versions. Its `dataschema` SHALL be that of the version that carries it.

The handler error SHALL be derived from `type` and the version rather than declared, and SHALL NOT be a stored entry of `emits`.

#### Scenario: Handler error type
- **WHEN** a contract of `type` `com_payment_process` is declared
- **THEN** every version's handler error type is `handler_com_payment_process_error`

#### Scenario: Handler error payload is invariant
- **WHEN** a contract declares versions `1.0.0` and `1.1.0`
- **THEN** both versions' handler error payloads have the same shape

#### Scenario: Handler error dataschema follows its version
- **WHEN** version `1.1.0` of a contract with `uri` `#/com/order/create` carries a handler error
- **THEN** that handler error's `dataschema` is `#/com/order/create/1.1.0`

#### Scenario: Handler error is available to a version declaring no emits
- **WHEN** a version declares an empty `emits`
- **THEN** its handler error is still available

#### Scenario: Handler error is not a declared emit
- **WHEN** a version is declared
- **THEN** its `emits` does not contain the handler error

### Requirement: Declaration-Time Rejection Reports Every Failure

The system SHALL validate a contract when it is declared, and SHALL report every rule the declaration broke that can be meaningfully evaluated, rather than only the first. Each reported failure SHALL identify the position within the contract that broke it.

A rule SHALL NOT be reported when the value it would judge could not be established because a prerequisite failed — see **Prerequisite Validity Of `type`**. The system SHALL NOT report a derived value as a failure when that value could not be derived.

#### Scenario: Multiple independent failures
- **WHEN** a contract is declared with a malformed `domain`, two malformed `emits` keys, and a malformed version key
- **THEN** declaration fails
- **AND** the failure names all four problems

#### Scenario: Failures across versions
- **WHEN** a contract declares two versions and each breaks a rule
- **THEN** the failure names the problem in both versions

#### Scenario: Failure positions are identified
- **WHEN** a version's emit key is malformed
- **THEN** the reported failure identifies the version and the offending key

#### Scenario: Aggregation is unaffected when `type` is valid
- **WHEN** a contract with a valid `type` is declared with faults in several other positions
- **THEN** the failure names every one of them

### Requirement: Prerequisite Validity Of `type`

`type` SHALL be validated before any rule that depends on it. When `type` is invalid, the system SHALL report that failure alone and SHALL NOT evaluate the remaining rules. The reported failure SHALL state that the remaining rules were not evaluated, so a reader is not left to infer that nothing else is wrong.

This SHALL apply wherever a contract or a standalone version contract is declared.

#### Scenario: An invalid `type` is reported alone
- **WHEN** a contract is declared with an invalid `type` and faults in other positions
- **THEN** declaration fails
- **AND** the only reported failure is the one naming `type`

#### Scenario: The reader is told the run stopped
- **WHEN** declaration fails because `type` is invalid
- **THEN** the failure states that the remaining rules were not evaluated

#### Scenario: A derived `uri` is not reported when it could not be derived
- **WHEN** a contract is declared with an invalid `type` and no `uri`
- **THEN** no failure names `uri`

#### Scenario: A supplied `uri` is still the caller's to answer for
- **WHEN** a contract is declared with a valid `type` and an invalid `uri`
- **THEN** the failure names `uri`

#### Scenario: A standalone version contract behaves the same way
- **WHEN** a version contract is declared directly with an invalid `type` and faults in other positions
- **THEN** the only reported failure is the one naming `type`

### Requirement: Standalone Version Declaration

A version contract SHALL be declarable directly, without a containing contract, and SHALL be validated by the same version-level rules applied when it is materialized from a contract.

#### Scenario: Valid standalone version
- **WHEN** a version contract is declared directly with a valid type, uri, version, accepts, and emits
- **THEN** declaration succeeds

#### Scenario: Invalid standalone version
- **WHEN** a version contract is declared directly with a malformed emit key
- **THEN** declaration fails on the same rule that would have rejected it within a contract

#### Scenario: A contract's own materialization never fails version validation
- **WHEN** a contract is declared successfully
- **THEN** every version it materializes satisfies the version-level rules

### Requirement: Immutability

A declared contract and its version contracts SHALL NOT be mutable after declaration.

#### Scenario: Mutating a declared contract
- **WHEN** any field of a declared contract or version contract is assigned
- **THEN** the assignment does not take effect
