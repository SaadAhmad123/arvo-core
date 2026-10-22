# event-dispatcher Specification

## Purpose

A set of handlers entered as one handler: what the set refuses when it is declared, how it picks the handler for a delivered event, the one fault it raises of its own, what it can be asked about itself, and everything it must leave to whatever runs it. Implements [ADR-017](../../../../../docs/adr/017-dispatcher.md).

## Requirements

### Requirement: A Dispatcher Is Declared From Handlers And Layers

A dispatcher SHALL be declared from a list of handlers and, optionally, a list of layers. Either list MAY name another dispatcher in place of entries: in the handler list it SHALL contribute its handlers and nothing else; in the layer list it SHALL contribute its own layers, in their order, at that position. The result SHALL be one flat set of handlers and one flat list of layers.

Declaration SHALL be offered both as an operation that reports an invalid declaration as a value and as one that throws it, the second derived from the first.

#### Scenario: Handlers listed directly

- **WHEN** a dispatcher is declared with two handlers implementing different contracts
- **THEN** the declaration succeeds and the dispatcher handles both self contract types

#### Scenario: A dispatcher listed among the handlers

- **WHEN** a dispatcher is declared with one handler and another dispatcher holding two handlers
- **THEN** the declaration succeeds and the dispatcher handles all three self contract types

#### Scenario: A dispatcher listed among the layers

- **WHEN** a dispatcher is declared with layers `a`, then a dispatcher whose layers are `b` and `c`, then layer `d`
- **THEN** every handler it enters is supplied layers `a`, `b`, `c`, `d`, in that order

#### Scenario: A dispatcher listed among the handlers contributes no layers

- **WHEN** a dispatcher carrying layers is listed only among another dispatcher's handlers
- **THEN** its handlers are taken and its layers are not

#### Scenario: No layers given

- **WHEN** a dispatcher is declared with handlers and no layer list
- **THEN** the declaration succeeds and every handler it enters is supplied no layers

#### Scenario: The throwing form

- **WHEN** an invalid dispatcher is declared through the throwing operation
- **THEN** the same validation error the value-returning operation would report is thrown

### Requirement: What A Declaration Refuses

A declaration SHALL be refused, naming every rule broken rather than the first, where:

- the set of handlers is empty after flattening;
- one handler instance appears more than once after flattening, however it was reached;
- two handlers implement self contracts of the same `type`, whether or not their `uri`s differ;
- a handler declares a service contract whose `type` another handler in the set implements, at a version the implementing handler's contract does not declare, or with a `uri` different from the implementing contract's.

Each refusal SHALL name the handler or handlers concerned by their self contract `type`, and the rule broken.

#### Scenario: An empty set

- **WHEN** a dispatcher is declared with no handlers
- **THEN** the declaration is refused as empty

#### Scenario: An empty set after flattening

- **WHEN** a dispatcher is declared with only a nested dispatcher that holds no handlers
- **THEN** the declaration is refused as empty

#### Scenario: One handler listed twice

- **WHEN** the same handler instance is listed twice
- **THEN** the declaration is refused, naming that handler

#### Scenario: One handler reached twice through nesting

- **WHEN** a handler is listed directly and also held by a nested dispatcher
- **THEN** the declaration is refused, naming that handler

#### Scenario: Two handlers under one type

- **WHEN** two handlers implement self contracts of the same `type` and the same `uri`
- **THEN** the declaration is refused, naming that `type`

#### Scenario: Two handlers under one type with different uris

- **WHEN** two handlers implement self contracts of the same `type` and different `uri`s
- **THEN** the declaration is refused, naming that `type`

#### Scenario: A service declared at a version its implementer lacks

- **WHEN** handler A declares service `com_payment_charge` at a version the handler implementing `com_payment_charge` does not declare
- **THEN** the declaration is refused, naming both handlers and the version

#### Scenario: A service declared under a different uri

