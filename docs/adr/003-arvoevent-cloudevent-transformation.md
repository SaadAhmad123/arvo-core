# ADR-003: ArvoEvent–CloudEvent Transformation

- **Status:** Accepted
- **Date:** 2026-08-03
- **Scope:** Arvo ecosystem
- **Amends:** AAM 1 membership (ADR-000)

Conformance language is as defined in [ADR-000](./000-arvo-system-identity-and-architectural-principles.md).

## Scope

This ADR defines the transformation between an ArvoEvent, as [ADR-001](./001-arvoevent-structure.md) structures it and [ADR-002](./002-arvoevent-field-domain-constraints.md) narrows it, and a CloudEvent: which fields land on CloudEvents' own context attributes, which require an extension attribute, which belong in event data, and what a conforming transformation must guarantee about the round trip. It depends on ADR-002's field-domain narrowing — `source` as a URI-reference, string fields excluding control characters and unpaired surrogates, `executionunits` as finite binary64 — for its totality guarantee, and does not repeat those rules here.

Five things are deliberately not defined here:

- **Binary content mode.** This ADR defines the abstract CloudEvent and its JSON-valued event data. How that event is subsequently carried in structured or binary content mode over HTTP, AMQP, Kafka, or any other transport is governed by CloudEvents' own event-format and protocol-binding specifications and by infrastructure adapters. Arvo does not restate them.
- **The transformation mechanism.** Whether a conforming implementation performs the mapping through a class, a pipeline of per-field transformers, or a single function is implementation. This ADR states what a conforming mapping must produce in both directions; it does not prescribe how a package produces it. That belongs to OpenSpec and `design.md`.
- **Contract validation.** Whether `ArvoEvent.data` satisfies the contract schema `ArvoEvent.dataschema` names remains assigned to handler trust boundaries by ADR-001. This ADR relocates both values inside the CloudEvent data wrapper without changing that relationship. CloudEvents' own `dataschema` instead identifies the wrapper schema, as CloudEvents requires.
- **How a boundary decides what to supply.** This ADR defines that a caller may supply values for fields a foreign CloudEvent lacks. It does not define how a boundary decides which contract, subject, or execution identity to assign to a foreign event — that is handler protocol, not this ADR.
- **Canonical wire serialization.** This ADR guarantees equivalence of CloudEvent attribute values, not byte-for-byte identity of serialized messages. Canonical JSON, signing, hashing, and other concerns that depend on identical bytes require a separate wire-format decision.

## Context

ADR-000 requires that every ArvoEvent be transformable into a CloudEvent, and states that whether the transformation is lossless and bidirectional would be settled by "the ArvoEvent ADR." ADR-001 built the event this ADR must now transform, and explicitly declined to settle that question, placing "CloudEvent transformation" under its own Left Deferred section instead. This is the ADR that settles it — not ADR-001, whatever ADR-000's wording suggested. A reader following ADR-000's cross-reference to ADR-001 in search of this answer will not find it there.

The event is Arvo's only medium of inter-node interaction (ADR-000, *Event-Only Communication*), and CloudEvents is the standard Arvo has chosen to make that medium legible outside Arvo itself — to a router, a broker, a tracing bridge, a foreign system's boundary proxy, or a human task queue, none of which need to understand Arvo to understand a CloudEvent. That choice only pays off if the transformation is principled rather than incidental to whatever a given implementation finds convenient. An ad hoc mapping, chosen independently per implementation, defeats the reason a standard was chosen at all — each implementation would effectively be speaking its own wire format again, just with CloudEvents' names borrowed for the parts that happened to fit.

The mapping is not mechanical because the two field sets do not line up. Five of ArvoEvent's eighteen fields correspond directly to CloudEvents' own context attributes. The rest do not, and CloudEvents' extension attributes are narrower than JSON — an extension attribute's value must be one of a fixed set of scalar types (Boolean, Integer, String, Binary, URI, URI-reference, Timestamp). Most of ArvoEvent's remaining envelope fields fit a CloudEvents scalar type only once ADR-002 narrows their domain. `depth` is the one exception: it fits without any domain narrowing at all, because ADR-001 already makes it an unbounded non-negative integer, and an integer of any size has an exact decimal-string form. `baggage` does not fit natively regardless, because it is a map. Where a field lands is a real decision, and it has a real cost either way: an extension attribute is legible to CloudEvents-aware tooling without decoding event data, while anything folded into `data` is legible only to something that knows Arvo's convention for unpacking it.

