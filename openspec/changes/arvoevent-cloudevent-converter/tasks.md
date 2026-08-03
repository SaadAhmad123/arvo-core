## 1. Dependency and shared types

- [ ] 1.1 Add `cloudevents` to `package.json` as a peer dependency (and a dev dependency for this package's own tests/build), per `design.md`. Before writing any code against it, verify its actual TypeScript exports and runtime behavior directly (parsing, constructing, validating a CloudEvent) rather than assuming from its README — resolves `design.md`'s Open Questions about which validation entry point to call and what type to build on
- [ ] 1.2 `src/cloudevent/interface.ts` — define `IConverter<I, O>` with both `convert(data: I): Promise<O>` and `revert(data: O): Promise<I>` mandatory, per `design.md`
- [ ] 1.3 `src/cloudevent/types.ts` — define the `CloudEvent` type used throughout this module (informed by 1.1's findings), `ForeignCloudEventFallback` (requires `dataschema`; other ArvoEvent fields optional), and `CloudEventTransformationKind = 'strict' | 'foreign'`

## 2. Forward mapping (default converter)

- [ ] 2.1 `src/cloudevent/default.ts` — native attribute placement: `id`, `source`, `type`, `subject`, `time` carried unchanged onto the CloudEvent's context attributes of the same name
- [ ] 2.2 Protocol-level constants: `specversion` fixed `1.0`, `datacontenttype` fixed `application/vnd.arvo.event+json;version=1`, `dataschema` fixed `https://www.arvo.land/schemas/cloudevent-data/v1`; `data_base64` never used
- [ ] 2.3 Established tracing extension placement: `traceparent`/`tracestate` carried as CloudEvents extensions under those exact names, omitted when null
- [ ] 2.4 Arvo-defined scalar extension placement: `parentid`→`arvoparentid`, `initid`→`arvoinitid`, `executionid`→`arvoexecutionid`, `category`→`arvocategory`, `to`→`arvoto`, `domain`→`arvodomain`, each omitted from the CloudEvent when the ArvoEvent value is null (except `executionid`, which is never null)
- [ ] 2.5 `arvodepth` canonical unsigned-decimal encoding of `depth`, matching `0|[1-9][0-9]*` exactly
- [ ] 2.6 `arvoexecutionunits` canonical RFC 8785 numeric string encoding of non-null `executionunits`, omitted when null
- [ ] 2.7 The `data` wrapper: `data.arvoeventdata` (= `ArvoEvent.data`), `data.arvoeventdataschema` (= `ArvoEvent.dataschema`), `data.arvoeventbaggage` (= `ArvoEvent.baggage`), and no other key
- [ ] 2.8 Wire 2.1–2.7 into `convert(data: ArvoEvent): Promise<CloudEvent>`; delegate final CloudEvents-conformance validation of the assembled value to the `cloudevents` package rather than reimplementing it, per ADR-003's delegation requirement

## 3. Reverse mapping — discriminator

- [ ] 3.1 Implement the three-way discrimination `default.ts` uses internally before choosing strict vs. foreign handling: neither `datacontenttype` matching the Arvo media type nor `dataschema` matching the Arvo wrapper-schema URI ⇒ foreign; either marker present ⇒ attempt strict, and any other condition failing is a rejection that must not fall back to foreign
- [ ] 3.2 Implement each strict-path condition check individually: `specversion` equals `1.0`; `datacontenttype` parses to media type `application/vnd.arvo.event+json` with exactly one `version` parameter equal to `1` and no others (media type/subtype/param-name comparison case-insensitive, `version` value case-sensitive); `dataschema` equals the wrapper URI exactly; `subject` and `time` present with correct types; the data wrapper has exactly its three correctly-typed keys; `arvoexecutionid` present; `arvodepth` present and matching its grammar; every other recognized extension present has its assigned type/encoding

## 4. Reverse mapping — strict path

- [ ] 4.1 On a CloudEvent discriminated as strict, decode the five native attributes, every present Arvo and tracing extension, and unwrap the three data-wrapper members; restore an omitted nullable extension as `null`
- [ ] 4.2 Assemble the candidate and pass it through the existing, unmodified `validateArvoEvent` — no second ArvoEvent validity rule set
- [ ] 4.3 Aggregate any mapping-level issues found during 3.2/4.1 together with any structural issues from 4.2 into one flat `ArvoEventValidationIssue[]`, reporting all of them rather than only the first

## 5. Reverse mapping — foreign path

- [ ] 5.1 On a CloudEvent discriminated as foreign, map `id`, `source`, `type` unconditionally; map `subject`, `time`, and object-valued `data` when present
- [ ] 5.2 Map `traceparent`/`tracestate` extensions when present; do not interpret any `arvo`-prefixed extension or the data-wrapper convention
- [ ] 5.3 Accept `ForeignCloudEventFallback`; require `dataschema` from it (never inherited from the foreign CloudEvent's own `dataschema`); apply other supplied fallback values only for fields the foreign mapping does not itself provide — a present foreign value always wins
- [ ] 5.4 Fail explicitly, rather than silently discarding the value, when foreign `data` is present and not an object
- [ ] 5.5 Assemble the candidate and pass it through `validateArvoEvent`, same as the strict path

## 6. Errors

- [ ] 6.1 `src/cloudevent/errors.ts` — `CloudEventTransformationError extends Error`, carrying `kind: CloudEventTransformationKind` and `issues: readonly ArvoEventValidationIssue[]` (imported from `ArvoEvent/errors.ts`, not redefined), matching the message-formatting depth of `ArvoEvent/errors.ts`
- [ ] 6.2 Confirm every failure path in `default.ts`'s reverse mapping (tasks 3–5) reports through `ArvoEventValidationIssue`'s existing shape — no parallel issue type introduced anywhere in this module

## 7. `CloudEventConverter` and extensibility

- [ ] 7.1 `src/cloudevent/index.ts` — `CloudEventConverter` class; a no-argument constructor wires in the single default converter from `default.ts` as the only stage
- [ ] 7.2 Constructor overload/parameter accepting a caller-supplied converter list `[IConverter<ArvoEvent, CloudEvent>, ...IConverter<CloudEvent, CloudEvent>[]]`
- [ ] 7.3 `convert(data: ArvoEvent): Promise<CloudEvent>` applies every stage forward, in order
- [ ] 7.4 `revert(data: CloudEvent, foreignFallback?: ForeignCloudEventFallback): Promise<ArvoEventParseResult>` unwinds any consumer-appended stages in reverse order, then runs the base mapping's own revert; never throws
- [ ] 7.5 A throwing convenience counterpart (e.g. `revertOrThrow`) that throws `CloudEventTransformationError` on failure, mirroring `ArvoEvent`'s constructor-throws/`safeParse`-returns-result duality

## 8. Public exports

- [ ] 8.1 `src/index.ts` — export `CloudEventConverter`, `IConverter`, `ForeignCloudEventFallback`, `CloudEventTransformationKind`, `CloudEventTransformationError`, and the `CloudEvent` type

## 9. Tests — forward mapping correctness

- [ ] 9.1 `tests/cloudevent/default.spec.ts` — one test per mapping-table row: native attributes, protocol constants, tracing extension (present and null-omitted), each Arvo-defined scalar extension (present and null-omitted, tested individually — not a representative sample), `arvodepth` across multiple magnitudes including `0`, `arvoexecutionunits` across multiple values including negative, fractional, and a large finite magnitude, and the data wrapper's exact three keys
- [ ] 9.2 Round-trip losslessness: construct ArvoEvents spanning both extremes of every optional field (all-null, all-populated) and `executionunits` supplied as `-0`; convert then revert; assert field-for-field identity with the original

## 10. Tests — discriminator and strict reversal

- [ ] 10.1 One test per discriminator condition failing individually: wrong `specversion`; each `datacontenttype` failure mode (wrong media type, missing `version` param, wrong `version` value, extra params, case mismatches); wrong `dataschema`; missing `subject`; missing `time`; each wrapper violation (missing key, extra key, each of the three keys wrong-typed); missing `arvoexecutionid`; each `arvodepth` grammar violation (sign, leading zero, decimal point, exponent); each optional extension present-but-wrong-typed, and `arvoexecutionunits` failing its RFC 8785 round-trip check
- [ ] 10.2 A fully-conforming CloudEvent is recognized as strict and reverses successfully
- [ ] 10.3 A partial-marker-match (only `datacontenttype` or only `dataschema` claims Arvo shape, another condition fails) is rejected as malformed, with an explicit assertion that this outcome is distinguishable from attempting foreign adaptation
- [ ] 10.4 A CloudEvent passing every discriminator condition but whose assembled candidate violates an existing ArvoEvent structural rule (e.g. ADR-001's Root Event Constraint, or ADR-002's canonical-form requirement on `source`) fails at the shared-validation step
- [ ] 10.5 `revert` never throws for any case in 10.1–10.4 — every one reports through the returned result

## 11. Tests — foreign adaptation

- [ ] 11.1 `id`/`source`/`type` mapped unconditionally
- [ ] 11.2 `subject`/`time`/object-valued `data` mapped when present, and absent (falling through to caller fallback or ArvoEvent defaults) when not
- [ ] 11.3 A present foreign `subject`, `time`, and `data` each individually win over a caller-supplied fallback for the same field
- [ ] 11.4 `traceparent`/`tracestate` mapped when present
- [ ] 11.5 Missing caller-supplied `dataschema` fails adaptation, naming `dataschema`
- [ ] 11.6 Foreign `data` present but not an object fails adaptation explicitly, naming `data`
- [ ] 11.7 A foreign CloudEvent's `arvo`-prefixed attributes, if any happen to be present without either Arvo marker, are never interpreted as Arvo extensions
- [ ] 11.8 The assembled candidate still runs through `validateArvoEvent`

## 12. Tests — `CloudEventConverter` extensibility

- [ ] 12.1 The no-argument constructor's behavior is identical to calling the default converter from `default.ts` directly
- [ ] 12.2 A custom converter list appends a CloudEvent-to-CloudEvent stage correctly on `convert`
- [ ] 12.3 `revert` unwinds a custom appended stage in reverse order before the base `revert` runs
- [ ] 12.4 `IConverter`'s mandatory pair is enforced at the type level — a stage object missing either `convert` or `revert` fails to type-check (a compile-time check, e.g. a `// @ts-expect-error` fixture, not a runtime test)

## 13. Close out

- [ ] 13.1 `pnpm lint` clean
- [ ] 13.2 `pnpm test` — full suite green apart from any pre-existing, separately-tracked failures already documented by prior changes (confirm the failure set is identical before and after this change's edits)
- [ ] 13.3 `pnpm exec openspec validate arvoevent-cloudevent-converter --strict` passes
- [ ] 13.4 Decide whether a changeset is needed, following the same reasoning already applied to the ADR-002 change (no changeset while `v4` is not being released imminently), and record the decision
