## RENAMED Requirements

- FROM: `### Requirement: A SQLite Outbox Deletes Events Seen Longer Than It Keeps Them`
- TO: `### Requirement: A SQLite Outbox Deletes What It Keeps No Longer`

## MODIFIED Requirements

### Requirement: A SQLite Outbox Deletes What It Keeps No Longer

A SQLite outbox SHALL keep an event once seen, and a state at `success`, `error`, `cancelled` or `failure` after its last commit, each for a time set when it is built, with a default of its own, and MAY then delete it. It SHALL NOT delete an unseen event, nor a state at any other lifecycle. Marking events seen SHALL delete a bounded number of what has expired, and the outbox SHALL offer a way to delete everything expired at once, answering how many events and how many states. Deleting a state SHALL leave its events. A file it creates SHALL give the space of what it deletes back to the disk. No other outbox is held to this.

#### Scenario: An event seen longer ago than it is kept

- **WHEN** events are marked seen and one has been seen for longer than the outbox keeps seen events
- **THEN** that event is deleted, and an event seen more recently is kept

#### Scenario: An unseen event committed long ago

- **WHEN** an unseen event was committed long ago
- **THEN** it is never deleted

#### Scenario: A finished execution long ago

- **WHEN** a state at `success` was last committed longer ago than the outbox keeps terminal states, and everything expired is deleted
- **THEN** that state is deleted, its events are kept, and reading the execution's latest state answers none

#### Scenario: A waiting execution long ago

- **WHEN** a state at `waiting` was last committed long ago, and everything expired is deleted
- **THEN** it is kept

#### Scenario: Seen events kept forever

- **WHEN** the outbox is built to keep seen events and terminal states for an unending time
- **THEN** nothing is ever deleted

#### Scenario: More expired events than one marking deletes

- **WHEN** more events and states have expired than one marking deletes
- **THEN** marking deletes no more than its bound, and deleting everything expired removes the rest and answers how many of each

#### Scenario: A window that is no duration

- **WHEN** the outbox is built with a retention that is not a whole number of milliseconds, zero or more, nor unending
- **THEN** building it throws its validation error, naming the retention

### Requirement: A SQLite Outbox Keeps Its File Safe

A SQLite outbox SHALL create a missing file readable and writable by its owner alone, and SHALL leave the permissions of an existing file as they are. It SHALL sync every commit to disk in full, overwrite what it deletes, and run nothing the file itself defines. It SHALL record the version of its tables in the file, and SHALL refuse, before creating anything, a file whose outbox tables are of a version newer than its own, or of no version it knows. Its tables SHALL refuse a row no outbox could have written.

#### Scenario: A new file

- **WHEN** a SQLite outbox creates its file
- **THEN** only the file's owner can read or write it, and the file records the version of its tables

#### Scenario: A file of another version

- **WHEN** a SQLite outbox is opened on a file whose outbox tables record a version newer than its own, or one it does not know
- **THEN** opening throws, naming the file and both versions, and the file is left as it was

#### Scenario: A row no outbox could write

- **WHEN** another writer inserts a state with a negative revision, or a document that is not JSON
- **THEN** the file refuses it

## ADDED Requirements

### Requirement: A SQLite Outbox Upgrades An Older File

A SQLite outbox SHALL build its tables by numbered steps shipped in the package, and SHALL run, when it is opened, every step the file has not yet run, in order, then record how many it has run. It SHALL do all of it in one locked write, so that a failure leaves the file as it was and several outboxes opening one file run each step once. A step SHALL only add to the tables.

#### Scenario: A file at the version before

- **WHEN** a SQLite outbox is opened on a file at the version before its own, holding states and events
- **THEN** the file is at its own version, and every state and event reads back as it was

#### Scenario: Two outboxes opening one older file

- **WHEN** two SQLite outboxes are opened on the same file at an older version
- **THEN** the file is upgraded once, and both open

### Requirement: A SQLite Outbox Limits Nothing

A SQLite outbox SHALL answer its capacity as `available` with no buffers, whatever it is asked about, and SHALL refuse no commit for lack of room. A commit of events alone SHALL answer that it committed.

#### Scenario: Asked about any amount

- **WHEN** a SQLite outbox is asked its capacity for any number of events and any state
- **THEN** it answers `available` with no buffers

#### Scenario: Events alone

- **WHEN** events are committed alone to a SQLite outbox
- **THEN** it answers that they committed

### Requirement: A SQLite Outbox Refuses Options That Break A Rule

A SQLite outbox SHALL check its options when it is built, before touching any file: a file name, a wait and each retention a whole number of milliseconds, zero or more, a retention unending as well, and no option it does not know. Building it with any other SHALL throw its validation error, carrying every problem at once. The package SHALL offer a factory answering that error as a value, and one throwing it.

#### Scenario: A retention that is no duration

- **WHEN** a SQLite outbox is built with a retention that is negative or fractional
- **THEN** building it throws its validation error, with an issue at that retention, and no file is touched

#### Scenario: Every problem at once

- **WHEN** a SQLite outbox is built with a bad wait and a bad retention
- **THEN** its validation error names both

#### Scenario: Built through a factory

- **WHEN** the value-answering factory is given options that break a rule
- **THEN** it answers the validation error, and the throwing factory throws it

### Requirement: The Conformance Kit Checks Capacity

The conformance kit SHALL check, of any outbox, that its capacity answers one of `available`, `tolerating` or `exhausted` overall and for each buffer it gives, that its overall status is the worst of its buffers, that asking changes nothing it holds, and that a commit of events alone answers its outcome. It SHALL NOT require any outbox to limit anything.

#### Scenario: An outbox that limits nothing

- **WHEN** the kit is run against an outbox that answers `available` with no buffers
- **THEN** every capacity check passes

#### Scenario: An outbox whose overall status is not the worst

- **WHEN** an outbox answers `available` overall while a buffer is `exhausted`
- **THEN** that check fails, naming the rule

#### Scenario: An outbox that changes what it holds when asked

- **WHEN** asking an outbox its capacity deletes or adds anything
- **THEN** that check fails, naming the rule