## Decision

**Vocabulary.** A **CloudEvent**, in this document, is a value conforming to [CloudEvents 1.0.2](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md) specifically — pinned to that version, not to whatever CloudEvents says at any given time, the same discipline ADR-002 already applies to its own citations: a fixed set of context attributes (`id`, `source`, `specversion`, `type`, plus the optional `datacontenttype`, `dataschema`, `subject`, `time`), an **event data** payload carried in `data`, and any number of **extension attributes** — additional context attributes outside the core set, each typed as one of Boolean, Integer, String, Binary, URI, URI-reference, or Timestamp. CloudEvents reserves the core attribute names; an extension attribute MUST NOT reuse one.

**Transformability.** Every ArvoEvent MUST be transformable into a CloudEvent conforming to CloudEvents 1.0.2. This direction is total: a well-formed ArvoEvent always has a corresponding CloudEvent, and producing it cannot fail for structural reasons. ADR-002's narrowed field domains close most of the gap that would otherwise stand between the two; the remaining field, `depth`, needs no domain narrowing at all — ADR-001 already bounds it below by zero, and this ADR's canonical decimal-string encoding (see **Field Placement**) preserves any magnitude exactly. No ArvoEvent field is ever delegated to a CloudEvents implementation as an incompatible value and allowed to fail there.

**Losslessness.** For a CloudEvent produced from an ArvoEvent by this transformation and then reversed, the round trip MUST be lossless: ArvoEvent → CloudEvent → ArvoEvent yields an ArvoEvent identical, field for field, to the original. Every one of ArvoEvent's eighteen fields has a defined landing place under this ADR for exactly this reason — nothing is dropped, approximated, or reconstructed by inference. ArvoEvent itself never distinguishes negative zero from zero, per ADR-002's construction-time normalization; that is what allows this guarantee to hold rather than depending on where in the round trip the normalization happens.

**The reverse direction is partial.** Not every CloudEvent is a valid ArvoEvent. A CloudEvent produced by something other than Arvo may lack fields ArvoEvent requires, and this ADR treats that as the ordinary case rather than an error condition to special-case away. See **Deserialization**.

**Validation is delegated, not reimplemented.** Establishing that the assembled value conforms to the CloudEvents specification is the responsibility of a conformant CloudEvents implementation, not of a bespoke reimplementation of CloudEvents' validity rules in this package. ArvoEvent's structural validity, including ADR-002's narrowed domains, remains this package's responsibility.

## Field Placement

**Native attributes.** Five fields correspond directly to a CloudEvents context attribute of the same name and are carried there without transformation: `id`, `source`, `type`, `subject`, and `time`.

Reusing a CloudEvents attribute name does not mean every consumer knows Arvo's stronger semantics. CloudEvents leaves `type` producer-defined, while ADR-001 makes it an Arvo contract event name. CloudEvents treats `subject` as descriptive context within a source, while ADR-001 makes it a deliberately inert, fixed workflow key. These uses are compatible because CloudEvents permits the stricter meanings Arvo assigns, but a CloudEvents-native reader is entitled to assume only CloudEvents' weaker guarantees.

**Protocol-level constants.** `specversion` is fixed at `1.0` by the transformation itself; no ArvoEvent field carries it. This transformation defines no behavior for another CloudEvents version. `datacontenttype` is fixed at `application/vnd.arvo.event+json;version=1`. CloudEvents `dataschema` is fixed at `https://www.arvo.land/schemas/cloudevent-data/v1`, identifying the version-one wrapper defined below rather than the contract schema of the nested Arvo payload. `data_base64` is never used; the wrapper is always a JSON object.

