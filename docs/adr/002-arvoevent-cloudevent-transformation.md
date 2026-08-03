# ADR-002: ArvoEvent–CloudEvent Transformation

- **Status:** Proposed
- **Date:** 2026-08-03
- **Scope:** Arvo ecosystem
- **Amends:** AAM 1 membership (ADR-000)

Conformance language is as defined in [ADR-000](./000-arvo-system-identity-and-architectural-principles.md).

## Scope

This ADR defines the transformation between an ArvoEvent, as [ADR-001](./001-arvoevent-structure.md) structures it, and a CloudEvent: which fields land on CloudEvents' own context attributes, which require an extension attribute, which cannot be represented as an extension attribute at all, and what a conforming transformation must guarantee about the round trip.

Four things are deliberately not defined here:

- **Binary content mode.** This ADR defines only the structured-mode CloudEvents object — the abstract event as the CloudEvents core specification describes it. How that object is subsequently carried over HTTP headers, AMQP, Kafka, or any other transport is governed by CloudEvents' own protocol-binding specifications and by infrastructure adapters. Arvo does not restate them.
- **The transformation mechanism.** Whether a conforming implementation performs the mapping through a class, a pipeline of per-field transformers, or a single function is implementation. This ADR states what a conforming mapping must produce in both directions; it does not prescribe how a package produces it. That belongs to OpenSpec and `design.md`.
- **Contract validation.** Whether `data` satisfies the schema `dataschema` names is unaffected by this ADR. ADR-001 already assigns that to contract validation at handler trust boundaries, and this ADR does not touch it — a value nested one level deeper inside a CloudEvent's `data` attribute is still exactly the value ADR-001 defined.
- **How a boundary decides what to supply.** This ADR defines that a caller may supply values for fields a foreign CloudEvent lacks. It does not define how a boundary decides which contract, subject, or execution identity to assign to a foreign event — that is handler protocol, not this ADR.

## Context

ADR-000 requires that every ArvoEvent be transformable into a CloudEvent, and states that whether the transformation is lossless and bidirectional would be settled by "the ArvoEvent ADR." ADR-001 built the event this ADR must now transform, and explicitly declined to settle that question, placing "CloudEvent transformation" under its own Left Deferred section instead. This is the ADR that settles it — not ADR-001, whatever ADR-000's wording suggested. A reader following ADR-000's cross-reference to ADR-001 in search of this answer will not find it there.

The event is Arvo's only medium of inter-node interaction (ADR-000, *Event-Only Communication*), and CloudEvents is the standard Arvo has chosen to make that medium legible outside Arvo itself — to a router, a broker, a tracing bridge, a foreign system's boundary proxy, or a human task queue, none of which need to understand Arvo to understand a CloudEvent. That choice only pays off if the transformation is principled rather than incidental to whatever a given implementation finds convenient. An ad hoc mapping, chosen independently per implementation, defeats the reason a standard was chosen at all — each implementation would effectively be speaking its own wire format again, just with CloudEvents' names borrowed for the parts that happened to fit.

The mapping is not mechanical because the two field sets do not line up. Six of ArvoEvent's eighteen fields correspond directly to CloudEvents' own context attributes. The rest do not, and CloudEvents' extension attributes are narrower than JSON — an extension attribute's value must be one of a fixed set of scalar types (Boolean, Integer, String, Binary, URI, URI-reference, Timestamp), which fits most of ArvoEvent's remaining fields exactly and fits none of the rest at all: `baggage` is a map, and no extension type holds one, string-encoded or otherwise. Where a field lands is a real decision, and it has a real cost either way: an extension attribute is legible to any CloudEvents-aware tool without any knowledge of Arvo, while anything folded into `data` is legible only to something that knows Arvo's convention for unpacking it.

## Decision

**Vocabulary.** A **CloudEvent**, in this document, is a value conforming to the CloudEvents specification, version 1.0: a fixed set of context attributes (`id`, `source`, `specversion`, `type`, plus the optional `datacontenttype`, `dataschema`, `subject`, `time`), an **event data** payload carried in `data`, and any number of **extension attributes** — additional context attributes outside the core set, each typed as one of Boolean, Integer, String, Binary, URI, URI-reference, or Timestamp. CloudEvents reserves the core attribute names; an extension attribute MUST NOT reuse one.

