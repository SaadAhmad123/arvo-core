# ADR-002: ArvoEvent Field Domain Constraints

- **Status:** Proposed
- **Date:** 2026-08-03
- **Scope:** Arvo ecosystem
- **Supersedes in part:** ADR-001 — `source` format; string-field character domain; `executionunits` number domain

Conformance language is as defined in [ADR-000](./000-arvo-system-identity-and-architectural-principles.md).

## Scope

This ADR narrows three rules within [ADR-001](./001-arvoevent-structure.md)'s Structural Validity section. Every other ADR-001 rule — the eighteen-field set, their types, defaults, remaining structural-validity rules, and propagation — is unchanged and remains governed by ADR-001 directly.

It changes:

- `source`'s format, from unconstrained to a non-empty RFC 3986 URI-reference.
- Every ArvoEvent string field's character domain, excluding control characters, Unicode noncharacters, and unpaired surrogates.
- `executionunits`' number domain, from any finite number to finite IEEE 754 binary64.

It does not touch `data` or `baggage`'s content, contract validation, or any field's semantics — only the shape of the values these three rules already govern.

## Context

Drafting a CloudEvents transformation for ArvoEvent — now [ADR-003](./003-arvoevent-cloudevent-transformation.md) — surfaced that ArvoEvent's own definition permits values no CloudEvents-conformant transformation could represent: CloudEvents types `source` as a URI-reference and every other context or extension attribute value as a narrower `String` domain excluding control characters and Unicode noncharacters, and has no attribute type for an arbitrary-precision or unbounded number. ADR-001 constrained none of this.

Two responses were available: absorb the gap into the transformation layer specifically, via a reversible encoding applied only at the ArvoEvent-CloudEvent boundary, or close it in ArvoEvent's own definition. This ADR takes the second path. Each rule still has its own justification independent of CloudEvents, even though — as the next paragraph explains — the exact boundary each rule draws is now stated by reference to CloudEvents' type system rather than enumerated independently. A control character or unpaired UTF-16 surrogate embedded in an identifier-like field — `type`, `category`, `executionid` — is virtually never a deliberate choice, and far more often a sign of a bug or corrupted input than a legitimate value. A URI-reference is a well-understood, general-purpose identifier shape that the overwhelming majority of `source` values already satisfy without any change, and imposes nothing that "the convention a deployment adopts" — ADR-001's own phrase — could not just as easily have adopted anyway. And a fixed, well-known numeric domain is what makes a value portable across independently implemented consumers at all; an unbounded, language-neutral domain either requires every implementation to support arbitrary precision or silently degrades to whatever precision each one happens to use, which is not really a shared domain.

[ADR-003](./003-arvoevent-cloudevent-transformation.md) is what surfaced the need for this ADR and is currently its only consumer. The rules below are still ArvoEvent's own domain constraints, not a description of how the CloudEvent transformation happens to work — but they are defined by reference to CloudEvents' own attribute type system rather than by an independent enumeration, because that type system is precise, already versioned, and already exactly the boundary every affected field needs to satisfy. The trade is named here rather than left implicit: this ADR's exact boundary now tracks CloudEvents' own `String` and `URI-reference` type definitions, so it would move if those ever did. A future serialization target with a different, incompatible type system would need its own ADR to narrow the same or additional fields further; this one does not attempt to anticipate what that would require.

`arvo-core` v4 has not been declared stable, and ADR-000 states explicitly that compatibility guarantees are deferred until it is: "compatibility guarantees for stable APIs, event representations, contracts, persisted state, and adapter interfaces will be defined before it is declared stable." This tightening is exactly the kind of pre-stability correction that window exists for.

## Decision

