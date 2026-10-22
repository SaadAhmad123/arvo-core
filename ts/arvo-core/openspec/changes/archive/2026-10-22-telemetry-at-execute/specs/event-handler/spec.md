## ADDED Requirements

### Requirement: Where An Execution Records Is Given Per Execution

Where an execution records — the tracer its span is started on, the meter its instruments are created on, and what its log records are emitted through — SHALL be given with each execution, optionally, and SHALL NOT be part of a handler's declaration. A built handler SHALL hold no telemetry, and nothing given for one execution SHALL reach another.

Where telemetry is given, the execution SHALL record with it as given. Where it is not, the execution SHALL record with the default, resolved when that execution begins and not before: a tracer taken from whatever OpenTelemetry provider is registered at that moment, and no meter and no logger. A handler built before any provider is registered SHALL record through a provider registered afterwards.

Each part of the given telemetry SHALL be optional on its own, and a part not given SHALL take its default.

#### Scenario: Telemetry given with the execution

- **WHEN** a handler is executed with a tracer
- **THEN** the execution's span is started on that tracer

#### Scenario: No telemetry given

- **WHEN** a handler is executed with no telemetry while an OpenTelemetry provider is registered
- **THEN** the execution's span is started on a tracer from that provider and records

#### Scenario: A provider registered after the handler was built

- **WHEN** a handler is built, an OpenTelemetry provider is registered afterwards, and the handler is then executed with no telemetry
- **THEN** the execution's span records through that provider

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
