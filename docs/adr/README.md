# Architecture Decision Records

This directory contains the Architecture Decision Records (ADRs) for Arvo.

ADRs record durable architectural decisions, their context, and their consequences. Feature specifications may provide detailed requirements and acceptance criteria, but they must remain consistent with accepted ADRs or explicitly propose a superseding decision.

This repository is the canonical source of Arvo ecosystem ADRs until a dedicated architecture repository supersedes it. Other ecosystem repositories must reference these records rather than maintain independent copies.

## Status

- **Proposed**: Under review and not yet binding.
- **Accepted**: Governs the architecture until superseded.
- **Partially Superseded**: Some rules within this ADR have been replaced by a later ADR; the rest remains governing. The record itself states which, and keeps the replaced text annotated so a reader meets the superseding ADR where the old rule was.
- **Superseded**: Replaced by a later ADR.
- **Rejected**: Considered but not adopted.

## Records

| ADR | Title | Status |
| --- | --- | --- |
| [ADR-000](./000-arvo-system-identity-and-architectural-principles.md) | Arvo System Identity and Architectural Invariants | Accepted |
| [ADR-001](./001-arvoevent-structure.md) | ArvoEvent Structure | Partially Superseded |
| [ADR-002](./002-arvoevent-field-domain-constraints.md) | ArvoEvent Field Domain Constraints | Accepted |
| [ADR-003](./003-arvoevent-cloudevent-transformation.md) | ArvoEvent–CloudEvent Transformation | Accepted |
| [ADR-004](./004-multi-language-implementation-governance.md) | Multi-Language Implementation Governance | Accepted |
| [ADR-005](./005-arvocontract-structure.md) | ArvoContract Structure | Accepted |
| [ADR-006](./006-arvoeventhandler-protocol.md) | ArvoEventHandler Protocol | Partially Superseded |
| [ADR-007](./007-execution-record.md) | Execution Record | Partially Superseded |
| [ADR-008](./008-execution-faults-and-abandonment.md) | Execution Faults and Abandonment | Accepted |
| [ADR-009](./009-execution-bounds.md) | Execution Bounds | Accepted |
| [ADR-010](./010-delivery-classification-and-entry-validation.md) | Delivery Classification and Entry Validation | Accepted |
| [ADR-011](./011-dependency-lifetime.md) | Dependency Lifetime | Accepted |
| [ADR-012](./012-absent-dependencies-and-hooks.md) | Absent Dependencies and Hooks | Accepted |
| [ADR-013](./013-record-contracts-snapshot-removed.md) | The Record's Contracts Snapshot Is Removed | Accepted |
| [ADR-014](./014-idempotency-keys.md) | Idempotency Keys | Accepted |
| [ADR-015](./015-no-ordering-guarantee.md) | No Ordering Guarantee | Accepted |
| [ADR-016](./016-executor-middleware.md) | Executor Middleware | Accepted |
