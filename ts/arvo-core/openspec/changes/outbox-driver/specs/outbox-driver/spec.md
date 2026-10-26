## Purpose

The outbox driver: the one party on Arvo's side that calls an outbox, building what it stores, checking and restoring what it returns, and reporting every failure as one error whose kind says why. Implements [ADR-020](../../../../../docs/adr/020-outbox-driver.md).

## ADDED Requirements

### Requirement: One Party Calls The Outbox

The driver SHALL be built with the outbox it calls, and SHALL be the only party that calls it, opening and closing included. It SHALL NOT itself offer the outbox's interface.

#### Scenario: Opening and closing through the driver

- **WHEN** the driver is opened or closed
- **THEN** it opens or closes its outbox, and a failure of either is reported as the driver's error, kind `unavailable`

#### Scenario: Not an outbox

- **WHEN** the driver is offered where an outbox is expected
- **THEN** it is not accepted, since it takes live events and reports failure in Arvo's shape

### Requirement: The Driver Builds Every Event Record

For each live event to commit, the driver SHALL write the event as CloudEvent JSON by ADR-003's forward transformation and build the event record with that string as its payload. Every other field of the record SHALL be taken from the event, except the triggering event's identifier, from the delivered event, and the revision, from the execution record or none where events commit alone.

#### Scenario: Events committed with a record

- **WHEN** a record and its events are committed
- **THEN** each event record carries the event's fields, the delivered event's identifier, the record's revision, and the event as CloudEvent JSON

#### Scenario: Events committed alone

- **WHEN** events are committed with no record
- **THEN** each event record carries no revision

### Requirement: The Driver Lifts The Commit's Fields Off The Record

The driver SHALL take the execution, revision, subject, source, version and lifecycle off the execution record and pass them beside it, so the outbox never opens the record. The record itself SHALL be passed whole and unchanged.

#### Scenario: A record committed

- **WHEN** a record is committed
- **THEN** the outbox receives those six fields as plain values beside the record, which is the document the driver was given

### Requirement: A Record Missing A Field Is The Caller's Error

Where a record handed to the driver lacks a field it must lift, or holds one of the wrong type, the driver SHALL throw a validation error naming every such field, and SHALL call nothing on the outbox. This SHALL NOT be one of the driver's error kinds.

#### Scenario: A record with no revision

- **WHEN** a record without a revision, or with a revision that is not a whole number, is committed
- **THEN** the validation error names the field and the outbox is not called

### Requirement: The Driver Removes No Duplicates

The driver SHALL pass every event it is given to the outbox, removing none, whatever it holds or the outbox holds.

#### Scenario: An event given twice

- **WHEN** a commit carries an event the outbox already holds, or one event twice
- **THEN** every event is passed on, and the outbox decides

### Requirement: Every Return Is Checked

The driver SHALL check every value the outbox returns before handing anything on: a state read SHALL be a JSON object or none, else `malformed_state`; a commit outcome SHALL be well formed, else `malformed_response`; every event record SHALL carry every field with its type, else `malformed_event`.

#### Scenario: A state that is not an object

- **WHEN** the outbox answers a state read with something that is not a JSON object or none
- **THEN** the driver reports `malformed_state`

#### Scenario: A malformed outcome

- **WHEN** the outbox answers a commit with something that is not a well-formed outcome
- **THEN** the driver reports `malformed_response`

#### Scenario: An event record missing a field

- **WHEN** the outbox answers a read of events with a record missing a field, or a field of the wrong type
- **THEN** the driver reports `malformed_event`

#### Scenario: A list that is not a list

- **WHEN** the outbox answers a read of events with something that is not a list
- **THEN** the driver reports `malformed_response`

### Requirement: Payloads Are Restored Strictly, By Default

Reading committed events and listing unseen events SHALL restore each payload to a live event by ADR-003's strict, Arvo-shaped reverse, answering each record beside its event. Restoring SHALL be on unless the caller turns it off for that read; off, each record is answered with no event and its payload as stored. A payload that will not restore SHALL be `malformed_event`.

#### Scenario: A payload restored

- **WHEN** events are read with restoring on
- **THEN** each record is answered beside the live event its payload holds

#### Scenario: Restoring turned off

- **WHEN** events are read with restoring off
- **THEN** each record is answered with no event, and a payload that would not restore is not reported

#### Scenario: A payload that is not an Arvo event

- **WHEN** a payload is not JSON, or is a CloudEvent that is not Arvo-shaped
- **THEN** the driver reports `malformed_event`

### Requirement: One Error Whose Kind Says Why

Every failure the driver reports SHALL be one error type carrying a kind, the operation, and the cause. The kinds SHALL be exactly `state_exists`, `revision_stale`, `unavailable`, `malformed_state`, `malformed_event` and `malformed_response`. Anything the outbox throws SHALL be `unavailable`, with what it threw as the cause.

#### Scenario: The outbox throws

- **WHEN** any call to the outbox throws
- **THEN** the driver reports `unavailable` for that operation, carrying what was thrown

### Requirement: A Refused Commit Is An Error

Where the outbox refuses a commit, the driver SHALL report its error with the refusal as the kind, and SHALL NOT report the commit as done.

#### Scenario: A commit that lost a race

- **WHEN** the outbox refuses a commit as `state_exists` or `revision_stale`
- **THEN** the driver reports that kind

### Requirement: Each Operation Answers Both Ways

Every operation SHALL be offered as a call answering its failure as a value and as one throwing it, the two reporting the same error.

#### Scenario: The throwing form

- **WHEN** an operation fails through its throwing form
- **THEN** it throws the error its value-answering form would have answered

### Requirement: The Driver Decides Nothing

The driver SHALL NOT retry, re-read on a refusal, abandon, sweep, or build a fault. Each operation SHALL call the outbox once and report what came of it.

#### Scenario: A refusal reported, not acted on

- **WHEN** a commit is refused
- **THEN** the driver calls the outbox no further for it

### Requirement: One Span Per Call

The driver SHALL open one span per operation, continuing the trace active where it was called, with the telemetry given to that call, and SHALL end it however the call ends.

#### Scenario: A call under a trace

- **WHEN** an operation is called inside an active span
- **THEN** its span is a child of that span, and is ended whether the call succeeds or fails
