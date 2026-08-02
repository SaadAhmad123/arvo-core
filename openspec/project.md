# Project Context

## Purpose

`arvo-core` is the reference TypeScript implementation of the **Arvo Application Model (AAM)** — a portable, language-independent application model for event-driven systems. It provides the application-tier primitives (`ArvoEvent`, `ArvoContract`, `ArvoEventHandler`) through which independently built participants compose.

Arvo does not execute the model; infrastructure adapters do. This package is deliberately lightweight and opinionated.

The current major line, v4, is a deliberate rebuild unconstrained by earlier majors. It is the first implementation of AAM 1.

## Where decisions live

This repository is written to be read by both humans and agents, and the reasoning behind a decision is treated as part of the deliverable. Four kinds of record, with distinct jobs — put a new decision in the right one:

| Record | Scope | Normative? | Changes by |
|---|---|---|---|
| [`docs/vision.md`](../docs/vision.md) | Why Arvo exists, and how the bet could fail | No | Editing |
| [`docs/adr/`](../docs/adr/) | Architectural decisions about the **model** — ecosystem-wide, cross-language | **Yes** | Superseding ADR only |
| `openspec/` | Capability specifications and proposed changes to **this package** | Yes, once archived | The OpenSpec workflow |
| [`docs/why-agent-native-development.md`](../docs/why-agent-native-development.md) | Why the repository is structured this way | No | Editing |

The distinction that matters most: an ADR describes what Arvo *is*, in terms any implementation in any language must honour. An OpenSpec capability describes what *this package* does. A decision that would bind a Go implementation belongs in an ADR; a decision about how the TypeScript reaches that outcome belongs in `openspec/`.

## Governance

**Accepted ADRs are authoritative over specs and code.** This repository is their canonical source.

- [ADR-000](../docs/adr/000-arvo-system-identity-and-architectural-principles.md) — Arvo System Identity and Architectural Invariants. Defines AAM 1, its invariants, and what is inside versus outside the model. **Accepted.**
- [ADR-001](../docs/adr/001-arvoevent-structure.md) — ArvoEvent Structure. Defines the event's eighteen fields, their types, defaults, structural constraints, and propagation. **Accepted.**

Rules that follow:

- A change MUST NOT contradict an accepted ADR. If it needs to, that ADR must be superseded first — accepted ADRs are never amended in place.
- Where an ADR defers a decision, a spec MUST NOT quietly settle it. Note the deferral and keep it out of scope.
- Specs implement ADRs; they do not reinterpret them. Cite the ADR rather than paraphrasing it into something subtly different.
- Every proposal names the ADR it implements, or states that none governs it. Both are useful signals.

## Capability conventions

- Capabilities are kebab-case nouns naming a coherent area of behaviour, not a file or a class: `arvo-event`, `arvo-contract`, `event-handler`.
- A capability tracks the **primitive**, not the implementation stage. `arvo-event` covers the event's structural validity now and its propagation rules later; both come from one ADR and describe one primitive, so splitting them would scatter a single concept across capabilities that must then be read together.
- Scope a *change* narrowly and a *capability* broadly. Several changes accumulating into one capability spec is the intended shape.

## Tech Stack

- TypeScript, ESM only, Node ≥ 22 (see `.nvmrc` — the OpenSpec CLI and pnpm 11 both fail on older runtimes)
- Zod (peer dependency) for schema validation
- OpenTelemetry API (peer dependency) for trace context
- Vitest for testing, Biome for lint and format
- pnpm for package management, Changesets for versioning and release

## Conventions

### Code style

Biome-enforced. Run `pnpm lint` before finishing any change.

### Documentation in source

TSDoc is written for the **package consumer**, not the contributor. Someone who installed `arvo-core` from npm and is hovering a symbol in their editor is the audience — they do not have this repository open, and they did not ask about how it is built.

- **State rules and constraints, not provenance.** What is this, what may I pass, what will happen. Not why the design is this way, what was rejected, or which record decided it.
- **Keep it short.** A hover tooltip is a small box. Every sentence that does not change what the caller writes or expects buries the one that does.
- **Cite `docs/` paths, never `openspec/` paths.** ADRs and the vision document are durable, are the architecture, and change only by supersession, so a reader can follow them. OpenSpec paths move when a change is archived, so a shipped comment pointing at one rots by design.
- **A citation supplements the rule, never replaces stating it.** Being pointed at an ADR is not a substitute for being told what the constraint is.
- **Document a constraint where a caller meets it**, not on the type that models it. A rule enforced when an event is constructed belongs on that field, not on the type alias its value happens to use.

The reasoning is not lost by keeping it out of source — it is recorded in the ADRs and in `openspec/`. Duplicating it into shipped comments creates a second copy that drifts and can only be corrected by cutting a release.

### Errors

Errors are human-facing. Every thrown error names what failed, the value involved, and the rule violated, and preserves the underlying cause. Generic messages such as "invalid input" are not acceptable — a reader should be able to correct the problem from the message alone without opening the source.

### Validation

Runtime validation is not optional, and compile-time types do not substitute for it. ADR-000 is explicit that types cannot establish validity across independently deployed, external, or cross-language participants.

### Testing

Vitest, in `tests/` mirroring `src/`. Tests must cover the cases an ADR calls out as **legal** as well as those it forbids. Several structural rules are deliberately one-directional, and a suite that only checks rejections will not notice an implementation that has quietly made them biconditional.

### Git

Trunk is `main`; the v4 rebuild line is `v4`. Work happens on topic branches.

## Domain Glossary

- **AAM** — Arvo Application Model. The versioned, language-independent model this package implements.
- **Node** — any participant composing through Arvo contracts: a handler, a human, an external system, or a sealed composition of these.
- **Lattice** — a deployment within which events are ordinarily fulfilled. An event that must be fulfilled elsewhere carries a non-null `domain`.
- **Execution** — one durable, resumable run of a handler, identified by `executionid`.
- **Execution slice** — one active period of execution, from receiving or resuming until completing, failing, or suspending.
- **Structural validity** — properties of a single event, checkable without a contract, a store, or any other event. Distinct from contract validation.
- **Orchestrated choreography** — a coordinating node directing others while remaining an ordinary participant, with no privileged control path.
