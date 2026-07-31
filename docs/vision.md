# Arvo — Vision

> Non-normative. This document explains why Arvo exists and what it is betting on.
> The binding architectural commitments are recorded in
> [ADR-000](adr/000-arvo-system-identity-and-architectural-principles.md).

## What Arvo is

Arvo is a portable application model for event-driven systems. It defines how independently built participants — conventional handlers, deterministic workflows, AI agents, human approvals, external systems — compose through versioned contracts and events.

Arvo does not execute that model. Infrastructure adapters do.

## The bet

**One composition model, at any scale.** Application logic is becoming a mixture. A single business process now spans deterministic code, a nondeterministic agent, a human who takes three days to respond, and a system you do not control. No execution engine is going to own that mixture. Arvo bets that the layer worth standardising is therefore composition, not execution — and that choreography, with orchestration expressed as an ordinary participant inside it rather than as a privileged conductor, is the model that spans all of it.

**Boundaries you can move.** Composition is closed: any group of nodes can be sealed behind a single contract and presented as one node. That works in both directions. Several nodes converge into one when you want less surface; one node bifurcates into several when a seam turns out to be real. Node granularity becomes a reversible design decision rather than an architectural commitment, so being wrong about service boundaries early is cheap — in a way it is not when the service boundary is also the deployment boundary and the codebase boundary.

The unit of reuse follows from this. You do not import a capability, you address its contract. What is behind it may be TypeScript, may be Python, may be a queue a human works from. Consumers cannot tell and do not need to.

**It outlives the engine you picked.** Application semantics stay portable across infrastructure adapters. The first two legs are what you use Arvo for; this is what keeps them from expiring when the platform underneath changes.

## How this could be wrong

Worth stating plainly, so it can be judged later.

**Portability could turn out to be free.** If durable execution engines converge on a shared open programming model, the independence Arvo buys stops being worth paying for.

**Choreography's cost might not be paid off.** The standing objection is that in a choreographed system the process exists nowhere and nobody can see it. Arvo's answer is that declared contracts make the possible edges statically visible and lineage makes the actual edges visible after the fact. If that answer does not hold at fifty nodes in practice, teams will retreat to central orchestrators and the universal composition claim fails.

**Orchestrated choreography could prove too expensive.** A coordinating node with no privileged control path also has no cheap cancellation, no cheap timeout, and no cheap way to abort everything downstream. All of it must be modelled as events. If that is ergonomically painful enough, people will want the back channel — and the model forbids it.

**Uniformity could be lowest-common-denominator in disguise.** Arvo rejects workflow-engine abstraction layers for flattening engines to a common case. The same charge can be aimed at one composition model serving deterministic workflows, agents, and humans alike. The answer is that Arvo composes rather than normalizes, and that capability profiles carry the differences — but that answer has to survive contact with real systems.

**Reversible boundaries could be theoretical.** Merging and splitting nodes is only cheap while node identity has not leaked into anything durable — lineage records, persisted state, external correlation, human task queues. If it leaks, every boundary change becomes a migration.

## What it looks like

A purchase order.

A deterministic pricing workflow computes terms and requests a draft from an LLM agent. The agent produces contract language and requests human approval. The approval comes back three days later, after two deploys. The approved order settles against an external ERP that knows nothing about Arvo.

Four participants. Four completely different execution characteristics — deterministic, nondeterministic, human-latency, foreign. One composition model, no privileged control path, and a three-day gap that has to survive a deployment.

Later, pricing and terms-drafting turn out to belong together and are sealed behind a single `terms` contract. Nothing calling them changes.

## Next

- [ADR-000 — Arvo System Identity and Architectural Principles](adr/000-arvo-system-identity-and-architectural-principles.md)
- [https://www.arvo.land/](https://www.arvo.land/)
