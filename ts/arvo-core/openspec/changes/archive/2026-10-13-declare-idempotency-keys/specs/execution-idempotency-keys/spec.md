## Purpose

The keys an executor hands to something outside Arvo that accepts one, so that work repeated by a retry or by two racing deliveries is recognised as the same work rather than done twice.

## ADDED Requirements

### Requirement: Three Scopes, And No Fourth

An executor SHALL be given three idempotency keys, each a string: one the same for every execution of one workflow, one the same for every delivery and attempt of one execution, and one the same for every attempt of one delivery.

No key SHALL be offered that differs between an attempt and the attempt it repeats.

#### Scenario: All three are present
- **WHEN** an executor is entered
- **THEN** it finds a key for the workflow, one for the execution, and one for the delivery

#### Scenario: Nothing is keyed on the attempt
- **WHEN** an executor looks for a key that identifies this attempt
- **THEN** there is none

### Requirement: The Workflow Key Is The Same Everywhere In One Run

The workflow key SHALL be the same for every execution belonging to one workflow, at every depth, and SHALL differ between workflows.

#### Scenario: Two executions of one workflow
- **WHEN** two different executions of one workflow are carried out
- **THEN** both are given the same workflow key

#### Scenario: Two workflows
- **WHEN** executions of two different workflows are carried out
- **THEN** they are given different workflow keys

### Requirement: The Execution Key Is The Same For Every Delivery Of One Execution

The execution key SHALL be the same on every delivery to one execution and on every attempt of each, and SHALL differ between executions.

#### Scenario: A later delivery to the same execution
- **WHEN** an execution is delivered to again
- **THEN** the execution key is the one the first delivery was given

#### Scenario: A retry of one delivery
- **WHEN** a delivery is attempted again
- **THEN** the execution key is unchanged

#### Scenario: A different execution of the same workflow
- **WHEN** another execution of the same workflow is carried out
- **THEN** its execution key differs, while its workflow key does not

### Requirement: The Delivery Key Is The Same For Every Attempt Of One Delivery

The delivery key SHALL be the same on every attempt of one delivery, SHALL be the same where the event that caused it is delivered again, and SHALL differ between two deliveries to one execution caused by different events.

#### Scenario: A retry of one delivery
- **WHEN** a delivery is attempted again
- **THEN** the delivery key is unchanged

#### Scenario: Two different events reaching one execution
- **WHEN** one execution is delivered to twice, caused by two different events
- **THEN** each delivery is given a different delivery key
- **AND** both are given the same execution key

### Requirement: The Keys Are Derived, Not Stored

Every key SHALL be a function of what the record and the delivered event already carry. No key SHALL be written into the record, and carrying out the same events again SHALL produce the same keys.

#### Scenario: The record is unchanged by the keys
- **WHEN** an execution is carried out
- **THEN** nothing about an idempotency key appears in what was committed

#### Scenario: The same events again
- **WHEN** the same events are carried out again against an empty store
- **THEN** every key is the one it was the first time

### Requirement: How Each Key Is Composed Is Fixed

Each key SHALL be composed exactly as [ADR-014](../../../../../docs/adr/014-idempotency-keys.md) states: the scope's name, then the parts that scope is keyed on, separated by a byte that cannot occur within any of them, hashed, rendered as lowercase hexadecimal, behind a prefix naming the composition.

Two implementations SHALL produce the same key for the same execution.

#### Scenario: A known execution
- **WHEN** keys are composed for a known workflow, execution and event
- **THEN** each is exactly the string the pinned composition produces

#### Scenario: Two scopes that would otherwise collide
- **WHEN** a workflow's name is the same string as some execution's identifier
- **THEN** the workflow key and the execution key still differ

#### Scenario: Parts that would otherwise run together
- **WHEN** two different executions and events would form the same string if their parts were joined without a separator
- **THEN** their delivery keys still differ
