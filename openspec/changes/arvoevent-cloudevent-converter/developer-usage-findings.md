# Developer usage findings

Written after building the change, by using `CloudEventConverter` the way an actual consumer would rather than through unit tests written against the spec. The scenarios: converting a freshly-built `ArvoEvent` and round-tripping it; adapting a plain, hand-parsed JSON object claiming to be a foreign CloudEvent (the realistic shape of "I got this from an HTTP body"); and appending a custom enrichment stage.

Each finding below is verified against the real, committed code, not theorized — a small script was actually run for each one.

## Finding 1 — The most natural first attempt at `revert` doesn't compile, and the error doesn't point anywhere useful

```ts
const incomingJson = {
  id: 'evt-123',
  source: 'https://partner.example.com',
  type: 'com.partner.order.shipped',
  specversion: '1.0',
  data: { orderId: 'abc' },
};
const converter = new CloudEventConverter();
await converter.revert(incomingJson); // <- what most people will write first
```

```
error TS2345: Argument of type '{ id: string; source: string; ... }' is not
assignable to parameter of type 'CloudEvent'.
  Type '{ ... }' is missing the following properties from type
  'CloudEvent<Record<string, unknown>>': toJSON, validate, emit, cloneWith
```

This is *the* entry point for the single most common real use case — you received a CloudEvent as JSON (from an HTTP body, a queue message, wherever) and want an `ArvoEvent`. The fix (`new CloudEvent(incomingJson, false)` first) is a real, deliberate, documented decision — `design.md`'s "`cloudevents`'s actual TypeScript surface" section explains exactly why `strict: false` is the escape hatch — but nothing at the point of failure says so. The error names four methods (`toJSON`, `validate`, `emit`, `cloneWith`) that mean nothing to the task the developer is doing; a first-time reader has no reason to connect "I'm missing these methods" to "construct a class instance first." Nobody hitting this compiles-but-wrong error will find the fix without either already knowing it or reading `design.md`, which nothing points them to.

**Worth fixing, cheaply.** `CloudEventConverter.tryRevert`/`revert`'s own TSDoc doesn't mention this at all right now. A single `@example` showing `new CloudEvent(plainObject, false)` for a plain-object input would close this for most readers — no code change needed, just the one thing the TSDoc was missing.

## Finding 2 — A missing `dataschema` fallback is reported twice, with different wording, for the same field

```ts
await converter.revert(someForeignCe); // no foreignFallback argument at all
```

```
Foreign CloudEvent could not be adapted into an ArvoEvent. (5 problems):
  - dataschema: is required as a caller-supplied fallback when adapting a foreign CloudEvent (received undefined)
  - subject: is required
  - executionid: is required
  - dataschema: is required
  - source: must be a valid RFC 3986 URI-reference (received "https://partner.example.com")
```

`dataschema` appears twice, with two different messages. The first is `decodeForeign`'s own explicit check (`!fallback?.dataschema`); the second is `ArvoEvent`'s own `requireNonEmptyString` check firing on the same, still-missing field once `assemble()` hands the candidate to `new ArvoEvent(...)`. Both statements are individually true, but a reader sees the same field flagged twice and reasonably wonders whether there are two distinct problems or whether the list itself is buggy — `subject` and `executionid`, missing for the identical reason, correctly appear only once each.

