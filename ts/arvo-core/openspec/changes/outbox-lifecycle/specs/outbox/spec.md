## MODIFIED Requirements

### Requirement: An Outbox Offers Six Operations

An outbox SHALL offer exactly these operations: read the latest state of an execution; commit a state and its events; commit events with no state; read committed events by a filter; list events not yet seen; and mark events seen. Beside them it SHALL offer a way to open it and a way to close it. Each SHALL be callable by its caller with no knowledge of how the outbox stores anything.

#### Scenario: A developer's outbox satisfies the interface

- **WHEN** a developer implements every operation, and opening and closing, against their own storage
- **THEN** it is accepted wherever an outbox is expected, with nothing else to implement

### Requirement: A Conformance Kit Checks Any Outbox

The package SHALL provide, at an entry point of its own, every rule of this capability that does not need a controlled clock as a check that can be run against any outbox, and SHALL provide a way to run all of them as a test suite. Each check SHALL fail where the outbox it is given breaks its rule. The suite SHALL open each outbox before its check and close it after, whether the check passes or fails.

#### Scenario: A developer's outbox that conforms

- **WHEN** the kit is run against an outbox that meets every rule
- **THEN** every check passes

#### Scenario: An outbox that breaks one rule

- **WHEN** a check is run against an outbox that breaks the rule that check covers
- **THEN** that check fails, naming the rule

#### Scenario: Each check given a fresh outbox

- **WHEN** the kit runs its checks
- **THEN** it asks for a new, empty outbox for each one, so no check sees another's events

#### Scenario: Each outbox opened and closed by the suite

- **WHEN** the suite runs a check, and the check passes or fails
- **THEN** the outbox was opened before the check and is closed after it

### Requirement: A SQLite Outbox Is Provided

The package SHALL provide an outbox kept in a SQLite file, which meets every requirement of this capability, creates what it needs in the file where it is missing when it is opened, and leaves in place what is already there. Building it SHALL touch no file.

#### Scenario: A new file

- **WHEN** the SQLite outbox is opened on a file that does not yet exist
- **THEN** it creates the file and everything it needs in it, and meets every requirement above

#### Scenario: A file it has used before

- **WHEN** the SQLite outbox is opened on a file it used earlier
- **THEN** every state and event committed earlier is there, unchanged

#### Scenario: Built and never opened

- **WHEN** the SQLite outbox is built on a file that does not yet exist, and not opened
- **THEN** no file is created

#### Scenario: A file that cannot be opened

- **WHEN** the SQLite outbox is opened on a file that is not a SQLite database
- **THEN** opening throws, and the file is left as it was

### Requirement: A SQLite Outbox Is Closed By Its Caller

A SQLite outbox SHALL hold its file from when it is opened until its caller closes it. Closing SHALL release the file and MAY be repeated. Using an outbox after closing it SHALL throw.

#### Scenario: Closing twice

- **WHEN** a SQLite outbox is closed and closed again
- **THEN** nothing is thrown

#### Scenario: Using a closed outbox

- **WHEN** any operation is called on a closed SQLite outbox
- **THEN** it throws

### Requirement: An In-Memory Outbox Is Provided

The package SHALL provide an outbox that keeps everything in process memory and meets every requirement of this capability. Its clock SHALL be replaceable when it is built, so that landing times can be controlled. Closing it SHALL free everything it holds.

#### Scenario: A working outbox with no storage

- **WHEN** the in-memory outbox is built with nothing given, and opened
- **THEN** it meets every requirement above, using the current time as its clock

#### Scenario: A clock given when it is built

- **WHEN** the in-memory outbox is built with a clock
- **THEN** every landing time it stamps comes from that clock, never from its caller

#### Scenario: A clock that goes back

- **WHEN** the in-memory outbox's clock gives an earlier time than it gave for the commit before
- **THEN** the commit is stamped with the landing time of the commit before, so unseen events are still listed in the order committed

## ADDED Requirements

### Requirement: An Outbox Is Opened Before Use And Closed After

An outbox SHALL be opened before its operations are used and closed once they no longer are. Opening and closing SHALL each return directly or through a promise, and MAY throw whatever the storage throws. Opening an open outbox SHALL do nothing, and closing a closed one SHALL do nothing. Once an outbox is closed, every operation SHALL throw. An outbox MAY allow its operations before it is opened, and MAY allow being opened again after it is closed.

#### Scenario: Opened twice

- **WHEN** an open outbox is opened again
- **THEN** nothing is thrown, and it still works

#### Scenario: Closed twice

- **WHEN** a closed outbox is closed again
- **THEN** nothing is thrown

#### Scenario: Used once closed

- **WHEN** any operation is called on a closed outbox
- **THEN** it throws

#### Scenario: A developer's outbox that connects lazily

- **WHEN** a developer's outbox answers an operation before it is opened
- **THEN** it still conforms

### Requirement: Arvo's Outboxes Are Used Only While Open

Arvo's outboxes SHALL throw on every operation called before they are opened, and SHALL throw on being opened once closed, each naming the outbox and what to do instead. Closing one that was never opened SHALL do nothing, and SHALL leave it closed.

#### Scenario: Used before opening

- **WHEN** any operation is called on one of Arvo's outboxes before it is opened
- **THEN** it throws, saying to open it first

#### Scenario: Opened once closed

- **WHEN** one of Arvo's outboxes is opened after it was closed
- **THEN** opening throws, saying to build a new one

#### Scenario: Closed without being opened

- **WHEN** one of Arvo's outboxes is closed without ever being opened
- **THEN** nothing is thrown, and opening it afterwards throws
