# ADR-004: Multi-Language Implementation Governance

- **Status:** Proposed
- **Date:** 2026-08-05
- **Scope:** Arvo ecosystem
- **Addresses, in part:** ADR-000 Deferred Decision — "Cross-language protocol compatibility"; leaves runtime interoperability, the compatibility half of that phrase, to a future ADR

Conformance language is as defined in [ADR-000](./000-arvo-system-identity-and-architectural-principles.md).

## Scope

This ADR governs how independent, per-language packages that each implement the Arvo Application Model relate to the ADRs that define it, to this repository, and to one another as separate packages. It defines: where multiple language implementations live relative to one another; what a language package must guarantee to claim conformance to a given AAM version; what it is explicitly free to decide for itself; how its release versioning relates to AAM's own versioning and to other language packages' versioning; and where implementation-level specification work (OpenSpec) is authored relative to ADRs.

It does not define any language package's actual public API, naming convention, or error-handling mechanism — ADR-000's own Deferred Decisions already assign that to each implementation, and this ADR states the boundary of that freedom rather than narrowing it. It does not establish CI, publishing credentials, or registry mechanics — those are tooling decisions this ADR's rules constrain but do not themselves make.

**Explicitly out of scope: runtime interoperability between language implementations.** This ADR does not address, and does not require, that a running TypeScript-implemented node and a running Python-implemented node compose or exchange events with each other today. Its subject is narrower — that each language package is, independently, a correct and conformant implementation of the same model — not that multiple implementations have been made to interoperate at runtime. Whether and how that composition works is a distinct question left to a future ADR; see **Left deferred**.

## Context

ADR-000 defines Arvo as "a portable, language-independent application model," states plainly that "AAM versions are distinct from the versions of any package implementing them," and lists "Cross-language protocol compatibility" among its Deferred Decisions, requiring its own ADR. Until now, exactly one implementation has existed — `arvo-core`, TypeScript. Adding a second language package to this same repository raises two questions ADR-000 left open for exactly this moment.

First, ADR-000's own Governance section states that "other repositories reference these records rather than copying them" — written with a picture of separate repositories, each pointing back at one canonical ADR source. Left unaddressed, hosting more than one language package directly inside this repository would sit in unstated tension with that sentence. Second, without an explicit conformance boundary, "conformance" has no test: nothing distinguishes a language package that correctly implements ADR-001/002/003's guarantees from one that merely resembles the TypeScript implementation's API shape, or diverges from it for no principled reason at all. Both questions need an answer before a second language package is added, not after.

## Repository Topology

`arvo-core` is a multi-language monorepo. This states the target topology this ADR requires once a second language package is added; it is not yet the current state — today the TypeScript implementation occupies the repository root directly, and restructuring to this topology is a precondition of adding a second language, not a separate migration to schedule afterward.

Each language implementation lives in its own top-level directory, physically separate from every other language's, with its own build tooling, dependency manifest, test runner, and package-publishing configuration — illustrated here as `ts/` and `py/`. The separation itself is normative; the exact directory-naming convention is not fixed by this ADR (see **Left deferred**). `docs/adr/` sits alongside these language directories, at the repository root, as the one copy every language references. Each language's own `openspec/` directory, per **OpenSpec Placement** below, lives inside that language's own directory, not centrally — implementation-level detail belongs with the implementation it describes, not beside the ADRs that govern every implementation.

Each language's package keeps `arvo-core` as its own published name (the TypeScript package already publishes as `arvo-core` today) — the repository, the ecosystem, and every language's own package deliberately share one identity, rather than the overlap being incidental.

This topology reconciles with ADR-000's Governance sentence rather than contradicting it: that sentence constrains *other* repositories, requiring them to reference this repository's ADRs rather than copying them. It says nothing about how this repository — which the same section names as "the canonical source of Arvo ecosystem ADRs" — organizes the language implementations it itself hosts. A monorepo housing multiple language packages alongside the canonical ADRs is a stronger form of the same principle: every implementation this repository hosts references the same, single, physically adjacent copy of each ADR, with no possibility of drift from copying. A future language implementation maintained *outside* this repository remains bound by the original sentence exactly as written. See **Considered Alternatives** for the rejected alternative reading of that sentence.

