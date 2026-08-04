## 1. Dependency and shared types

- [x] 1.1 Add `cloudevents` to `package.json` as a peer dependency (and a dev dependency for this package's own tests/build), pinned per `design.md`'s verified v10.0.0 findings. If the installed version differs materially, re-verify its exports and constructor/`.validate()` throwing behavior directly before relying on `design.md`'s findings as-is
- [x] 1.2 `src/cloudevent/interface.ts` — define `ICloudEventConverter` (not generic — only ever a CloudEvent-to-CloudEvent enrichment stage) with both `convert(data: CloudEvent): Promise<CloudEvent>` and `revert(data: CloudEvent): Promise<CloudEvent>` mandatory, per `design.md`; and, alongside it in the same file, `IArvoEventTransformer` (the base stage's own contract: `convert(data: ArvoEvent): Promise<CloudEvent>`, `revert(data: CloudEvent, foreignFallback?: ForeignCloudEventFallback): Promise<ArvoEvent>` — a real second parameter on `revert`, not a cast, per `design.md`'s reasoning for why this isn't a generic `ICloudEventConverter` instantiation)
- [x] 1.3 `src/cloudevent/types.ts` — re-export `cloudevents`' own `CloudEvent` class and `CloudEventV1` interface directly (no hand-written structural interface, per `design.md`'s verified findings); define `ForeignCloudEventFallback` (requires `dataschema`; other ArvoEvent fields optional) and `CloudEventTransformationKind = 'strict' | 'foreign' | 'stage'`

## 2. Forward mapping (default converter)

- [x] 2.1 `src/cloudevent/default/` — native attribute placement: `id`, `source`, `type`, `subject`, `time` carried unchanged onto the CloudEvent's context attributes of the same name
- [x] 2.2 Protocol-level constants: `specversion` fixed `1.0`, `datacontenttype` fixed `application/vnd.arvo.event+json;version=1`, `dataschema` fixed `https://www.arvo.land/schemas/cloudevent-data/v1`; `data_base64` never used
- [x] 2.3 Established tracing extension placement: `traceparent`/`tracestate` carried as CloudEvents extensions under those exact names, omitted when null
- [x] 2.4 Arvo-defined scalar extension placement: `parentid`→`arvoparentid`, `initid`→`arvoinitid`, `executionid`→`arvoexecutionid`, `category`→`arvocategory`, `to`→`arvoto`, `domain`→`arvodomain`, each omitted from the CloudEvent when the ArvoEvent value is null (except `executionid`, which is never null)
- [x] 2.5 `arvodepth` canonical unsigned-decimal encoding of `depth`, matching `0|[1-9][0-9]*` exactly
- [x] 2.6 `arvoexecutionunits` canonical RFC 8785 numeric string encoding of non-null `executionunits`, omitted when null
- [x] 2.7 The `data` wrapper: `data.arvoeventdata` (= `ArvoEvent.data`), `data.arvoeventdataschema` (= `ArvoEvent.dataschema`), `data.arvoeventbaggage` (= `ArvoEvent.baggage`), and no other key
- [x] 2.8 Wire 2.1–2.7 into `convert(data: ArvoEvent): Promise<CloudEvent>`; delegate final CloudEvents-conformance validation of the assembled value to the `cloudevents` package rather than reimplementing it, per ADR-003's delegation requirement

## 3. Reverse mapping — discriminator

- [x] 3.1 Implement the three-way discrimination `src/cloudevent/default/decode/` uses internally before choosing strict vs. foreign handling: neither `datacontenttype` matching the Arvo media type nor `dataschema` matching the Arvo wrapper-schema URI ⇒ foreign; either marker present ⇒ attempt strict, and any other condition failing is a rejection that must not fall back to foreign
- [x] 3.2 Implement each strict-path condition check individually: `specversion` equals `1.0`; `datacontenttype` parses to media type `application/vnd.arvo.event+json` with exactly one `version` parameter equal to `1` and no others (media type/subtype/param-name comparison case-insensitive, `version` value case-sensitive); `dataschema` equals the wrapper URI exactly; `subject` and `time` present with correct types; the data wrapper has exactly its three correctly-typed keys; `arvoexecutionid` present; `arvodepth` present and matching its grammar; every other recognized extension present has its assigned type/encoding

## 4. Reverse mapping — strict path

- [x] 4.1 On a CloudEvent discriminated as strict, decode the five native attributes, every present Arvo and tracing extension, and unwrap the three data-wrapper members; restore an omitted nullable extension as `null`
- [x] 4.2 Assemble the candidate and pass it through the existing, unmodified `validateArvoEvent` — no second ArvoEvent validity rule set
- [x] 4.3 Aggregate any mapping-level issues found during 3.2/4.1 together with any structural issues from 4.2 into one flat `ArvoEventValidationIssue[]`, reporting all of them rather than only the first

## 5. Reverse mapping — foreign path

- [x] 5.1 On a CloudEvent discriminated as foreign, map `id`, `source`, `type` unconditionally; map `subject`, `time`, and object-valued `data` when present
- [x] 5.2 Map `traceparent`/`tracestate` extensions when present; do not interpret any `arvo`-prefixed extension or the data-wrapper convention
- [x] 5.3 Accept `ForeignCloudEventFallback`; require `dataschema` from it (never inherited from the foreign CloudEvent's own `dataschema`); apply other supplied fallback values only for fields the foreign mapping does not itself provide — a present foreign value always wins
- [x] 5.4 Fail explicitly, rather than silently discarding the value, when foreign `data` is present and not an object
- [x] 5.5 Assemble the candidate and pass it through `validateArvoEvent`, same as the strict path

## 6. Errors

- [x] 6.1 `src/cloudevent/errors.ts` — `CloudEventTransformationError extends Error`, a single class carrying a `detail: CloudEventTransformationErrorDetail` field, itself a real discriminated union (not flattened onto the class as optional properties, which would lose TypeScript narrowing): `{ kind: 'strict' | 'foreign'; issues: readonly ArvoEventValidationIssue[] }` (issues imported from `ArvoEvent/errors.ts`, not redefined) for the base mapping's own structural rejections, or `{ kind: 'stage'; direction: 'convert' | 'revert'; stageIndex: number; cause: unknown }` for a pipeline stage's own thrown failure; matching the message-formatting depth of `ArvoEvent/errors.ts`
- [x] 6.2 Confirm every failure path in `src/cloudevent/default/decode/`'s reverse mapping (tasks 3–5) reports through `ArvoEventValidationIssue`'s existing shape under the `'strict'`/`'foreign'` kinds — no parallel issue type introduced anywhere in this module
- [x] 6.3 Confirm `tryConvert`/`tryRevert` catch every stage's thrown value unconditionally (not filtered by type, unlike `ArvoEvent.tryParse`'s narrow re-throw rule) and preserve it verbatim as `cause` on the `'stage'` failure, per `design.md`'s Errors section

## 7. `CloudEventConverter` and extensibility

- [x] 7.1 `src/cloudevent/index.ts` — `CloudEventConverter` class; a no-argument constructor wires in `ArvoToCloudEventConverter` (from `src/cloudevent/default/`) as `transformer`, with an empty `converters` list
- [x] 7.2 Constructor parameters `(transformer?: IArvoEventTransformer, converters?: ICloudEventConverter[])` — two separate parameters, not one tuple, since the base stage and an appended enrichment stage are genuinely different contracts (see `design.md`'s "Revised from an earlier version" note on why a single generic `IConverter<I, O>` couldn't safely carry `foreignFallback` to a substituted base stage)
- [x] 7.3 `tryConvert(data: ArvoEvent): AsyncResult<CloudEvent, CloudEventTransformationError>` applies every stage forward, in order, starting with the base mapping's own `convert`; stops at the first stage that throws and reports it as a `kind: 'stage'` failure carrying that stage's index and `cause`; never throws itself — the primitive, per `project.md`'s `tryX`/`X` convention
- [x] 7.4 `convert(data: ArvoEvent): Promise<CloudEvent>` — a throwing convenience with no logic of its own beyond unwrapping `tryConvert`, throwing `CloudEventTransformationError` on failure, mirroring `ArvoEvent.parse`'s relationship to `ArvoEvent.tryParse` exactly
- [x] 7.5 `tryRevert(data: CloudEvent, foreignFallback?: ForeignCloudEventFallback): AsyncResult<ArvoEvent, CloudEventTransformationError>` unwinds any consumer-appended stages in reverse order, then runs the base mapping's own `revert`; stops at the first stage that throws and reports it as a `kind: 'stage'` failure carrying that stage's index and `cause`, distinct from the base mapping's own `kind: 'strict' | 'foreign'` structural failure; never throws itself — the primitive, per `project.md`'s `tryX`/`X` convention
- [x] 7.6 `revert(data: CloudEvent, foreignFallback?: ForeignCloudEventFallback): Promise<ArvoEvent>` — a throwing convenience with no logic of its own beyond unwrapping `tryRevert`, throwing `CloudEventTransformationError` on failure, mirroring `ArvoEvent.parse`'s relationship to `ArvoEvent.tryParse` exactly
- [x] 7.7 `tryConvert` and `tryRevert`'s stage-running logic built with `neverthrow`'s `ResultAsync.fromPromise` per stage, chained with `.andThen(...)` for fail-fast short-circuiting — not a hand-rolled loop with manual try/catch — converted to arvo-core's plain `AsyncResult` only at the return boundary via `fromNeverthrowAsync` from `src/result.ts`

## 8. Public exports

- [x] 8.1 `src/index.ts` — export `CloudEventConverter`, `ICloudEventConverter`, `IArvoEventTransformer`, `ForeignCloudEventFallback`, `CloudEventTransformationKind`, `CloudEventTransformationError`, and the `CloudEvent` type

## 9. Tests — forward mapping correctness

- [x] 9.1 `tests/cloudevent/default.spec.ts` — one test per mapping-table row: native attributes, protocol constants, tracing extension (present and null-omitted), each Arvo-defined scalar extension (present and null-omitted, tested individually — not a representative sample), `arvodepth` across multiple magnitudes including `0`, `arvoexecutionunits` across multiple values including negative, fractional, and a large finite magnitude, and the data wrapper's exact three keys
- [x] 9.2 Round-trip losslessness: construct ArvoEvents spanning both extremes of every optional field (all-null, all-populated) and `executionunits` supplied as `-0`; convert then revert; assert field-for-field identity with the original

## 10. Tests — discriminator and strict reversal

- [x] 10.1 One test per discriminator condition failing individually: wrong `specversion`; each `datacontenttype` failure mode (wrong media type, missing `version` param, wrong `version` value, extra params, case mismatches); wrong `dataschema`; missing `subject`; missing `time`; each wrapper violation (missing key, extra key, each of the three keys wrong-typed); missing `arvoexecutionid`; each `arvodepth` grammar violation (sign, leading zero, decimal point, exponent); each optional extension present-but-wrong-typed, and `arvoexecutionunits` failing its RFC 8785 round-trip check
- [x] 10.2 A fully-conforming CloudEvent is recognized as strict and reverses successfully
- [x] 10.3 A partial-marker-match (only `datacontenttype` or only `dataschema` claims Arvo shape, another condition fails) is rejected as malformed, with an explicit assertion that this outcome is distinguishable from attempting foreign adaptation
- [x] 10.4 A CloudEvent passing every discriminator condition but whose assembled candidate violates an existing ArvoEvent structural rule (e.g. ADR-001's Root Event Constraint, or ADR-002's canonical-form requirement on `source`) fails at the shared-validation step
- [x] 10.5 `tryRevert` never throws for any case in 10.1–10.4 — every one reports through the returned `Result`

## 11. Tests — foreign adaptation

- [x] 11.1 `id`/`source`/`type` mapped unconditionally
- [x] 11.2 `subject`/`time`/object-valued `data` mapped when present, and absent (falling through to caller fallback or ArvoEvent defaults) when not
- [x] 11.3 A present foreign `subject`, `time`, and `data` each individually win over a caller-supplied fallback for the same field
- [x] 11.4 `traceparent`/`tracestate` mapped when present
- [x] 11.5 Missing caller-supplied `dataschema` fails adaptation, naming `dataschema`
- [x] 11.6 Foreign `data` present but not an object fails adaptation explicitly, naming `data`
- [x] 11.7 A foreign CloudEvent's `arvo`-prefixed attributes, if any happen to be present without either Arvo marker, are never interpreted as Arvo extensions
- [x] 11.8 The assembled candidate still runs through `validateArvoEvent`

## 12. Tests — `CloudEventConverter` extensibility

- [x] 12.1 The no-argument constructor's behavior is identical to calling `ArvoToCloudEventConverter` (from `src/cloudevent/default/`) directly
- [x] 12.2 A custom converter list appends a CloudEvent-to-CloudEvent stage correctly on `tryConvert`/`convert`
- [x] 12.3 `tryRevert` unwinds a custom appended stage in reverse order before the base mapping's own `revert` runs
- [x] 12.4 `ICloudEventConverter`'s and `IArvoEventTransformer`'s mandatory pairs are each enforced at the type level — a stage object missing either `convert` or `revert` fails to type-check (a compile-time check, e.g. a `// @ts-expect-error` fixture, not a runtime test)
- [x] 12.5 A custom appended stage that throws during `convert` is reported by `tryConvert` as a `kind: 'stage'` failure naming that stage's index and `direction: 'convert'`, with the thrown value preserved as `cause`; `convert` throws the same `CloudEventTransformationError`
- [x] 12.6 A custom appended stage that throws during `revert` is reported by `tryRevert` as a `kind: 'stage'` failure naming that stage's index and `direction: 'revert'`, with the thrown value preserved as `cause`; `revert` throws the same `CloudEventTransformationError`
- [x] 12.7 With multiple appended stages, a failure in an earlier stage of the run order stops the pipeline before any later stage executes — assert the later stage is never invoked, for both `tryConvert` and `tryRevert`
- [x] 12.8 A stage failure's `stageIndex` correctly identifies which stage failed when more than one stage is appended, for both directions

## 13. Close out

- [x] 13.1 `pnpm lint` clean
- [x] 13.2 `pnpm test` — full suite green apart from any pre-existing, separately-tracked failures already documented by prior changes (confirm the failure set is identical before and after this change's edits) — confirmed identical: the same 18 pre-existing `tests/factory/index.spec.ts` failures (unrelated, predate this change), 587 passing including this change's new suite (100% statement/branch/function/line coverage of `src/cloudevent/**`)
- [x] 13.3 `pnpm exec openspec validate arvoevent-cloudevent-converter --strict` passes
- [x] 13.4 No changeset — same reasoning as the `rebuild-arvoevent-structure` change (commit `3c4eaeb`): this merges into `v4`, which is not being released imminently, so a changeset now would falsely imply one. Write the real changeset once `v4` approaches release, covering everything merged into it by then
