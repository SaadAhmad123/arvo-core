## 1. Dependencies and verification

- [x] 1.1 Add `cloudevents` (2.x) to `pyproject.toml`'s `[project.dependencies]`
- [x] 1.2 Verify (short script, not assumed from docs) that `cloudevents.v1.pydantic.v2.event.CloudEvent` is a genuine `pydantic.BaseModel` and accepts arbitrary extension attributes
- [x] 1.3 Identify and empirically verify a library implementing RFC 8785 canonical number serialization (test against a handful of known RFC 8785 number-serialization test vectors, not assumed from the library's own docs); if none is adequate, hand-roll the specific number-to-string algorithm RFC 8785 requires, recording why in `design.md`

## 2. `CloudEventTransformationError`

- [x] 2.1 `src/arvo_core/cloudevent/errors.py` — `CloudEventTransformationError(Exception)`, `kind: Literal["strict", "foreign"]`, human-readable message, always raised via `raise CloudEventTransformationError(...) from original_error`

## 3. Forward transformation (`to_cloud_event`)

- [x] 3.1 `src/arvo_core/cloudevent/convert.py` — `to_cloud_event(event: ArvoEvent) -> CloudEvent`: native attributes (`id`, `source`, `type`, `subject`, `time`), protocol constants (`specversion`, `datacontenttype`, `dataschema`)
- [x] 3.2 Arvo-defined extension attributes, correctly named and prefixed, omitted (not null) when the source field is `None`
- [x] 3.3 `depth` → `arvodepth`: canonical unsigned-decimal string
- [x] 3.4 `executionunits` → `arvoexecutionunits`: RFC 8785 canonical number string, omitted when `None`
- [x] 3.5 `data`/`dataschema`/`baggage` → the `data` wrapper, exactly `{arvoeventdata, arvoeventdataschema, arvoeventbaggage}`
- [x] 3.6 `time` written using whatever `cloudevents` does natively for a `datetime` — no custom wire handling, per `design.md`'s instant-equality decision

## 4. Arvo-shaped discrimination

- [x] 4.1 `src/arvo_core/cloudevent/discriminate.py` (or co-located) — a private `_is_arvo_shaped(ce: CloudEvent) -> bool` (or an issues-returning variant, implementer's choice) checking every condition ADR-003's **Discriminating Arvo-shaped events** section lists: `specversion`, parsed `datacontenttype` (media type + exactly one `version=1` param), `dataschema`, required native attributes, required extensions with correct type/encoding, `data` wrapper shape
- [x] 4.2 A value that matches the media type or wrapper URI but fails some other condition is distinguished from a value that matches none of them at all — the malformed-vs-genuinely-foreign distinction `from_cloud_event` needs to route correctly

## 5. Reverse transformation — strict path

- [x] 5.1 `src/arvo_core/cloudevent/convert.py` — the strict path: maps every native attribute and extension back, decodes `arvodepth`/`arvoexecutionunits` (rejecting a non-canonical string per each field's own round-trip check), unwraps the `data` wrapper, restores omitted nullable extensions as `None`, ignores any caller-supplied fallback entirely
- [x] 5.2 Passes the assembled candidate through `ArvoEvent`'s own construction; a resulting `ArvoEventValidationError` becomes `CloudEventTransformationError(kind="strict")`, wrapping it as cause
- [x] 5.3 Any other malformed-Arvo-shaped condition (missing required extension, malformed canonical string, unexpected wrapper key) raises `CloudEventTransformationError(kind="strict")` directly, never falling through to foreign handling

## 6. Reverse transformation — foreign path

- [x] 6.1 Maps `id`, `source`, `type` natively; maps `subject`, `time`, and object-valued `data` when present; maps `traceparent`/`tracestate` when present
- [x] 6.2 Accepts `**foreign_fallback`, requires `dataschema` in it, uses fallback only for a field the mapping didn't provide — a value the CloudEvent itself provides always wins
- [x] 6.3 A present non-object `data` value fails adaptation rather than being silently discarded
- [x] 6.4 Passes the assembled candidate through `ArvoEvent`'s own construction; a resulting `ArvoEventValidationError` becomes `CloudEventTransformationError(kind="foreign")`

## 7. `from_cloud_event` dispatcher

- [x] 7.1 `from_cloud_event(ce: CloudEvent, **foreign_fallback: Any) -> ArvoEvent` — runs the discrimination check from group 4 once, then branches to the strict path (group 5) or the foreign path (group 6); the branch decision itself cannot be bypassed by calling internal strict/foreign logic directly out of order (keep that logic private, not separately exported)

## 8. Public exports

- [x] 8.1 `src/arvo_core/cloudevent/__init__.py` — export `to_cloud_event`, `from_cloud_event`, `CloudEventTransformationError`
- [x] 8.2 `src/arvo_core/__init__.py` — re-export the same three names

## 9. Tests — forward transformation

- [x] 9.1 Any structurally valid ArvoEvent converts without raising
- [x] 9.2 Native fields map unchanged
- [x] 9.3 Protocol constants are always set, independent of the source event
- [x] 9.4 Every non-null extension-mapped field is present, correctly named
- [x] 9.5 `arvodepth` is a canonical unsigned-decimal string for a representative range of values, including `0` and a large value
- [x] 9.6 `arvoexecutionunits` is a canonical RFC 8785 number string for a representative range of finite values, including very small/large magnitudes
- [x] 9.7 A null nullable field is omitted from extensions entirely, not present as any null-like value
- [x] 9.8 The `data` wrapper has exactly the three required keys, correctly populated

## 10. Tests — discrimination and strict deserialization

- [x] 10.1 An Arvo-shaped CloudEvent (produced by `to_cloud_event`) is correctly recognized and reverses using only its own values, ignoring any fallback supplied alongside it
- [x] 10.2 A CloudEvent claiming the Arvo media type but missing a required extension is rejected with `kind="strict"`, not treated as foreign
- [x] 10.3 A CloudEvent claiming the Arvo wrapper schema but with a malformed `arvodepth` (leading zero, sign, non-digit) is rejected with `kind="strict"`
- [x] 10.4 A CloudEvent with an unexpected key in the `data` wrapper is rejected with `kind="strict"`

## 11. Tests — foreign adaptation

- [x] 11.1 A foreign CloudEvent adapts correctly with a complete fallback
- [x] 11.2 The foreign CloudEvent's own `subject`/`time`/`data` win over a fallback supplying the same fields
- [x] 11.3 Missing `dataschema` in the fallback is rejected with `kind="foreign"`
- [x] 11.4 A present non-object `data` value fails adaptation with `kind="foreign"`, rather than being silently dropped
- [x] 11.5 `traceparent`/`tracestate` map when present on a foreign CloudEvent

## 12. Tests — losslessness

- [x] 12.1 A fully-populated ArvoEvent round-trips through `to_cloud_event`/`from_cloud_event` identical, field for field, except `time` (see 12.3)
- [x] 12.2 A minimal (mostly-null) ArvoEvent round-trips identically, except `time`
- [x] 12.3 An ArvoEvent with an explicit, non-default, non-UTC-offset, non-millisecond-precision `time` round-trips to the same instant (parse both and compare) — not necessarily the same string; matches `ts/arvo-core`'s own guarantee for this field
- [x] 12.4 `depth` values at representative magnitudes (0, small, large) round-trip exactly
- [x] 12.5 `executionunits` values at representative magnitudes/precisions round-trip exactly

## 13. Tests — error reporting

- [x] 13.1 Every failure case above is asserted as `CloudEventTransformationError`, never a raw underlying exception
- [x] 13.2 `.__cause__` is set for at least one representative failure per path
- [x] 13.3 `.kind` is correctly `"strict"` or `"foreign"` for each respective failure case

## 14. Close out

- [x] 14.1 `uv run ruff check .` and `uv run ruff format --check .` clean
- [x] 14.2 `uv run pyrefly check` clean
- [x] 14.3 `uv run pytest --cov --cov-report=term-missing` — full suite green, 100% coverage of `src/arvo_core/cloudevent/**`
- [x] 14.4 `openspec validate arvoevent-cloudevent-transformation --strict` passes
- [x] 14.5 A developer-usage pass, matching the discipline `arvo-event` established — actually convert and revert events as a consumer would (Arvo-produced, foreign, malformed) before considering this change done, recording findings in a `developer-usage-findings.md`
