## MODIFIED Requirements

### Requirement: Declaring A Handler

The system SHALL build a handler from a declaration naming the contract it implements, an executor for each of that contract's versions, and optionally the contracts it may send events to, options for the handler, options for a version, a state schema for a version, and layers that run around every version's executor.

A declaration that breaks any rule of this capability SHALL be refused, and the handler SHALL NOT be built.

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

#### Scenario: A version that remembers something
- **WHEN** a handler is declared with a version that names a state schema
- **THEN** the handler is built
- **AND** that version holds that schema unchanged

### Requirement: What An Execution Remembers

The system SHALL represent what an execution remembers as one immutable value carrying its own data, the execution's identity and depth, the contract and version it belongs to, where it rests and why, the event that opened it, the event that caused the delivery being processed, the events it has touched, what it is waiting on, and the bookkeeping whatever stores it requires.

#### Scenario: Reading what an execution remembers
- **WHEN** an execution's state is read
- **THEN** its data is reported
- **AND** so are its identity, where it rests, and what it is waiting on
- **AND** so are the event that opened it and the event that caused this delivery

#### Scenario: One place to read one value
- **WHEN** an executor reads the delivered event, or the event that opened the execution
- **THEN** each is reached through what the execution remembers
- **AND** neither is reported a second time elsewhere

### Requirement: Storing What An Execution Remembers

The system SHALL turn what an execution remembers into a string, and SHALL turn such a string back into what an execution remembers, against the schema governing that version's data.

Reading one back SHALL restore every event it holds to an event value, and SHALL check its data against the schema supplied.

What is read back SHALL carry everything that was written.

#### Scenario: A round trip
- **WHEN** what an execution remembers is turned into a string and back
- **THEN** every field it carried is what it was
- **AND** its data is what it was

#### Scenario: Events come back as events
- **WHEN** a record holding events is read back
- **THEN** each of them is an event value rather than the plain object it was stored as

### Requirement: Building An Event To Emit

The system SHALL let an executor produce a fully addressed event from an event type and a payload, without that executor knowing any addressing rule.

Such an event SHALL carry every default the protocol fixes for its role.

A type this version may not emit SHALL be refused. The handler error event's type SHALL be refused, an executor having no means to produce one.

A payload the schema for that type refuses SHALL be refused.

#### Scenario: A type this version may not emit
- **WHEN** an executor builds an event of a type that is neither a declared service's input nor one of this version's outputs
- **THEN** it is refused

#### Scenario: The handler error event
- **WHEN** an executor builds an event of this version's handler error type
- **THEN** it is refused

#### Scenario: A payload the schema refuses
- **WHEN** an executor builds an event whose payload does not satisfy the schema its type selects
- **THEN** it is refused

### Requirement: Seeing A Bound Before Crossing It

The system SHALL tell an executor whether an event it sends to a service could still be sent, so that reaching the limit is a choice rather than a failure. That SHALL be true exactly when such an event could no longer sit one deeper without reaching the maximum this version allows.

#### Scenario: Room to send to a service
- **WHEN** an execution sits further than one step from the maximum
- **THEN** it is told it may still send to a service

#### Scenario: No room left
- **WHEN** an execution sits one step from the maximum
- **THEN** it is told it may not

### Requirement: What A Delivery Records Against

The system SHALL carry the delivery's tracing span to an executor, so that what an executor does is recorded against the same delivery everything else is.

That span SHALL be supplied from outside and carried unchanged. The system SHALL neither start nor end it. The tracing headers of that span SHALL be readable alongside it, and SHALL be absent where the span records nothing.

#### Scenario: An executor records what it did
- **WHEN** an executor reaches the delivery's span
- **THEN** it is the span the delivery was given

#### Scenario: Nothing is collecting traces
- **WHEN** the span records nothing
- **THEN** no tracing headers are offered
- **AND** an event built carries none rather than carrying meaningless ones

### Requirement: Taking In A Response An Execution Was Waiting For

The system SHALL record a service's response against the request it answers, so that what an execution is still waiting for is always what it says.

The request answered SHALL be the one the response names. Recording it SHALL leave everything else about the execution as it was, and SHALL add the response to the events the execution has handled.

#### Scenario: A response that was awaited
- **WHEN** a response naming an outstanding request is taken in
- **THEN** that request holds the response rather than nothing
- **AND** the response is among the events the execution has handled

