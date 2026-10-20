## MODIFIED Requirements

### Requirement: Declaring A Handler

The system SHALL build a handler from a declaration naming the contract it implements, an executor for each of that contract's versions, and optionally the contracts it may send events to, options for the handler, options for a version, a state schema for a version, and layers that run around every version's executor.

A declaration SHALL be assembled in two stages: what a handler has one of, declared once, and then each version, declared one at a time. No rule SHALL be checked until the declaration is complete, and every rule SHALL be checked then.

The contract SHALL be named as a contract and not as a version. Each contract the handler may send events to SHALL be named at exactly one version.

A version needing neither a state schema nor options of its own SHALL be declarable as its executor alone, and SHALL be understood exactly as the same executor declared with neither.

A declaration MAY state the shape of the dependencies and of the mechanism hooks its executors will be given. Both are supplied by whatever runs the handler and neither is part of what a handler holds, so stating either SHALL NOT change what is built and SHALL NOT be stored.

A declaration MAY name layers. Omitting them SHALL be the only way to say there are none, and an empty list SHALL be understood as none. Layers named here SHALL apply to every version the handler declares. Two named layers carrying one identifier SHALL be a declaration error.

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

## ADDED Requirements

### Requirement: Middleware Data On The Context

The execution context SHALL carry two further members: middleware data, read, and a way to write it, in the shape the business state and its write member already have.

The write member SHALL take one key and one value, SHALL make the value readable through the read member from that moment, and SHALL refuse a key already present as a non-retryable execution fault naming a middleware conflict. Nothing written SHALL reach the record or be checked against any schema.

Where no layer wrote anything, the read member SHALL be an empty value that is present, since the data is the execution's own and not something a mechanism supplies.

#### Scenario: Nothing written
- **WHEN** an executor reads middleware data and no layer wrote any
- **THEN** it finds a present, empty value

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