The asymmetry: `subject`/`executionid` have no mapping-level pre-check in `decodeForeign` the way `dataschema` does — they're just left `undefined` on the candidate and only `ArvoEvent`'s own validation catches them, so they naturally report once. `dataschema` is special-cased with its own early check (because ADR-003 calls it out specifically: never inherited from the foreign event's own `dataschema`), and that early check doesn't currently suppress the later, redundant one.

**Worth fixing.** In `decode/foreign.ts`, when `!fallback?.dataschema`, either skip setting `candidate.dataschema` to `undefined` and rely solely on `ArvoEvent`'s own message (losing the more specific "as a caller-supplied fallback" wording), or — better — keep the specific message but don't also let the generic one through, e.g. by tracking that `dataschema`'s issue was already reported and filtering `ArvoEventValidationError`'s own `dataschema`-path issue out of the aggregation in that one case. Small, contained fix; not attempted here since it wasn't asked for.

## Finding 3 — The single most likely real-world foreign-adaptation failure: a bare-origin `source`

```ts
await converter.revert(ce, { dataschema: 'unknown/0.0.0', subject: 's', data: {} });
// where ce.source === 'https://partner.example.com'  (no trailing path)
```

Fails: `source: must be a valid RFC 3986 URI-reference (received "https://partner.example.com")`. The identical event with `source: 'https://partner.example.com/'` (trailing slash added) succeeds.

Root cause, confirmed directly:

```ts
fastUri.serialize(fastUri.parse('https://partner.example.com'))
// => 'https://partner.example.com/'   (fast-uri adds the slash)
```

`ArvoEvent`'s own `source` rule (ADR-002) requires `serialize(parse(value)) === value` exactly, and `fast-uri` canonicalizes a bare origin by appending `/`. This is correct, pre-existing, already-decided `ArvoEvent` behavior — nothing about this change introduces it, and it's out of this change's scope to revisit ADR-002. But `source` is one of only two CloudEvent-native fields carried through unconditionally on foreign adaptation, and a bare-origin `source` is an extremely common real shape (GitHub's own webhook CloudEvents use `source: "https://github.com/..."` style paths, but plenty of producers use a bare domain — service meshes, some cloud providers' event buses). Anyone adapting real-world foreign CloudEvents will hit this, probably immediately, and the error alone gives no hint that the fix is "add a trailing slash" rather than "this source is somehow malformed."

**Not fixable here** — changing `source`'s canonicalization rule is ADR-002 territory, not this change's. Recorded because it's the single highest-probability real-world failure this converter's foreign-adaptation path will produce, and whoever next touches ADR-002 or writes consumer-facing docs for this converter should know it's the first thing a real integration will trip on.

## Finding 4 — A custom enrichment stage needs `new CloudEvent(..., false)` boilerplate even for a one-line change

```ts
const routingStage: ICloudEventConverter = {
  async convert(ce) {
    return new CloudEvent({ ...ce, routinghint: 'us-east' } as never, false);
  },
  async revert(ce) {
    const { routinghint, ...rest } = ce as never as Record<string, unknown>;
    return new CloudEvent(rest as never, false);
  },
};
```

Worked correctly once written, but every line needed a cast. `ICloudEventConverter.convert`/`revert` both return `Promise<CloudEvent>` — a real class instance — so even adding one extension attribute means spreading the old instance into a plain object (which doesn't satisfy `CloudEvent`'s own constructor parameter type cleanly, since spreading a class instance picks up only its own enumerable properties, not its methods) and re-wrapping. There's no lighter-weight "just the extensions" helper; the interface's honesty about "a stage produces a real CloudEvent" is correct (matches the same conformance-delegation reasoning `design.md` already gives for the base mapping), but it makes the common "append one attribute" case noticeably more boilerplate-heavy than the mental model ("add a field") suggests.

**Accepted, not a defect.** This is the direct, correct consequence of `ICloudEventConverter`'s contract, not a bug — a looser return type would reopen exactly the conformance-delegation question `design.md` already settled for the base stage. Worth a TSDoc `@example` on `ICloudEventConverter` showing the `new CloudEvent({ ...ce, ... }, false)` pattern, so at least the shape of the boilerplate is discoverable without deriving it.

## Finding 5 — `revert`/`tryRevert` never return a narrower `ArvoEvent<T, D>` than the default

```ts
const event: ArvoEvent = await converter.revert(ce); // always ArvoEvent<string, Record<string, any>>
```

`CloudEventConverter` isn't generic over `ArvoEvent`'s own `T`/`D` type parameters anywhere — `convert` accepts the default-typed `ArvoEvent`, and `revert`/`tryRevert` always return it too, regardless of what a caller might already know about which contract a given CloudEvent belongs to. This is the correct behavior — the converter has no compile-time way to know a foreign CloudEvent's contract until it inspects `type`/`dataschema` at runtime — but it's worth being explicit that no narrowing is available "for free" from this API, unlike constructing an `ArvoEvent<'order.created', OrderPayload>` directly. A caller wanting a typed result narrows it themselves afterward (a discriminated switch on `event.type`, or handing it to an `ArvoContract`), which is standard practice but easy to expect the converter to do for you the first time.

**Accepted, no action.** Correctly out of scope — narrowing by contract belongs to `ArvoContract`, not this transformation.

## What worked without friction

- The basic round trip — `new CloudEventConverter().convert(event)` then `.revert(ce)` — produced a field-for-field-equal event with zero surprises on the first try, no documentation needed.
- `tryConvert`/`tryRevert`'s `Result` narrowing (`if (result.ok) ... else result.error.detail.kind`) read naturally and TypeScript narrowed `detail` correctly at every branch tried, including the three-way `'strict' | 'foreign' | 'stage'` switch.
- Supplying a custom `transformer` (replacing the base mapping entirely) worked exactly as documented on the first attempt, no trial and error.
- Every error message but the duplicate in Finding 2 was legible on its own — no need to open the source to understand what was wrong, including the `RFC 3986 URI-reference` message in Finding 3 (the *cause* was non-obvious, but the message itself was accurate and specific).