#### Scenario: Everything else is left alone
- **WHEN** a response is taken in
- **THEN** the data, the identity and where the execution rests are what they were

### Requirement: Checking An Event Against The Contract Governing It

The system SHALL check that the event which caused this delivery satisfies the schema the contract governing it selects, and SHALL report an execution fault naming a rejected payload where it does not.

The contract governing it SHALL follow from how the delivery was classified: the implemented contract's own input where the delivery opened the execution, and the answering service's contract where it did not.

#### Scenario: A delivered event that satisfies its contract
- **WHEN** the event that caused this delivery is checked
- **AND** its payload satisfies the schema its contract selects
- **THEN** nothing is reported

#### Scenario: A delivered event that does not
- **WHEN** its payload does not satisfy that schema
- **THEN** an execution fault naming a rejected payload is reported
- **AND** it names every rule the payload broke

### Requirement: The Seven Options And Their Defaults

The system SHALL accept seven options, at the handler and at each version: a maximum depth, a maximum number of retry attempts, a retry delay, a run timeout, an execution timeout, a collection strategy, and a handler error domain.

Every option SHALL hold a value at the handler level once the handler is built, the value being the one declared or, where none was declared, the default [ADR-006](../../../../../../docs/adr/006-arvoeventhandler-protocol.md) fixes for it.

#### Scenario: Defaults where nothing is declared
- **WHEN** a handler is declared naming no options at either level
- **THEN** the handler is built
- **AND** every option at the handler level holds the default ADR-006 fixes for it

#### Scenario: A declared handler-level value is kept
- **WHEN** a handler is declared with a handler-level value for an option
- **THEN** that option holds the declared value at the handler level

#### Scenario: A retry delay as a function
- **WHEN** a handler is declared with a retry delay given as a function
- **THEN** the handler is built
- **AND** that option holds the function unchanged

#### Scenario: A handler error domain naming a source
- **WHEN** a handler is declared with a handler error domain given as a domain source rather than a literal
- **THEN** the handler is built
- **AND** that option holds the source unchanged, unresolved

### Requirement: Reporting Every Rule A Declaration Breaks

The system SHALL report every rule a declaration breaks rather than the first, each naming its position within the declaration and the value found.

A declaration failure SHALL be reported before any of it takes effect: a handler SHALL NOT be built at all where any rule was broken.

A declaration failure SHALL be reported as a validation failure and SHALL NOT be reported as an execution fault, no fault being defined for a declaration.

#### Scenario: Several rules broken
- **WHEN** a declaration omits an executor for one version and carries an option outside its domain
- **THEN** the declaration is refused
- **AND** both are reported

#### Scenario: A position for every report
- **WHEN** a declaration is refused for a version's option
- **THEN** the report names the version and the option

### Requirement: Reading A Version Of A Built Handler

The system SHALL report, for any version a built handler declares, one immutable value carrying that version: the state schema it declared or its absence, the options in force for it, the event types it may emit, and the means to run its executor.

Reading a version the handler declares SHALL always yield such a value, a handler having been refused where any declared version had none.

#### Scenario: Reading a declared version
- **WHEN** a version of a built handler is read
- **THEN** a value for that version is reported
- **AND** it carries the state schema that version declared

#### Scenario: A version that declared no schema
- **WHEN** a version that declared no state schema is read
- **THEN** the absence of a schema is reported rather than a schema

#### Scenario: What was read cannot be changed
- **WHEN** a version of a built handler is read
- **THEN** neither it nor the options it reports can be modified

### Requirement: Middleware Data On The Context

The execution context SHALL carry two further members: middleware data, read, and a way to write it, in the shape the business state and its write member already have.

Where no layer wrote anything, the read member SHALL be an empty value that is present, since the data is the execution's own and not something a mechanism supplies.

#### Scenario: Nothing written
- **WHEN** an executor reads middleware data and no layer wrote any
- **THEN** it finds a present, empty value

### Requirement: Where An Execution Records Is Given Per Execution

Where an execution records — the tracer its span is started on, the meter its instruments are created on, and what its log records are emitted through — SHALL be given with each execution, optionally, and SHALL NOT be part of a handler's declaration. A built handler SHALL hold no telemetry, and nothing given for one execution SHALL reach another.

