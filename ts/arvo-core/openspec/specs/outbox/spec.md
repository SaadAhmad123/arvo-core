# outbox Specification

## Purpose

The outbox: where a mechanism keeps each execution's state and every event committed with it, so that the two land together, a stale write is refused, and a crashed delivery is recovered by resending what was committed rather than regenerating it. Implements [ADR-019](../../../../../docs/adr/019-outbox.md).

## Requirements

### Requirement: An Outbox Offers Seven Operations

An outbox SHALL offer exactly these operations: read the latest state of an execution; commit a state and its events; commit events with no state; read committed events by a filter; list events not yet seen; mark events seen; and answer how much room it has. Beside them it SHALL offer a way to open it and a way to close it. Each SHALL be callable by its caller with no knowledge of how the outbox stores anything.

#### Scenario: A developer's outbox satisfies the interface

- **WHEN** a developer implements every operation, and opening and closing, against their own storage
- **THEN** it is accepted wherever an outbox is expected, with nothing else to implement

#### Scenario: An outbox with no capacity operation

- **WHEN** a developer's outbox offers every operation but capacity
- **THEN** it is not accepted where an outbox is expected

### Requirement: An Outbox's Operations Are Plain

An outbox's operations SHALL return their values directly, or a promise of them, and MAY throw whatever their storage throws. An outbox SHALL NOT be required to produce results, faults or errors of Arvo's own; turning its answers and failures into those is its caller's.

#### Scenario: Storage that throws

- **WHEN** the storage behind an outbox fails during any operation
- **THEN** the operation throws what the storage threw, and no Arvo error type is required of it

#### Scenario: An operation that answers synchronously

- **WHEN** an outbox answers an operation without awaiting anything
- **THEN** returning the value directly is accepted, as returning a promise of it is

### Requirement: The Latest State Is Read Live

Reading the latest state of an execution SHALL reach what is stored on every call, and SHALL return the state with the highest revision under that execution, or none where nothing is stored. Nothing SHALL be cached in front of it.

#### Scenario: Nothing stored

- **WHEN** the latest state is read for an execution never committed
- **THEN** none is returned

#### Scenario: A commit is seen at once

- **WHEN** a state is committed and the latest state is then read
- **THEN** the state just committed is returned, not one read earlier

#### Scenario: The highest revision wins

- **WHEN** an execution has been committed at several revisions
- **THEN** reading its latest state returns the one at the highest revision

### Requirement: A State Is Returned As The Same Value

A state SHALL be returned as the same JSON value it was committed as: nothing added, nothing dropped, nothing changed. An outbox SHALL NOT parse, validate or interpret it.

#### Scenario: A state with nested values

- **WHEN** a state holding nested objects, arrays, nulls and numbers is committed and read back
- **THEN** the value read back equals the value committed in every field

#### Scenario: A state an outbox could not interpret

- **WHEN** a state that is not a valid execution record is committed
- **THEN** it is stored and returned as given, since judging it is not the outbox's

### Requirement: An Outbox Reads Nothing Off The State

An outbox SHALL key, compare and index a committed state only by the plain fields given beside it on the commit, and SHALL NOT read any of them from the state itself.

#### Scenario: The commit's fields disagree with the document

- **WHEN** a state is committed under one execution identifier while its document names another
- **THEN** it is stored and read back under the identifier the commit gave

### Requirement: A Commit Lands Whole Or Not At All

Everything in one commit of a state and its events SHALL become visible together, or none of it SHALL. A refused commit SHALL leave nothing behind.

#### Scenario: A committed state and its events

- **WHEN** a state and its events are committed
- **THEN** reading the state and reading the events both see the commit

#### Scenario: A refused commit

- **WHEN** a commit is refused
- **THEN** neither its state nor any of its events is stored

### Requirement: The First Revision Is Committed Only Where None Exists

A commit at revision `0` SHALL succeed only where no state exists under its execution, and SHALL otherwise be refused as `state_exists`.

#### Scenario: The first state of an execution

- **WHEN** a state is committed at revision `0` for an execution with nothing stored
- **THEN** it is committed

#### Scenario: A second first state

- **WHEN** a state is committed at revision `0` for an execution that already has one
- **THEN** the commit is refused as `state_exists`

### Requirement: Each Later Revision Follows The Stored One

A commit at any revision other than `0` SHALL succeed only where it is exactly one greater than the latest stored revision of its execution, and SHALL otherwise be refused as `revision_stale`.

#### Scenario: The next revision

- **WHEN** a state is committed at one greater than the stored revision
- **THEN** it is committed

#### Scenario: A revision already taken

- **WHEN** a state is committed at the stored revision itself
- **THEN** the commit is refused as `revision_stale`