**Established extension convention.** `traceparent` and `tracestate` are carried as CloudEvents extension attributes under those exact, unprefixed names, reusing the CloudEvents Distributed Tracing Extension rather than inventing an Arvo-specific alternative. A tracing bridge that already understands CloudEvents' own tracing convention understands these without knowing anything about Arvo.

**Arvo-defined extensions.** Eight fields have no CloudEvents-native home and no established extension convention to reuse: `parentid`, `initid`, `executionid`, `category`, `depth`, `to`, `domain`, `executionunits`. Each is carried as an extension attribute, namespaced with an `arvo` prefix — `arvoparentid`, `arvoinitid`, `arvoexecutionid`, `arvocategory`, `arvodepth`, `arvoto`, `arvodomain`, `arvoexecutionunits` — rather than bare. The prefix guards against collision with an attribute a foreign producer already uses under the bare name for something else, and matches the naming convention used inside the `data` wrapper below, so a reader sees one consistent namespace rather than two.

Six of these fields fit a CloudEvents scalar type directly, guaranteed by ADR-002. `depth` and `executionunits` still require canonical string encodings, because CloudEvents `Integer` is limited to a signed 32-bit range and CloudEvents defines no non-integer number type — ADR-002 narrows `executionunits` to finite binary64, but binary64 itself remains outside what any native CloudEvents numeric type holds.

`arvodepth` is a CloudEvents `String` containing the canonical unsigned-decimal representation of `depth`. The grammar is `0|[1-9][0-9]*`: no sign, leading zero, decimal point, or exponent is permitted. Deserialization parses it as an arbitrarily large non-negative integer before applying ADR-001's structural validation.

`arvoexecutionunits` is a CloudEvents `String` containing the number serialization defined by the [RFC 8785 JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785) for the finite IEEE 754 binary64 value ADR-002 guarantees. Deserialization parses it as binary64 and MUST reject the attribute unless serializing the parsed value again under RFC 8785 produces the identical string. This round-trip check rejects non-canonical spellings without requiring Arvo to invent a second number grammar. RFC 8785 serializes negative zero as `0`, consistent with ADR-002's normalization.

A nullable extension-mapped field — `parentid`, `initid`, `category`, `to`, `domain`, `executionunits`, and, from the established-convention group above, `traceparent` and `tracestate` — that is `null` on the ArvoEvent is omitted from the CloudEvent's extension attributes entirely — CloudEvents' extension type system has no `null` value, so absence is how null is represented. Absence on deserialization is read back as `null`, never as an error, consistent with ADR-001 already treating `null` and absent as equivalent for these fields.

**The `data` wrapper.** Three fields have no defined landing place above: `data`, `dataschema`, and `baggage`. `ArvoEvent.dataschema` describes `ArvoEvent.data`; it cannot occupy CloudEvents `dataschema` after that payload is wrapped because CloudEvents requires its own attribute to identify the schema of the complete CloudEvents `data` value. `baggage` is a flat map, and no CloudEvents extension type holds a map natively. All three values are therefore carried together inside the CloudEvent's `data` attribute as:

```json
{
  "arvoeventdata": {},
  "arvoeventdataschema": "#/services/example/1.0.0",
  "arvoeventbaggage": {}
}
```

The wrapper MUST be an object with exactly these three keys. `arvoeventdata` MUST be an object of JSON values, `arvoeventdataschema` MUST be a non-empty string, and `arvoeventbaggage` MUST be a flat map under ADR-001's definitions. The fixed CloudEvents `dataschema` URI identifies this wrapper shape; the nested `arvoeventdataschema` continues to identify the Arvo contract that applies specifically to `arvoeventdata`. A machine-readable representation of the wrapper schema SHOULD be developed alongside this ADR's implementation and published at `https://www.arvo.land/schemas/cloudevent-data/v1` before the feature is released.

`baggage` is carried as a nested object, not a JSON-encoded string. String-encoding a value that already lives inside `data` — itself already an arbitrary JSON container — adds a second encoding step for no benefit; nothing about `data`'s type constrains its values to scalars the way an extension attribute does.