Each part of the given telemetry SHALL be optional on its own, and a part not given SHALL take its default.

#### Scenario: Each execution records with its own

- **WHEN** one handler is executed twice, each time with a different tracer
- **THEN** each execution's span is started on the tracer given with it, and neither on the other's

#### Scenario: Only a tracer given

- **WHEN** a handler is executed with a tracer and no meter or logger
- **THEN** the execution records its span on that tracer and emits no instruments and no log records

#### Scenario: A declaration naming telemetry

- **WHEN** a handler's declaration is written with telemetry
- **THEN** the declaration does not type-check
- **AND** where it is built anyway, from code no type checker saw, that telemetry is never used: every execution records as if it had not been named

## ADDED Requirements

### Requirement: Declaring In Two Stages

A declaration SHALL be assembled in two stages: what a handler has one of, declared once, and then each version, declared one at a time. No rule SHALL be checked until the declaration is complete, and every rule SHALL be checked then.

A version needing neither a state schema nor options of its own SHALL be declarable as its executor alone, and SHALL be understood exactly as the same executor declared with neither.

#### Scenario: A version declared as its executor alone
- **WHEN** a version is declared as an executor rather than as a declaration naming one
- **THEN** the handler is built
- **AND** that version holds that executor
- **AND** it holds no state schema
- **AND** every one of its options is the value in force at the handler

### Requirement: Naming The Contract And Its Services

The contract SHALL be named as a contract and not as a version. Each contract the handler may send events to SHALL be named at exactly one version.

#### Scenario: Services are held at the version named
- **WHEN** a handler is declared naming a service contract at one of its versions
- **THEN** the handler holds that version of that contract

### Requirement: Declaring A Handler Does Nothing Else

A declaration MAY state the shape of the dependencies and of the mechanism hooks its executors will be given. Both are supplied by whatever runs the handler and neither is part of what a handler holds, so stating either SHALL NOT change what is built and SHALL NOT be stored.

A handler built from a declaration SHALL process no event, read no record and call no executor. Declaring a handler is the whole of what this capability does.

#### Scenario: Declared dependency and hook shapes are not stored
- **WHEN** a handler is declared stating the shape of its dependencies and of its mechanism hooks
- **THEN** the handler is built
- **AND** it holds neither

### Requirement: Declaring Layers

A declaration MAY name layers, each as a layer or as an operation returning one. Omitting them SHALL be the only way to say there are none, and an empty list SHALL be understood as none. Layers named here SHALL apply to every version the handler declares. Two named layers carrying one identifier SHALL be a declaration error; an operation SHALL NOT be invoked at declaration, so its identifier is checked at execution instead.

#### Scenario: A handler declaring no layers
- **WHEN** a handler is declared naming no layers
- **THEN** the handler is built
- **AND** it holds none

#### Scenario: A handler declaring layers
- **WHEN** a handler is declared naming two layers with distinct identifiers
- **THEN** the handler is built
- **AND** it holds both, in the order declared
- **AND** every version it declares runs them

#### Scenario: Two declared layers with one identifier
- **WHEN** a handler is declared naming two layers carrying the same identifier
- **THEN** the declaration is refused
- **AND** the refusal names the identifier

#### Scenario: A declared operation is not invoked at declaration
- **WHEN** a handler is declared naming an operation in place of a layer
- **THEN** the handler is built
- **AND** the operation was not invoked

### Requirement: Checking What An Execution Remembers As It Is Built

What an execution remembers SHALL be checked as it is built, and SHALL NOT come into being where any field it carries is of the wrong shape. What is checked is shape and domain; whether the record agrees with the contract it names is not checked here.

#### Scenario: A record of the wrong shape
- **WHEN** a value of the wrong shape is offered as what an execution remembers
- **THEN** it is refused, and no such value comes into being

### Requirement: Replacing An Execution's Data

Replacing the data an execution remembers SHALL produce a new value of what an execution remembers, carrying every other field across unchanged. The value replaced SHALL NOT be altered.

Data SHALL be replaceable by a value, or by a function given what is remembered now.

Nothing other than data SHALL be replaceable by an executor.

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

### Requirement: Checking Data Against The Schema At The Write