**Transformability.** Every ArvoEvent MUST be transformable into a structured-mode CloudEvent conforming to CloudEvents 1.0. Because an ArvoEvent is structurally valid by construction (ADR-001), this direction is total: a well-formed ArvoEvent always has a corresponding CloudEvent, and producing it cannot fail for structural reasons.

**Losslessness.** For an ArvoEvent produced by this transformation and then reversed, the round trip MUST be lossless: ArvoEvent → CloudEvent → ArvoEvent yields an ArvoEvent identical, field for field, to the original. Every one of ArvoEvent's eighteen fields has a defined landing place under this ADR for exactly this reason — nothing is dropped, approximated, or reconstructed by inference.

**The reverse direction is partial.** Not every CloudEvent is a valid ArvoEvent. A CloudEvent produced by something other than Arvo may lack fields ArvoEvent requires, and this ADR treats that as the ordinary case rather than an error condition to special-case away. See **Deserialization**.

**Validation is delegated, not reimplemented.** Establishing that a produced value conforms to the CloudEvents specification is the responsibility of a conformant CloudEvents implementation, not of bespoke logic in this package. ArvoEvent's own structural validity (ADR-001) remains this package's responsibility; CloudEvents' validity does not.

## Field Placement

**Native attributes.** Six fields correspond directly to a CloudEvents context attribute of the same name and are carried there without transformation: `id`, `source`, `type`, `subject`, `time`, `dataschema`.

Reusing CE's attribute name does not always mean reusing CE's exact semantics. `dataschema` and `type` carry ADR-001's meaning without tension: ADR-001 already treats both as Arvo identifiers, "self-identifying only within the Arvo ecosystem... not a shape an arbitrary external reader can resolve," and CE treats its own attributes as opaque strings from its side, so nothing is lost by the reuse. `subject` is the one genuine narrowing. CE describes it as descriptive context supplied by the producer, with reuse across events explicitly expected; ADR-001 makes it a deliberately inert, fixed workflow key, written once and never reinterpreted. The reuse is still correct — both are non-empty strings, and nothing in CE's looser semantics contradicts Arvo's stricter ones — but a CE-native reader relying on CE's own, looser expectations of `subject` would not be wrong to assume less structure than ArvoEvent actually guarantees.

**Protocol-level constants.** `specversion` is fixed at `1.0` by the transformation itself; no ArvoEvent field carries it. Whether an incoming CloudEvent carrying any other `specversion` is even valid input at all is governed by the same delegation this ADR already applies to CloudEvents conformance generally: this transformation targets CloudEvents 1.0 and defines no behavior for any other version, and a conformant CloudEvents implementation's own version handling governs it, not a policy invented here. `datacontenttype` is always set to `application/vnd.arvo.event+json;version=1` on output — see **Discriminating Arvo-shaped events**. `data_base64` is never used; ArvoEvent's payload is always JSON, never raw binary.

**Established extension convention.** `traceparent` and `tracestate` are carried as CloudEvents extension attributes under those exact, unprefixed names, reusing the CloudEvents Distributed Tracing Extension rather than inventing an Arvo-specific alternative. A tracing bridge that already understands CloudEvents' own tracing convention understands these without knowing anything about Arvo.

**Arvo-defined extensions.** Eight fields have no CloudEvents-native home and no established extension convention to reuse: `parentid`, `initid`, `executionid`, `category`, `depth`, `to`, `domain`, `executionunits`. Each is carried as an extension attribute, namespaced with an `arvo` prefix — `arvoparentid`, `arvoinitid`, `arvoexecutionid`, `arvocategory`, `arvodepth`, `arvoto`, `arvodomain`, `arvoexecutionunits` — rather than bare. The prefix guards against collision with an attribute a foreign producer already uses under the bare name for something else, and matches the naming convention used inside the `data` wrapper below, so a reader sees one consistent namespace rather than two.