No other field joins this wrapper. Placement here is reserved for the payload, the schema that qualifies that payload, and `baggage`'s structural incompatibility with the extension type system — not general convenience. See **Considered Alternatives** for the fields that were weighed against this and kept as extensions instead.

## Discriminating Arvo-shaped events

A CloudEvent produced by this transformation carries `datacontenttype: application/vnd.arvo.event+json;version=1` — a vendor media type with a structured syntax suffix — and `dataschema: https://www.arvo.land/schemas/cloudevent-data/v1`.

A CloudEvent is **Arvo-shaped** only when all of the following hold:

- `specversion` is `1.0`.
- Parsed `datacontenttype` has media type `application/vnd.arvo.event+json`, exactly one `version` parameter whose value is `1`, and no other parameters. Media type, subtype, and parameter-name comparison follows the case-insensitive rules for media types; the `version` value is case-sensitive.
- `dataschema` is exactly `https://www.arvo.land/schemas/cloudevent-data/v1`.
- The required Arvo-native attributes `subject` and `time` are present with their defined types.
- `data` satisfies the wrapper shape above.
- The required Arvo extensions `arvoexecutionid` and `arvodepth` are present with their defined types and encodings.
- Every other recognized Arvo or distributed-tracing extension that is present has the type and encoding this ADR assigns it.

These conditions discriminate a representation; they do not authenticate its producer. A value matching either the Arvo media type or the Arvo wrapper-schema URI but failing any other condition is a malformed Arvo-shaped event and MUST be rejected. It MUST NOT silently fall back to foreign-event handling. Whether an implementation exposes one function, multiple functions, or an explicit mode is transformation mechanism and remains deferred; every API shape MUST preserve this behavioral distinction.

## Mapping Table

| ArvoEvent field | CloudEvent placement |
|---|---|
| `id` | `id` |
| `source` | `source` |
| `type` | `type` |
| `subject` | `subject` |
| `time` | `time` |
| `traceparent` | extension `traceparent` (omitted when null) |
| `tracestate` | extension `tracestate` (omitted when null) |
| `parentid` | extension `arvoparentid` (omitted when null) |
| `initid` | extension `arvoinitid` (omitted when null) |
| `executionid` | extension `arvoexecutionid` |
| `category` | extension `arvocategory` (omitted when null) |
| `depth` | extension `arvodepth`, canonical unsigned-decimal `String` |
| `to` | extension `arvoto` (omitted when null) |
| `domain` | extension `arvodomain` (omitted when null) |
| `executionunits` | extension `arvoexecutionunits`, RFC 8785 binary64 `String` (omitted when null) |
| `data` | `data.arvoeventdata` |
| `dataschema` | `data.arvoeventdataschema` |
| `baggage` | `data.arvoeventbaggage` |
| — | `specversion` fixed at `1.0` |
| — | `datacontenttype` fixed at `application/vnd.arvo.event+json;version=1` |
| — | `dataschema` fixed at `https://www.arvo.land/schemas/cloudevent-data/v1` |

## Deserialization

CloudEvent → ArvoEvent is partial, not total. Deserialization has two behaviorally distinct cases without prescribing an API shape:

- **Strict Arvo-shaped deserialization** accepts only an event satisfying every discriminator above. It maps the five native attributes, decodes every Arvo extension, unwraps the three data members, restores omitted nullable extensions as `null`, and validates the assembled ArvoEvent. Caller-supplied values do not participate in this case: values carried by the Arvo-shaped CloudEvent are authoritative. A missing required extension, malformed canonical string, unexpected wrapper key, or other mismatch is an error rather than evidence that the event was foreign.
- **Foreign-event adaptation** accepts a CloudEvent that does not claim the Arvo media type or wrapper schema, plus caller-supplied Arvo values. It maps CloudEvents `id`, `source`, and `type`, and maps `subject`, `time`, and object-valued `data` when present. It maps the established `traceparent` and `tracestate` extensions when present. It does not interpret Arvo-prefixed extensions or the Arvo wrapper convention, and it does not reuse the foreign CloudEvent's `dataschema` as `ArvoEvent.dataschema`: that attribute describes the foreign payload schema, not the Arvo contract the boundary declares on the foreign producer's behalf.

