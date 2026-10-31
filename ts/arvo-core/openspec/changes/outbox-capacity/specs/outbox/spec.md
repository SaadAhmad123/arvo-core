## RENAMED Requirements

- FROM: `### Requirement: An Outbox Offers Six Operations`
- TO: `### Requirement: An Outbox Offers Seven Operations`

## MODIFIED Requirements

### Requirement: An Outbox Offers Seven Operations

An outbox SHALL offer exactly these operations: read the latest state of an execution; commit a state and its events; commit events with no state; read committed events by a filter; list events not yet seen; mark events seen; and answer how much room it has. Beside them it SHALL offer a way to open it and a way to close it. Each SHALL be callable by its caller with no knowledge of how the outbox stores anything.

#### Scenario: A developer's outbox satisfies the interface

- **WHEN** a developer implements every operation, and opening and closing, against their own storage
- **THEN** it is accepted wherever an outbox is expected, with nothing else to implement

#### Scenario: An outbox with no capacity operation

- **WHEN** a developer's outbox offers every operation but capacity
- **THEN** it is not accepted where an outbox is expected

### Requirement: A Refusal Is Answered, Not Thrown

A refused commit SHALL be reported as an answer naming the refusal, and SHALL NOT be thrown. Losing a race and having no room SHALL each be a refusal. Throwing SHALL be reserved for an outbox that could not do its work at all.

#### Scenario: Losing a race

- **WHEN** two commits of the same execution at the same revision arrive one after the other
- **THEN** the first is committed and the second is answered as refused, without throwing

#### Scenario: No room

- **WHEN** an outbox refuses a commit because it has no room for it
- **THEN** the commit is answered as refused with `capacity_exhausted`, without throwing

### Requirement: Events May Be Committed With No State

Events SHALL be committable with no state, as one unit, with no revision compared. Committing them SHALL answer whether they were committed, and MAY be refused only for lack of room, as `capacity_exhausted`. Each event record so committed SHALL carry no revision.

#### Scenario: Events alone

- **WHEN** events are committed with no state
- **THEN** they are stored, each carries no revision, and the commit is answered as committed

#### Scenario: Events alone for an execution with a state

- **WHEN** events are committed with no state for an execution that already has one
- **THEN** they are stored, and the stored state is left as it was

#### Scenario: Events alone with no room

- **WHEN** an outbox refuses a commit of events alone because it has no room
- **THEN** it is answered as refused with `capacity_exhausted`, and none of the events is stored

## ADDED Requirements

### Requirement: An Outbox Answers How Much Room It Has

An outbox SHALL answer, when asked with a number of events and, where a state comes with them, that state's revision, whether it would have room for that much: `available` within what it is meant to hold, `tolerating` past that but within the most it should ever hold, `exhausted` past the most. It SHALL answer so for each buffer it limits, events and states, and overall the worst of them. What that much costs it is its own to work out.

#### Scenario: Asked with events and a state

- **WHEN** an outbox is asked about a number of events and a state at some revision
- **THEN** it answers one of `available`, `tolerating` or `exhausted` overall

#### Scenario: Asked with events alone

- **WHEN** an outbox is asked about a number of events with no state
- **THEN** it answers, with nothing about a state to weigh

#### Scenario: The overall answer is the worst

- **WHEN** an outbox answers `tolerating` for events and `exhausted` for states
- **THEN** its overall answer is `exhausted`

### Requirement: Everything Held Counts Toward Room

An outbox's answer SHALL count every event it holds, seen or not, and every state it keeps, of executions running or finished.

#### Scenario: Seen events

- **WHEN** an outbox holds events already marked seen
- **THEN** they count toward its answer as unseen ones do

### Requirement: Asking About Room Changes Nothing

Asking an outbox how much room it has SHALL NOT add, delete or alter anything it holds. The answer SHALL describe the outbox as it would be with that much added, and MAY be an estimate.

#### Scenario: Asked twice

- **WHEN** an outbox is asked about the same amount twice with nothing committed between
- **THEN** nothing it holds has changed

### Requirement: The Numbers Behind An Answer Are Optional

An outbox MAY give, for each buffer, how much it would hold, what it is meant to hold, and the most it should ever hold, and MAY leave out a buffer it does not limit. An outbox that limits nothing SHALL answer `available`, and need give nothing else.

#### Scenario: An outbox that limits nothing

- **WHEN** an outbox that limits nothing is asked about any amount
- **THEN** it answers `available` with no buffers, and it conforms

#### Scenario: An answer with its numbers

- **WHEN** an outbox answers for a buffer it limits
- **THEN** it may give how much it would hold, what it is meant to hold, and the most, or leave any of them out

### Requirement: An Answer About Room May Stay Steady

An outbox that has answered `tolerating` for a buffer MAY keep answering so until it has drained well below what it is meant to hold, and SHALL still answer `exhausted` once past the most it should ever hold.

#### Scenario: Just below what it is meant to hold

- **WHEN** an outbox that answered `tolerating` drains to just below what it is meant to hold
- **THEN** answering `tolerating` still conforms, as answering `available` does

### Requirement: A Commit May Refuse For Lack Of Room

An outbox MAY refuse, at commit, what it would answer `exhausted` for, as the refusal `capacity_exhausted`, and SHALL NOT throw for it. It need not refuse. An outbox whose limit must never be passed SHALL refuse inside the commit what would pass it, since an answer about room can be overtaken by other commits.

#### Scenario: An outbox that enforces its limit

- **WHEN** a commit would take an outbox that enforces its limit past the most it should hold
- **THEN** the commit is refused as `capacity_exhausted` and writes nothing

#### Scenario: An outbox that does not enforce its limit

- **WHEN** a commit would take an outbox that does not enforce its limit past the most it should hold
- **THEN** committing it still conforms
