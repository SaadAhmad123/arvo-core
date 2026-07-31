# Arvo — Vision

> Non-normative. This explains why Arvo exists and what it is betting on.
> The binding commitments are in [ADR-000](adr/000-arvo-system-identity-and-architectural-principles.md).

## A process nobody can model cleanly

A purchase order needs pricing, drafted contract terms, a human sign-off, and settlement against an ERP.

Pricing is deterministic code. The terms come from a model that produces something different every time it runs. The sign-off arrives three days later, after two deploys. The ERP predates everyone in the room and will not be changing.

Four participants. Four incompatible execution characteristics — deterministic, nondeterministic, human-latency, foreign. Nothing available treats them as the same kind of thing.

A durable execution platform models the pricing beautifully and treats the agent and the human as escapes from its model. An agent framework inverts that. Plain choreography treats all four equally and then leaves you with a process that exists nowhere, that nobody can see once it passes a few dozen participants. So the process gets built across three tools with a task table bolted on for the humans, and the seams between them are where it breaks at 2am.

Two further things go wrong over time. Boundaries harden: where the service boundary landed in month one is where it stays, because it is also the deployment boundary and the codebase boundary — and domain understanding arrives in month nine. And whichever engine gets adopted to solve the first problem, the composition semantics of the whole application quietly become that engine's semantics.

## What Arvo is

Arvo is a portable application model for event-driven systems. It defines how independently built participants — handlers, deterministic workflows, agents, humans, external systems — compose through versioned contracts and events.

Arvo does not execute that model. Infrastructure adapters do.

## The bet

**One model, no second-class participants.** Choreography is the substrate, always. Orchestration is a pattern inside it rather than an alternative to it: a coordinating node may direct the others, but it is an ordinary participant speaking events under contracts, with no privileged control path. The pricing workflow, the agent, the human queue, and the ERP boundary are all nodes. None of them is an exception, so there are no seams between paradigms — because there is only one.

**Boundaries you can move.** Composition is closed: any group of nodes can be sealed behind a single contract and presented as one node. It works in both directions. Several nodes converge into one when you want less surface; one node bifurcates into several when a seam turns out to be real. Nothing new is required to do it — a sealed subgraph is just a handler implementing the outer contract.

Say pricing and terms-drafting turn out to belong together, and drafting is absorbed into pricing. Order intake always addressed the pricing contract, which is unchanged, so nothing calling in notices. The drafting contract, which only pricing ever addressed, disappears from the graph. That is the rule and not a lucky case: splitting behind a boundary is always invisible, and merging is invisible exactly when the absorbed contracts had no outside callers.

The reuse model follows. You do not import a capability, you address its contract. What is behind it may be TypeScript today and something else later — a Python service, a queue a human works from. Consumers cannot tell, and getting service boundaries wrong early stops being expensive.

**It outlives the engine.** Composition and handler lifecycle semantics stay portable across infrastructure adapters. The first two claims are what you use Arvo for; this is what stops them expiring when the platform underneath changes.

## How this could be wrong

Stated plainly, so it can be judged later.

**Portability could turn out to be free.** If durable execution engines converge on a shared open programming model, the independence Arvo buys stops being worth paying for.

**Choreography's cost might not be paid off.** The standing objection is real: in a choreographed system the process exists nowhere. Arvo's answer is that declared contracts make the possible edges statically visible and lineage makes the actual edges visible afterwards. If that does not hold at fifty nodes in practice, teams retreat to central orchestrators and the universal composition claim fails with them.

**Orchestrated choreography could prove too expensive.** A coordinator with no privileged control path also has no cheap cancellation, no cheap timeout, and no cheap way to abort everything downstream. All of it has to be modelled as events. If that is painful enough, people will want the back channel — and the model forbids it.

**Uniformity could be lowest-common-denominator in disguise.** Arvo rejects workflow-engine abstraction layers for flattening engines to a common case. The same charge can be aimed at one composition model serving deterministic workflows, agents, and humans alike. The answer is that Arvo composes rather than normalizes, and that capability profiles carry the differences — but that answer has to survive real systems.

**Reversible boundaries could be theoretical.** Moving boundaries stays cheap only while durable records — lineage, persisted state, external correlation, human task queues — key off contract and execution identity rather than the topology that produced them. If they come to depend on which node did the work, every boundary change becomes a migration.

**Static capability declaration could age badly.** A handler declares every contract it may talk to before it runs. That buys explicit, analysable effects. It costs runtime extensibility: a capability registered after deployment needs a redeploy, and discovery-style tool acquisition is out. If agent composition standardises on runtime discovery, this is the wrong side of that trade.

## Next

- [ADR-000 — Arvo System Identity and Architectural Invariants](adr/000-arvo-system-identity-and-architectural-principles.md)
- [https://www.arvo.land/](https://www.arvo.land/)