Foreign-event adaptation MUST accept caller-supplied values alongside the CloudEvent for ArvoEvent fields that the mapping above does not provide. The caller MUST supply `dataschema`. It MUST also supply any other required field absent after native mapping and defaults, and MAY supply absent optional fields. A supplied value MUST NOT replace a value the foreign mapping provides: when both are present, the mapped CloudEvent value is used and the supplied fallback is ignored. In particular, present foreign `subject`, `time`, and object-valued `data` win over caller input. A present non-object `data` value cannot form an ArvoEvent and causes adaptation to fail rather than being silently discarded. The supplied values travel alongside the CloudEvent; the caller is not required to inspect, mutate, or augment the CloudEvent first.

Both cases MUST pass the assembled input through the same non-throwing structural-validation entry point ADR-001 defines for events arriving as data, including ADR-002's narrowed domains. Deserialization MUST NOT define a second ArvoEvent validity rule set.

## Consequences

**Gained.** A single, principled mapping means every conforming implementation of this ADR, in any language, produces and consumes attribute-equivalent CloudEvents — the interoperability ADR-000 asked for when it made CloudEvent transformability part of AAM 1. Fields a non-Arvo tool plausibly needs — routing hints, causation, lineage, tracing, accounting — stay reachable without decoding event data because they stay extension attributes. Losslessness for Arvo-native round trips means no adapter, replay tool, or cross-language bridge silently drops information by round-tripping through CloudEvents. A fixed wrapper schema makes CloudEvents `dataschema` truthful while preserving the Arvo contract identifier beside the payload it qualifies. Distinct strict and foreign reverse behaviors eliminate heuristic precedence and fallback behavior without prescribing an API shape.

**Paid for.** Every field's placement is now something a cross-language implementer must match exactly, including the `arvo` prefix, both canonical numeric strings, the fixed wrapper-schema URI, and the wrapper's exact key names. `baggage`'s placement inside `data` means a CloudEvents-only consumer sees an Arvo-specific wrapper rather than the business payload alone. The original Arvo contract schema is likewise no longer available as a core CloudEvents context attribute; Arvo-aware consumers find it at `data.arvoeventdataschema`. Foreign-event adaptation is only as trustworthy as the boundary supplying the missing Arvo context, and a foreign event with scalar or array data cannot be adapted directly because ADR-001 requires an object payload. This ADR's totality guarantee is inherited almost entirely from ADR-002's field-domain narrowing, `depth` being the one field that needed none; ADR-002's own Consequences records the breaking-change cost of what it does narrow, which this ADR does not repeat.

## Considered Alternatives

**`baggage` as a JSON-encoded string extension attribute** — considered, not chosen. It would have kept CloudEvents `data` identical in value to `ArvoEvent.data`, preserving direct payload transparency for a generic CloudEvents consumer, and losslessness holds either way. Rejected on two grounds. First, a deliberate preference for one mechanism carrying the business payload, its Arvo contract identifier, and baggage over separate payload and extension encodings. Second, CloudEvents already has an established path for an oversized `data` payload — the Dataref Extension, which lets a producer store the payload externally and carry a reference in its place — while there is no equivalent standard mechanism for externalizing one oversized extension attribute. Keeping the three related values together gives an oversized combined payload one future externalization story rather than two.

**`ArvoEvent.dataschema` mapped directly to CloudEvents `dataschema`** — considered, not chosen. Once the CloudEvents `data` attribute contains an Arvo wrapper, the Arvo contract schema describes only `data.arvoeventdata`, not the complete wrapper. CloudEvents defines its `dataschema` as identifying the schema the complete `data` value adheres to. Keeping the direct mapping would make the attribute semantically false, so CloudEvents `dataschema` identifies the wrapper and the original value moves beside the nested payload it actually qualifies.

**`executionunits` folded into the `data` wrapper alongside `baggage`** — considered, not chosen. `executionunits`' mismatch with CloudEvents' type system is a range-and-precision problem, not a structural one like `baggage`'s. An RFC 8785 `String` resolves it losslessly within the extension-attribute system. Moving it into `data` would hide an accounting field from tooling that should be able to read it without parsing the payload.

