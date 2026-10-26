## Purpose

The outbox: where a mechanism keeps each execution's state and every event committed with it, so that the two land together, a stale write is refused, and a crashed delivery is recovered by resending what was committed rather than regenerating it. Implements [ADR-019](../../../../../docs/adr/019-outbox.md).

## ADDED Requirements

### Requirement: An Outbox Offers Six Operations

An outbox SHALL offer exactly these operations: read the latest state of an execution; commit a state and its events; commit events with no state; read committed events by a filter; list events not yet seen; and mark events seen. Each SHALL be callable by its caller with no knowledge of how the outbox stores anything.

#### Scenario: A developer's outbox satisfies the interface

- **WHEN** a developer implements every operation against their own storage
- **THEN** it is accepted wherever an outbox is expected, with nothing else to implement

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

A refused commit SHALL be reported as an answer naming the refusal, and SHALL NOT be thrown. Throwing SHALL be reserved for an outbox that could not do its work at all.

#### Scenario: Losing a race

- **WHEN** two commits of the same execution at the same revision arrive one after the other
- **THEN** the first is committed and the second is answered as refused, without throwing

### Requirement: Events May Be Committed With No State

Events SHALL be committable with no state, as one unit, with no revision compared and nothing refused. Each event record so committed SHALL carry no revision.

#### Scenario: Events alone

- **WHEN** events are committed with no state
- **THEN** they are stored, and each carries no revision

#### Scenario: Events alone for an execution with a state

- **WHEN** events are committed with no state for an execution that already has one
- **THEN** they are stored, and the stored state is left as it was

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

The package SHALL provide, at an entry point of its own, every rule of this capability that does not need a controlled clock as a check that can be run against any outbox, and SHALL provide a way to run all of them as a test suite. Each check SHALL fail where the outbox it is given breaks its rule.

#### Scenario: A developer's outbox that conforms

- **WHEN** the kit is run against an outbox that meets every rule
- **THEN** every check passes

#### Scenario: An outbox that breaks one rule

- **WHEN** a check is run against an outbox that breaks the rule that check covers
- **THEN** that check fails, naming the rule

#### Scenario: Each check given a fresh outbox

- **WHEN** the kit runs its checks
- **THEN** it asks for a new, empty outbox for each one, so no check sees another's events

### Requirement: Each Entry Point Needs Only Its Own Dependencies

The package's main entry point SHALL load neither the test runner the kit uses nor the SQLite library. Each outbox and the kit SHALL be reachable at an entry point of its own, and only importing that entry point SHALL require what it needs. The package SHALL declare those needs so that a consumer who never imports an entry point is not asked to install its dependency.

#### Scenario: A consumer with neither installed

- **WHEN** a consumer imports the main entry point, or the in-memory outbox's, with neither the test runner nor the SQLite library installed
- **THEN** the import succeeds

#### Scenario: The SQLite outbox's entry point

- **WHEN** a consumer imports the SQLite outbox's entry point
- **THEN** it needs the SQLite library and nothing else beyond the package's own dependencies

### Requirement: An In-Memory Outbox Is Provided

The package SHALL provide an outbox that keeps everything in process memory and meets every requirement of this capability. Its clock SHALL be replaceable when it is built, so that landing times can be controlled.

#### Scenario: A working outbox with no storage

- **WHEN** the in-memory outbox is built with nothing given
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

### Requirement: An In-Memory Outbox Holds A Bounded Number Of Events

The in-memory outbox SHALL hold at most a number of event records set when it is built, with a default of its own. To make room it SHALL drop the records seen longest ago, no more than a commit needs, and SHALL NOT drop an unseen one; where that frees too little, the commit SHALL throw and write nothing. No other outbox is held to this bound.

#### Scenario: Room made from seen events

- **WHEN** a commit needs room and the outbox holds seen events
- **THEN** the events seen longest ago are dropped, as few as the commit needs, and the commit lands

#### Scenario: No room without dropping an unseen event

- **WHEN** a commit needs more room than dropping every seen event would free
- **THEN** it throws, naming how many it holds unseen and how many it may hold, and nothing is written or dropped

