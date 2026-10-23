## MODIFIED Requirements

### Requirement: A Layer, Or A Way To Make One

Wherever layers are listed, each entry SHALL be accepted either as a layer or as an operation taking nothing and returning one. Before any layer runs, each such operation SHALL be invoked exactly once for the execution and what it returns SHALL take the entry's place; the identifier rule SHALL then be applied to the layers that result.

A layer made by such an operation SHALL serve that execution only.

#### Scenario: A declared factory
- **WHEN** a handler declares an operation in place of a layer and an execution runs
- **THEN** the operation was invoked once for that execution
- **AND** the layer it returned ran as if it had been declared directly

#### Scenario: A supplied factory
- **WHEN** an execution is supplied an operation in place of a layer
- **THEN** the operation was invoked once and the layer it returned ran

#### Scenario: One instance per execution
- **WHEN** two executions of one handler run with a declared operation
- **THEN** the operation was invoked once per execution
- **AND** the two executions ran different instances

#### Scenario: Duplicate identifiers after instantiation
- **WHEN** an operation returns a layer whose identifier another layer already carries
- **THEN** the execution is a non-retryable fault naming a middleware conflict

### Requirement: Supplying Layers Per Execution

An execution SHALL accept layers supplied alongside the event, the state function, the attempt and the dependencies, and SHALL apply them to that execution only. Omitting them SHALL be the only way to say there are none, and an empty list SHALL be understood as none. A caller no compiler saw passing nothing SHALL be understood as none, and one passing something that is not a list SHALL be refused as a non-retryable execution fault naming a failed instantiation.

#### Scenario: Nothing supplied
- **WHEN** an execution is supplied no layers and the handler declares none
- **THEN** the executor runs alone, exactly as it would have before layers existed

#### Scenario: Supplied layers apply to this execution only
- **WHEN** one execution is supplied a layer and a later execution of the same handler is not
- **THEN** the layer runs for the first and not for the second

### Requirement: The Before Part Has An Executor's Powers And An Executor's Failures

A before part SHALL be able to do what an executor may do before returning: read the context, replace business state, write middleware data, mark the execution cancelled, raise a fault through the context, or fail. It SHALL return nothing.

#### Scenario: State written before is seen by the executor
- **WHEN** a before part replaces the business state
- **THEN** the executor reads the replaced state

#### Scenario: A before part cancels
- **WHEN** a before part marks the execution cancelled and the executor then answers the caller
- **THEN** the record rests at cancelled, as it would had the executor marked it

### Requirement: The After Part Only Observes

An after part SHALL return nothing and SHALL NOT be able to alter what the executor returned, nor what the execution remembers: the record produced SHALL be the one the execution had come to at the moment the executor returned. A write an after part makes through the context — to the business state, or by marking the execution cancelled — SHALL be discarded and marked on the delivery span.

#### Scenario: An after part writes state
- **WHEN** an after part replaces the business state
- **THEN** the record produced carries the state the executor left
- **AND** the discarded write is marked on the delivery span

#### Scenario: An after part cancels
- **WHEN** an after part marks an execution cancelled that the executor concluded otherwise
- **THEN** the record rests where the executor's return put it

### Requirement: Middleware Data Travels Inward

An execution SHALL carry middleware data: a value built fresh for every execution, written by a layer's before part through the context's write member and read by every layer inside it and by the executor through the context's read member.

It SHALL NOT be written to the record, SHALL NOT be validated against any schema, and SHALL be whatever the layers left under whatever keys they chose.

The read member SHALL NOT be a way to write.

#### Scenario: Written before, read by the executor
- **WHEN** a before part writes a key
- **THEN** the executor reads that key with that value

#### Scenario: Written by an outer layer, read by an inner one
- **WHEN** a supplied layer's before part writes a key
- **THEN** a declared layer's before part reads that key with that value

#### Scenario: Fresh per execution
- **WHEN** one execution writes a key and a later execution of the same handler reads it
- **THEN** the later execution finds no such key

#### Scenario: Not on the record
- **WHEN** an execution writes middleware data and produces a record
- **THEN** the record carries nothing of it

#### Scenario: Reading is not writing
- **WHEN** an executor attempts to assign through the read member
- **THEN** the attempt fails
- **AND** the data is unchanged

### Requirement: One Run Clock Covers The Layers

The run clock SHALL cover the before parts, the executor and the after parts. Where it expires during a before part or the executor, the execution SHALL be the retryable fault naming the run timeout, as it is today. Where it expires during an after part, what the executor returned SHALL stand, the remaining after parts SHALL NOT run, and the overrun SHALL be recorded on the delivery span and discarded.