#### Scenario: A revision that skips ahead

- **WHEN** a state is committed at two or more greater than the stored revision
- **THEN** the commit is refused as `revision_stale`

#### Scenario: A later revision with nothing stored

- **WHEN** a state is committed at a revision other than `0` for an execution with nothing stored
- **THEN** the commit is refused as `revision_stale`

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

### Requirement: An Event Already Committed Is Ignored

An event record whose identifier is already committed SHALL be left as stored and SHALL be skipped by any later commit, without failing that commit. This SHALL hold for both kinds of commit.

#### Scenario: The same event committed twice with a state

- **WHEN** a commit of a state carries an event whose identifier is already committed
- **THEN** the state is committed, the event already stored is unchanged, and nothing is thrown

#### Scenario: The same event committed twice alone

- **WHEN** events committed with no state include one whose identifier is already committed
- **THEN** the others are stored, the one already stored is unchanged, and nothing is thrown

#### Scenario: The same event twice in one commit

- **WHEN** one commit carries two event records with the same identifier
- **THEN** one of them is stored and the commit is not failed

### Requirement: An Event's Payload Is Kept Byte For Byte

An event record's payload SHALL be kept and returned as the same string it was committed as, character for character. An outbox SHALL NOT open, parse or rewrite it.

#### Scenario: A payload read back

- **WHEN** an event is committed and read back
- **THEN** its payload is exactly the string committed

#### Scenario: A payload an outbox could not parse

- **WHEN** an event record whose payload is not valid JSON is committed
- **THEN** it is stored and returned as given, since opening it is not the outbox's

### Requirement: An Outbox Stamps When A Commit Landed

Every event record in a commit SHALL be given the time the commit landed, once, by the outbox's own clock, and SHALL be stored as not yet seen. Neither SHALL be taken from the caller.

#### Scenario: The time a commit landed

- **WHEN** events are committed
- **THEN** each is read back with the time the commit landed, as the outbox's clock gave it, and as not yet seen

#### Scenario: Every event in one commit

- **WHEN** one commit carries several events
- **THEN** every one of them carries the same landing time

### Requirement: Committed Events Are Read By A Filter

Committed events SHALL be readable by one execution, by one delivery, or by one delivery within one execution, and SHALL be returned exactly as committed, each with its landing time and whether it has been seen. A filter matching nothing SHALL return nothing.

#### Scenario: One delivery's events

- **WHEN** committed events are read by the delivery that produced them
- **THEN** exactly that delivery's events are returned, and no other

#### Scenario: One execution's events

- **WHEN** committed events are read by one execution
- **THEN** every event committed for that execution is returned, across all its deliveries

#### Scenario: One delivery within one execution

- **WHEN** committed events are read by both a delivery and an execution
- **THEN** only events matching both are returned

#### Scenario: Events already seen

- **WHEN** committed events are read after some have been marked seen
- **THEN** those are still returned, marked as seen

#### Scenario: A filter matching nothing

- **WHEN** committed events are read by a delivery that committed none
- **THEN** nothing is returned

### Requirement: Unseen Events Are Listed Oldest First

Events not yet seen SHALL be listable oldest landing time first, at most a given number of them, leaving out any that landed more recently than a given age. Events marked seen SHALL NOT be listed.

#### Scenario: Oldest first

- **WHEN** events from several commits are unseen
- **THEN** they are listed in the order their commits landed, oldest first

#### Scenario: At most the number asked for

- **WHEN** more events are unseen than the number asked for
- **THEN** only that many are listed, the oldest

#### Scenario: Too recent to list

- **WHEN** an unseen event landed more recently than the age given
- **THEN** it is not listed

#### Scenario: Old enough to list

- **WHEN** an unseen event landed exactly the age given ago, or earlier
- **THEN** it is listed

#### Scenario: Seen events are not listed

- **WHEN** an event has been marked seen
- **THEN** it is not listed again

### Requirement: A Lease May Be Asked For When Listing

A caller listing unseen events MAY ask for a lease of a given length. An outbox MAY honour it, leaving the events it lists out of every other listing until the lease lapses or they are marked seen; it SHALL NOT be required to, and a listing that asks for a lease SHALL return what the same listing would without one. Asking for none SHALL be leaving the lease out.

#### Scenario: Listing with a lease

- **WHEN** unseen events are listed with a lease asked for
- **THEN** they are listed as they would be with none

### Requirement: Marking Events Seen Is Final And Repeatable

Marking events seen SHALL make each named event seen, and SHALL change nothing else about it. Marking an event already seen, or naming one never committed, SHALL do nothing and SHALL NOT fail.

#### Scenario: Marking an event seen