#### Scenario: An event carried twice

- **WHEN** a commit carries an event already held, or one event twice
- **THEN** each counts once against the bound

#### Scenario: An event dropped and committed again

- **WHEN** an event dropped to make room is committed again
- **THEN** it is stored anew, as not yet seen

#### Scenario: A bound that is no number of events

- **WHEN** the in-memory outbox is built with a bound that is not a whole number greater than zero
- **THEN** building it throws, naming the bound and the rule

### Requirement: An Outbox Answers Concurrent Calls As If Each Were Alone

Arvo's outboxes SHALL answer calls that overlap in time as if each had run alone. Two commits of one execution at one revision SHALL see exactly one committed and the other refused, and a read overlapping a commit SHALL see all of that commit or none of it.

#### Scenario: Two commits racing

- **WHEN** two commits of the same execution at the same revision are started together and both awaited
- **THEN** exactly one is committed and the other is refused as `revision_stale` or `state_exists`

#### Scenario: A read during a commit

- **WHEN** a read of committed events overlaps a commit of those events
- **THEN** it returns all of the commit's events or none of them

### Requirement: Arvo's Outboxes Answer Directly

Arvo's outboxes SHALL return every answer directly, not through a promise, and SHALL throw directly where they cannot do their work. Neither waits on anything, and an operation that never yields cannot be interleaved with another. A caller SHALL be able to await their answers as it awaits any outbox's.

#### Scenario: An answer read directly

- **WHEN** an operation of Arvo's own outbox is called
- **THEN** it returns its answer, not a promise of it

#### Scenario: An answer awaited

- **WHEN** a caller awaits an operation of Arvo's own outbox
- **THEN** it receives the same answer

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

The package SHALL provide an outbox kept in a SQLite file, which meets every requirement of this capability, creates what it needs in the file where it is missing, and leaves in place what is already there.

#### Scenario: A new file

- **WHEN** the SQLite outbox is opened on a file that does not yet exist
- **THEN** it creates the file and everything it needs in it, and meets every requirement above

#### Scenario: A file it has used before

- **WHEN** the SQLite outbox is opened on a file it used earlier
- **THEN** every state and event committed earlier is there, unchanged

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

### Requirement: A SQLite Outbox Deletes Events Seen Longer Than It Keeps Them

A SQLite outbox SHALL keep an event once seen for a time set when it is opened, with a default of its own, and MAY then delete it. It SHALL NOT delete an unseen event. Marking events seen SHALL delete a bounded number of expired events, and the outbox SHALL offer a way to delete every expired event at once. A file it creates SHALL give the space of what it deletes back to the disk. No other outbox is held to this.

#### Scenario: An event seen longer ago than it is kept

- **WHEN** events are marked seen and one has been seen for longer than the outbox keeps seen events
- **THEN** that event is deleted, and an event seen more recently is kept

#### Scenario: An unseen event committed long ago

- **WHEN** an unseen event was committed long ago
- **THEN** it is never deleted

#### Scenario: Seen events kept forever

- **WHEN** the outbox is opened to keep seen events for an unending time
- **THEN** no event is ever deleted

#### Scenario: More expired events than one marking deletes

- **WHEN** more events have expired than one marking deletes
- **THEN** marking deletes no more than its bound, and deleting every expired event removes the rest and answers how many

#### Scenario: A window that is no duration

- **WHEN** the outbox is opened with a window that is not a whole number of milliseconds, zero or more, nor unending
- **THEN** opening it throws, naming the window and the rule

### Requirement: A SQLite Outbox Is Closed By Its Caller

A SQLite outbox SHALL hold its file open until its caller closes it. Closing SHALL release the file and MAY be repeated. Using an outbox after closing it SHALL throw.

#### Scenario: Closing twice

- **WHEN** a SQLite outbox is closed and closed again
- **THEN** nothing is thrown

#### Scenario: Using a closed outbox

- **WHEN** any operation is called on a closed SQLite outbox
- **THEN** it throws
