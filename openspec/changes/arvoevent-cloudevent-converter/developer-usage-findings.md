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

This isn't unique to `dataschema` in the foreign path — a missing `subject` in the *strict* path duplicates identically, for the same reason, and existing test coverage didn't catch it (it asserted `.some(path === 'subject')`, which a duplicate still satisfies). It's specifically the fields with **both** an explicit decode-level required-check **and** no `ArvoEvent`-level default (`subject`, `dataschema`) that collide; `arvoexecutionid`→`executionid` doesn't, because `ArvoEvent` defaults a missing `executionid` to `subject`, which happens to mask the duplicate rather than avoid the underlying pattern.

Two tempting "real" fixes turn out to be wrong on inspection, not just more work than they're worth:

- **Delete the decode-level presence checks, let `ArvoEvent` catch it alone** — wrong, not just risky. ADR-003 lists `subject`/`time`/`arvoexecutionid`/`arvodepth` presence as **discriminator conditions**, not incidental redundancy. Deleting `arvoexecutionid`'s check specifically would let `ArvoEvent`'s own `executionid ?? subject` default silently paper over a missing extension ADR-003 requires to be a hard rejection.
- **Have decode-level checks own these fields and stop handing the full candidate to `new ArvoEvent(...)`** — collides directly with ADR-003's own text, *"Deserialization MUST NOT define a second ArvoEvent validity rule set."* Reusing `new ArvoEvent(candidate)` wholesale is exactly what satisfies that requirement.