- **WHEN** an unseen event is marked seen
- **THEN** it is read back as seen, with its payload and landing time unchanged

#### Scenario: Marking it again

- **WHEN** an event already seen is marked seen again
- **THEN** nothing changes and nothing is thrown

#### Scenario: Naming an event never committed

- **WHEN** an identifier no committed event carries is marked seen
- **THEN** nothing changes and nothing is thrown

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

### Requirement: Each Entry Point Needs Only Its Own Dependencies

The package's main entry point SHALL load neither the test runner the kit uses nor the SQLite library. Each outbox and the kit SHALL be reachable at an entry point of its own, and only importing that entry point SHALL require what it needs. The package SHALL declare those needs so that a consumer who never imports an entry point is not asked to install its dependency.

#### Scenario: A consumer with neither installed

- **WHEN** a consumer imports the main entry point, or the in-memory outbox's, with neither the test runner nor the SQLite library installed
- **THEN** the import succeeds

#### Scenario: The SQLite outbox's entry point

- **WHEN** a consumer imports the SQLite outbox's entry point
- **THEN** it needs the SQLite library and nothing else beyond the package's own dependencies

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

### Requirement: An In-Memory Outbox Keeps Each Execution's Latest State

The in-memory outbox SHALL keep, for each execution, only its latest state and the fields committed beside it.

#### Scenario: A state committed over an earlier one

- **WHEN** a state is committed at the revision following the stored one
- **THEN** the earlier state is no longer held, and the latest state and the revision check are as for any outbox

### Requirement: An Outbox Answers Concurrent Calls As If Each Were Alone

Arvo's outboxes SHALL answer calls that overlap in time as if each had run alone. Two commits of one execution at one revision SHALL see exactly one committed and the other refused, and a read overlapping a commit SHALL see all of that commit or none of it.

#### Scenario: Two commits racing

- **WHEN** two commits of the same execution at the same revision are started together and both awaited
- **THEN** exactly one is committed and the other is refused as `revision_stale` or `state_exists`

#### Scenario: A read during a commit

- **WHEN** a read of committed events overlaps a commit of those events
- **THEN** it returns all of the commit's events or none of them

### Requirement: Arvo's Outboxes Answer Directly

Arvo's outboxes SHALL return the answer of every operation directly, not through a promise, and SHALL throw directly where they cannot do their work. No operation waits on anything, and an operation that never yields cannot be interleaved with another. Opening and closing SHALL answer through a promise. A caller SHALL be able to await every answer as it awaits any outbox's.

#### Scenario: An answer read directly

- **WHEN** an operation of Arvo's own outbox is called
- **THEN** it returns its answer, not a promise of it

#### Scenario: An answer awaited

- **WHEN** a caller awaits an operation of Arvo's own outbox
- **THEN** it receives the same answer

#### Scenario: Opening and closing awaited

- **WHEN** one of Arvo's outboxes is opened or closed
- **THEN** the call answers through a promise, which settles once the outbox is open or closed

### Requirement: Arvo's Outboxes Refuse A Listing That Is No Listing

Arvo's outboxes SHALL refuse, before reading or claiming anything, a listing of unseen events whose number to list is not a whole number, zero or more, or whose age is not a finite number, zero or more, naming the value and the rule.

#### Scenario: A negative number to list

- **WHEN** unseen events are listed with a negative number to list
- **THEN** listing throws rather than listing every event

### Requirement: Arvo's Outboxes Honour A Lease

Arvo's outboxes SHALL honour a lease asked for when listing: each event listed SHALL be left out of every listing, by any caller of the same store, until the lease lapses by the outbox's clock or the event is marked seen, and SHALL then be listed again. Only what is listed SHALL be leased, and a lease that is not a whole number of milliseconds greater than zero SHALL be refused, claiming nothing.

#### Scenario: A leased event listed again

- **WHEN** an event is listed with a lease, and listed again before the lease lapses
- **THEN** it is left out; once the lease lapses, it is listed again

#### Scenario: A leased event marked seen

- **WHEN** a leased event is marked seen
- **THEN** it is never listed again

#### Scenario: Several SQLite outboxes on one file

- **WHEN** one SQLite outbox leases events and another on the same file lists unseen events
- **THEN** the other's listing leaves the leased events out

#### Scenario: A lease that is no duration

- **WHEN** a lease is asked for that is not a whole number of milliseconds greater than zero
- **THEN** listing throws, naming the lease and the rule, and nothing is leased

### Requirement: Nothing Stored Can Be Changed From Outside

What Arvo's outboxes are given and hand back SHALL be their own copies, so that changing an object after committing it, or after reading it, SHALL change nothing stored.

#### Scenario: Changing what was committed

