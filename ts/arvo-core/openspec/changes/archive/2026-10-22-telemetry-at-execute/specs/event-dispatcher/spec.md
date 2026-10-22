## ADDED Requirements

### Requirement: Where A Dispatcher Records Is Given Per Call

Where a dispatcher records SHALL be given with each call, optionally, and SHALL NOT be part of its declaration. A built dispatcher SHALL hold no telemetry, and nothing given for one call SHALL reach another.

On every call the dispatcher SHALL resolve its telemetry once, at the start of that call: as given where it was given, and otherwise the default a handler resolves where none is given. It SHALL open its own span with that telemetry, and SHALL enter the handler with that same resolved telemetry. A handler entered by a dispatcher SHALL record with the dispatcher's telemetry for that call and SHALL NOT resolve telemetry of its own.

#### Scenario: Telemetry given with the call

- **WHEN** a dispatcher is entered with a tracer
- **THEN** its span is started on that tracer
- **AND** the picked handler's span is started on that same tracer

#### Scenario: No telemetry given

- **WHEN** a dispatcher is entered with no telemetry while an OpenTelemetry provider is registered
- **THEN** its span and the picked handler's span both record through that provider

#### Scenario: A provider registered after the dispatcher was built

- **WHEN** a dispatcher is built, an OpenTelemetry provider is registered afterwards, and the dispatcher is then entered with no telemetry
- **THEN** its span and the picked handler's span both record through that provider

#### Scenario: The handler is always given telemetry

- **WHEN** a dispatcher is entered, with telemetry or without
- **THEN** the picked handler is entered with telemetry, and it is the telemetry the dispatcher resolved for that call

#### Scenario: Telemetry given is passed on unchanged

- **WHEN** a dispatcher is entered with a tracer, a meter and a logger
- **THEN** the picked handler is entered with that same tracer, meter and logger

#### Scenario: Each call records with its own

- **WHEN** one dispatcher is entered twice, each time with a different tracer
- **THEN** each call's spans are started on the tracer given with it, and neither on the other's

#### Scenario: Nothing taken for an event no handler takes

- **WHEN** a dispatcher is entered with a tracer and an event no handler in the set takes
- **THEN** its span, failed as *No Handler For The Event* has it, is started on that tracer

#### Scenario: A declaration naming telemetry

- **WHEN** a dispatcher's declaration is written with telemetry
- **THEN** the declaration does not type-check
- **AND** where it is built anyway, from code no type checker saw, that telemetry is never used: every call records as if it had not been named

## MODIFIED Requirements

### Requirement: Entering A Dispatcher

A dispatcher SHALL be entered with exactly what a handler is entered with, less layers: the event, the state function, the attempt number, and optionally dependencies, hooks and telemetry. Dependencies SHALL be given as one entry per handler, keyed by the handler's self contract `type`. Hooks SHALL be one value every handler in the set can accept. Telemetry SHALL be given as a handler takes it.

Entering SHALL be offered both as an operation that reports a fault as a value and as one that throws it, the second derived from the first. It SHALL NOT accept layers.

On entry, the dispatcher SHALL pick the handler whose self contract `type` equals `event.to`, and enter that handler with the event — as *A Dispatcher's Span* says it is handed on — the state function, the attempt number, that handler's own dependency entry or none, the hooks, the telemetry *Where A Dispatcher Records Is Given Per Call* resolves, and the dispatcher's layers as the layers supplied for that execution. It SHALL return what the handler returned, unchanged: the events and the next record, a discard, or a fault.

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
