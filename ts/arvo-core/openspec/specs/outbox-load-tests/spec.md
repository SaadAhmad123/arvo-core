# outbox-load-tests Specification

## Purpose
A load suite that runs the in-memory and SQLite outboxes under load, for long, and through forced failures, inside Docker, to prove they lose nothing, double nothing and fail cleanly, and to measure how fast they go.

## Requirements

### Requirement: The Suite Runs Per Outbox, In Docker

The suite SHALL offer one command per outbox, `load:inmemory` and `load:sqlite`, each running every check that applies to that outbox inside a Docker container built from one image, against a fresh build of `arvo-core`, through its public entry points only. A long run SHALL be added only when asked. Nothing but the command that starts the containers SHALL run on the host.

#### Scenario: Running one outbox's suite

- **WHEN** `load:sqlite` is run with Docker available
- **THEN** every SQLite check runs in containers, and the run ends with a report

#### Scenario: Asking for the long run

- **WHEN** a command is run with `--soak`
- **THEN** the resources-over-time checks run as well, for about an hour

#### Scenario: Docker not running

- **WHEN** a command is run without Docker available
- **THEN** it stops at once, saying Docker is needed

### Requirement: The Suite Leaves The Host Untouched

Every check SHALL run inside a container: no outbox, worker, forked process, file under test or faked clock SHALL run or exist on the host. The host SHALL run only the command that builds the image, starts and stops containers, and writes the report, and SHALL be written to nowhere but the run's own results folder.

#### Scenario: What a run leaves behind

- **WHEN** a run ends
- **THEN** the only thing it has written on the host is its folder under the sandbox's `load-results/`

### Requirement: Each Container Is Capped, Shut Off And Removed

Each container SHALL be capped in CPU, memory and process count, SHALL run unprivileged and as a user other than root, with no network and no host folder mounted but the run's own results folder, and SHALL be removed when it stops, whether the run passes, fails or is interrupted.

#### Scenario: A run that exhausts its container

- **WHEN** a check uses up its container's memory or processes
- **THEN** only that container is stopped, and the host keeps every resource the caps left it

#### Scenario: An interrupted run

- **WHEN** a run is interrupted on the host
- **THEN** every container it started is stopped and removed, and nothing it started is left running

### Requirement: Every Check Holds The Same Invariants

After every check that commits, the suite SHALL verify that every committed event was handed out at least once, that no commit landed twice, that every payload reads back byte for byte, that unseen events listed oldest first, and that every refusal was a value, not a crash. Any breach SHALL fail the run, naming the check and the event.

#### Scenario: An event lost

- **WHEN** a committed event is never listed, read or published by the end of a check
- **THEN** the run fails, naming the check and the event

#### Scenario: A commit doubled

- **WHEN** two commits of one execution at one revision both land
- **THEN** the run fails

### Requirement: The Suite Measures Speed

The suite SHALL measure each operation's typical and slowest-one-percent time at 1, 4, 16 and 64 concurrent workers, with commits of 1, 10, 100 and 10,000 events, events of 1 KB, 100 KB and 1 MB, and states both tiny and deeply nested, directly on the outbox and through the dispatcher and driver. For SQLite it SHALL measure how long each call holds the thread. It SHALL report these, not assert them.

#### Scenario: A speed run

- **WHEN** the speed checks finish
- **THEN** the report gives each measurement beside the same measurement from the last run on the same machine

### Requirement: The Suite Fills An Outbox And Watches It Recover

The suite SHALL fill the in-memory outbox to each buffer's size and limit, and check that it answers `tolerating` past the size, refuses at the limit and never past it, stays `tolerating` until drained without flapping, and answers `available` and commits refused work once the sweep frees room, at tolerance zero and one and at sizes from one to millions.

#### Scenario: Pushed past its limit

- **WHEN** commits arrive faster than retention frees room
- **THEN** the in-memory outbox refuses as `capacity_exhausted` exactly at its limit, never crashes, and recovers once the sweep catches up

