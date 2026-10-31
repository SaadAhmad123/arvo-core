## MODIFIED Requirements

### Requirement: Every Return Is Checked

The driver SHALL check every value the outbox returns before handing anything on: a state read SHALL be a JSON object or none, else `malformed_state`; a commit outcome, of either commit, SHALL be well formed, else `malformed_response`; a capacity answer SHALL be well formed, else `malformed_response`; every event record SHALL carry every field with its type, else `malformed_event`.

#### Scenario: A state that is not an object

- **WHEN** the outbox answers a state read with something that is not a JSON object or none
- **THEN** the driver reports `malformed_state`

#### Scenario: A malformed outcome

- **WHEN** the outbox answers a commit with something that is not a well-formed outcome
- **THEN** the driver reports `malformed_response`

#### Scenario: A malformed outcome of events alone

- **WHEN** the outbox answers a commit of events alone with nothing, or with a refusal other than `capacity_exhausted`
- **THEN** the driver reports `malformed_response`

#### Scenario: A malformed capacity answer

- **WHEN** the outbox answers a capacity question with a status it does not know, or a buffer whose numbers are not whole numbers zero or more
- **THEN** the driver reports `malformed_response`

#### Scenario: An event record missing a field

- **WHEN** the outbox answers a read of events with a record missing a field, or a field of the wrong type
- **THEN** the driver reports `malformed_event`

#### Scenario: A list that is not a list

- **WHEN** the outbox answers a read of events with something that is not a list
- **THEN** the driver reports `malformed_response`

### Requirement: One Error Whose Kind Says Why

Every failure the driver reports SHALL be one error type carrying a kind, the operation, and the cause. The kinds SHALL be exactly `state_exists`, `revision_stale`, `capacity_exhausted`, `unavailable`, `malformed_state`, `malformed_event` and `malformed_response`. Anything the outbox throws SHALL be `unavailable`, with what it threw as the cause.

#### Scenario: The outbox throws

- **WHEN** any call to the outbox throws
- **THEN** the driver reports `unavailable` for that operation, carrying what was thrown

### Requirement: A Refused Commit Is An Error

Where the outbox refuses a commit, the driver SHALL report its error with the refusal as the kind, and SHALL NOT report the commit as done. A commit of events alone SHALL be refused only as `capacity_exhausted`.

#### Scenario: A commit that lost a race

- **WHEN** the outbox refuses a commit as `state_exists` or `revision_stale`
- **THEN** the driver reports that kind

#### Scenario: A commit refused for lack of room

- **WHEN** the outbox refuses either commit as `capacity_exhausted`
- **THEN** the driver reports `capacity_exhausted`, carrying no capacity answer

### Requirement: The Driver Decides Nothing

The driver SHALL NOT retry, re-read on a refusal, abandon, sweep, or build a fault. Each operation SHALL call the outbox once and report what came of it, except that each commit SHALL first ask the outbox's capacity, and SHALL call the outbox no further where that question stops it.

#### Scenario: A refusal reported, not acted on

- **WHEN** a commit is refused
- **THEN** the driver calls the outbox no further for it

#### Scenario: A commit stopped by its question

- **WHEN** the capacity question before a commit answers `exhausted`, or fails
- **THEN** the driver does not call the outbox's commit

### Requirement: One Span Per Call

The driver SHALL open one span per operation, with the telemetry given to that call, as a child of the span the call names or, where it names none, of the span active where it was called, and SHALL end it however the call ends. The capacity question a commit asks first SHALL open no span of its own; what was asked and answered SHALL be recorded on the commit's span.

#### Scenario: A call under a trace

- **WHEN** an operation is called inside an active span
- **THEN** its span is a child of that span, and is ended whether the call succeeds or fails

#### Scenario: A call naming its parent

- **WHEN** an operation is called naming a span as its parent
- **THEN** its span is a child of that span, whatever span is active

#### Scenario: Asking capacity on its own

- **WHEN** the driver's capacity operation is called
- **THEN** it opens one span of its own

#### Scenario: The question inside a commit

- **WHEN** a commit asks the outbox's capacity first
- **THEN** only the commit's span is opened, and it records what was asked and what was answered

## ADDED Requirements

### Requirement: The Driver Asks How Much Room The Outbox Has

The driver SHALL offer a capacity operation, given what would be committed with a record, what would be committed alone, or nothing. It SHALL ask the outbox with only the facts: the number of events and the record's revision; the number of events alone; or, given nothing, one event and a state at the first revision. It SHALL hand the checked answer back unchanged, `exhausted` included, which is an answer and not an error.

#### Scenario: Given a commit with a record

- **WHEN** capacity is asked with a record and its events
- **THEN** the outbox is asked with the number of events and the record's revision

#### Scenario: Given events alone

- **WHEN** capacity is asked with events and no record
- **THEN** the outbox is asked with the number of events and no state

#### Scenario: Given nothing

- **WHEN** capacity is asked with nothing
- **THEN** the outbox is asked with one event and a state at the first revision

#### Scenario: An exhausted outbox

- **WHEN** the outbox answers `exhausted`
- **THEN** the driver answers it as given, not as an error

#### Scenario: A record missing its revision

- **WHEN** capacity is asked with a record lacking a field the commit would lift
- **THEN** the driver throws its validation error and the outbox is not called

### Requirement: Every Commit Asks Its Capacity First

Before each commit, the driver SHALL ask the outbox's capacity for that commit. Where the answer is `exhausted`, it SHALL NOT commit, and SHALL report `capacity_exhausted` carrying the answer. Where the question fails, it SHALL NOT commit, and SHALL report that failure, `unavailable` or `malformed_response`, for the commit. Where the answer is `available` or `tolerating`, it SHALL commit.

#### Scenario: No room

- **WHEN** a commit's capacity question answers `exhausted`
- **THEN** the driver reports `capacity_exhausted` with the answer, and nothing is written

#### Scenario: Tolerating

- **WHEN** a commit's capacity question answers `tolerating`
- **THEN** the commit goes ahead

#### Scenario: The question fails

- **WHEN** the outbox throws on the capacity question before a commit
- **THEN** the driver reports `unavailable` for the commit, and nothing is written
