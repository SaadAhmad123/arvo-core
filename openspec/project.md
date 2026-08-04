# Project Context

> Everything here must pass one test: **will this still be true in two years?** If it will not, it is not project context. Work that is only true now belongs in an OpenSpec change, which is archived when it lands; an architectural fact belongs in an ADR. A stale line in this file is worse than a missing one, because every proposal and every cold-starting agent reads it as authoritative.

## Purpose

`arvo-core` is the reference TypeScript implementation of the **Arvo Application Model (AAM)** — a portable, language-independent application model for event-driven systems. It provides the application-tier primitives (`ArvoEvent`, `ArvoContract`, `ArvoEventHandler`) through which independently built participants compose.

Arvo does not execute the model; infrastructure adapters do. This package is deliberately lightweight and opinionated.

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

- [ADR-000](../docs/adr/000-arvo-system-identity-and-architectural-principles.md) — Arvo System Identity and Architectural Invariants. Defines AAM 1, its invariants, and what is inside versus outside the model.
- [ADR-001](../docs/adr/001-arvoevent-structure.md) — ArvoEvent Structure. Defines the event's fields, their types, defaults, structural constraints, and propagation.

[`docs/adr/README.md`](../docs/adr/README.md) is the index and the source of truth for which ADRs exist and what status each holds. Check it rather than trusting this list to be current.

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

### Dependencies and reuse

Before writing non-trivial logic, check whether something already in the dependency tree does it — see `package.json` for what is currently there. An existing dependency costs consumers nothing they are not already paying; a new one does.

The heuristic: **if the code you are about to write would make sense in a package that knows nothing about Arvo, it probably already exists in one.** A rule that comes from an ADR is Arvo's problem; a general-purpose data or validation concern usually is not.

*Minimal dependencies* is a rule against gratuitous ones, not a licence to reinvent. Bespoke code is a standing cost: its own tests, its own edge cases, its own maintenance, and it is where subtle bugs live.

Three counterweights, so this does not become an argument for adding packages freely:

- A **new** dependency is a cost borne by every consumer. Introducing one needs materially more justification than using one already present.
- Do not add a dependency for something trivial. A ten-line helper is not worth a supply-chain entry.
- Bespoke is right when the semantics are genuinely Arvo's, or when the library cannot express what is needed.

Two mechanisms doing the same job is worse than either alone — two idioms, two error shapes, and no guarantee they agree.

When bespoke wins, `design.md` records why, so the next person does not re-litigate it.

### Documentation in source

TSDoc is written for the **package consumer**, not the contributor. Someone who installed `arvo-core` from npm and is hovering a symbol in their editor is the audience — they do not have this repository open, and they did not ask about how it is built.

- **State rules and constraints, not provenance.** What is this, what may I pass, what will happen. Not why the design is this way, what was rejected, or which record decided it.
- **Keep it short.** A hover tooltip is a small box. Every sentence that does not change what the caller writes or expects buries the one that does.
- **Cite `docs/` paths, never `openspec/` paths.** ADRs and the vision document are durable, are the architecture, and change only by supersession, so a reader can follow them. OpenSpec paths move when a change is archived, so a shipped comment pointing at one rots by design.
- **A citation supplements the rule, never replaces stating it.** Being pointed at an ADR is not a substitute for being told what the constraint is.
- **Document a constraint where a caller meets it**, not on the type that models it. A rule enforced when an event is constructed belongs on that field, not on the type alias its value happens to use.

The reasoning is not lost by keeping it out of source — it is recorded in the ADRs and in `openspec/`. Duplicating it into shipped comments creates a second copy that drifts and can only be corrected by cutting a release.

This governs the package's **public export surface** — what `src/index.ts` re-exports, and therefore what a consumer's editor can ever surface. An internal module that is never exported may carry full contributor-facing reasoning at its top, in the same register as `design.md`, because no consumer's tooling will ever show it to them. Point to `design.md` for the canonical record rather than duplicating it — the same cite-don't-copy rule that governs everything else here.

### Errors

Errors are human-facing. Every thrown error names what failed, the value involved, and the rule violated, and preserves the underlying cause. Generic messages such as "invalid input" are not acceptable — a reader should be able to correct the problem from the message alone without opening the source.

