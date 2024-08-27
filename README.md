---
title: ArvoEvent
group: Guides
---

# Arvo

### What is Arvo

Arvo is an opinionated approach to building event-driven systems. It's designed as a pattern and methodology rather than a rigid framework.

### Principal

The core principle of Arvo is to provide a solid foundation with enough flexibility for customization, allowing you to impose your own technical posture, including security measures, event brokerage, and telemetry. While Arvo offers a structured approach, it encourages developers to implement their own solutions if they believe they can improve upon or diverge from Arvo's principles.

If you're looking to focus on results without getting bogged down in the nitty-gritty of event creation, handling, system state management, and telemetry, while also avoiding vendor lock-in, Arvo provides an excellent starting point. I believe, it strikes a balance between opinionated design and customization, making it an ideal choice for developers who want a head start in building event-driven systems without sacrificing flexibility.

Key features of Arvo include:
- Lightweight and unopinionated core
- Extensible architecture
- Cloud-agnostic design
- Built-in primitives for event-driven patterns
- Easy integration with existing systems and tools

Whether you're building a small microservice or a large-scale distributed system, my hope with Arvo is to offers you some of the tools and patterns to help you succeed in the world of event-driven architecture.

## Arvo - Core

This core package defines primitive types and utility functions to help you quickly start building interesting and robust event-driven applications.

At its core, Arvo has only two main data structures:

- [ArvoEvent](src/ArvoEvent/README.md) aims to provide a extendible variant of the open-source CloudEvent spec-ed object to define all the event in the system.
- ArvoContract is a basic class to define and impose contracts between services, ensuring trust in decoupled systems during build and development.

### Utility Functions

The package also includes utility functions for:

- Creating ArvoEvents
- Integrating with OpenTelemetry
- TypeScript types for core components