Replacing data SHALL check it against the schema governing that version, at the moment of the write. That schema SHALL be supplied by whatever performs the write and SHALL NOT be part of what is remembered. Data the schema refuses SHALL be reported as an execution fault naming that, and SHALL leave what is remembered unchanged.

What is remembered SHALL be what the schema produced, so that a value the schema fills in or transforms reads back as the schema left it.

#### Scenario: Data the schema refuses
- **WHEN** data is replaced by something the schema refuses
- **THEN** an execution fault naming a rejected state is reported
- **AND** it names every rule the value broke
- **AND** what is remembered is unchanged

#### Scenario: What the schema fills in is what is remembered
- **WHEN** data is replaced by a value the schema completes or transforms
- **THEN** what is remembered is what the schema produced

### Requirement: Data Is Empty Until Written

Data SHALL be empty until something writes it, every other field being known from the moment an execution opens. The value itself SHALL NOT be absent on that account.

#### Scenario: An execution that has written nothing
- **WHEN** the state of an execution that has just opened is read
- **THEN** its data is empty
- **AND** its identity, its depth and where it rests are all reported

### Requirement: Refusing A Record That Will Not Restore

A string that is not what was written, a record missing what it must carry, an event that will not restore, or data the schema refuses SHALL each be reported rather than returned, and no partly restored record SHALL be given back.

#### Scenario: A string that is not a record
- **WHEN** something that is not what was written is read back
- **THEN** it is reported rather than returned

#### Scenario: Data the schema refuses
- **WHEN** a record is read back against a schema its data does not satisfy
- **THEN** it is reported rather than returned

### Requirement: Addressing An Event By Its Role

An event to a service SHALL carry this execution's own identity, one more than its depth, and no correlation to a request being answered. An event completing this execution SHALL carry the caller's identity, this execution's own depth, and the event that opened the execution as the request it answers. Both SHALL carry the workflow, the contract this execution implements, the event that caused this delivery, and the role the event plays.

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

### Requirement: Setting Fields Of An Event To Emit

An executor SHALL be able to set what is its own to choose without reaching past a boundary, and SHALL be able to set what is not only by reaching past one that is named as such.

#### Scenario: Setting what is the executor's to choose
- **WHEN** an executor sets the processing path or the cost figure
- **THEN** the event carries what was set

#### Scenario: Setting what is not
- **WHEN** an executor sets a field whose wrong value would spoil something beyond this execution
- **THEN** it does so only through a surface named as unsafe
- **AND** the event carries what was set

### Requirement: Seeing How Long Is Left

The system SHALL tell an executor how long it has left, on each of the two clocks the version bounds: the one covering this attempt, and the one covering the execution from the event that opened it until it rests. A clock the version leaves unbounded SHALL be reported as having no limit rather than as a figure.

A clock already overrun SHALL report a figure below zero rather than none.

#### Scenario: How long is left
- **WHEN** an executor reads what time it has
- **THEN** it is told what remains of this attempt
- **AND** what remains of the whole execution, measured from the event that opened it

#### Scenario: A clock the version left unbounded
- **WHEN** a version sets no limit on a clock
- **THEN** that clock is reported as having none

#### Scenario: A clock already overrun
- **WHEN** an executor reads a clock it has already passed
- **THEN** it is told by how much

### Requirement: Time Left Is Worked Out When Read

The figures for how long an executor has left SHALL be worked out afresh whenever they are read, so that an executor running for a long time sees what is left rather than what was left when it started. The moment the executor was entered, which is where the clock on the attempt starts, SHALL be readable.

#### Scenario: Time passing while an executor runs
- **WHEN** an executor reads what time it has, works for a while, and reads again
- **THEN** the second reading is smaller than the first

### Requirement: Events Descend From The Delivery's Span

Every event the system builds SHALL descend from the delivery's tracing span rather than from the event which caused the delivery, so that the causal chain joins through the handler rather than around it.

#### Scenario: An event built during the delivery
- **WHEN** an event is built
- **THEN** its tracing names the delivery's span

### Requirement: Refusing A Response Nothing Is Waiting For

A response nothing is waiting for SHALL be refused as an execution fault naming exactly that, and SHALL leave what is remembered unchanged. Three cases SHALL be refused alike: a response naming no request, a response naming one this execution never awaited, and a response naming one already answered.

