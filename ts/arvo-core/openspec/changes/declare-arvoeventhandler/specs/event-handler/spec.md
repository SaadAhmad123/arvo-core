## Purpose

An ArvoEventHandler implements one contract, declares the contracts it may send events to, and holds one executor per version of the contract it implements. This capability covers what a handler is, what declaring one requires, which declarations are refused and why, and how the options governing a version are resolved. It implements [ADR-006](../../../../../../docs/adr/006-arvoeventhandler-protocol.md).

## ADDED Requirements

### Requirement: Declaring A Handler

The system SHALL build a handler from a declaration naming the contract it implements, an executor for each of that contract's versions, and optionally the contracts it may send events to, options for the handler, options for a version, and a state schema for a version.

A declaration SHALL be assembled in two stages: what a handler has one of, declared once, and then each version, declared one at a time. No rule SHALL be checked until the declaration is complete, and every rule SHALL be checked then.

The contract SHALL be named as a contract and not as a version. Each contract the handler may send events to SHALL be named at exactly one version.

A version needing neither a state schema nor options of its own SHALL be declarable as its executor alone, and SHALL be understood exactly as the same executor declared with neither.

A declaration MAY state the shape of the dependencies and of the mechanism hooks its executors will be given. Both are supplied by whatever runs the handler and neither is part of what a handler holds, so stating either SHALL NOT change what is built and SHALL NOT be stored.

A declaration that breaks any rule of this capability SHALL be refused, and the handler SHALL NOT be built.

A handler built from a declaration SHALL process no event, read no record and call no executor. Declaring a handler is the whole of what this capability does.

#### Scenario: A handler implementing a one-version contract
- **WHEN** a handler is declared for a contract with one version, with an executor for that version
- **THEN** the handler is built
- **AND** it holds that contract
- **AND** it holds that executor for that version

#### Scenario: A handler with no services
- **WHEN** a handler is declared naming no contracts it may send events to
- **THEN** the handler is built
- **AND** it holds no services

#### Scenario: A version that remembers nothing
- **WHEN** a handler is declared with a version that names no state schema
- **THEN** the handler is built
- **AND** that version holds no state schema

#### Scenario: A version declared as its executor alone
- **WHEN** a version is declared as an executor rather than as a declaration naming one
- **THEN** the handler is built
- **AND** that version holds that executor
- **AND** it holds no state schema
- **AND** every one of its options is the value in force at the handler

#### Scenario: A version that remembers something
- **WHEN** a handler is declared with a version that names a state schema
- **THEN** the handler is built
- **AND** that version holds that schema unchanged

#### Scenario: Declared dependency and hook shapes are not stored
- **WHEN** a handler is declared stating the shape of its dependencies and of its mechanism hooks
- **THEN** the handler is built
- **AND** it holds neither

#### Scenario: Services are held at the version named
- **WHEN** a handler is declared naming a service contract at one of its versions
- **THEN** the handler holds that version of that contract

### Requirement: What An Execution Remembers

The system SHALL represent what an execution remembers as one immutable value carrying its own data, the execution's identity and depth, the contract and version it belongs to, where it rests and why, the event that opened it, the event that caused the delivery being processed, the events it has touched, what it is waiting on, and the bookkeeping whatever stores it requires.

Such a value SHALL be checked as it is built, and SHALL NOT come into being where any field it carries is of the wrong shape. What is checked is shape and domain; whether the record agrees with the contract it names is not checked here.

Replacing that data SHALL produce a new such value, carrying every other field across unchanged. The value replaced SHALL NOT be altered.

Data SHALL be replaceable by a value, or by a function given what is remembered now.

Replacing data SHALL check it against the schema governing that version, at the moment of the write. That schema SHALL be supplied by whatever performs the write and SHALL NOT be part of what is remembered. Data the schema refuses SHALL be reported as an execution fault naming that, and SHALL leave what is remembered unchanged.

What is remembered SHALL be what the schema produced, so that a value the schema fills in or transforms reads back as the schema left it.

Data SHALL be empty until something writes it, every other field being known from the moment an execution opens. The value itself SHALL NOT be absent on that account.

Nothing other than data SHALL be replaceable by an executor.

