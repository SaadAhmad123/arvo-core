# event-handler-dependencies Specification

## Purpose
How whatever an executor works with — a database client, an HTTP client, a clock, a secret — is supplied to a handler, made usable before the executor runs, read by it, and let go of once the execution ends.
## Requirements
### Requirement: Dependencies Are Supplied As One Thing That Opens And Closes

An execution SHALL accept at most one dependency, and that dependency SHALL be something that can be opened, read and closed. A bare value and a factory SHALL both be refused.

Omitting it SHALL be the only way to say there is none.

#### Scenario: Nothing supplied
- **WHEN** an execution is given no dependency
- **THEN** nothing is opened and nothing is closed
- **AND** the executor is told nothing was supplied

#### Scenario: One supplied
- **WHEN** an execution is given a dependency
- **THEN** the executor finds what that dependency exposes

### Requirement: An Executor Is Told Where Nothing Was Supplied

Where no dependency was supplied, what the executor reads SHALL state absence and SHALL NOT be an empty value standing in for one. The same SHALL hold for whatever the mechanism exposes.

Where what was supplied does not carry everything the version declared, each member it does not carry SHALL also state absence. A declared member SHALL NOT read as satisfied because the thing carrying it arrived.

An empty value that was supplied SHALL remain a supplied value, distinguishable from nothing having been supplied.

The execution SHALL be carried out either way: a handler SHALL NOT refuse a delivery because something a version declared was not supplied, and SHALL NOT decide on the executor's behalf what absence means. An executor that cannot proceed SHALL be able to fail the execution itself, naming what was missing; one that can proceed SHALL be able to.

#### Scenario: A declared dependency was not supplied
- **WHEN** a version declares what its executor needs and an execution is given none
- **THEN** the executor reads absence rather than a value whose members are missing
- **AND** the executor was entered

#### Scenario: An executor that cannot proceed says so
- **WHEN** an executor finds no dependency and cannot work without one
- **THEN** it fails the execution itself, and the failure names what was missing

#### Scenario: An executor that can proceed does
- **WHEN** an executor finds no dependency and can work without one
- **THEN** the execution is carried out and concludes normally

#### Scenario: Nothing exposed by the mechanism
- **WHEN** an execution is given no hooks
- **THEN** the executor reads absence rather than an empty value

#### Scenario: Part of a declaration arrived
- **WHEN** a version declares two things and a mechanism supplies one of them
- **THEN** the member that arrived reads as present
- **AND** the member that did not reads as absent
- **AND** the executor decides about each of them separately

#### Scenario: An empty value deliberately supplied
- **WHEN** a mechanism deliberately exposes an empty set of hooks
- **THEN** the executor reads that as supplied, not as absence

### Requirement: What The Executor Finds Is What The Dependency Exposes

An executor SHALL be given what the dependency exposes and SHALL NOT be given the dependency itself, so that the ability to open and close it is unreachable from business code.

#### Scenario: The lifetime is not reachable from an executor
- **WHEN** an executor reads what it was given and a dependency was supplied
- **THEN** it is the exposed surface and not the dependency
- **AND** nothing on it can open or close anything

### Requirement: A Dependency Is Opened Once Before The Executor

A dependency SHALL be opened exactly once per execution, after every entry check has passed and before the executor is entered. What it exposes SHALL be read once, after opening.

Opening SHALL be told what it is opening for: the event that caused the execution, what the execution remembers or absence where it remembers nothing yet, which execution it is, which attempt, and where the execution records.

#### Scenario: Opened before the executor
- **WHEN** an execution with a dependency is carried out
- **THEN** the dependency was opened once before the executor read it

#### Scenario: Told what it is opening for
- **WHEN** a dependency is opened
- **THEN** it is told the event, the execution, the attempt, and where to record
- **AND** it is told what the execution remembers, or absence on an execution that had no record yet

#### Scenario: Opened again for the next execution
- **WHEN** one dependency is supplied to two executions in turn
- **THEN** it is opened for each
- **AND** what each executor finds is what that execution's open produced

### Requirement: A Dependency That Cannot Be Opened Fails The Execution Safely

Where opening fails, the execution SHALL fail with a fault stating that dependencies could not be opened, SHALL carry the underlying failure as its cause, and SHALL state that a further attempt is in prospect. The executor SHALL NOT be entered and nothing SHALL be emitted or written.

A dependency that opens but cannot produce what it exposes SHALL fail the same way, having equally failed to become usable.

#### Scenario: Opening fails
- **WHEN** opening a dependency fails
- **THEN** the execution fails with a dependency-resolution fault carrying the cause
- **AND** a further attempt is in prospect
- **AND** the executor was never entered

#### Scenario: Opening fails with something that is not an error
- **WHEN** opening fails with a value that is not an error
- **THEN** that value is rendered into the fault's cause

#### Scenario: The exposed surface cannot be read
- **WHEN** a dependency opens but what it exposes cannot be read
- **THEN** the execution fails the same way as one that could not be opened
- **AND** the dependency is still closed, having already been opened

### Requirement: A Dependency Is Closed Once The Execution Ends

A dependency SHALL be closed exactly once after the execution ends, on every path out: a concluded execution, an executor that raised, a return that was refused, a record that could not be stored, a bound that was crossed, and an execution that ended itself.

Closing SHALL happen after everything the execution produced has been produced, so nothing is let go of while something still needs it. Closing SHALL be told the same thing opening was told.

#### Scenario: Closed after a concluded execution
- **WHEN** an execution concludes
- **THEN** the dependency was closed once, after the record was produced

#### Scenario: Closed after a failure
- **WHEN** an execution fails for any reason after its dependency was opened
- **THEN** the dependency was closed once

#### Scenario: Closed for the execution it was opened for
- **WHEN** a dependency is closed
- **THEN** it is told the same execution it was opened for

### Requirement: A Dependency That Cannot Be Closed Changes Nothing

Where closing fails, the failure SHALL be recorded where the execution records and then discarded. It SHALL NOT become a fault, SHALL NOT change what the execution produced, and SHALL NOT be reported to whatever ran the handler.

#### Scenario: Closing fails after a successful execution
- **WHEN** closing a dependency fails after an execution concluded
- **THEN** what the execution produced is unchanged
- **AND** the failure is recorded where the execution records
- **AND** nothing about the failure reaches whatever ran the handler

#### Scenario: Closing fails after a failed execution
- **WHEN** closing fails after an execution had already failed
- **THEN** the original failure is what is reported

### Requirement: Opening And Closing Are The Supplier's To Make Repeatable

A handler SHALL keep no record of what it has already opened or closed, and SHALL NOT be required to. Whoever supplies a dependency SHALL make opening safe to repeat, closing safe to repeat, and closing safe on something never opened.

#### Scenario: A handler tracks nothing
- **WHEN** a dependency is supplied to a handler
- **THEN** the handler opens and closes it without consulting any record of having done so before

#### Scenario: One dependency serving many executions
- **WHEN** one dependency is supplied to several executions
- **THEN** each execution opens and closes it
- **AND** what each executor finds belongs to its own execution

