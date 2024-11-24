[![SonarCloud](https://sonarcloud.io/images/project_badges/sonarcloud-white.svg)](https://sonarcloud.io/summary/new_code?id=SaadAhmad123_arvo-core)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=SaadAhmad123_arvo-core&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=SaadAhmad123_arvo-core)


# Arvo

## What is Arvo

Arvo is an opinionated approach to building event-driven systems. It's designed as a pattern and methodology rather than a rigid framework.

## Principal

The core principle of Arvo is to provide a solid foundation with enough flexibility for customization, allowing you to impose your own technical posture, including security measures, event brokerage, and telemetry. While Arvo offers a structured approach, it encourages developers to implement their own solutions if they believe they can improve upon or diverge from Arvo's principles.

If you're looking to focus on results without getting bogged down in the nitty-gritty of event creation, handling, system state management, and telemetry, while also avoiding vendor lock-in, Arvo provides an excellent starting point. I believe, it strikes a balance between opinionated design and customization, making it an ideal choice for developers who want a head start in building event-driven systems without sacrificing flexibility.

Key features of Arvo include:

- Lightweight and unopinionated core
- Extensible architecture
- Cloud-agnostic design
- Built-in primitives for event-driven patterns
- Easy integration with existing systems and tools

Whether you're building a small microservice or a large-scale distributed system, my hope with Arvo is to offers you some of the tools and patterns to help you succeed in the world of event-driven architecture.

## Arvo suite

Arvo is a collection of libraries which allows you to build the event driven system in the Arvo pattern. However, if you feel you don't have to use them or you can use them as you see fit.

| Scope       | NPM                                                                | Github                                                                | Documentation                                                                |
| ------------ | ------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------- |
| Orchestration      | https://www.npmjs.com/package/arvo-xstate?activeTab=readme | https://github.com/SaadAhmad123/arvo-xstate | https://saadahmad123.github.io/arvo-xstate/index.html |
| Core       | https://www.npmjs.com/package/arvo-core?activeTab=readme                | https://github.com/SaadAhmad123/arvo-core | https://saadahmad123.github.io/arvo-core/index.html |
| Event Handling | https://www.npmjs.com/package/arvo-event-handler?activeTab=readme      | https://github.com/SaadAhmad123/arvo-event-handler | https://saadahmad123.github.io/arvo-event-handler/index.html |

# Arvo - Core

This core package defines primitive types and utility functions to help you quickly start building interesting and robust event-driven applications.

## Documentation & Resources

| Source       | Link                                                     |
| ------------ | -------------------------------------------------------- |
| Package      | https://www.npmjs.com/package/arvo-core?activeTab=readme |
| Github       | https://github.com/SaadAhmad123/arvo-core                |
| Documenation | https://saadahmad123.github.io/arvo-core/index.html      |

## Installation

You can install the core package via `npm` or `yarn`

```bash
npm install arvo-core
```

```bash
yarn add arvo-core
```

## Components

At its core, Arvo has only three main data structures:

- [ArvoEvent](src/ArvoEvent/README.md) aims to provide a extendible variant of the open-source CloudEvent spec-ed object to define all the event in the system.
- [ArvoContract](src/ArvoContract/README.md) is a basic class to define and impose contracts between services, ensuring trust in decoupled systems during build and development.
- `ArvoErrorSchema` is the recommeded zod schema for all the errors in the ArvoEvents

## Utilities

The package also includes utility functions for:

- Creating ArvoEvents, ArvoContracts, and contract libraries
- Integrating with OpenTelemetry
- TypeScript types for core components

## Getting Started

To start using Arvo in your project:

- Install the package as shown in the Installation section.
- Import the necessary components:

```javascript
import {
  createArvoEvent,
  createArvoContract,
  createArvoEventFactory,
  createSimpleArvoContract,
  createArvoOrchestratorContract,
} from 'arvo-core';
```

- Begin defining your events and contracts using the provided classes.

## License

This package is available under the MIT License. For more details, refer to the [LICENSE.md](LICENSE.md) file in the project repository.

## Change Logs

For a detailed list of changes and updates, please refer to the [document](CHANGELOG.md) file.

### SonarCloud Metrics

[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=SaadAhmad123_arvo-core&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=SaadAhmad123_arvo-core)
[![Bugs](https://sonarcloud.io/api/project_badges/measure?project=SaadAhmad123_arvo-core&metric=bugs)](https://sonarcloud.io/summary/new_code?id=SaadAhmad123_arvo-core)
[![Code Smells](https://sonarcloud.io/api/project_badges/measure?project=SaadAhmad123_arvo-core&metric=code_smells)](https://sonarcloud.io/summary/new_code?id=SaadAhmad123_arvo-core)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=SaadAhmad123_arvo-core&metric=coverage)](https://sonarcloud.io/summary/new_code?id=SaadAhmad123_arvo-core)
[![Duplicated Lines (%)](https://sonarcloud.io/api/project_badges/measure?project=SaadAhmad123_arvo-core&metric=duplicated_lines_density)](https://sonarcloud.io/summary/new_code?id=SaadAhmad123_arvo-core)
[![Lines of Code](https://sonarcloud.io/api/project_badges/measure?project=SaadAhmad123_arvo-core&metric=ncloc)](https://sonarcloud.io/summary/new_code?id=SaadAhmad123_arvo-core)
[![Reliability Rating](https://sonarcloud.io/api/project_badges/measure?project=SaadAhmad123_arvo-core&metric=reliability_rating)](https://sonarcloud.io/summary/new_code?id=SaadAhmad123_arvo-core)
[![Security Rating](https://sonarcloud.io/api/project_badges/measure?project=SaadAhmad123_arvo-core&metric=security_rating)](https://sonarcloud.io/summary/new_code?id=SaadAhmad123_arvo-core)
[![Technical Debt](https://sonarcloud.io/api/project_badges/measure?project=SaadAhmad123_arvo-core&metric=sqale_index)](https://sonarcloud.io/summary/new_code?id=SaadAhmad123_arvo-core)
[![Maintainability Rating](https://sonarcloud.io/api/project_badges/measure?project=SaadAhmad123_arvo-core&metric=sqale_rating)](https://sonarcloud.io/summary/new_code?id=SaadAhmad123_arvo-core)
[![Vulnerabilities](https://sonarcloud.io/api/project_badges/measure?project=SaadAhmad123_arvo-core&metric=vulnerabilities)](https://sonarcloud.io/summary/new_code?id=SaadAhmad123_arvo-core)