### Requirement: The Suite Fills A SQLite Outbox's Disk

The suite SHALL run the SQLite outbox on a size-capped disk, fill it during a commit, and check that the commit fails cleanly, nothing of it is written, and commits succeed once space is freed.

#### Scenario: A full disk

- **WHEN** the SQLite outbox's disk fills during a commit
- **THEN** that commit throws, the file opens and holds nothing of it, and commits succeed once space is freed

### Requirement: The Suite Checks Cleaning Up Under Load

The suite SHALL check, at volume, that expired seen events and terminal states are deleted and unexpired ones kept, at retentions of zero, long and, for SQLite, unending; measure how long one sweep or batch delete takes over a large backlog; check cleaning up when the clock jumps forward, back or returns no valid time, faking SQLite's clock in its container; and, for SQLite, check deleting while other processes commit.

#### Scenario: A clock that jumps back

- **WHEN** the clock jumps back during a run
- **THEN** nothing unexpired is deleted, and nothing is lost

#### Scenario: Deleting while others commit

- **WHEN** one SQLite process deletes everything expired while others commit to the same file
- **THEN** every commit lands, and only expired rows are deleted

### Requirement: The Suite Runs Things At Once

The suite SHALL race many commits of one execution at one revision, the same event committed twice within and across commits, listing against marking seen, several sweepers with leases, a lease lapsing mid-send and an event marked seen after its lease lapsed, commits during a sweep, close during commits, and opening and closing in quick succession. For SQLite it SHALL run four to eight processes on one file, a writer holding the file past the wait, and one file opened twice in one process.

#### Scenario: A race for one revision

- **WHEN** many workers commit one execution at one revision at once
- **THEN** exactly one lands and every other is refused

#### Scenario: Several processes on one file

- **WHEN** several processes commit, list with leases and mark seen on one SQLite file
- **THEN** every commit lands once, and every event is marked seen once

### Requirement: The Suite Forces Failures

The suite SHALL force: a clock that throws or returns no valid time; an outbox that throws or answers wrong shapes, seen through the driver at volume; and, for SQLite, a process killed mid-commit, a file made read-only, deleted while open, corrupted, or from a newer release. Each SHALL end in a clean error or a clean recovery, never a lost or half-written commit.

#### Scenario: Killed mid-commit

- **WHEN** a process is killed during a SQLite commit
- **THEN** the file opens afterwards, and holds all of that commit or none of it

#### Scenario: An outbox answering wrongly at volume

- **WHEN** an outbox throws or answers malformed values under load, called through the driver
- **THEN** every call reports a driver error of the right kind, and none crashes the process

### Requirement: The Suite Checks Resources Over Time

Asked for the long run, the suite SHALL run ordinary traffic for about an hour and sample, every minute, memory, the SQLite file's size and its log's, timers and open files. It SHALL fail where any keeps growing to the end, and SHALL check that closing leaves no timer, file handle or connection behind.

#### Scenario: A leak

- **WHEN** memory still grows through the last part of the long run
- **THEN** the run fails, showing the samples

### Requirement: The Suite Holds An Outbox At Its Size Limits

The suite SHALL hold a million events and a hundred thousand executions at once, and read an execution with a long history, measuring each operation there and checking every invariant.

#### Scenario: A million events

- **WHEN** an outbox holds a million events
- **THEN** every invariant holds, and the report gives each operation's time there

### Requirement: The Suite Reports Every Run

Each run SHALL end with a report naming every check passed or failed, its measurements beside the last run's on the same machine, and the machine, Docker limits and `arvo-core` build it ran on, written to the terminal and to `load-results/` in the sandbox. A check that cannot run where it is SHALL be reported as skipped, with why, and SHALL NOT pass.

#### Scenario: A check that cannot run

- **WHEN** a check needs something its container does not have
- **THEN** the report names it skipped and why, and does not count it as passed