- **WHEN** handler A declares service `com_payment_charge` with a `uri` different from the `uri` of the handler implementing `com_payment_charge`
- **THEN** the declaration is refused, naming both handlers

#### Scenario: Every broken rule reported together

- **WHEN** a declaration lists one handler twice and also holds two other handlers under one `type`
- **THEN** the refusal names both rules

### Requirement: What A Declaration Does Not Refuse

A declaration SHALL NOT be refused for any of the following:

- a service some handler declares that no handler in the set implements;
- output or error types that coincide across different contracts;
- anything about dependencies;
- a handler that declares its own self contract as a service, or any cycle among the handlers' services;
- anything about the layers, including two layers sharing an identifier or an entry that is not a layer.

#### Scenario: A service nobody here implements

- **WHEN** a handler declares a service contract that no handler in the set implements
- **THEN** the declaration succeeds

#### Scenario: A service implemented at a declared version

- **WHEN** handler A declares service `com_payment_charge` at a version the implementing handler declares, under the same `uri`
- **THEN** the declaration succeeds

#### Scenario: Two handlers calling each other

- **WHEN** handler A declares handler B's contract as a service and handler B declares handler A's
- **THEN** the declaration succeeds

#### Scenario: A handler calling itself

- **WHEN** a handler declares its own self contract as a service
- **THEN** the declaration succeeds

#### Scenario: Two layers with one identifier

- **WHEN** a dispatcher is declared with two layers sharing an identifier
- **THEN** the declaration succeeds, and the handler refuses the conflict when it is entered

### Requirement: Entering A Dispatcher

A dispatcher SHALL be entered with exactly what a handler is entered with, less layers: the event, the state function, the attempt number, and optionally dependencies and hooks. Dependencies SHALL be given as one entry per handler, keyed by the handler's self contract `type`. Hooks SHALL be one value every handler in the set can accept.

Entering SHALL be offered both as an operation that reports a fault as a value and as one that throws it, the second derived from the first. It SHALL NOT accept layers.

On entry, the dispatcher SHALL pick the handler whose self contract `type` equals `event.to`, and enter that handler with the event — as *A Dispatcher's Span* says it is handed on — the state function, the attempt number, that handler's own dependency entry or none, the hooks, and the dispatcher's layers as the layers supplied for that execution. It SHALL return what the handler returned, unchanged: the events and the next record, a discard, or a fault.

#### Scenario: The handler `to` names is entered

- **WHEN** a dispatcher holding handlers for `com_order_create` and `com_payment_charge` is entered with an event whose `to` is `com_payment_charge`
- **THEN** the `com_payment_charge` handler is entered and the other is not

#### Scenario: The handler's response is returned unchanged

- **WHEN** the picked handler produces events and a next record
- **THEN** the dispatcher returns that same response, with nothing added, removed or reordered

#### Scenario: A discard passes through

- **WHEN** the picked handler discards the event
- **THEN** the dispatcher returns the discard with the handler's reason

#### Scenario: A handler's fault passes through

- **WHEN** the picked handler raises a fault
- **THEN** the dispatcher returns that fault, identical in kind, message, retry verdict and abandonment pair

#### Scenario: Only the picked handler's dependencies are passed

- **WHEN** dependencies are given for both `com_order_create` and `com_payment_charge`, and the event's `to` is `com_payment_charge`
- **THEN** the `com_payment_charge` handler receives its own entry and nothing of the other's

#### Scenario: No entry for the picked handler

- **WHEN** dependencies are given only for `com_order_create`, and the event's `to` is `com_payment_charge`
- **THEN** the `com_payment_charge` handler is entered with no dependencies, and finds them absent

#### Scenario: An entry for a type nobody here handles

- **WHEN** dependencies are given for a `type` no handler in the set implements
- **THEN** that entry is never read and the call proceeds as if it were not there

#### Scenario: The set's layers are supplied

- **WHEN** a dispatcher declared with layers is entered
- **THEN** the picked handler runs those layers as its supplied layers, outside its own declared layers

#### Scenario: The throwing form

