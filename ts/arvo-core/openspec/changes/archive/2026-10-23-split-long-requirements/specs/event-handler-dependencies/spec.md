## MODIFIED Requirements

### Requirement: An Executor Is Told Where Nothing Was Supplied

Where no dependency was supplied, what the executor reads SHALL state absence and SHALL NOT be an empty value standing in for one. The same SHALL hold for whatever the mechanism exposes.

#### Scenario: A declared dependency was not supplied
- **WHEN** a version declares what its executor needs and an execution is given none
- **THEN** the executor reads absence rather than a value whose members are missing
- **AND** the executor was entered

#### Scenario: Nothing exposed by the mechanism
- **WHEN** an execution is given no hooks
- **THEN** the executor reads absence rather than an empty value

## ADDED Requirements

### Requirement: A Declared Member That Did Not Arrive Reads As Absent

Where what was supplied does not carry everything the version declared, each member it does not carry SHALL also state absence. A declared member SHALL NOT read as satisfied because the thing carrying it arrived.

#### Scenario: Part of a declaration arrived
- **WHEN** a version declares two things and a mechanism supplies one of them
- **THEN** the member that arrived reads as present
- **AND** the member that did not reads as absent
- **AND** the executor decides about each of them separately

### Requirement: A Supplied Empty Value Is Not Absence

An empty value that was supplied SHALL remain a supplied value, distinguishable from nothing having been supplied.

#### Scenario: An empty value deliberately supplied
- **WHEN** a mechanism deliberately exposes an empty set of hooks
- **THEN** the executor reads that as supplied, not as absence

### Requirement: Absence Does Not Stop The Execution

The execution SHALL be carried out either way: a handler SHALL NOT refuse a delivery because something a version declared was not supplied, and SHALL NOT decide on the executor's behalf what absence means. An executor that cannot proceed SHALL be able to fail the execution itself, naming what was missing; one that can proceed SHALL be able to.

#### Scenario: An executor that cannot proceed says so
- **WHEN** an executor finds no dependency and cannot work without one
- **THEN** it fails the execution itself, and the failure names what was missing

#### Scenario: An executor that can proceed does
- **WHEN** an executor finds no dependency and can work without one
- **THEN** the execution is carried out and concludes normally