Of these, every field is natively scalar-typed except `executionunits`, which ADR-001 permits to be any finite number, including non-integer and arbitrarily large values — outside what CloudEvents' `Integer` extension type holds (a 32-bit signed integer). `arvoexecutionunits` is therefore typed as CloudEvents' `String` extension type, carrying the number's literal decimal form, rather than `Integer`. This preserves its status as an ordinary extension attribute, readable by any cost- or usage-accounting tool without parsing `data`, at the cost of requiring that reader to parse the string as a number.

A nullable extension-mapped field — `parentid`, `initid`, `category`, `to`, `domain`, `executionunits`, and, from the established-convention group above, `traceparent` and `tracestate` — that is `null` on the ArvoEvent is omitted from the CloudEvent's extension attributes entirely — CloudEvents' extension type system has no `null` value, so absence is how null is represented. Absence on deserialization is read back as `null`, never as an error, consistent with ADR-001 already treating `null` and absent as equivalent for these fields.

**The `data` wrapper.** Two fields have no defined landing place above: `data` itself, and `baggage`. `baggage` is a flat map, and no CloudEvents extension type — scalar, string, or otherwise — holds a map. Rather than string-encoding it into a single extension attribute, both fields are carried together inside the CloudEvent's own `data` attribute, as:

```json
{
  "arvoeventdata": { /* ArvoEvent.data, unchanged */ },
  "arvoeventbaggage": { /* ArvoEvent.baggage, unchanged, not stringified */ }
}
```

`baggage` is carried as a nested object, not a JSON-encoded string. String-encoding a value that already lives inside `data` — itself already an arbitrary JSON container — adds a double-encoding step for no benefit; nothing about `data`'s type constrains its values to scalars the way an extension attribute does.

No other field joins this wrapper. Placement here is reserved for `baggage`'s structural incompatibility with the extension type system, not general convenience — see **Considered Alternatives** for the fields that were weighed against this and kept as extensions instead.

## Discriminating Arvo-shaped events

A CloudEvent produced by this transformation carries `datacontenttype: application/vnd.arvo.event+json;version=1` — a vendor media type (RFC 6838) with a structured syntax suffix (RFC 6839), the same pattern CloudEvents itself uses for its own structured-mode envelope (`application/cloudevents+json`), versioned the way `application/vnd.github.v3+json` is.

This value is a signal, not sole authority. A receiver deciding whether an incoming CloudEvent is Arvo-shaped MUST corroborate it against the presence of Arvo's own extension attributes rather than trusting `datacontenttype` alone — the same corroborate-never-override posture ADR-001 already takes with `category`: a hint that can confirm what other evidence shows, or be contradicted and set aside, but never one that redirects anything by itself.

## Mapping Table

| ArvoEvent field | CloudEvent placement |
|---|---|
| `id` | `id` |
| `source` | `source` |
| `type` | `type` |
| `subject` | `subject` |
| `time` | `time` |
| `dataschema` | `dataschema` |
| `traceparent` | extension `traceparent` (omitted when null) |
| `tracestate` | extension `tracestate` (omitted when null) |
| `parentid` | extension `arvoparentid` (omitted when null) |
| `initid` | extension `arvoinitid` (omitted when null) |
| `executionid` | extension `arvoexecutionid` |
| `category` | extension `arvocategory` (omitted when null) |
| `depth` | extension `arvodepth` |
| `to` | extension `arvoto` (omitted when null) |
| `domain` | extension `arvodomain` (omitted when null) |
| `executionunits` | extension `arvoexecutionunits`, `String`-typed (omitted when null) |
| `data` | `data.arvoeventdata` |
| `baggage` | `data.arvoeventbaggage` |
| — | `specversion` fixed at `1.0` |
| — | `datacontenttype` fixed at `application/vnd.arvo.event+json;version=1` |

## Deserialization

CloudEvent → ArvoEvent is partial, not total. Deserialization MUST support both:

- An **Arvo-shaped CloudEvent** — one this transformation, or a conforming equivalent, produced — which reverses losslessly to the original ArvoEvent.
- A **foreign CloudEvent** — one Arvo never produced, lacking some or all of the extension attributes above, and potentially lacking `data`, `subject`, `dataschema`, or `time` — each required by ADR-001, and each, unlike `id`, `source`, and `type`, optional in CloudEvents core. This is not a degenerate case; ADR-001 already anticipates it directly: "events from foreign systems enter through a boundary that declares a contract on their behalf and supplies the value."

Accordingly, deserialization MUST accept caller-supplied values alongside the CloudEvent, to be used for a required ArvoEvent field the CloudEvent itself does not carry. It MUST NOT require the caller to pre-process or augment the CloudEvent's own extension attributes before calling it — the override is supplied alongside the CloudEvent, not merged into it beforehand.

Deserialization MUST NOT define a second structural-validity check. Once CloudEvent attributes, `data`, and any caller-supplied overrides are assembled into ArvoEvent's input shape, the result is validated through the same non-throwing entry point ADR-001 already defines for events arriving as data. There is one structural-validity rule set in this package; this ADR does not add a second one for CloudEvents-shaped input.

## Consequences

**Gained.** A single, principled mapping means every conforming implementation of this ADR, in any language, produces and consumes wire-identical CloudEvents — the interoperability ADR-000 asked for when it made CloudEvent transformability part of AAM 1. Fields a non-Arvo tool plausibly needs — routing hints, causation, lineage, tracing, accounting — stay reachable without any Arvo-specific decoding, because they stay extension attributes rather than migrating into an opaque payload. Losslessness for Arvo-native round trips means no adapter, replay tool, or cross-language bridge silently drops information by round-tripping through CloudEvents. Delegating CloudEvents conformance to a conformant implementation means this package is never in the business of maintaining its own copy of the CloudEvents specification's validity rules.

**Paid for.** Every field's placement is now something a cross-language implementer must match exactly, including the `arvo` prefix, the `String` typing of `arvoexecutionunits`, and the `data` wrapper's exact key names — a mismatch on any of these breaks interoperability with every other conforming implementation, silently. `baggage`'s placement inside `data` means a CloudEvents-only consumer reading `data` sees an Arvo-specific wrapper rather than the payload alone; reaching the actual business payload requires knowing to look inside `arvoeventdata`. Foreign-CloudEvent deserialization accepting caller-supplied overrides means the ArvoEvent that results is only as trustworthy as whatever supplied those overrides — this ADR defines that the mechanism exists, not that any particular source of overrides is trustworthy.

## Considered Alternatives

**`baggage` as a JSON-encoded string extension attribute** — considered, not chosen. It would have kept `data` byte-identical to `ArvoEvent.data`, preserving direct payload transparency for a generic CloudEvents consumer, and losslessness holds either way. Rejected on two grounds. First, a deliberate preference for one mechanism carrying both `data` and `baggage` over two separate ones. Second, a concrete forward-compatibility argument: CloudEvents already has an established path for an oversized `data` payload — the Dataref Extension, which lets a producer store the payload externally and carry a reference in its place — and that path covers `data` only. There is no equivalent standard mechanism for externalizing a single oversized extension attribute; giving `baggage` that treatment on its own would mean inventing one. Keeping `data` and `baggage` combined means an oversized combined payload has exactly one future story, reachable through an existing CloudEvents convention, rather than two.

**`executionunits` folded into the `data` wrapper alongside `baggage`** — considered, not chosen. `executionunits`' mismatch with CloudEvents' `Integer` extension type is a range-and-precision problem, not a structural one like `baggage`'s — a `String`-typed extension attribute resolves it completely, losslessly, within the extension-attribute system. Moving it into `data` for mechanism consistency would hide an accounting field from cost or billing tooling that should be able to read it off the envelope without parsing the payload, to solve a problem the extension-attribute system already solves on its own.

