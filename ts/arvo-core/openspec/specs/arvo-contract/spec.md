# arvo-contract Specification

## Purpose

An ArvoContract is the versioned interface declaration through which independently built participants agree on the event a handler takes in and the events it may put out. This capability defines a contract's field set, its defaults, the per-version isolation model, the grammar its declared identifiers must follow, the handler error every version carries, what makes a declaration valid or rejected, and how an event is checked against a declaration.

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

### Requirement: Version Dataschema

A version contract SHALL expose a `dataschema` value formed as the contract's `uri`, a `/`, and that version.

#### Scenario: Dataschema composition
- **WHEN** a contract with `uri` of `#/com/order/create` declares version `1.0.0`
- **THEN** that version's `dataschema` is `#/com/order/create/1.0.0`

#### Scenario: Dataschema is per version
- **WHEN** a contract declares versions `1.0.0` and `1.1.0`
- **THEN** each version's `dataschema` ends with its own version

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
- **WHEN** a version contract is declared directly with a valid type, uri, version, input, and outputs
- **THEN** declaration succeeds

#### Scenario: Invalid standalone version
- **WHEN** a version contract is declared directly with a malformed output key
- **THEN** declaration fails on the same rule that would have rejected it within a contract

#### Scenario: A contract's own materialization never fails version validation
- **WHEN** a contract is declared successfully
- **THEN** every version it materializes satisfies the version-level rules

### Requirement: Immutability

A declared contract and its version contracts SHALL NOT be mutable after declaration.

#### Scenario: Mutating a declared contract
- **WHEN** any field of a declared contract or version contract is assigned
- **THEN** the assignment does not take effect

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

### Requirement: An Event's Dataschema Is Read As An Identifier And A Version

An event's `dataschema` SHALL be accepted only in the form `{uri}/{version}`. The version SHALL be its final segment and the identifier everything preceding that segment.

A `dataschema` SHALL be treated as not of that form only when it carries no separator, or when either part is empty. It SHALL then fail, reported at the position `event.dataschema` rather than at either part.

A `dataschema` carrying two non-empty parts SHALL be judged as those two parts, whatever they contain. The version part SHALL be compared as it stands against the versions declared, and SHALL NOT be required to be a well-formed version before that comparison.

#### Scenario: The version is the final segment
- **WHEN** an event's `dataschema` is read
- **THEN** its final segment is taken as the version
- **AND** everything before that segment is taken as the identifier

#### Scenario: An identifier containing separators
- **WHEN** an event's `dataschema` identifier itself contains separators
- **THEN** the whole identifier is taken, not a leading part of it

#### Scenario: A dataschema with no separator
- **WHEN** an event's `dataschema` carries no separator
- **THEN** the assertion fails
- **AND** the reported position is `event.dataschema`
- **AND** no failure is reported against either the identifier or the version

#### Scenario: A dataschema with an empty part
- **WHEN** an event's `dataschema` has a separator but one of its two parts is empty
- **THEN** the assertion fails
- **AND** the reported position is `event.dataschema`

#### Scenario: A version part that is not a well-formed version
- **WHEN** an event's `dataschema` has two non-empty parts and the version part is not a well-formed version
- **THEN** it is compared against the versions declared as it stands
- **AND** the failure is reported at `event.dataschema.version`, the version not being one that is declared

### Requirement: Both A Contract And A Version Contract Check The Dataschema

A contract and a version contract SHALL each check an event's `dataschema` themselves, neither relying on the other.

Both SHALL check that the identifier is their own contract's, comparing it against the `uri` the contract holds. Neither SHALL derive, rebuild, or inspect the inside of that identifier. A contract SHALL check that the version is one of the versions it declares; a version contract SHALL check that the version is its own.

#### Scenario: A version contract rejects an event from another version
- **WHEN** an event whose `dataschema` names version `1.1.0` is asserted directly against version `1.0.0` of the same contract
- **THEN** the assertion fails
- **AND** the reported position is `event.dataschema.version`

#### Scenario: A version contract rejects an event from another contract
- **WHEN** an event whose `dataschema` names a different contract's identifier is asserted directly against a version contract
- **THEN** the assertion fails
- **AND** the reported position is `event.dataschema.uri`

#### Scenario: An identifier bearing no relation to the contract's type
- **WHEN** a contract whose `uri` was supplied explicitly, sharing nothing with its `type`, asserts an event carrying that `uri`
- **THEN** the identifier is accepted

