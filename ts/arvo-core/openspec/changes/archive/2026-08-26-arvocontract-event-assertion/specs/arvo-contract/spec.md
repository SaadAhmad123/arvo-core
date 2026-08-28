## ADDED Requirements

### Requirement: Asserting An Event Against A Version

A version contract SHALL determine whether an event matches one of the three shapes it declares — its `accepts`, one of its `emits`, or its handler error — and SHALL report which of the three matched.

#### Scenario: An event matching accepts
- **WHEN** an event whose `type` is the contract's `type` and whose payload satisfies that version's `accepts` is asserted
- **THEN** the assertion succeeds
- **AND** the result reports the scope as the accepted request

#### Scenario: An event matching a declared emit
- **WHEN** an event whose `type` is one of the version's `emits` keys and whose payload satisfies that emit's schema is asserted
- **THEN** the assertion succeeds
- **AND** the result reports the scope as an emit

#### Scenario: An event matching the handler error
- **WHEN** an event whose `type` is the version's handler error type and whose payload satisfies the handler error shape is asserted
- **THEN** the assertion succeeds
- **AND** the result reports the scope as the handler error

#### Scenario: The handler error is assertable for a version declaring no emits
- **WHEN** a version declaring an empty `emits` asserts its handler error event
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

A contract and a version contract SHALL each check an event's `dataschema` themselves, neither relying on the other to have done so.

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

Beyond checking the `dataschema` against the versions it declares, the contract SHALL NOT apply rules of its own, so that an event a contract accepts is exactly an event one of its versions accepts.

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

What may be expected SHALL be limited to what that version declares: its `type`, one of its `emits` keys, or its handler error type. Expecting anything else SHALL fail.

A contract SHALL NOT accept such a statement, the version it would be checked against not yet being known.

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

Five failures SHALL be reported before any payload is examined, and each SHALL report the position named below, so that they are distinguishable without reading the failure's wording:

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

Where the event's `type` is not the shape being checked — matching none of the version's declared shapes, or not being the type the caller expected — the system SHALL NOT examine the payload. The payload belongs to a different shape than the one in hand, so any rule applied to it would be a rule the event never claimed to satisfy.

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