#### Scenario: A record of the wrong shape
- **WHEN** a value of the wrong shape is offered as what an execution remembers
- **THEN** it is refused, and no such value comes into being

#### Scenario: An execution that has written nothing
- **WHEN** the state of an execution that has just opened is read
- **THEN** its data is empty
- **AND** its identity, its depth and where it rests are all reported

#### Scenario: Reading what an execution remembers
- **WHEN** an execution's state is read
- **THEN** its data is reported
- **AND** so are its identity, where it rests, and what it is waiting on
- **AND** so are the event that opened it and the event that caused this delivery

#### Scenario: One place to read one value
- **WHEN** an executor reads the delivered event, or the event that opened the execution
- **THEN** each is reached through what the execution remembers
- **AND** neither is reported a second time elsewhere

#### Scenario: Replacing the data
- **WHEN** an execution's data is replaced
- **THEN** what is remembered carries the new data
- **AND** every other field is what it was

#### Scenario: What was read is not disturbed
- **WHEN** an execution's data is replaced
- **THEN** the value read before the replacement is unchanged

#### Scenario: Building on what is remembered
- **WHEN** data is replaced by a function
- **THEN** that function receives what is remembered now
- **AND** what it returns becomes the new data

#### Scenario: Data the schema refuses
- **WHEN** data is replaced by something the schema refuses
- **THEN** an execution fault naming a rejected state is reported
- **AND** it names every rule the value broke
- **AND** what is remembered is unchanged

#### Scenario: What the schema fills in is what is remembered
- **WHEN** data is replaced by a value the schema completes or transforms
- **THEN** what is remembered is what the schema produced

### Requirement: Storing What An Execution Remembers

The system SHALL turn what an execution remembers into a string, and SHALL turn such a string back into what an execution remembers, against the schema governing that version's data.

Reading one back SHALL restore every event it holds to an event value, and SHALL check its data against the schema supplied.

A string that is not what was written, a record missing what it must carry, an event that will not restore, or data the schema refuses SHALL each be reported rather than returned, and no partly restored record SHALL be given back.

What is read back SHALL carry everything that was written.

#### Scenario: A round trip
- **WHEN** what an execution remembers is turned into a string and back
- **THEN** every field it carried is what it was
- **AND** its data is what it was

#### Scenario: Events come back as events
- **WHEN** a record holding events is read back
- **THEN** each of them is an event value rather than the plain object it was stored as

#### Scenario: A string that is not a record
- **WHEN** something that is not what was written is read back
- **THEN** it is reported rather than returned

#### Scenario: Data the schema refuses
- **WHEN** a record is read back against a schema its data does not satisfy
- **THEN** it is reported rather than returned

### Requirement: Building An Event To Emit

The system SHALL let an executor produce a fully addressed event from an event type and a payload, without that executor knowing any addressing rule.

Such an event SHALL carry every default the protocol fixes for its role. An event to a service SHALL carry this execution's own identity, one more than its depth, and no correlation to a request being answered. An event completing this execution SHALL carry the caller's identity, this execution's own depth, and the event that opened the execution as the request it answers. Both SHALL carry the workflow, the contract this execution implements, the event that caused this delivery, and the role the event plays.

A type this version may not emit SHALL be refused. The handler error event's type SHALL be refused, an executor having no means to produce one.

A payload the schema for that type refuses SHALL be refused.

An executor SHALL be able to set what is its own to choose without reaching past a boundary, and SHALL be able to set what is not only by reaching past one that is named as such.

#### Scenario: An event to a service
- **WHEN** an executor builds an event of a declared service's input type
- **THEN** it is addressed to that service
- **AND** it carries this execution's identity, and one more than its depth
- **AND** it answers no request

#### Scenario: An event completing this execution
- **WHEN** an executor builds an event of one of this version's own output types
- **THEN** it is addressed to whoever opened this execution
- **AND** it carries the caller's identity, and this execution's own depth
- **AND** it names the event that opened the execution as the request it answers

#### Scenario: A type this version may not emit
- **WHEN** an executor builds an event of a type that is neither a declared service's input nor one of this version's outputs
- **THEN** it is refused

#### Scenario: The handler error event
- **WHEN** an executor builds an event of this version's handler error type
- **THEN** it is refused