#### Scenario: A slow before part
- **WHEN** a before part takes longer than the run clock allows
- **THEN** the execution is a retryable fault naming the run timeout
- **AND** the executor did not run

#### Scenario: A slow after part
- **WHEN** an after part takes longer than what remains of the run clock
- **THEN** the execution produces exactly what the executor returned
- **AND** the remaining after parts did not run
- **AND** the overrun is recorded on the delivery span

## ADDED Requirements

### Requirement: A Layer That Cannot Be Made Is A Fault

An operation that fails, or returns something that is not a layer, SHALL be a non-retryable execution fault naming a failed instantiation, raised before any layer runs.

#### Scenario: An operation that throws
- **WHEN** an operation listed in place of a layer throws
- **THEN** the execution is a non-retryable fault naming a failed instantiation
- **AND** no part of any layer ran
- **AND** the executor did not run

#### Scenario: An operation that returns something else
- **WHEN** an operation listed in place of a layer returns a value with no identifier
- **THEN** the execution is a non-retryable fault naming a failed instantiation

### Requirement: A Supplied Identifier Already Carried Is Refused

A supplied layer whose identifier another layer of the same execution already carries — whether that other layer was supplied or declared on the handler — SHALL be refused as a non-retryable execution fault naming a middleware conflict, before any layer runs.

#### Scenario: A supplied identifier already declared
- **WHEN** an execution is supplied a layer whose identifier a declared layer carries
- **THEN** the execution is a non-retryable fault naming a middleware conflict
- **AND** no part of any layer ran
- **AND** the executor did not run

#### Scenario: Two supplied layers with one identifier
- **WHEN** an execution is supplied two layers carrying the same identifier
- **THEN** the execution is a non-retryable fault naming a middleware conflict
- **AND** no part of any layer ran

### Requirement: A Failing Before Part Ends The Execution

Where a before part fails, no further before part SHALL run, the executor SHALL NOT run, and no after part SHALL run. What was raised SHALL decide the outcome exactly as it would had the executor raised it: a fault built through the context SHALL remain an execution fault with the retry verdict the layer chose, and anything else SHALL become the handler error event with the execution resting at error.

#### Scenario: A before part raises a fault
- **WHEN** a before part raises a fault built through the context
- **THEN** the execution is that fault, with the retry verdict the layer chose
- **AND** nothing is emitted and no record is produced
- **AND** no later before part, the executor, or any after part ran

#### Scenario: A before part throws
- **WHEN** a before part throws something that is not a fault
- **THEN** the execution produces the handler error event for the caller
- **AND** the record rests at error with the failure's message
- **AND** no later before part, the executor, or any after part ran

### Requirement: An After Part Runs Only Where The Executor Returned

An after part SHALL run only where the executor returned. Where the executor raised, or outran the run clock, no after part SHALL run.

#### Scenario: The executor raised
- **WHEN** the executor throws
- **THEN** no after part runs
- **AND** the execution produces the handler error event as before

#### Scenario: The executor outran the run clock
- **WHEN** the executor does not return within the run clock
- **THEN** no after part runs
- **AND** the execution is a retryable fault naming the run timeout as before

### Requirement: A Failing After Part Leaves The Outcome Unchanged

Where an after part fails — a fault built through the context or anything else — the outcome SHALL be unchanged: what the executor returned SHALL stand, the failure SHALL be recorded on the delivery span and discarded, every remaining after part SHALL still run, and nothing of the failure SHALL reach the mechanism.

#### Scenario: An after part throws
- **WHEN** an after part throws
- **THEN** the execution produces exactly what the executor returned
- **AND** the failure is recorded on the delivery span
- **AND** every other after part ran

#### Scenario: An after part raises a fault
- **WHEN** an after part raises a fault built through the context
- **THEN** the execution is not a fault
- **AND** it produces exactly what the executor returned
- **AND** the fault is recorded on the delivery span

### Requirement: A Middleware Data Key Is Written Once

The write member SHALL take one key and one value. A key already present SHALL be refused as a non-retryable execution fault naming a middleware conflict, and the write SHALL leave the data unchanged.

#### Scenario: A key written twice
- **WHEN** a key already present is written again
- **THEN** the execution is a non-retryable fault naming a middleware conflict
- **AND** the fault's message names the key

### Requirement: The Clocks Are Read When The Executor Returns

The clocks SHALL be read at the moment the executor returns, so that time spent in after parts changes neither verdict.

#### Scenario: A slow after part and the execution clock
- **WHEN** the executor returns inside the execution clock and an after part then runs past it
- **THEN** the execution is not refused for time