The fix that's actually correct — deduplicating the merged issues list by `path` in `assemble()`, keeping the decode-level issue and dropping `ArvoEvent`'s redundant one — is real and architecturally justified (`ArvoEvent`'s own validator already guarantees one issue per path internally via guard clauses; this restores that invariant across the boundary rather than inventing a new one). But it's a genuine half-day: a full collision audit across both strict and foreign paths, dedicated tests instead of loose `.some()` assertions, and re-verification of every existing "rejects a missing/wrong-typed X" test.

**Accepted, deferred.** Nothing here is a functional bug — the transformation still correctly fails for the correct reason either way; this is diagnostic-quality only, and no consumer or release depends on it right now. Weighed against the effort, and against Finding 3 actually blocking real-world use with no fix available in this change's scope at all, this isn't worth doing today. Revisit if `.issues` output quality is ever reported as an actual problem, or opportunistically alongside other `decode/` work.

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

**Attempted a scoped fix, reverted it, documented instead.** Tried canonicalizing `source`/`dataschema` via `fastUri.serialize(fastUri.parse(value))` in the reverse path only, before handing the candidate to `ArvoEvent` — reasoning that `revert` is already documented as best-effort for anything but this converter's own round trip, so a cosmetic difference (added trailing slash, case-folded scheme) is an acceptable trade-off for accepting a real-world value. It backfired: `ArvoEvent`'s own rule uses `serialize(parse(value)) === value` specifically to *detect* malformed input, exploiting the fact that `fast-uri` is lenient and percent-encodes garbage into "valid" nonsense rather than rejecting it (`'not a uri at all !!'` → `'not%20a%20uri%20at%20all%20%21%21'`, a different but "valid" URI). Feeding the validator an already-canonicalized value makes that check tautological — it neutered rejection of genuinely malformed `source`/`dataschema` entirely, not just the bare-origin case. A narrower fix (canonicalize only when `fastUri.parse(value).reference === 'absolute'`, since every case observed where that's true is a legitimate cosmetic difference, and every case where a `'relative'`-parsed value changes is fast-uri mangling non-URI text) looked promising on the cases tried, but wasn't pursued further — the risk of a URI-shaped-but-still-wrong edge case slipping through unnoticed wasn't worth it for what remains a diagnostic-quality problem, not a functional one.

**Accepted, documented instead.** `CloudEventConverter.tryRevert`/`revert`'s own TSDoc now states the canonical-form requirement explicitly, so a consumer hitting this at least gets pointed at the actual cause (and the fix — canonicalize before calling) without needing to find this document. Changing `source`'s canonicalization rule itself remains ADR-002 territory, not this change's, and is still the single highest-probability real-world failure this converter's foreign-adaptation path will produce.

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

**Resolved.** `tryRevert`/`revert` now take explicit `<T extends string = string, D extends Record<string, any> = Record<string, any>>` type parameters, exactly like `ArvoEvent.parse`/`ArvoEvent.tryParse` already do — a caller who already knows the expected shape asserts it at the call site (`converter.revert<'order.created', OrderPayload>(ce, fallback)`), and gets `ArvoEvent<'order.created', OrderPayload>` back. This is a compile-time-only assertion, not a runtime check — the type parameters have no effect on what `assemble()` actually validates or constructs, and a caller asserting the wrong `T`/`D` gets a wrongly-typed but still structurally-valid `ArvoEvent`, same as `ArvoEvent.parse<T, D>()` itself already allows. Real, contract-backed narrowing (validating that `data` actually matches `D`, not just asserting it) is still `ArvoContract`'s job, applied after `revert` returns — this only removes the friction of the *default* being unnarrowable even when the caller already knows better. Not a bug in the finding's original framing, but a real ergonomics gap that had a cheap, precedented fix once looked at directly.

## Finding 6 — Every prior round-trip test, including in this document, never actually went over the wire

```ts
const ce = await converter.convert(event);
const wireBody = JSON.stringify(ce);          // what actually crosses a network
const reconstructed = new CloudEvent(JSON.parse(wireBody), false);
const back = await converter.revert(reconstructed);
back.time !== event.time   // true, until this finding's fix
```

Every "round-trip losslessness" test in `default.spec.ts` — and every scenario in this document's earlier passes — calls `converter.revert(await converter.convert(event))` directly on the in-memory `CloudEvent` object. None of them ever call `JSON.stringify()` on it. That matters because `cloudevents`' own `CloudEvent.prototype.toJSON()` — which `JSON.stringify` invokes automatically, no way around it as a normal consumer — does `event.time = new Date(this.time).toISOString()`. `Date.prototype.toISOString()` always converts to UTC and always emits a `Z` suffix, never the original offset; for a non-UTC `time` the visible clock digits change too, not just the suffix notation, even though the underlying instant is identical. `ArvoEvent`'s own `time` validation accepts both forms, so nothing rejects it — the value just silently comes back different. `createTimestamp()` (this package's own default `time` generator) produced `+00:00`-style output, never bare `Z`, so *every* `ArvoEvent` built without an explicit `time` hit this the first time it was actually transmitted — which is the only reason to produce a CloudEvent at all. A 100%-coverage, all-green test suite gave no signal, because it never exercised the one code path (`toJSON()`) where the bug lives.

Four options were weighed (a serialization helper bypassing `toJSON()`; document-only; carry the exact string in a new Arvo extension, which would be the only complete fix but requires an ADR-003 amendment and is out of this change's scope to decide alone; redefine "lossless" as instant-equality). Went with none of them directly — instead fixed the actual root cause for the dominant case: `createTimestamp()` computed `Z` internally and then explicitly *replaced* it with `+00:00` notation before returning. Removing that replacement (and the `offsetHours` parameter entirely — unused anywhere except its own tests; not exported from `src/index.ts`; its only real call site, `validator.ts`, always calls it with zero arguments) means the auto-generated default is already in the exact canonical form `toJSON()` normalizes toward, so the round trip is a no-op for it.

**Resolved for the default path; documented as a residual gap for the explicit path.** Verified directly: a fully populated event, a minimal event, `-0` executionunits, a foreign adaptation, a double round trip, and generic-narrowed `revert<T, D>` all now survive the *real* `JSON.stringify`/`JSON.parse` wire path, not just the in-memory shortcut. An `ArvoEvent` constructed with an explicit non-UTC `time` (still valid, still allowed) is unaffected by this fix and still mismatches after a real wire round trip — verified as still-reproducing, not silently fixed — exactly as `tryRevert`/`revert`'s TSDoc already documents.

**Real gap this surfaced, not yet closed:** none of the scenarios verified for this finding are in the permanent test suite — they were one-off scripts, same as this document's own examples always have been. `default.spec.ts`'s round-trip tests should gain a `JSON.stringify`/`JSON.parse` variant alongside the existing in-memory one, or this exact class of bug (something that only manifests through real serialization) has no test-suite tripwire and could regress silently.

## What worked without friction

- The basic round trip — `new CloudEventConverter().convert(event)` then `.revert(ce)` — produced a field-for-field-equal event with zero surprises on the first try, no documentation needed.
- `tryConvert`/`tryRevert`'s `Result` narrowing (`if (result.ok) ... else result.error.detail.kind`) read naturally and TypeScript narrowed `detail` correctly at every branch tried, including the three-way `'strict' | 'foreign' | 'stage'` switch.
- Supplying a custom `transformer` (replacing the base mapping entirely) worked exactly as documented on the first attempt, no trial and error.
- Every error message but the duplicate in Finding 2 was legible on its own — no need to open the source to understand what was wrong, including the `RFC 3986 URI-reference` message in Finding 3 (the *cause* was non-obvious, but the message itself was accurate and specific).