- **WHEN** the picked handler raises a fault and the dispatcher is entered through the throwing operation
- **THEN** that fault is thrown

### Requirement: No Handler For The Event

Where no handler in the set implements a self contract whose `type` equals `event.to`, including where the event carries no `to`, the dispatcher SHALL raise a fault of the kind `handler_not_found`. That fault SHALL be non-retryable, SHALL carry neither an abandonment record nor an abandonment event, and SHALL name the event's subject, the event's identifier, the attempt number, and the value of `to` that nothing handled. No handler SHALL be entered.

#### Scenario: A `to` nobody here handles

- **WHEN** a dispatcher is entered with an event whose `to` names a `type` no handler in the set implements
- **THEN** the fault is `handler_not_found`, with no retry verdict and no abandonment pair, and no handler is entered

#### Scenario: No `to` at all

- **WHEN** a dispatcher is entered with an event carrying no `to`
- **THEN** the fault is `handler_not_found`, and no handler is entered

#### Scenario: The same on every attempt

- **WHEN** a dispatcher is entered with such an event at a later attempt number
- **THEN** the fault is still `handler_not_found` and still carries no retry verdict

#### Scenario: The fault is recorded

- **WHEN** a dispatcher raises `handler_not_found`
- **THEN** the fault is recorded on the dispatcher's own span, a counter and a log in the same form as any handler fault

### Requirement: A Dispatcher's Span

On every entry the dispatcher SHALL open exactly one span continuing the event's trace: a child of the context the event's trace headers name where they name one, and the root of a new trace where they do not. The span SHALL end before the entry returns, on every path.

Where that span is recording, the dispatcher SHALL enter the handler with a copy of the event whose trace headers name the span and which is identical to the event in every other field. Where the span is not recording, it SHALL enter the handler with the event as it is. The event the dispatcher was given SHALL NOT be altered.

The dispatcher SHALL mark on its span that it was entered and which handler it picked. It SHALL NOT record on its span anything the handler records on its own. It SHALL mark its span successful once a handler has been entered and has returned, whatever the handler returned, and failed where no handler takes the event. Where something that is not a fault is thrown, it SHALL record it on its span, mark the span failed, and let it propagate as thrown.

#### Scenario: The span continues the event's trace

- **WHEN** a dispatcher is entered with an event carrying a trace context
- **THEN** it opens one span that is a child of that context, and ends it before returning

#### Scenario: An event with no trace

- **WHEN** a dispatcher is entered with an event carrying no trace context
- **THEN** it opens one span that begins a new trace

#### Scenario: The handler's span nests under the dispatcher's

- **WHEN** a dispatcher with a recording span enters a handler
- **THEN** the handler receives an event whose trace headers name the dispatcher's span and whose every other field equals the given event's
- **AND** the handler's span is a child of the dispatcher's

#### Scenario: A span that is not recording

- **WHEN** a dispatcher's span is not recording, as with no OpenTelemetry SDK configured
- **THEN** the handler receives the given event itself, trace headers included

#### Scenario: The given event is untouched

- **WHEN** a dispatcher is entered
- **THEN** the event it was given is unchanged afterwards

#### Scenario: Returned events keep the handler's trace

- **WHEN** the handler returns events carrying its own trace context
- **THEN** the dispatcher returns them with that trace context, unchanged

#### Scenario: The pick is marked

- **WHEN** a dispatcher enters a handler
- **THEN** its span records that it was entered and which handler was picked

#### Scenario: The span is successful once a handler returns

- **WHEN** the picked handler returns, with events or with a fault of its own
- **THEN** the dispatcher's span is marked successful

#### Scenario: The span is failed where nothing takes the event

- **WHEN** no handler in the set takes the event's `to`
- **THEN** the dispatcher's span is marked failed

#### Scenario: Something thrown that is not a fault is recorded

- **WHEN** entering the handler throws something that is not a fault
- **THEN** the dispatcher records it on its span, marks the span failed, and the thrown value propagates unchanged

