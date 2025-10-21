# Changelog

## [1.0.0] - 2024-08-31

- Finalised the first release version of the core. This contains core class such as ArvoEvent, ArvoContract, and ArvoContractLibrary. Moreover, this release contains utility functions for string manipulation, validation and OpenTelemetry

## [1.0.2] - 2024-08-31

- Update ArvoContract description

## [1.0.3] - 2024-08-31

- Making type in ArvoEvent a generic string for better type control

## [0.0.4] - 2024-08-31

- Created an event factory generator for creating contractually compliant events

## [0.0.5] - 2024-08-31

- Updated README documentation

## [1.0.6] - 2024-09-01

- Updated ArvoContract typing mechanism

## [1.0.7] - 2024-09-01

- Updates to OpenTelemetry functions

## [1.0.8] - 2024-09-01

- Added support for system error in ArvoContract

## [1.0.15] - 2024-09-07

- Added ArvoEvent spec-ed extension getter for a more ergonomic experience

## [1.0.19] - 2024-09-07

- Fix a type bug in ArvoEvent creation

## [1.0.25] - 2024-09-08

- Updated OpenTelemetry propagation and fixed propagation in the event factory

## [1.0.26] - 2024-09-08

- Added OpenTelemetry attributes for Arvo and OpenInference

## [1.0.28] - 2024-09-10

- Added SonarCloud integration for code scanning

## [1.1.0] - 2024-09-20

- Added support for Arvo orchestration subject management

## [1.1.1] - 2024-09-21

- Added support for ArvoEvent http formats and made ArvoEvent extensions more specific

## [1.1.8] - 2024-09-26

- Added Arvo Orchestrator Contract primitive

## [1.1.16] - 2024-10-21

- Added mandatory parent chaining in orchestration events so the process chaining and orchestration chaining can be traced

## [2.0.0] - 2024-11-24

- Added version support for contracts and simplified orchestrator contracts

## [2.0.3] - 2024-11-24

- Remove potential security bug of reading the file system

## [2.0.4] - 2024-12-01

- Refactored code implementation architecture for better maintainability

## [2.1.14] - 2024-12-19

- Tested Snyk upgrade, added more test coverage and added support for redirectto in orchestrator subject generation in init factory function

## [2.2.0] - 2024-12-25

- Finalised the version 2 for Arvo core.

## [2.2.7] - 2025-01-25

- Added helper functions and added Biome for better linting

## [2.2.9] - 2025-01-29

- Added better README.md docs and streamlined ArvoEventFactory subject field behaviour

## [2.2.10] - 2025-01-29

- Updated dependency versions to latest

## [2.3.0] - 2025-06-22

- Adding support for event domain in the orchestration. This will allow the orchestrator to segregate events into domain and handle them as per their domains. This model opens up the possiblity of human in the loop kind of workflow as well as other very interesting ways to handle events

## [2.3.3] - 2025-07-07

- Added support for `parentid` in the ArvoEvent to track event causality

## [3.0.0] - 2025-07-23

- Added ArvoEvent domain which is a big change in thinkinh. However, by default there is not need to think about them the most. Bumping major verion as I am planning to merge the packages `arvo-event-handler` and `arvo-xstate` to `arvo-event-handler` because the now `arvo-xstate` has outgrown its conceptual boundaries. `ArvoResumable` is coming which is a resumable event orchestrator function and handler.

## [3.0.8] - 2025-10-20

- Added primitive for type guarding ViolationError which is quite robust

## [3.0.10] - 2025-10-21

- Improved OTEL logging

