# ADR-004: Multi-Language Implementation Governance

- **Status:** Proposed
- **Date:** 2026-08-05
- **Scope:** Arvo ecosystem
- **Amends:** ADR-000 Deferred Decisions — "Infrastructure adapter interfaces and conformance" and "Cross-language protocol compatibility"

Conformance language is as defined in [ADR-000](./000-arvo-system-identity-and-architectural-principles.md).

## Scope

This ADR governs how a language implementation of the Arvo Application Model relates to the ADRs that define it, to other language implementations, and to this repository. It defines: where multiple language implementations live relative to one another; what a language package must guarantee to claim conformance to a given AAM version; what it is explicitly free to decide for itself; how its release versioning relates to AAM's own versioning and to other language packages' versioning; where implementation-level specification work (OpenSpec) is authored relative to ADRs; and what, if anything, verifies that a language package's claim of conformance is true.

It does not define any language package's actual public API, naming convention, or error-handling mechanism — ADR-000's own Deferred Decisions already assign that to each implementation, and this ADR states the boundary of that freedom rather than narrowing it. It does not establish CI, publishing credentials, or registry mechanics — those are tooling decisions this ADR's rules constrain but do not themselves make. And it does not establish a formal cross-language conformance test suite; see **Left deferred**.

## Context

ADR-000 defines Arvo as "a portable, language-independent application model," states plainly that "AAM versions are distinct from the versions of any package implementing them," and lists both "Infrastructure adapter interfaces and conformance" and "Cross-language protocol compatibility" as Deferred Decisions, each requiring its own ADR. Until now, exactly one implementation has existed — `arvo-core`, TypeScript — so every one of those deferred questions has had a single, uncontested answer by default: there was nothing to diverge from. Adding a second language implementation to this same repository ends that default.

Three concrete risks motivate settling this now rather than after a second implementation exists in the wild. First, ADR-000's own Governance section states that "other repositories reference these records rather than copying them" — written with a picture of separate repositories, each pointing back at one canonical ADR source, not a single repository hosting multiple language packages directly. Left unaddressed, a multi-language monorepo would sit in unstated tension with that sentence. Second, without an explicit conformance boundary, "conformance" has no test: nothing distinguishes a language package that correctly implements ADR-001/002/003's wire-level guarantees from one that merely resembles the TypeScript implementation's API shape, or diverges from it for no principled reason. Third, and demonstrated rather than hypothetical: this repository's own `arvoevent-serializer` OpenSpec change states outright, in its `proposal.md`, that "No ADR governs this change directly," and then its `design.md` unilaterally decides that CloudEvent is the default wire format. That decision is behavior a consumer moving between language implementations would reasonably expect to hold in both — exactly the kind of decision a second language's independently authored OpenSpec change could, with no rule to stop it, decide differently, producing two implementations that share a capability's name while disagreeing on its default behavior.

## Repository Topology

`arvo-core` is a multi-language monorepo. Each language implementation lives in its own top-level directory (`ts/arvo-core`, `py/arvo-core`, and so on as further languages are added), each with its own build tooling, dependency manifest, test runner, and package-publishing configuration. `docs/adr/` and, per **OpenSpec Placement** below, each language's `openspec/` directory, sit alongside these language directories rather than inside any one of them.

This reconciles with ADR-000's Governance sentence rather than contradicting it: that sentence constrains *other* repositories, requiring them to reference this repository's ADRs rather than copying them. It says nothing about how this repository — which the same section names as "the canonical source of Arvo ecosystem ADRs" — organizes the language implementations it itself hosts. A monorepo housing multiple language packages alongside the canonical ADRs is a stronger form of the same principle: every implementation this repository hosts references the same, single, physically adjacent copy of each ADR, with no possibility of drift from copying. A future language implementation maintained *outside* this repository remains bound by the original sentence exactly as written.

## AAM Conformance Boundary

A language package MAY claim conformance to a given AAM version only if it correctly implements every MUST and SHOULD rule stated by that version's constituent ADRs, evaluated at the level those ADRs actually state their rules: the field set, types, defaults, and structural-validity rules of ADR-001; the domain constraints of ADR-002; the field placement, mapping table, and round-trip guarantees of ADR-003; and every later ADR amending or extending AAM membership. Conformance is a property of observable behavior — the values a construction, validation, or transformation actually accepts, rejects, or produces — not of API shape, method naming, internal mechanism, or resemblance to any other language's implementation.

A language package MAY be released, versioned, and published before it satisfies every rule a given AAM version states. It MUST NOT claim conformance to that AAM version until it does. A package's own documentation states which AAM version, if any, it currently conforms to.

## Idiomatic Freedom

Everything outside the conformance boundary above is each language package's own decision, and MUST be judged by whether it is good, idiomatic developer experience for that language — not by whether it matches another language implementation's naming, error-handling mechanism, module or class structure, or any other API-shape choice. `arvo-core`'s TypeScript implementation's specific choices (a `tryX`/`X` pair per fallible operation, a class-based `CloudEventConverter`, `neverthrow` used internally) are one implementation's idiomatic answer to what the governing ADRs require, not a template later languages are expected to imitate. A Python implementation choosing free functions over a class, or Python's own established error-handling idiom over a hand-rolled `Result` type, is exercising this freedom correctly, not deviating from a standard.

## Versioning

Each language package's release version is its own semantic-versioning line, governing only that package's own public-API stability, and is independent of every other language package's version and of AAM's own version. No mechanism in this repository requires or implies that language packages' version numbers correspond to one another.