#### Scenario: A response naming no request
- **WHEN** a response naming no request at all is taken in
- **THEN** an execution fault naming an unawaited response is reported

#### Scenario: A response nothing awaited
- **WHEN** a response naming a request this execution never made is taken in
- **THEN** an execution fault naming an unawaited response is reported
- **AND** what is remembered is unchanged

#### Scenario: A request already answered
- **WHEN** a response naming a request that already holds an answer is taken in
- **THEN** an execution fault naming an unawaited response is reported
- **AND** the answer already held is unchanged

### Requirement: Checking An Event An Executor Means To Emit

The system SHALL check that an event an executor means to emit may be emitted and satisfies the schema its type selects. A type this version may not emit SHALL be reported as an impermissible emission, a payload the schema refuses as a rejected payload, and an event that would sit at or beyond the depth this version allows as a depth breach.

#### Scenario: An event an executor means to emit
- **WHEN** an event of a type this version may emit, with a payload its schema accepts, is checked
- **THEN** nothing is reported

#### Scenario: An event of a type this version may not emit
- **WHEN** such an event is checked
- **THEN** an execution fault naming an impermissible emission is reported

#### Scenario: An event whose payload the schema refuses
- **WHEN** such an event is checked
- **THEN** an execution fault naming a rejected payload is reported

#### Scenario: An event that would breach the depth allowed
- **WHEN** an event to a service that would sit at or beyond the maximum is checked
- **THEN** an execution fault naming a depth breach is reported

### Requirement: Every Option Within Its Domain

Each option's value SHALL lie within the domain that option's type allows, at both levels, and the system SHALL refuse a declaration carrying a value outside it.

#### Scenario: A value outside its domain at the handler level
- **WHEN** a handler is declared with a negative maximum depth
- **THEN** the declaration is refused
- **AND** the report names that option

#### Scenario: A value outside its domain at a version
- **WHEN** a handler is declared with a version whose collection strategy is neither of the two allowed
- **THEN** the declaration is refused
- **AND** the report names the version and that option

### Requirement: Reporting Alone That The Implemented Contract Is Not A Contract

Where the contract implemented is not a contract, the system SHALL report that alone, marked as blocking, and SHALL attempt no other rule.

#### Scenario: No contract
- **WHEN** a declaration names something that is not a contract
- **THEN** the declaration is refused
- **AND** that is reported alone, marked as blocking

### Requirement: Reporting The Options In Force For A Version

The options reported SHALL be the complete set in force, inheritance already applied. What a version declared SHALL NOT be reported separately.

#### Scenario: The options reported are the ones in force
- **WHEN** a version declaring one option is read, its handler declaring another
- **THEN** every option is reported
- **AND** the version's own value is reported for the one it declared
- **AND** the handler's value is reported for the one it did not

### Requirement: Writing Middleware Data

The write member SHALL take one key and one value, SHALL make the value readable through the read member from that moment, and SHALL refuse a key already present as a non-retryable execution fault naming a middleware conflict. Nothing written SHALL reach the record or be checked against any schema.

#### Scenario: Written then read
- **WHEN** a key is written through the write member
- **THEN** the read member reports that key with that value

#### Scenario: Written twice
- **WHEN** a key is written a second time
- **THEN** the write is a non-retryable execution fault naming a middleware conflict
- **AND** the read member still reports the first value

#### Scenario: Not remembered
- **WHEN** an execution writes middleware data and its record is read back
- **THEN** the record carries nothing of it

### Requirement: Recording With Given Telemetry Or The Default

Where telemetry is given, the execution SHALL record with it as given. Where it is not, the execution SHALL record with the default, resolved when that execution begins and not before: a tracer taken from whatever OpenTelemetry provider is registered at that moment, and no meter and no logger. A handler built before any provider is registered SHALL record through a provider registered afterwards.

#### Scenario: Telemetry given with the execution

- **WHEN** a handler is executed with a tracer
- **THEN** the execution's span is started on that tracer

#### Scenario: No telemetry given

- **WHEN** a handler is executed with no telemetry while an OpenTelemetry provider is registered
- **THEN** the execution's span is started on a tracer from that provider and records

#### Scenario: A provider registered after the handler was built

- **WHEN** a handler is built, an OpenTelemetry provider is registered afterwards, and the handler is then executed with no telemetry
- **THEN** the execution's span records through that provider
