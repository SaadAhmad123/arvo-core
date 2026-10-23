## MODIFIED Requirements

### Requirement: Handler Error

Every version SHALL carry a handler error, available regardless of what that version's `outputs` declares. Its type SHALL be the contract's `type` in the pattern `handler_{type}_error`. Its payload SHALL be an object with `error_name` (string), `error_message` (string), and `error_stack` (string or null), invariant across versions. Its `dataschema` SHALL be that of the version that carries it.

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

### Requirement: Declaration-Time Rejection Reports Every Failure

The system SHALL validate a contract when it is declared, and SHALL report every rule the declaration broke that can be meaningfully evaluated, rather than only the first.

A rule SHALL NOT be reported when the value it would judge could not be established because a prerequisite failed — see **Prerequisite Validity Of `type`**. The system SHALL NOT report a derived value as a failure when that value could not be derived.

#### Scenario: Multiple independent failures
- **WHEN** a contract is declared with a malformed `domain`, two malformed `outputs` keys, and a malformed version key
- **THEN** declaration fails
- **AND** the failure names all four problems

#### Scenario: Failures across versions
- **WHEN** a contract declares two versions and each breaks a rule
- **THEN** the failure names the problem in both versions

#### Scenario: Aggregation is unaffected when `type` is valid
- **WHEN** a contract with a valid `type` is declared with faults in several other positions
- **THEN** the failure names every one of them

### Requirement: An Event's Dataschema Is Read As An Identifier And A Version

An event's `dataschema` SHALL be accepted only in the form `{uri}/{version}`. The version SHALL be its final segment and the identifier everything preceding that segment.

A `dataschema` SHALL be treated as not of that form only when it carries no separator, or when either part is empty. It SHALL then fail, reported at the position `event.dataschema` rather than at either part.

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

#### Scenario: An undeclared expectation is attributed to the expectation
- **WHEN** the assertion fails because the expected type is not declared by the version
- **THEN** the reported position is `expectedType`

#### Scenario: A foreign contract is attributed to the identifier
- **WHEN** the assertion fails because the event's `dataschema` names a different contract
- **THEN** the reported position is `event.dataschema.uri`

#### Scenario: An unknown version is attributed to the version
- **WHEN** the assertion fails because the event's `dataschema` names a version other than the one being asked
- **THEN** the reported position is `event.dataschema.version`

#### Scenario: The five are not interchangeable
- **WHEN** each of the five failures occurs in turn
- **THEN** each reports a position distinct from the other four

## ADDED Requirements

### Requirement: The Handler Error Is Derived Rather Than Declared

The handler error SHALL be derived from `type` and the version rather than declared, and SHALL NOT be a stored entry of `outputs`.

#### Scenario: Handler error is not a declared output
- **WHEN** a version is declared
- **THEN** its `outputs` does not contain the handler error

### Requirement: Declaration-Time Failures Identify Their Position

Each reported failure SHALL identify the position within the contract that broke the rule.

#### Scenario: Failure positions are identified
- **WHEN** a version's output key is malformed
- **THEN** the reported failure identifies the version and the offending key

### Requirement: A Dataschema's Version Part Is Compared As It Stands

A `dataschema` carrying two non-empty parts SHALL be judged as those two parts, whatever they contain. The version part SHALL be compared as it stands against the versions declared, and SHALL NOT be required to be a well-formed version before that comparison.

#### Scenario: A version part that is not a well-formed version
- **WHEN** an event's `dataschema` has two non-empty parts and the version part is not a well-formed version
- **THEN** it is compared against the versions declared as it stands
- **AND** the failure is reported at `event.dataschema.version`, the version not being one that is declared

### Requirement: Both Ways A Type Can Be Wrong Are Reported At The Type

The failure of a `type` that is not the shape being checked covers both ways a type can be wrong: matching none of the version's declared shapes, and not being the type the caller expected. Both SHALL be reported at `event.type`.

#### Scenario: An unmatched type is attributed to the type
- **WHEN** the assertion fails because the event's `type` matches none of the version's declared shapes
- **THEN** the reported position is `event.type`

#### Scenario: A contradicted expectation is attributed to the type
- **WHEN** the assertion fails because the event's `type` is not the type expected, the version declaring both
- **THEN** the reported position is `event.type`
- **AND** not `expectedType`, which the version does declare

### Requirement: Prerequisite Failures Are Evaluated In Order

The five failures listed in *Prerequisite Failures Report Distinct Positions* SHALL be evaluated in the order listed, and the first to fail SHALL be reported on its own.

#### Scenario: An unanswerable request is reported before anything about the event
- **WHEN** an event addressed to another contract is asserted against a type the version does not declare
- **THEN** the reported position is `expectedType`
- **AND** no failure of the event is reported alongside it

#### Scenario: One blocking failure at a time
- **WHEN** an event fails more than one of these
- **THEN** only the first in the order above is reported

### Requirement: A Prerequisite Failure States That The Remaining Rules Did Not Run

Each failure listed in *Prerequisite Failures Report Distinct Positions* SHALL state that the remaining rules were not evaluated.

#### Scenario: Nothing further is evaluated
- **WHEN** any of the five occurs
- **THEN** the failure states that the remaining rules did not run