## AAM Conformance Boundary

A language package MAY claim conformance to a given AAM version only if it correctly implements every MUST rule stated by that version's constituent ADRs, and every SHOULD rule it has not explicitly and justifiably departed from, per ADR-000's own conformance vocabulary — evaluated at the level those ADRs actually state their rules: the field set, types, defaults, and structural-validity rules of ADR-001; the domain constraints of ADR-002; the field placement, mapping table, and round-trip guarantees of ADR-003; and every later ADR amending or extending AAM membership. Conformance is evaluated per language package, independently — it is a property of that package's own observable behavior (the values a construction, validation, or transformation actually accepts, rejects, or produces), not of API shape, method naming, internal mechanism, or resemblance to any other language's implementation. It says nothing about whether two conformant packages can be made to interoperate at runtime; see **Scope**.

A language package MAY be released, versioned, and published before it satisfies every rule a given AAM version states. It MUST NOT claim conformance to that AAM version until it does. A package's own documentation states which AAM version, if any, it currently conforms to. A departure from a SHOULD rule, and its documented justification, is recorded in that language's own OpenSpec `design.md` for the change that departs from it — the same place that change's other design decisions already live.

## Idiomatic Freedom

Everything outside the conformance boundary above is each language package's own decision, and MUST be judged by whether it is good, idiomatic developer experience for that language — not by whether it matches another language implementation's naming, error-handling mechanism, module or class structure, or any other API-shape choice. `arvo-core`'s TypeScript implementation's specific choices (a `tryX`/`X` pair per fallible operation, a class-based `CloudEventConverter`, `neverthrow` used internally) are one implementation's idiomatic answer to what the governing ADRs require, not a template later languages are expected to imitate. A Python implementation choosing free functions over a class, or Python's own established error-handling idiom over a hand-rolled `Result` type, is exercising this freedom correctly, not deviating from a standard.

## Versioning

Each language package's release version is its own semantic-versioning line, governing only that package's own public-API stability, and is independent of every other language package's version and of AAM's own version. No mechanism in this repository requires or implies that language packages' version numbers correspond to one another.

Separately, each language package's release records which AAM version, and where useful which specific ADRs' accepted state, it conforms to — as metadata distinct from its own semver (for example, a published constant, or a manifest field). This lets a reader determine which model version a given release actually implements without that information being entangled in, or inferred from, the package's own release number.

## OpenSpec Placement

Each language package maintains its own `openspec/` directory, inside that language's own top-level directory (see **Repository Topology**), including its own `project.md` stating that language's own conventions. OpenSpec instantiates an ADR's requirements into concrete, language-specific implementation decisions — types, error shapes, verified dependency behavior, tests. This detail does not transfer between languages and is not centralized.

OpenSpec's role remains what it already is in this repository: it decides *how* a package implements what an ADR requires, not *what* the model itself requires. A design decision that is really a new model-level behavioral commitment — not an implementation detail of an already-stated ADR requirement — belongs in an ADR (new, or amending an existing one), not inside a single OpenSpec change. This is the same boundary already stated in ADR-003 ("The transformation mechanism... belongs to OpenSpec and `design.md`", implying the transformation's *requirements* belong to the ADR) applied as an explicit rule rather than left implicit, and it holds independently of whether more than one language package exists.

## Consequences

**Gained.** A second (and later, further) language implementation has an explicit test for what it must guarantee to call itself a conformant AAM implementation, independent of resembling the TypeScript implementation's API. Each language is free to be genuinely idiomatic rather than a transliteration, which is what makes the package worth using natively in that language at all. Versioning tells the truth about each package's own maturity rather than being forced to a shared number neither earned. And the ADR/OpenSpec boundary — already implicit in this repository's practice — is now an explicit rule rather than something a reviewer has to reconstruct from precedent.