### Result types and the `try`-prefix convention

Every fallible operation is implemented exactly once, as `tryX`, returning a `Result<R, E>` — or `AsyncResult<R, E>`, an alias for `Promise<Result<R, E>>`, for an asynchronous one. `tryX` is the primitive. Every branch, every case, every piece of validation or failure logic lives there and nowhere else.

`X` — the same name without the prefix — is a thin wrapper with no logic of its own: it calls `tryX` and unwraps the result, returning the success value or throwing the failure. It exists for a caller who wants ordinary throw/catch and does not want to reason about `Result`. Two names, one implementation. `X` is derived from `tryX`; `tryX` is never derived from `X`.

This governs the whole of `arvo-core`'s public surface, not any one function. Before writing something that can fail, decide which of the two it is — there is no third shape. A bespoke `{ success, value } | { success: false, error }` object, hand-rolled per function, is the two-mechanisms-doing-the-same-job problem *Dependencies and reuse* already warns against, recreated at the API-shape level instead of the implementation level.

A constructor cannot be `tryX` — it cannot return a `Result`, only build the instance or throw. That makes a constructor the natural `X`: throw-or-succeed is already its shape, and it is free to hold the real logic directly, exactly as it would if there were no `Result`-returning sibling at all. `tryX`, for a class, is what gets built on top — a thin wrapper calling the constructor inside a try/catch, turning a thrown failure into `Err` and a built instance into `Ok`. The direction does not reverse for a class the way it does for a plain function: the constructor is not derived from `tryX`; `tryX` is derived from the constructor. A static `X` may still exist alongside `new` for symmetry with `tryX`, but it is a one-line delegate to the constructor, not a second place logic lives.

Which library supplies `Result`/`AsyncResult` is an implementation detail, decided and recorded per change under *Dependencies and reuse* — not fixed here. The aliases themselves live in `src/types.ts`, alongside the package's other shared value types.

### Validation

Runtime validation is not optional, and compile-time types do not substitute for it. ADR-000 is explicit that types cannot establish validity across independently deployed, external, or cross-language participants.

### Testing

Vitest, in `tests/` mirroring `src/`. Tests must cover the cases an ADR calls out as **legal** as well as those it forbids. Several structural rules are deliberately one-directional, and a suite that only checks rejections will not notice an implementation that has quietly made them biconditional.

**Bespoke code — anything that won out over a dependency under *Dependencies and reuse* — is held to a higher bar than code that delegates to one.** It carries none of a library's track record. This package is public: a missed edge case here does not surface as a caught exception, it surfaces as silently wrong data in a consumer's event. Test every failure mode the code exists to catch individually, not a representative sample, and check the coverage against the reasoning recorded in `design.md` for why the code is bespoke in the first place.

### Git

Trunk is `main`. Work happens on topic branches.

**Commit each task group as it completes, then move on.** Do not batch a whole change into one commit. A rebuild touches many files for many different reasons, and a single commit spanning all of them cannot be reviewed, bisected, or partially reverted.

Tick the task in `tasks.md` in the same commit that does the work, so the checklist and the tree never disagree about what is finished.

A mid-sequence commit may legitimately not typecheck. Deleting a type in one group and removing its last consumer in a later one leaves the tree broken in between, and that is preferable to one commit large enough to hide a mistake. The final group in a change is what has to be green.

Commit messages explain why the change was made, not what the diff already shows.

## Domain Glossary

- **AAM** — Arvo Application Model. The versioned, language-independent model this package implements.
- **Node** — any participant composing through Arvo contracts: a handler, a human, an external system, or a sealed composition of these.
- **Lattice** — a deployment within which events are ordinarily fulfilled. An event that must be fulfilled elsewhere carries a non-null `domain`.
- **Execution** — one durable, resumable run of a handler, identified by `executionid`.
- **Execution slice** — one active period of execution, from receiving or resuming until completing, failing, or suspending.
- **Structural validity** — properties of a single event, checkable without a contract, a store, or any other event. Distinct from contract validation.
- **Orchestrated choreography** — a coordinating node directing others while remaining an ordinary participant, with no privileged control path.