Separately, each language package's release records the AAM version — and, where finer granularity is useful, the specific ADR states — it conforms to, as metadata distinct from its own semver (for example, a published constant, or a manifest field). This is the identifier a consumer running more than one language implementation together actually needs to answer "do these two speak the same wire dialect," and it changes only when an ADR changes wire-visible behavior — not on every release of either package.

## OpenSpec Placement

Each language package maintains its own `openspec/` directory (`ts/arvo-core/openspec/`, `py/arvo-core/openspec/`, and so on), including its own `project.md` stating that language's own conventions. OpenSpec changes translate an ADR's requirements into concrete, language-specific implementation decisions — types, error shapes, verified dependency behavior, tests — and this detail does not transfer between languages; it is not centralized.

A design decision within a language's OpenSpec change is **wire/behavior-visible** if a consumer composing more than one language's implementation could reasonably rely on it holding consistently across them — a default configuration, a capability's essential shape, what a given input produces or rejects. A wire/behavior-visible decision MUST already trace to an accepted ADR. Where no such ADR exists, one MUST be drafted or an existing ADR amended before any language's OpenSpec proposal proceeds with that decision — the proposal names the ADR it depends on, the same discipline already practiced by this repository's existing OpenSpec changes. A decision confined to API shape, naming, module structure, or internal mechanism is **idiom-only**, needs no such trace, and is settled entirely within that language's own OpenSpec change under **Idiomatic Freedom** above.

This rule is retroactive in effect, not in force: it does not invalidate `arvoevent-serializer`'s existing default-format decision, but that decision is the concrete example of a wire/behavior-visible choice made without an ADR, and is a candidate for promotion into ADR-003 or a new ADR before a second language implements an equivalent capability.

## Consequences

**Gained.** A second (and later, further) language implementation has an explicit test for what it must guarantee to call itself a conformant AAM implementation, independent of resembling the TypeScript implementation's API. Each language is free to be genuinely idiomatic rather than a transliteration, which is what makes the package worth using natively in that language at all. Versioning tells the truth about each package's own maturity rather than being forced to a shared number neither earned. And the one identified real risk — a capability's essential behavior silently diverging between languages because each authored its own OpenSpec change independently — has an explicit rule closing it: wire-visible decisions graduate to an ADR before a second language can diverge from them.

**Paid for.** Every OpenSpec proposal now carries an additional classification obligation — stating, for each design decision, whether it is wire/behavior-visible or idiom-only — that a single-language repository never needed. A decision wrongly classified as idiom-only when it was actually wire-visible reproduces exactly the risk this ADR exists to close, so the classification itself depends on reviewer judgment rather than a mechanical check; see **Left deferred**. And promoting a wire-visible decision into an ADR before an OpenSpec change can proceed is real, sequencing friction against moving fast on a single language alone.

## Considered Alternatives

**Unified semver across all language packages** (e.g. `ts` and `py` both released as `4.2.0`) — considered, not chosen. Semver states an individual package's own API-stability history; forcing every language to share one number would either falsely inflate a new implementation's apparent maturity or force meaningless version bumps on languages unaffected by a change to another. See **Versioning** above for the chosen alternative — a separate, non-semver AAM-conformance identifier — which answers the actual cross-language question ("do these agree on the wire") without conflating it with either package's own release history.

**A single, shared OpenSpec directory for all languages** — considered, not chosen. OpenSpec's implementation-level content (concrete types, verified dependency quirks, per-language test coverage) does not transfer between languages, and forcing it into one document either strips the detail that makes it useful or interleaves unrelated languages' implementation notes in one file. The **OpenSpec Placement** rule above achieves the actual goal — preventing wire-visible divergence — without centralizing content that has no reason to be shared.

**Deferring this decision until a second language implementation actually exists** — considered, not chosen. The concrete example in **Context** (`arvoevent-serializer`'s undocumented default-format decision) already demonstrates the risk exists within a single language's own OpenSpec practice; waiting for a second implementation to surface a real divergence is waiting for the failure mode this ADR exists to prevent.

**A formal, executable cross-language conformance test suite (shared test vectors, a compliance harness run against every language package)** — not rejected, deferred. It is the strongest possible verification of the conformance boundary this ADR defines, but building it is a substantial, standalone effort that presumes at least two language implementations mature enough to run it against. Nothing in this ADR precludes it; see **Left deferred**.

## Conformance to ADR-000

**Effect on ADR-000.** This ADR resolves two of ADR-000's own Deferred Decisions — "Infrastructure adapter interfaces and conformance" and "Cross-language protocol compatibility" — to the extent stated above. It amends no AAM membership list and supersedes no existing rule.

**Invariants depended on.** *Explicit Contracts and Runtime Validation* — ADR-000 already states that compile-time types "must not preclude cross-language participation"; this ADR's Idiomatic Freedom and AAM Conformance Boundary sections are the direct application of that requirement to multiple concrete language packages rather than a hypothetical one. *Infrastructure Independence* — the model's meaning must not vary by adapter; this ADR extends the same discipline to language implementation, stating that AAM's meaning must not vary by which language package implements it.

**Invariants strained.** None.

**Required of infrastructure adapters.** None. This ADR governs language packages implementing AAM, not the adapters that execute it.

**Left deferred.** Whether, and how, to build a formal executable cross-language conformance test suite is left for a future ADR or tooling decision once at least two language implementations exist to validate it against. The specific repository directory layout, build tooling, and CI/publishing mechanics for each language package are tooling decisions this ADR constrains (independent versioning, per-language OpenSpec) but does not itself make. Which concrete decisions already made by existing single-language OpenSpec changes should be retroactively promoted into an ADR under **OpenSpec Placement** is not resolved here beyond naming `arvoevent-serializer`'s default-format decision as the first candidate.