**Folding the remaining Arvo-specific fields into `data` more broadly** — considered, not chosen. `to` and `domain` are, by ADR-001's own description, hints supplied to infrastructure; an adapter routing on them should not have to parse a payload to find them. `parentid`, `initid`, `executionid`, `category`, and `depth` are the causation, correlation, and operational-visibility fields ADR-001 built expressly so they could be read without consulting a store or traversing a graph — burying them in `data` would defeat that purpose for exactly the tooling it exists to serve.

**Bare, unprefixed Arvo extension attribute names** — considered, not chosen. Shorter, but a foreign producer's unrelated extension under the same bare name would collide silently rather than being visibly distinguishable as Arvo's.

**`application/json;profile=<token>`** as the discriminator — considered, not chosen. `profile` is not an IANA-registered parameter for `application/json`; its nearest real precedent is JSON-LD, where its value is a dereferenceable URI rather than a bare token. A vendor tree with a structured syntax suffix is the established mechanism for exactly this purpose, and is what CloudEvents itself already uses for its own envelope.

**`datacontenttype` alone as authoritative for foreign-event detection** — considered, not chosen. A foreign producer could set an equivalent `datacontenttype` without actually being Arvo-shaped, or an intermediary could rewrite it in transit. Corroborating against the presence of Arvo's own extension attributes costs little and mirrors a pattern (`category`) ADR-001 already established for exactly this class of problem.

**A pure `CloudEvent → ArvoEvent` function, no override parameter** — considered, not chosen. It would keep deserialization's signature simpler, but would force every boundary handling foreign events to first synthesize a compliant CloudEvent carrying values it does not actually have, before being allowed to call deserialization at all — manufacturing exactly the intermediate object the override mechanism exists to avoid.

## Conformance to ADR-000 and ADR-001

**Effect on AAM.** This ADR settles the question ADR-000 raised and attributed to "the ArvoEvent ADR" — whether ArvoEvent's CloudEvent transformation is lossless and bidirectional — which ADR-001 did not in fact settle. CloudEvent transformability remains an AAM 1 member as ADR-000 established it; this ADR defines what that membership requires in both directions.

**Invariants depended on.** *Infrastructure Independence* — this ADR defines only the abstract CloudEvent object, never a transport binding, so the mapping's meaning cannot vary by broker or adapter. *Explicit Contracts and Runtime Validation* — `dataschema` maps to CloudEvents' own `dataschema` attribute unchanged, and `data`'s contract-typed content is preserved, one level deeper, inside the wrapper. *Observability by Default* — causation, lineage, and tracing fields are placed as extension attributes specifically so they remain readable without decoding the payload.

**Invariants strained.** *Explicit Contracts and Runtime Validation* — narrowly, and accepted rather than resolved. ADR-000 requires that runtime validation must not preclude cross-language participation; ADR-001 built on that to make `data` directly consumable by "a human task queue, a foreign system, or a service someone stands up in an afternoon," with no Arvo-specific knowledge required. Placing `baggage` inside `data` spends part of that: a CloudEvents-only consumer reading `data` now finds `arvoeventdata` and `arvoeventbaggage`, not the payload alone, and needs Arvo's wrapper convention to reach it. Unlike ADR-001's own treatment of `baggage` against this same invariant, this is not resolved into a clean non-strain — it is a real, if narrow, cost, weighed against the alternative recorded in **Considered Alternatives** and accepted rather than designed away.

**Required of infrastructure adapters.** Carry a CloudEvent's extension attributes and `data` unchanged across a boundary hop, exactly as ADR-001 already requires for ArvoEvent's own fields. Do not synthesize, mutate, or drop an extension attribute in transit, and do not rewrite `datacontenttype`.

**Left deferred.** Binary content mode and other CloudEvents protocol bindings. The transformation mechanism's implementation. Upgrading the target CloudEvents specification version beyond 1.0, which requires a superseding ADR under the same discipline that governs any other change here. Any size limit on `baggage` — ADR-001 deferred this pending a canonical encoding to measure it against; that encoding is now settled, which unblocks the question without answering it. Should a limit be set, CloudEvents' own Dataref Extension is the natural mechanism to reach for, since `data` now carries `data` and `baggage` together — adopting it is not decided here.