**Paid for.** Determining whether a given OpenSpec design decision is really a model-level commitment that belongs in an ADR, versus an implementation detail that doesn't, is a judgment call with no mechanical check — the same kind of judgment ADR-003's own scope boundary already required, now stated as an explicit obligation rather than an implicit norm. Nothing in this ADR yet says what happens when two language packages' implementations of the same ADR-required behavior are later found to disagree; that question is deferred along with runtime interoperability itself.

## Considered Alternatives

**Unified semver across all language packages** (e.g. `ts` and `py` both released as `4.2.0`) — considered, not chosen. Semver states an individual package's own API-stability history; forcing every language to share one number would either falsely inflate a new implementation's apparent maturity or force meaningless version bumps on languages unaffected by a change to another.

**Separate repositories per language, each referencing this repository's ADRs, rather than one monorepo** — considered, not chosen, though this is the reading ADR-000's Governance sentence most directly anticipates, and the strongest alternative to the topology actually chosen. It would keep this repository scoped to governance and any language-agnostic core, with `arvo-core-ts`, `arvo-core-py`, etc. as independent repositories downstream of it. Rejected for now because it multiplies operational overhead (separate CI, separate issue trackers, separate release tooling per language) before there is a second language package mature enough to justify paying that cost, and because nothing about a monorepo actually violates the cited sentence once read correctly — see **Repository Topology**. This alternative is not foreclosed permanently; it is the more likely direction if the number of supported languages grows large enough that per-language operational independence outweighs the convenience of one repository.

**A single, shared OpenSpec directory for all languages** — considered, not chosen. OpenSpec's implementation-level content (concrete types, verified dependency quirks, per-language test coverage) does not transfer between languages, and forcing it into one document either strips the detail that makes it useful or interleaves unrelated languages' implementation notes in one file.

## Conformance to ADR-000

**Effect on ADR-000.** This ADR addresses ADR-000's Deferred Decision "Cross-language protocol compatibility" only in part — namely, what each language package must independently guarantee to be conformant. It deliberately does not address the compatibility half of that phrase: whether independently conformant language packages can be made to interoperate at runtime is left to a future, dedicated ADR. It does not address "Infrastructure adapter interfaces and conformance," a different Deferred Decision this ADR does not touch. It amends no AAM membership list and supersedes no existing rule.

**Invariants depended on.** *Explicit Contracts and Runtime Validation* — ADR-000 already states that compile-time types "must not preclude cross-language participation"; this ADR's Idiomatic Freedom and AAM Conformance Boundary sections are the direct application of that requirement to a concrete second language package rather than a hypothetical one.

**Invariants strained.** None.

**Required of infrastructure adapters.** None. This ADR governs language packages implementing AAM, not the adapters that execute it.

**Left deferred.** Whether and how independently conformant language packages can be made to compose or exchange events with one another at runtime is left to a future, dedicated ADR — this one deliberately does not address it; see **Scope**.

How a conformance claim under **AAM Conformance Boundary** is actually verified, beyond reviewer judgment at OpenSpec proposal time, is not established here — no shared, executable conformance suite (test vectors, a compliance harness run against every language package) exists yet, and building one is left for a future ADR or tooling decision once at least two language implementations are mature enough to validate against. That same gap is what leaves open what happens when two language packages are later found to implement the same ADR-required behavior inconsistently: without a conformance suite, divergence has no fixed resolution rule yet, beyond the general principle that it means at least one package is non-conformant or the ADR itself is ambiguous and needs a clarifying amendment — which of the two applies in a given case is left to be judged when a divergence is actually found, not decided in the abstract here.

"Infrastructure adapter interfaces and conformance," the other Deferred Decision named in ADR-000 alongside cross-language protocol compatibility, remains unresolved and is not addressed here. The exact directory-naming convention for each language package (this ADR requires only that languages be physically separated, illustrated as `ts/`, `py/`), build tooling, and CI/publishing mechanics for each language package are tooling decisions this ADR constrains (independent versioning, per-language OpenSpec, physical separation) but does not itself fix.