#### Scenario: A payload the schema refuses
- **WHEN** an executor builds an event whose payload does not satisfy the schema its type selects
- **THEN** it is refused

#### Scenario: Setting what is the executor's to choose
- **WHEN** an executor sets the processing path or the cost figure
- **THEN** the event carries what was set

#### Scenario: Setting what is not
- **WHEN** an executor sets a field whose wrong value would spoil something beyond this execution
- **THEN** it does so only through a surface named as unsafe
- **AND** the event carries what was set

### Requirement: Seeing A Bound Before Crossing It

The system SHALL tell an executor whether an event it sends to a service could still be sent, so that reaching the limit is a choice rather than a failure. That SHALL be true exactly when such an event could no longer sit one deeper without reaching the maximum this version allows.

The system SHALL tell an executor how long it has left, on each of the two clocks the version bounds: the one covering this attempt, and the one covering the execution from the event that opened it until it rests. A clock the version leaves unbounded SHALL be reported as having no limit rather than as a figure.

Those figures SHALL be worked out afresh whenever they are read, so that an executor running for a long time sees what is left rather than what was left when it started. The moment the executor was entered, which is where the clock on the attempt starts, SHALL be readable.

A clock already overrun SHALL report a figure below zero rather than none.

#### Scenario: Room to send to a service
- **WHEN** an execution sits further than one step from the maximum
- **THEN** it is told it may still send to a service

#### Scenario: No room left
- **WHEN** an execution sits one step from the maximum
- **THEN** it is told it may not

#### Scenario: How long is left
- **WHEN** an executor reads what time it has
- **THEN** it is told what remains of this attempt
- **AND** what remains of the whole execution, measured from the event that opened it

#### Scenario: A clock the version left unbounded
- **WHEN** a version sets no limit on a clock
- **THEN** that clock is reported as having none

#### Scenario: Time passing while an executor runs
- **WHEN** an executor reads what time it has, works for a while, and reads again
- **THEN** the second reading is smaller than the first

#### Scenario: A clock already overrun
- **WHEN** an executor reads a clock it has already passed
- **THEN** it is told by how much

### Requirement: Ending An Execution Deliberately

The system SHALL let an executor end its own execution with a reason, leaving it at rest and unable to continue.

What is remembered SHALL otherwise be unchanged, and the reason SHALL be carried on it.

#### Scenario: An executor ends its execution
- **WHEN** an executor cancels with a reason
- **THEN** the execution is at rest
- **AND** the reason is carried on what it remembers

#### Scenario: Nothing else moves
- **WHEN** an executor cancels
- **THEN** its data, its identity and its event log are what they were

### Requirement: An Executor For Every Version, And For No Other

The system SHALL require one executor for each version the implemented contract declares, and SHALL refuse a declaration that omits one.

The system SHALL refuse a declaration naming an executor for a version the implemented contract does not declare.

The system SHALL refuse a declaration naming the same version more than once.

#### Scenario: Every version has an executor
- **WHEN** a handler is declared for a contract with two versions, with an executor for each
- **THEN** the handler is built

#### Scenario: A version has no executor
- **WHEN** a handler is declared for a contract with two versions, with an executor for one
- **THEN** the declaration is refused
- **AND** the report names the version with no executor

#### Scenario: An executor names an undeclared version
- **WHEN** a handler is declared with an executor for a version the contract does not declare
- **THEN** the declaration is refused
- **AND** the report names that version

#### Scenario: One version declared twice
- **WHEN** a handler is declared naming the same version twice
- **THEN** the declaration is refused
- **AND** the report names that version

### Requirement: No Two Declared Capabilities Share An Event Type

The system SHALL refuse a declaration in which any two capabilities of one version share an event type, a capability being the input type of a declared service, a key of that version's outputs, or that version's handler error type.

The check SHALL be made per version, the set of emittable types being a property of a version and not of the handler.

#### Scenario: Two services sharing an input type
- **WHEN** a handler is declared with two service contracts whose types are equal
- **THEN** the declaration is refused
- **AND** the report names the shared type

#### Scenario: A service input colliding with an output
- **WHEN** a handler is declared with a service contract whose type equals a key of a version's outputs
- **THEN** the declaration is refused
- **AND** the report names the version and the shared type