#### Scenario: A version accepts the version it declares
- **WHEN** an event whose `dataschema` names the version contract's own version and contract is asserted against it
- **THEN** the `dataschema` is not the reason for any failure

#### Scenario: A result never disagrees with the event it carries
- **WHEN** an assertion succeeds
- **THEN** the version the result names is the version the event's `dataschema` names

### Requirement: A Result Names The Version That Validated It

Every successful assertion SHALL report the version whose declaration the event was checked against.

#### Scenario: A version contract reports its own version
- **WHEN** a version contract asserts an event successfully
- **THEN** the result names that version

#### Scenario: A contract reports the version it selected
- **WHEN** a contract declaring several versions asserts an event successfully
- **THEN** the result names the version the event belonged to, not the contract's other versions

### Requirement: Asserting An Event Against A Contract

A contract SHALL determine which of its declared versions an event belongs to from that event's `dataschema`, and SHALL then apply that version's own rules.

Beyond checking the `dataschema` against the versions it declares, the contract SHALL NOT apply rules of its own. An event a contract accepts SHALL be exactly an event one of its versions accepts.

#### Scenario: The version is taken from the event
- **WHEN** a contract declaring versions `1.0.0` and `1.1.0` asserts an event whose `dataschema` names version `1.1.0`
- **THEN** the event is checked against version `1.1.0`
- **AND** the result names version `1.1.0`

#### Scenario: A contract agrees with its own version
- **WHEN** the same event is asserted by a contract and by the version that contract would select
- **THEN** both succeed or both fail
- **AND** on success both report the same scope

#### Scenario: An event from a contract this is not
- **WHEN** an event whose `dataschema` names a different contract's `uri` is asserted
- **THEN** the assertion fails

#### Scenario: An event from a version this contract does not declare
- **WHEN** an event whose `dataschema` names a version the contract does not declare is asserted
- **THEN** the assertion fails
- **AND** the failure names the versions the contract does declare

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

### Requirement: Prerequisite Failures Report Distinct Positions

Five failures SHALL be reported before any payload is examined, and each SHALL report the position named below:

| What failed | Reported position |
|---|---|
| an expected type the version does not declare | `expectedType` |
| a `dataschema` not of the form `{uri}/{version}` | `event.dataschema` |
| a `dataschema` whose identifier is another contract's | `event.dataschema.uri` |
| a `dataschema` whose version is not the one being asked | `event.dataschema.version` |
| a `type` that is not the shape being checked | `event.type` |

These positions are the reported values themselves, not descriptions of them. Callers compare them, so changing one is a breaking change.

The last covers both ways a type can be wrong: matching none of the version's declared shapes, and not being the type the caller expected. Both SHALL be reported at `event.type`.

These SHALL be evaluated in the order listed, and the first to fail SHALL be reported on its own.

Each failure SHALL state that the remaining rules were not evaluated.

#### Scenario: An undeclared expectation is attributed to the expectation
- **WHEN** the assertion fails because the expected type is not declared by the version
- **THEN** the reported position is `expectedType`

#### Scenario: A foreign contract is attributed to the identifier
- **WHEN** the assertion fails because the event's `dataschema` names a different contract
- **THEN** the reported position is `event.dataschema.uri`

#### Scenario: An unknown version is attributed to the version
- **WHEN** the assertion fails because the event's `dataschema` names a version other than the one being asked
- **THEN** the reported position is `event.dataschema.version`

#### Scenario: An unmatched type is attributed to the type
- **WHEN** the assertion fails because the event's `type` matches none of the version's declared shapes
- **THEN** the reported position is `event.type`

#### Scenario: A contradicted expectation is attributed to the type
- **WHEN** the assertion fails because the event's `type` is not the type expected, the version declaring both
- **THEN** the reported position is `event.type`
- **AND** not `expectedType`, which the version does declare

#### Scenario: An unanswerable request is reported before anything about the event
- **WHEN** an event addressed to another contract is asserted against a type the version does not declare
- **THEN** the reported position is `expectedType`
- **AND** no failure of the event is reported alongside it

#### Scenario: One blocking failure at a time
- **WHEN** an event fails more than one of these
- **THEN** only the first in the order above is reported

#### Scenario: The five are not interchangeable
- **WHEN** each of the five failures occurs in turn
- **THEN** each reports a position distinct from the other four

#### Scenario: Nothing further is evaluated
- **WHEN** any of the five occurs
- **THEN** the failure states that the remaining rules did not run