**Folding the remaining Arvo-specific fields into `data` more broadly** — considered, not chosen. `to` and `domain` are, by ADR-001's own description, hints supplied to infrastructure; an adapter routing on them should not have to parse a payload to find them. `parentid`, `initid`, `executionid`, `category`, and `depth` are the causation, correlation, and operational-visibility fields ADR-001 built expressly so they could be read without consulting a store or traversing a graph — burying them in `data` would defeat that purpose for exactly the tooling it exists to serve.

**Bare, unprefixed Arvo extension attribute names** — considered, not chosen. Shorter, but a foreign producer's unrelated extension under the same bare name would collide silently rather than being visibly distinguishable as Arvo's.

**`application/json;profile=<token>`** as the discriminator — considered, not chosen. `profile` is not an IANA-registered parameter for `application/json`; its nearest real precedent is JSON-LD, where its value is a dereferenceable URI rather than a bare token. A vendor tree with a structured syntax suffix is the established mechanism for exactly this purpose, and is what CloudEvents itself already uses for its own envelope.

**`datacontenttype` alone as authoritative for Arvo-shaped detection** — considered, not chosen. A foreign producer could set the media type without carrying the wrapper or required extensions. Detection therefore combines the media type, wrapper-schema URI, wrapper validity, and required extensions, and treats a partial claim as malformed rather than foreign.

**One undifferentiated reverse behavior** — considered, not chosen. Strict reversal and foreign adaptation have different data semantics, schema semantics, and caller-input rules. Collapsing those cases behind an underspecified heuristic makes precedence and malformed-event fallback implementation-dependent. This ADR therefore distinguishes their required behavior while leaving functions, modes, classes, and other API choices to implementation design.

## Conformance to ADR-000, ADR-001, and ADR-002

**Effect on AAM.** This ADR settles the question ADR-000 raised and attributed to "the ArvoEvent ADR" — whether ArvoEvent's CloudEvent transformation is lossless and bidirectional — which ADR-001 did not in fact settle. CloudEvent transformability remains an AAM 1 member as ADR-000 established it; this ADR defines what that membership requires in both directions, depending on ADR-002's field-domain narrowing — and, for `depth` alone, on ADR-001's own unbounded-integer definition instead — to make the forward direction total.

**Invariants depended on.** *Infrastructure Independence* — this ADR defines only the abstract CloudEvent, never a transport binding, so the mapping's meaning cannot vary by broker or adapter. *Explicit Contracts and Runtime Validation* — the Arvo contract identifier remains adjacent to the nested payload it qualifies, while CloudEvents `dataschema` truthfully identifies the complete wrapper. *Observability by Default* — causation, lineage, and tracing fields are placed as extension attributes specifically so they remain readable without decoding the payload.

**Invariants strained.** *Explicit Contracts and Runtime Validation* — narrowly, and accepted rather than resolved. ADR-001 made `data` directly consumable without Arvo-specific knowledge. A CloudEvents-only consumer now finds `arvoeventdata`, `arvoeventdataschema`, and `arvoeventbaggage`, and needs the wrapper convention to reach the business payload. This is a real cost, weighed against the alternatives above and accepted rather than designed away.

**Required of infrastructure adapters.** Carry a CloudEvent's context attributes, extension attributes, and `data` unchanged across a boundary hop. Do not synthesize, mutate, or drop an extension attribute in transit, and do not rewrite `datacontenttype` or `dataschema`.

**Left deferred.** Structured and binary content modes, canonical wire serialization, and CloudEvents protocol bindings. The transformation mechanism's implementation. Upgrading the target CloudEvents specification version beyond 1.0.2, which requires a superseding ADR. Any size limit on `baggage` — ADR-001 deferred this pending a canonical encoding to measure it against; that encoding is now settled, which unblocks the question without answering it. Should a limit be set, CloudEvents' Dataref Extension is the natural mechanism to consider because `data` now carries the business payload, its Arvo contract identifier, and baggage together; adopting Dataref is not decided here.