**Superseded: field domains under CloudEvents' attribute type system.** ADR-001 states `source`'s format as unconstrained and places no character or magnitude restriction on any other field. This is superseded. Every ArvoEvent field mapped to a CloudEvents `String` MUST satisfy the CloudEvents `String` domain — which excludes the control-character ranges U+0000–U+001F and U+007F–U+009F, Unicode noncharacters (U+FDD0–U+FDEF and the last two code points of any plane), and unpaired UTF-16 surrogates (a code unit in U+D800–U+DFFF with no matching pair). Every field mapped to `URI` or `URI-reference` MUST additionally satisfy [RFC 3986](https://www.rfc-editor.org/rfc/rfc3986) for that type. The affected ArvoEvent fields are:

- Native CloudEvents `String`: `id`, `type`, and `subject`.
- String-valued CloudEvents extensions: `parentid`, `initid`, `executionid`, `category`, `to`, `domain`, `traceparent`, and `tracestate`; nullable values are subject to this rule only when non-null.
- Canonically encoded CloudEvents `String` extensions: `depth` and, when non-null, `executionunits`, under the number-domain rule below.
- CloudEvents `URI-reference`: `source`.
- CloudEvents `Timestamp`: `time`, already constrained to RFC 3339 by ADR-001; no new rule applies.

No ArvoEvent field maps directly to a CloudEvents `URI`: CloudEvents `dataschema` is a fixed constant the transformation generates, not a value any ArvoEvent field supplies. Nullability and every other field-specific semantic rule from ADR-001 remain unchanged. Strings nested in `data` or `baggage`, and `dataschema` once relocated into the transformation's data wrapper, remain governed by ADR-001's JSON-value domain rather than this restriction.

**Source.** `source` remains an ordinary string in every language API. A URI-reference is an identifier, not necessarily a URL and not necessarily dereferenceable; familiar service identifiers such as `order-service` and hierarchical paths such as `api/users` are valid relative references, and the overwhelming majority of `source` values already satisfy the domain without any change. A producer whose natural identifier is not already URI-reference-shaped — containing whitespace or a raw non-ASCII byte sequence, for instance — MUST percent-encode the offending octets before constructing the ArvoEvent; this ADR does not perform that encoding automatically, so a constructed `source` is always exactly the string its producer chose.

**Execution units.** `executionunits`, when non-null, MUST additionally be a finite IEEE 754 binary64 value — narrower than the `String` domain above requires on its own, since an ordinary `String` extension's content is otherwise unconstrained in magnitude or precision. Its sign remains unconstrained and Arvo still assigns it no meaning; only its representable range and precision narrow. A value of `-0` is normalized to `0` at construction, so ArvoEvent itself never distinguishes them. Numbers nested in `data` or `baggage` are unaffected and retain ADR-001's existing JSON-number domain.

**Enforcement.** All of the above is structural validity in ADR-001's own sense: checked at construction, checked identically wherever an event enters as data, and requiring no contract, store, or other event to evaluate. No new validation pathway is introduced; every rule here extends the one ADR-001 already defines.

## Consequences

**Gained.** Every ArvoEvent field affected by these rules now inhabits a fixed, well-specified domain regardless of which wire format or language implementation handles it — narrower than JSON in general, but exactly the shape a value needs to be portable across independently implemented consumers rather than merely valid within one runtime's own type system. [ADR-003](./003-arvoevent-cloudevent-transformation.md) is the immediate and, currently, only beneficiary — every field this ADR narrows can now be carried by a CloudEvents-conformant transformation with no encoding step and no possibility of failure — and the domain is stated completely enough, by reference to CloudEvents' own type system, that any future serialization target sharing that type system inherits it without renegotiation; one that does not would need its own ADR to narrow further. Rejecting an out-of-domain value at construction also surfaces what was previously silent, likely-accidental input as an immediate, diagnosable error, consistent with the Diagnostic Quality ADR-001 already holds every other rule to.

**Paid for.** This is the first breaking change to an ADR-001 structural rule since it was accepted. A producer supplying a `source` outside URI-reference syntax, a string field containing a control character or unpaired surrogate, or an `executionunits` value outside finite binary64 — all of which previously constructed successfully — now fails, and a stored `executionunits` of `-0` is now silently normalized to `0`. ADR-000's stated pre-stability allowance for `arvo-core` v4 is what makes this an acceptable cost now rather than a compatibility break requiring its own migration story.

## Considered Alternatives

**Absorbing these constraints into the CloudEvents transformation layer instead of tightening ADR-001** — considered, not chosen. It would have kept ADR-001 untouched and avoided any breaking change to ArvoEvent's own construction rules, at the cost of every affected field needing a reversible encoding transform, a `source` that is not always the literal value its producer wrote once carried on the wire, and the same problem needing to be solved again — potentially differently — by any future non-CloudEvents serialization target. Narrowing the domain once, in ArvoEvent's own definition, is a one-time, pre-stability cost against a permanent, general-purpose encoding mechanism every future consumer would otherwise need to either reuse or reinvent.

**Preserving ADR-001's unbounded `executionunits` number domain** — considered, not chosen. A lossless, cross-language canonical representation for an unbounded, language-neutral number would require Arvo to first define an arbitrary-precision numeric model and then require every implementation to support it, just to exchange an opaque accounting value. Finite binary64 matches Arvo's TypeScript-first runtime, is already implemented natively or near-natively across essentially every target language, and has a standard canonical serialization already defined in RFC 8785 — reused, not invented, by [ADR-003](./003-arvoevent-cloudevent-transformation.md).

**Enumerating the excluded code points directly in ArvoEvent's own terms, rather than by reference to CloudEvents' `String` domain** — considered, not chosen. A self-contained enumeration would keep this ADR's meaning fixed regardless of any later change to CloudEvents' own type system. Defining the domain by reference instead was chosen for completeness and precision: it names every affected field against the exact CloudEvents attribute type it targets, accounts for a field needing no new rule explicitly (`time`) rather than by silence, and generalizes automatically to any future field mapped onto a CloudEvents attribute without requiring a new enumerated rule. The cost is accepted rather than hidden: this ADR's exact boundary now tracks CloudEvents' own `String` and `URI-reference` type definitions rather than being fixed independently of them.

## Conformance to ADR-000 and ADR-001

**Effect on ADR-001.** This ADR supersedes exactly three things in ADR-001's Structural Validity section: the sentence stating `source`'s format is unconstrained; the absence of any character restriction on string-valued fields; and the unbounded finite-number domain for `executionunits`. Every other rule ADR-001 states — the eighteen-field set, their types, defaults, propagation, and every other structural-validity rule — is unchanged and remains governed by ADR-001 directly.

**Invariants depended on.** *Explicit Contracts and Runtime Validation* — these remain construction-time, runtime-checked rules, not compile-time ones. *Observability by Default* — a well-formed `source` and control-character-free identifiers are what let routing, correlation, and tracing tooling treat these fields as stable identifiers rather than arbitrary blobs.

**Invariants strained.** None.

**Required of infrastructure adapters.** None beyond what ADR-001 already requires — this ADR changes what ArvoEvent permits at construction, not what an adapter carries.

**Left deferred.** Whether any further ArvoEvent field deserves a narrower domain than ADR-001 originally gave it is not addressed here; this ADR closes only the specific gaps drafting [ADR-003](./003-arvoevent-cloudevent-transformation.md) surfaced.