#### Scenario: Nothing of the handler's is recorded again

- **WHEN** the handler raises a fault
- **THEN** the dispatcher's span does not record that fault as the dispatcher's own

### Requirement: A Dispatcher Raises Only Faults During A Call

During a call, a dispatcher SHALL report a failure only as an execution fault: the handler's own, passed through, or `handler_not_found`. Anything thrown that is not a fault SHALL propagate unconverted.

#### Scenario: Something other than a fault escapes the handler

- **WHEN** the picked handler's call throws something that is not a fault
- **THEN** the dispatcher does not report it as a fault, and it propagates as thrown

### Requirement: A Dispatcher Leaves The Mechanism's Work To The Mechanism

A dispatcher SHALL hold nothing between calls, and SHALL NOT, during a call: write the record or the events anywhere; decide or record where a produced event goes; read or act on a fault's retry verdict; re-enter a handler; read or act on a fault's abandonment pair; treat any fault or a discard as anything other than what it is; or supply any input of its own other than its layers.

#### Scenario: Nothing is written

- **WHEN** the picked handler produces events and a next record
- **THEN** the dispatcher writes neither anywhere, and the state function it was given is only ever read

#### Scenario: A retryable fault is not retried

- **WHEN** the picked handler raises a fault whose retry verdict says it may be retried
- **THEN** the dispatcher returns the fault and enters the handler exactly once

#### Scenario: A repeated init is returned as a fault

- **WHEN** the picked handler raises the fault for an init arriving with a record already present
- **THEN** the dispatcher returns that fault as it is

#### Scenario: Two calls share nothing

- **WHEN** a dispatcher is entered twice, the second time with a different event
- **THEN** nothing from the first call affects the second

### Requirement: Asking A Dispatcher About Its Set

A dispatcher SHALL answer, without entering any handler:

- whether a given `type` is the self contract `type` of a handler in the set, answering no for an absent value;
- the largest run timeout any version of any handler in the set declares, or that none declares one.

#### Scenario: A type handled here

- **WHEN** a dispatcher is asked about the self contract `type` of one of its handlers
- **THEN** it answers yes

#### Scenario: A type not handled here

- **WHEN** a dispatcher is asked about a `type` none of its handlers implements, or about an absent value
- **THEN** it answers no

#### Scenario: The longest run timeout

- **WHEN** the versions in the set declare run timeouts of different lengths, and some declare none
- **THEN** the dispatcher reports the longest declared

#### Scenario: No run timeout anywhere

- **WHEN** no version in the set declares a run timeout
- **THEN** the dispatcher reports that none is declared

### Requirement: A Name Standing Outside The Set

A dispatcher SHALL say whether a given name may stand outside its set, refusing it, and naming every rule broken, where:

- it does not satisfy the contract-declared identifier grammar;
- it equals the self contract `type` of a handler in the set;
- it equals the `type` of a service contract any handler in the set declares.

It SHALL be offered both as an operation that reports a refusal as a value and as one that throws it, and SHALL return the name where it is accepted. A refusal SHALL be the dispatcher's validation error.

#### Scenario: An accepted name

- **WHEN** a dispatcher is asked about a well-formed name no handler in it implements or calls
- **THEN** the name is returned

#### Scenario: A name breaking the grammar

- **WHEN** a dispatcher is asked about a name containing a character the identifier grammar forbids
- **THEN** it is refused, naming the grammar

#### Scenario: A handler's own type

- **WHEN** a dispatcher is asked about the self contract `type` of one of its handlers
- **THEN** it is refused, naming that handler

#### Scenario: A service type

- **WHEN** a dispatcher is asked about the `type` of a service contract one of its handlers declares and no handler in the set implements
- **THEN** it is refused, naming the handler that declares it

#### Scenario: Every broken rule reported together

- **WHEN** a dispatcher is asked about a name that equals a handler's self contract `type` and is also a service another handler declares
- **THEN** the refusal names both rules