- **WHEN** a caller changes a state or an event record after committing it
- **THEN** reading it back returns it as it was committed

#### Scenario: Changing what was read

- **WHEN** a caller changes a state or an event record it read
- **THEN** reading it again returns it as it is stored

### Requirement: Arvo's Outboxes Do The Same Work However Much They Hold

Each operation of Arvo's outboxes SHALL do work in proportion to what that operation reads or writes, and SHALL NOT look through everything the outbox holds to answer.

#### Scenario: Reading one delivery's events in a full outbox

- **WHEN** one delivery's events are read from an outbox holding many deliveries
- **THEN** the outbox finds them without looking through the others

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

### Requirement: A SQLite Outbox Survives A Restart

What a SQLite outbox has committed SHALL still be there after the outbox is closed and opened again on the same file, or after the process that held it ends.

#### Scenario: Closed and opened again

- **WHEN** a state and its events are committed, the outbox closed, and a new one opened on the same file
- **THEN** the latest state, the committed events and which of them are seen all read back as they were

### Requirement: Several SQLite Outboxes On One File Stay Correct

Several SQLite outboxes open on one file at once, in one process or several, SHALL together meet every requirement of this capability, as one outbox would. Where the file is held by another writer for longer than the outbox is prepared to wait, the operation SHALL throw.

#### Scenario: Two outboxes, one file, one race

- **WHEN** two SQLite outboxes on the same file each commit the same execution at the same revision
- **THEN** exactly one commit is committed and the other is refused

#### Scenario: A writer that holds the file too long

- **WHEN** another writer holds the file for longer than the outbox waits
- **THEN** the operation throws, and nothing of it is stored

### Requirement: A SQLite Outbox Stamps Times By The Database's Clock

A SQLite outbox SHALL take every landing time, and the cut-off for listing unseen events, from SQLite's own clock, once per operation, never from the process that called it.

#### Scenario: One time for one commit

- **WHEN** a SQLite outbox commits several events
- **THEN** every one carries the same landing time, in the same form as an event's own time

### Requirement: A SQLite Outbox Keeps Each Execution's Latest State

A SQLite outbox SHALL keep, for each execution, only its latest state, deleting earlier revisions in the commit that replaces them.

#### Scenario: A state committed over an earlier one

- **WHEN** a state is committed at the revision following the stored one
- **THEN** the file holds only the new revision for that execution, and the revision check is as for any outbox

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

### Requirement: A SQLite Outbox Is Closed By Its Caller

A SQLite outbox SHALL hold its file from when it is opened until its caller closes it. Closing SHALL release the file and MAY be repeated. Using an outbox after closing it SHALL throw.

#### Scenario: Closing twice

- **WHEN** a SQLite outbox is closed and closed again
- **THEN** nothing is thrown

#### Scenario: Using a closed outbox

- **WHEN** any operation is called on a closed SQLite outbox
- **THEN** it throws

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

### Requirement: A Lifecycle Is Provided For Any Outbox

The package SHALL provide, at its main entry point, a lifecycle a developer's outbox can hold its resources through. It SHALL acquire once however often or concurrently it is opened, stay unopened where acquiring throws, close at once and for good, release once, including what an opening under way acquires, and hand the resources to an operation only while open. Acquiring and releasing MAY answer directly or through a promise; opening and closing SHALL answer through a promise.

#### Scenario: Opened by several callers at once

- **WHEN** a lifecycle is opened again while an opening is under way
- **THEN** acquiring happens once, and every caller is answered when that opening ends

#### Scenario: Closed while still opening

- **WHEN** a lifecycle is closed while an opening is under way
- **THEN** no opening may start after it, and what the opening acquires is released once it ends

#### Scenario: Acquiring that fails

- **WHEN** acquiring throws
- **THEN** what it threw is passed on as it was, and the lifecycle stays unopened, so it may be opened again

### Requirement: A Lifecycle Answers Its Refusals As Values Or Throws Them

Each step of the lifecycle that can be refused SHALL be offered both as a call answering the refusal as a value and as one throwing it, the refusal naming the outbox, the operation and what to do instead. A failure of acquiring or releasing SHALL be passed on as it was thrown, never as the lifecycle's own refusal.

#### Scenario: Used outside its open life

- **WHEN** the resources are asked for before opening, while still opening, or once closed
- **THEN** the refusal names the outbox, the operation and what to do instead, answered as a value or thrown

#### Scenario: Opening a closed lifecycle

- **WHEN** a closed lifecycle is opened
- **THEN** the refusal is answered as a value, or thrown

#### Scenario: Closing, as a value

- **WHEN** a lifecycle is closed through the call answering as a value
- **THEN** it answers success, since closing is never refused, and passes on what releasing throws

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
