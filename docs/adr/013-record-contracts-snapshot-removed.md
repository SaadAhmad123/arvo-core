# ADR-013: The Record's Contracts Snapshot Is Removed

- **Status:** Accepted
- **Date:** 2026-10-01
- **Scope:** Arvo ecosystem
- **Supersedes, in part:** [ADR-007](./007-execution-record.md) — the `contracts` field of **The fields**, the subsection **`contracts` is informational only**, and the deferred question about comparing the snapshot against the live contract under **Left deferred**. Everything else in ADR-007 stands
- **Depends on:** [ADR-007](./007-execution-record.md), which defines the record this field belonged to; [ADR-005](./005-arvocontract-structure.md), which defines the canonical contract form it carried
- **Addresses:** nothing ADR-000 deferred. It withdraws a field and a deferral of ADR-007's own
- **Left deferred:** nothing

Conformance language is as defined in [ADR-000](./000-arvo-system-identity-and-architectural-principles.md).

## Scope

### What this ADR defines

That the execution record does not carry a snapshot of the handler's contracts, and that the question of comparing such a snapshot against a live contract is withdrawn rather than deferred.

### What this ADR deliberately does not define

- **Anything else about the record.** Hydration, the lifecycle values, `cas_version`, version authority, the identifying fields and both events are ADR-007's and are untouched.
- **How a deployment keeps its contracts for posterity.** A contract's own durable form is ADR-005's business, and keeping them is a deployment's.

### How this ADR changes

Once accepted, this ADR changes only by a superseding ADR. It is not amended in place.

### Its history

This decision was first written as an addendum appended to ADR-007 on the date above. That was out of order: ADR-007 states of itself that it "changes only by a superseding ADR", and an addendum is not one — it carries no number, appears in no index, and left ADR-007 with a status the ADR index does not define. The decision itself was never in doubt and is reproduced here unchanged in substance. The record is corrected rather than the decision.

## Context

ADR-007 gave the record a `contracts` field: the handler's `self` and `services` contracts in ADR-005 canonical form, carried for a reader's benefit only. Its own subsection permitted it as informational and forbade resolving, binding or validating against it, and it left open whether the snapshot should be compared against the live contract.

## Decision

**The record does not carry `contracts`.** The field, the subsection permitting it as informational, and the deferred question of comparing it against the live contract are all withdrawn. Nothing replaces it.

`record_format_version` stays at ADR-007's accepted value. The rule under ADR-007's **How this record may change later** that a field MUST NOT be removed exists because removal reinterprets records already in a store, and no such record exists: nothing is published, no deployment has written one, so there is no data for this to reinterpret. That is the whole of the exemption, and it expires the moment a record is stored anywhere. After that point this field cannot come back out, and nor can any other, without a MAJOR bump by a superseding ADR.

## Why

**Nothing reads it.** The field was informational by construction, and ADR-007 already forbade resolving, binding or validating against it. A field that no part of the protocol may consult is carried on every write of every execution for a reader who may never arrive.

**It is derivable.** A handler holds its own contracts, and a record names the contract and version it belongs to through `source` and `version`. A reader with the handler has the contracts; a reader without it has an ADR-005 canonical form whose meaning they cannot check against anything.

**It is the one field no delivery can check.** Every other field is judged as a record is built: the identifiers, both counts, the lifecycle, both version fields, the two events. The snapshot could not be, because there was nothing to judge it against — ADR-007 says outright that a snapshot not matching a live contract "carries no meaning at execution time". So a record carrying a wrong snapshot was indistinguishable from one carrying a right one, which makes it a field that can rot silently for the whole life of an execution.

**The purpose it was given is better served elsewhere.** Understanding a record years later without the code that wrote it is a real need, and `source` and `version` already name what to go and find. A deployment that wants its contracts kept for posterity should keep them once, where they are declared, rather than once per execution.

## Consequences

### Gained

- One fewer field written on every revision of every execution, and the largest of them.
- No field in the record is unjudgeable. Every remaining one is checked as a record is built.
- A deferred question is answered by removal rather than left open against a field nobody reads.

### Paid for

- A reader holding a stored record and not the handler that wrote it has `source` and `version` to go on, and must find the contracts themselves. ADR-007's requirement that a record be understandable on its own terms is met by those two fields, which is what they are for.
- ADR-007's field table and one of its subsections must now be read against this ADR.

### What this does not change

The identifying fields stay inside the record rather than only in its keys, for the reason ADR-007 gives: a record found in a store must be understandable on its own terms. `source` and `version` are what carry that, and neither moves. Nothing about hydration, the lifecycle values, `cas_version`, or version authority is touched.

## Considered Alternatives

### Keeping it and comparing it against the live contract

This was ADR-007's own deferred question. Rejected along with the field: a comparison has no defined outcome. A mismatch cannot fail the execution — the record is the execution's memory and the contract may legitimately have moved on — so the comparison could only warn, which is a cost on every delivery for a signal nothing acts on.

### Keeping it, written once on the first revision only

Considered. Rejected because it does not address the objection: the field would still be unjudgeable, still unread by the protocol, and now also inconsistent with every other field, each of which is written on every revision.

## Conformance to ADR-000

### Effect on AAM

The execution record's field names are inside the model as a durable format (ADR-007, **Amends**). This removes one of those names before any record carrying it exists.

### Invariants depended on

None beyond those ADR-007 already depends on.

### Invariants strained

None.

### Required of infrastructure adapters

Nothing. A mechanism stores and returns the record whole; one field fewer changes nothing it does.

### Left deferred

Nothing.
