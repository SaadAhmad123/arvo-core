[![SonarCloud](https://sonarcloud.io/images/project_badges/sonarcloud-white.svg)](https://sonarcloud.io/summary/new_code?id=SaadAhmad123_arvo-core)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=SaadAhmad123_arvo-core&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=SaadAhmad123_arvo-core)

# Arvo - A toolkit for event driven applications (arvo-core)

The foundational package of, [Arvo](https://www.arvo.land/), a TypeScript toolkit for building event-driven applications that are distributed system-compliant. Arvo Core provides CloudEvents-compliant event primitives, type-safe contract validation, and OpenTelemetry observability without infrastructure lock-in.

This package gives you three essential building blocks for event-driven architecture:

**ArvoEvent** - CloudEvents-compliant event primitives with built-in validation, tracing, and execution cost tracking.

**ArvoContract** - Type-safe service interfaces with semantic versioning. Define what events your services accept and emit with automatic runtime validation and compile-time type inference.

**ArvoEventFactory** - Contract-bound factories that create validated events with full IntelliSense support and OpenTelemetry integration.

## Installation
```bash
npm install arvo-core zod@3
```

## Quick Start
```typescript
import { createArvoContract, createArvoEventFactory } from 'arvo-core';
import { z } from 'zod';

// Define a contract
const userContract = createArvoContract({
  uri: '#/contracts/user',
  type: 'user.create',
  versions: {
    '1.0.0': {
      accepts: z.object({
        email: z.string().email(),
        name: z.string()
      }),
      emits: {
        'evt.user.create.success': z.object({
          userId: z.string(),
          timestamp: z.string()
        })
      }
    }
  }
});

// Create events with type safety
const factory = createArvoEventFactory(userContract.version('1.0.0'));

const event = factory.accepts({
  source: 'api/users',
  data: {
    email: 'user@example.com',
    name: 'John Doe'
  }
});
```

## Why Arvo?

Arvo abstracts infrastructure concerns from your business logic. Write application code once and deploy it anywhere - Node.js servers, serverless functions, browsers, or distributed clusters. Your business logic encapsulated in event handlers and contracts remain unchanged while you swap infrastructure integrations.

The same primitives work for simple request-response services, complex multi-service workflows, AI agent systems, and everything in between. No framework lock-in, no mandatory infrastructure, just clean event-driven code that integrates with your existing stack.

## What is `arvo-core`?

The `arvo-core` is one of the two foundational packages in the Arvo ecosystem, alongside `arvo-event-handler`. Together, they provide the complete foundation for building event-driven applications that are distributed system-compliant. Explore additional tools and integrations in the `@arvo-tools` namespace.

Learn more at the official Arvo website: [https://www.arvo.land/](https://www.arvo.land/)

## Documentation

Complete guides, API reference, and tutorials at [https://www.arvo.land/](https://www.arvo.land/)

## License

MIT - See [LICENSE.md](LICENSE.md)

---

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