### Requirement: A Type That Is Not The Shape Being Checked Stops Before The Payload

Where the event's `type` is not the shape being checked — matching none of the version's declared shapes, or not being the type the caller expected — the system SHALL NOT examine the payload.

#### Scenario: A bad payload is not reported alongside an unmatched type
- **WHEN** an event carrying an undeclared type and a payload no shape would accept is asserted
- **THEN** the failure names the unmatched type
- **AND** reports no failure of the payload

#### Scenario: A payload is not judged against a shape the event did not claim
- **WHEN** an event carrying one declared type is asserted against a different declared type
- **THEN** the failure names the type disagreement
- **AND** reports no failure of the payload

### Requirement: Payload Failures Are Reported Together, As The Schema Reported Them

Where a shape has been selected and the payload does not satisfy it, the system SHALL report every rule the payload broke rather than only the first.

Each SHALL identify the position within the payload that broke, as the schema identified it, and SHALL carry the schema's own account of what was wrong rather than a restatement of it.

Each SHALL also carry the value found at that position. Where the broken rule is a value's absence, there is no value to carry and none SHALL be reported.

#### Scenario: A payload failure names its position
- **WHEN** an event whose type matches but whose payload violates that schema is asserted
- **THEN** the reported position is the offending position within the payload, beneath `event.data`

#### Scenario: A payload breaking several rules
- **WHEN** an event's payload breaks more than one of the selected shape's rules
- **THEN** every one of them is reported

#### Scenario: A position nested within the payload
- **WHEN** the rule that broke is on a value nested inside the payload
- **THEN** the reported position names that nested value beneath `event.data`, not the payload as a whole

#### Scenario: The offending value is reported
- **WHEN** a value in the payload breaks a rule of the selected shape
- **THEN** the failure carries the value found at that position

#### Scenario: An absent value has nothing to report
- **WHEN** the rule that broke is that a required value is absent
- **THEN** the failure reports no value found

### Requirement: An Assertion Returns The Event It Was Given

On success the system SHALL return the event it was given, unchanged and not replaced. It SHALL NOT construct a new event, alter the payload, or apply a default the payload omitted.

#### Scenario: The event returned is the event supplied
- **WHEN** an event is asserted successfully
- **THEN** the result carries that same event

#### Scenario: A value the schema defaults and the payload omits stays absent
- **WHEN** an event omitting a field the selected schema declares a default for is asserted successfully
- **THEN** the returned payload does not carry that default

#### Scenario: The event is unchanged
- **WHEN** an event is asserted
- **THEN** the event is the same afterwards as before

### Requirement: Non-Throwing Primitive, Throwing Convenience

The system SHALL provide, on both a contract and a version contract, a primitive reporting its outcome as a value rather than raising, and a companion that raises on failure and returns the value directly on success. The companion SHALL contain no logic beyond unwrapping the primitive.

#### Scenario: The primitive does not raise
- **WHEN** the primitive is called and the event cannot be asserted
- **THEN** the outcome is reported as a value rather than raised

#### Scenario: The companion raises what the primitive reported
- **WHEN** the companion is called and the primitive would report a failure
- **THEN** the companion raises that same failure

#### Scenario: Both agree
- **WHEN** the same event is given to both
- **THEN** they agree on success or failure
- **AND** on success both produce the same result

### Requirement: Every Failure Is Reported As One Kind Of Failure

The system SHALL report every failed assertion, from either a contract or a version contract, as a single kind of failure carrying the positions that broke. It SHALL NOT vary the kind of failure by what went wrong.

Within that failure, the position SHALL distinguish a caller's own request from the event they supplied: an expected type the version does not declare is reported at `expectedType`, and every other failure is reported beneath `event`.

#### Scenario: The same kind of failure for a request problem and an event problem
- **WHEN** the assertion fails because the expected type is not declared, and again because the event's payload does not satisfy its schema
- **THEN** both are reported as the same kind of failure

#### Scenario: A contract and a version contract fail alike
- **WHEN** the assertion fails on a contract and on a version contract
- **THEN** both report the same kind of failure

#### Scenario: The caller's own request is identifiable by position
- **WHEN** the assertion fails because the expected type is not declared by the version
- **THEN** the reported position is `expectedType`

#### Scenario: An event problem is identifiable by position
- **WHEN** the assertion fails because the event is addressed elsewhere, carries an undeclared type, or carries a payload its schema rejects
- **THEN** the reported position is beneath `event`, not `expectedType`