#### Scenario: A service input colliding with a handler error type
- **WHEN** a handler is declared with a service contract whose type equals a version's handler error type
- **THEN** the declaration is refused

#### Scenario: A collision in one version only
- **WHEN** a handler is declared for a contract of two versions, and a service's type collides with an output of one version only
- **THEN** the declaration is refused
- **AND** the report names the version in which the collision occurs

#### Scenario: Unrelated types across versions
- **WHEN** two versions of the implemented contract each declare an output of the same type, and no service collides with either
- **THEN** the handler is built

### Requirement: The Implemented Contract May Be Declared As A Service

The system SHALL permit a handler to name, as a service, the contract it implements, at one version, and SHALL NOT treat that as a collision.

#### Scenario: A handler that may call itself
- **WHEN** a handler is declared naming, as a service, a version of the contract it implements
- **THEN** the handler is built
- **AND** it holds that service

#### Scenario: Self as a service does not collide with its own outputs
- **WHEN** a handler names itself as a service and the implemented version also declares outputs
- **THEN** the handler is built

### Requirement: No Two Versions Of One Service Contract

The system SHALL refuse a declaration naming two versions of the same contract as services, identity being the contract's uri.

#### Scenario: One contract at two versions
- **WHEN** a handler is declared with two services that are different versions of one contract
- **THEN** the declaration is refused
- **AND** the report names that contract

#### Scenario: Two contracts at one version each
- **WHEN** a handler is declared with two services that are versions of different contracts
- **THEN** the handler is built

### Requirement: The Seven Options And Their Defaults

The system SHALL accept seven options, at the handler and at each version: a maximum depth, a maximum number of retry attempts, a retry delay, a run timeout, an execution timeout, a collection strategy, and a handler error domain.

Every option SHALL hold a value at the handler level once the handler is built, the value being the one declared or, where none was declared, the default [ADR-006](../../../../../../docs/adr/006-arvoeventhandler-protocol.md) fixes for it.

Each option's value SHALL lie within the domain that option's type allows, at both levels, and the system SHALL refuse a declaration carrying a value outside it.

#### Scenario: Defaults where nothing is declared
- **WHEN** a handler is declared naming no options at either level
- **THEN** the handler is built
- **AND** every option at the handler level holds the default ADR-006 fixes for it

#### Scenario: A declared handler-level value is kept
- **WHEN** a handler is declared with a handler-level value for an option
- **THEN** that option holds the declared value at the handler level

#### Scenario: A value outside its domain at the handler level
- **WHEN** a handler is declared with a negative maximum depth
- **THEN** the declaration is refused
- **AND** the report names that option

#### Scenario: A value outside its domain at a version
- **WHEN** a handler is declared with a version whose collection strategy is neither of the two allowed
- **THEN** the declaration is refused
- **AND** the report names the version and that option

#### Scenario: A retry delay as a function
- **WHEN** a handler is declared with a retry delay given as a function
- **THEN** the handler is built
- **AND** that option holds the function unchanged

#### Scenario: A handler error domain naming a source
- **WHEN** a handler is declared with a handler error domain given as a domain source rather than a literal
- **THEN** the handler is built
- **AND** that option holds the source unchanged, unresolved

### Requirement: Resolving An Option For A Version

The system SHALL determine, for any declared version, the value of each option in force for that version: the value that version declared where it declared one, and the handler-level value otherwise.

An option a version does not declare SHALL be understood as inherited, and SHALL NOT be understood as a value.

For an option whose type admits it, a version declaring null SHALL be understood as having declared that value, and SHALL NOT be understood as inheriting.

#### Scenario: A version's own value wins
- **WHEN** an option is declared at both the handler and a version
- **THEN** the value in force for that version is the version's

#### Scenario: An undeclared option inherits
- **WHEN** an option is declared at the handler and not at a version
- **THEN** the value in force for that version is the handler's

#### Scenario: An option declared nowhere
- **WHEN** an option is declared at neither level
- **THEN** the value in force for that version is the default ADR-006 fixes for it

#### Scenario: A written null is unbounded, not inherited
- **WHEN** a run timeout is declared at the handler, and a version declares its run timeout as null
- **THEN** the value in force for that version is null
- **AND** it is not the handler's value

#### Scenario: Resolution is per version
- **WHEN** two versions declare different values for one option
- **THEN** each reports its own value

