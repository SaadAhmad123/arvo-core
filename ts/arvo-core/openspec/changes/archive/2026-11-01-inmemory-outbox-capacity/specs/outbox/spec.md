## REMOVED Requirements

### Requirement: An In-Memory Outbox Holds A Bounded Number Of Events

**Reason**: A full outbox now refuses a commit as `capacity_exhausted` instead of throwing (ADR-019 rule 23), and what it holds is freed by retention, not by dropping seen events to make room.
**Migration**: Replace `maxEvents` with `buffers.events.size`. Seen events are deleted after `retentionMs.seenEvents`; a commit with no room is answered refused, not thrown.

## ADDED Requirements

### Requirement: An In-Memory Outbox Holds Two Buffers

The in-memory outbox SHALL hold events, seen or not, and states, each in a buffer with a size and a tolerance set when it is built, and defaults of its own. A buffer's limit SHALL be its size times one plus its tolerance. A size SHALL be a whole number greater than zero, and a tolerance a number from zero to one; building it with any other SHALL throw its validation error, carrying every problem in its options at once.

#### Scenario: Built with nothing given

- **WHEN** the in-memory outbox is built with no buffers
- **THEN** each buffer has the outbox's own size and tolerance

#### Scenario: A size that is no size

- **WHEN** the in-memory outbox is built with a buffer size that is zero, negative or fractional
- **THEN** building it throws its validation error, with an issue at that buffer's size

#### Scenario: A tolerance out of range

- **WHEN** the in-memory outbox is built with a tolerance below zero or above one
- **THEN** building it throws its validation error, with an issue at that buffer's tolerance

#### Scenario: No tolerance

- **WHEN** a buffer is built with a tolerance of zero
- **THEN** its limit is its size, and it is never `tolerating`

### Requirement: An In-Memory Outbox Answers Its Capacity

The in-memory outbox SHALL answer its capacity for each buffer with how much it would hold with the request added, its size and its limit, and a status: `available` within the size, `tolerating` past it but within the limit, `exhausted` past the limit. Events SHALL count the request's events; states SHALL count one more only where the request's state is at the first revision. Overall it SHALL answer the worst of the two.

#### Scenario: Room for a new execution

- **WHEN** capacity is asked for events and a state at the first revision, with room in both buffers
- **THEN** both buffers answer `available`, the states buffer holding one more than it does now

#### Scenario: A later revision

- **WHEN** capacity is asked for a state at a later revision
- **THEN** the states buffer holds no more than it does now, since a later revision replaces the one stored

#### Scenario: Past the size

- **WHEN** what the events buffer would hold is past its size but within its limit
- **THEN** it answers `tolerating`, and so does the outbox overall

#### Scenario: Past the limit

- **WHEN** what either buffer would hold is past its limit
- **THEN** that buffer and the outbox overall answer `exhausted`

#### Scenario: Asking changes nothing

- **WHEN** capacity is asked
- **THEN** nothing held is added, deleted or changed

### Requirement: An In-Memory Outbox's Answer Stays Steady

Once a buffer of the in-memory outbox has held more than its size, it SHALL answer `tolerating`, where not `exhausted`, until what it holds has drained to its size times one minus its tolerance.

#### Scenario: Drained just below the size

- **WHEN** a buffer that held more than its size drains to just below its size, but above its size times one minus its tolerance
- **THEN** it still answers `tolerating`

#### Scenario: Drained well below the size

- **WHEN** that buffer drains to its size times one minus its tolerance
- **THEN** it answers `available` again

### Requirement: An In-Memory Outbox Refuses A Commit It Has No Room For

The in-memory outbox SHALL refuse, as `capacity_exhausted`, a commit that would take a buffer it fills past its limit, and SHALL write nothing for it. A commit with a state SHALL be checked against both buffers, and a commit of events alone against the events buffer. It SHALL count an event already held, or carried twice, once. It SHALL NOT throw for lack of room.

#### Scenario: Events past the limit

- **WHEN** a commit would take the events buffer past its limit
- **THEN** it is refused as `capacity_exhausted`, and nothing it carries is stored

#### Scenario: A new execution past the states limit

- **WHEN** a commit at the first revision would take the states buffer past its limit
- **THEN** it is refused as `capacity_exhausted`

#### Scenario: A later revision with the states buffer full

- **WHEN** a commit at a later revision is made with the states buffer at its limit
- **THEN** the states buffer does not refuse it, since the revision replaces the one stored

#### Scenario: Tolerating

- **WHEN** a commit would take a buffer past its size but within its limit
- **THEN** it is committed

### Requirement: An In-Memory Outbox Deletes Seen Events After A While

The in-memory outbox SHALL delete each event once it has been seen for longer than a retention set when it is built, with a default of its own, by its own clock. An unseen event SHALL never be deleted. A deleted event SHALL be forgotten: reading its delivery no longer finds it, and committing it again stores it anew.

#### Scenario: An event seen long ago

- **WHEN** an event has been seen for longer than the retention, and the outbox sweeps
- **THEN** it is deleted, and an event seen more recently is kept

#### Scenario: An unseen event committed long ago

- **WHEN** an unseen event was committed long ago, and the outbox sweeps
- **THEN** it is kept

#### Scenario: An event deleted and committed again

- **WHEN** a deleted event is committed again
- **THEN** it is stored anew, as not yet seen

### Requirement: An In-Memory Outbox Deletes Terminal States After A While

The in-memory outbox SHALL delete each state whose lifecycle is `success`, `error`, `cancelled` or `failure` once its last commit is older than a retention set when it is built, with a default of its own, by its own clock. A state at any other lifecycle SHALL never be deleted. Deleting a state SHALL leave the execution's events as they are.

#### Scenario: A finished execution long ago

- **WHEN** a state at `success` was last committed longer ago than the retention, and the outbox sweeps
- **THEN** it is deleted, and reading the execution's latest state answers none

#### Scenario: A waiting execution long ago

- **WHEN** a state at `waiting` was last committed long ago, and the outbox sweeps
- **THEN** it is kept

#### Scenario: An execution that finished recently

- **WHEN** a state moved from `waiting` to `success` less than the retention ago
- **THEN** it is kept, its retention counted from that last commit

### Requirement: An In-Memory Outbox Sweeps On A Timer

The in-memory outbox SHALL sweep on a timer from when it is opened until it is closed, at an interval of the shorter retention divided by ten, and no shorter than one second. The timer SHALL NOT keep the process running. A sweep SHALL do work in proportion to what it deletes. A retention SHALL be a whole number of milliseconds, zero or more; building it with any other SHALL throw its validation error.

#### Scenario: Opened

- **WHEN** the in-memory outbox is opened
- **THEN** it sweeps at the interval its retentions give

#### Scenario: A retention of zero

- **WHEN** seen events are kept for zero milliseconds
- **THEN** the outbox sweeps every second, and deletes each seen event within a second of its being seen

#### Scenario: Closed

- **WHEN** the in-memory outbox is closed
- **THEN** it sweeps no more

#### Scenario: A process with nothing else to do

- **WHEN** an open in-memory outbox's timer is all that is left running
- **THEN** the process may end

#### Scenario: A clock that fails during a sweep

- **WHEN** the outbox's clock returns no valid time when a sweep runs
- **THEN** that sweep deletes nothing and is reported as a warning, and the next sweep runs as usual
