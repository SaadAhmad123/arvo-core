# Why This Repository Is Agent-Native

> Non-normative. This explains how `arvo-core` is built and why, for anyone — human or agent — who wants to understand the shape of the repository before working in it.
> The binding commitments are in [the ADRs](adr/). What belongs where is in [`openspec/project.md`](../openspec/project.md).

## The problem is not agents

Code records what a system does. It does not record why it does that and not the obvious alternative, what was tried and abandoned, or which constraint made an ugly decision the right one. That information lives in the author's head, leaks into pull request threads, and evaporates.

This has always been true and has always been expensive. A contributor arriving in month nine re-derives reasoning that took a week to establish. The author re-derives their own reasoning after six months away. The usual response is to accept the loss, because the cost is spread thinly enough to ignore.

Working with coding agents removes the option to ignore it. An agent begins every session cold. It has the code and nothing else, so it re-derives constantly, and when the reasoning is unavailable it does not stop — it guesses, plausibly, and sometimes contradicts a decision made deliberately three months earlier. The failure is not that the agent is careless. It is that the repository never told it, and never told anyone.

So the loss was always there. Agents make it legible, immediate, and repeated at every session boundary.

## What spec tooling actually does

Tools like OpenSpec and Spec Kit help, and only so far. They give proposals a shape, keep specification ahead of implementation, and provide somewhere for reasoning to live. That is scaffolding, and scaffolding is worth having.

What they cannot do is supply the reasoning. A spec directory does not know why `dataschema` is required, why an open extension map was rejected, or why one validity rule is deliberately one-directional. Someone has to decide those things and write them down. The tool provides the shelf; it does not provide the book.

Treating the tool as the solution produces the worst outcome available: ceremony that looks like rigour, specs generated to satisfy a workflow rather than to settle a question, and a repository that appears well documented while carrying no decisions at all.

## The bet

**The repository is the context artifact, not just the code.**

Decisions and the reasoning behind them are written down, in durable form, in the repository — not in issue threads, not in chat logs, not in anyone's memory. Three kinds of record, with different lifetimes and different authority:

- **ADRs** record architectural decisions about the Arvo model itself. They are ecosystem-scoped, they bind any implementation in any language, and once accepted they change only by supersession rather than by editing.
- **OpenSpec capabilities and changes** record what this package does and what is proposed to change, with each proposal naming the ADR it implements.
- **The vision document** records what Arvo is betting on and the conditions under which the bet fails.

Every one of these is written to be read by a person and by an agent, because the requirement turns out to be identical. Both need to know what was decided, why, what was rejected, and what is deliberately still open. Neither benefits from prose that gestures at a decision without making one.

The claim is not that this makes agents reliable. It is that a repository which can explain itself produces better work from whoever is doing it — and that this was worth doing before agents existed, but never quite worth the discipline it required.

## The stance

Neither pole is right.

Code written entirely by agents, unreviewed, is bad code — confidently structured, subtly wrong, and expensive in exactly the places that matter. But refusing the tooling on principle is also a mistake, and an increasingly costly one.

So the work here is neither. Architecture, the decisions that are hard to reverse, and the reasoning that has to survive are mine. Agents are used heavily for exploration, for drafting, for finding the contradiction I introduced four files ago, and for the large volume of careful, mechanical work that specification-first development creates. The specification is what makes that delegation safe: an agent implementing against a spec that states its obligations precisely is doing bounded work, and the boundary is checkable.

That division is the point of the structure. It is not scaffolding for agents. It is scaffolding for judgement, which happens to be legible to both.

## What this costs

Writing decisions down is real work, and it is front-loaded onto the moment when the decision is least comfortable to make — before the code exists to justify it.

It also introduces a failure mode absent from an undocumented repository. A stale specification is worse than no specification, because it is confidently wrong and both humans and agents will believe it. Every record here carries an obligation to be corrected or retired, and that obligation compounds.

## How this could be wrong

Stated plainly, so it can be judged later.

**The records could rot faster than they are maintained.** This is the likeliest failure. The discipline holds while the repository is small and one person cares. Whether it survives contributors, deadlines, and a year of drift is unproven here.

**The ceremony could exceed the value.** `arvo-core` is a small package. A specification workflow designed for coordination between teams may be overhead when there is no coordination problem to solve, and the honest test is whether it prevents mistakes or merely documents them.

**Better memory could make it moot.** If agents come to carry durable, reliable context across sessions, a substantial part of this scaffolding becomes redundant work. The counter-argument is that humans never had that memory either — but if the primary driver was the agent, the case weakens considerably.

**It could ossify the design.** Specification-first work makes change more expensive by construction. That is deliberate for the model, where stability is the product. It may be wrong at the package level, where the ability to be wrong quickly and cheaply is worth more.

**It could become performative.** The visible artifacts of rigour are easy to produce and the substance is not. A repository full of well-formatted specs that settle nothing would look almost exactly like this one from the outside.

## Working here

Read [`openspec/project.md`](../openspec/project.md) first — it maps which record owns which kind of decision, and sets the governance rules that keep the ADRs authoritative.

Then: a decision that would bind an implementation in another language belongs in an ADR. A decision about what this package does belongs in an OpenSpec capability. A decision that fits in neither is probably not a decision, and should be a code comment.