### Requirement: An Execution Timeout Not Below The Run Timeout

The system SHALL refuse a declaration in which, for any version, the resolved execution timeout is below the resolved run timeout.

The system SHALL refuse a declaration in which, for any version, the resolved run timeout is null and the resolved execution timeout is not.

The comparison SHALL be made on the values in force for that version after resolution, and not on the values as declared.

#### Scenario: An execution timeout below the run timeout
- **WHEN** a version resolves to a run timeout of thirty seconds and an execution timeout of five seconds
- **THEN** the declaration is refused
- **AND** the report names that version

#### Scenario: The two halves declared at different levels
- **WHEN** the run timeout is declared at the handler and an execution timeout below it is declared at a version
- **THEN** the declaration is refused

#### Scenario: An unbounded run timeout with a bounded execution timeout
- **WHEN** a version resolves to a null run timeout and an execution timeout that is not null
- **THEN** the declaration is refused

#### Scenario: Both unbounded
- **WHEN** a version resolves to a null run timeout and a null execution timeout
- **THEN** the handler is built

#### Scenario: An execution timeout above the run timeout
- **WHEN** a version resolves to a run timeout of ten seconds and an execution timeout of one day
- **THEN** the handler is built

#### Scenario: Equal timeouts
- **WHEN** a version resolves to a run timeout and an execution timeout of the same value
- **THEN** the handler is built

### Requirement: Reporting Every Rule A Declaration Breaks

The system SHALL report every rule a declaration breaks rather than the first, each naming its position within the declaration and the value found.

A declaration failure SHALL be reported before any of it takes effect: a handler SHALL NOT be built at all where any rule was broken.

Where the contract implemented is not a contract, the system SHALL report that alone, marked as blocking, and SHALL attempt no other rule.

A declaration failure SHALL be reported as a validation failure and SHALL NOT be reported as an execution fault, no fault being defined for a declaration.

#### Scenario: Several rules broken
- **WHEN** a declaration omits an executor for one version and carries an option outside its domain
- **THEN** the declaration is refused
- **AND** both are reported

#### Scenario: No contract
- **WHEN** a declaration names something that is not a contract
- **THEN** the declaration is refused
- **AND** that is reported alone, marked as blocking

#### Scenario: A position for every report
- **WHEN** a declaration is refused for a version's option
- **THEN** the report names the version and the option

### Requirement: Reading A Version Of A Built Handler

The system SHALL report, for any version a built handler declares, one immutable value carrying that version: the state schema it declared or its absence, the options in force for it, the event types it may emit, and the means to run its executor.

Reading a version the handler declares SHALL always yield such a value, a handler having been refused where any declared version had none.

The options reported SHALL be the complete set in force, inheritance already applied. What a version declared SHALL NOT be reported separately.

#### Scenario: Reading a declared version
- **WHEN** a version of a built handler is read
- **THEN** a value for that version is reported
- **AND** it carries the state schema that version declared

#### Scenario: A version that declared no schema
- **WHEN** a version that declared no state schema is read
- **THEN** the absence of a schema is reported rather than a schema

#### Scenario: The options reported are the ones in force
- **WHEN** a version declaring one option is read, its handler declaring another
- **THEN** every option is reported
- **AND** the version's own value is reported for the one it declared
- **AND** the handler's value is reported for the one it did not

#### Scenario: What was read cannot be changed
- **WHEN** a version of a built handler is read
- **THEN** neither it nor the options it reports can be modified

### Requirement: The Event Types A Version May Emit

The system SHALL determine, for any declared version, the set of event types that version may emit: the input type of each declared service, each key of that version's outputs, and that version's handler error type.

The set SHALL be a property of the version and SHALL NOT be shared between versions declaring different outputs.

#### Scenario: The set for a version
- **WHEN** a handler declares one service and a version declaring one output
- **THEN** that version's emittable set is the service's type, the output's key, and the version's handler error type

#### Scenario: Two versions differing
- **WHEN** two versions of the implemented contract declare different outputs
- **THEN** each version's emittable set carries its own outputs
- **AND** both carry every declared service's type

#### Scenario: A version declaring no outputs
- **WHEN** a version declares no outputs
- **THEN** its emittable set is every declared service's type and its handler error type
