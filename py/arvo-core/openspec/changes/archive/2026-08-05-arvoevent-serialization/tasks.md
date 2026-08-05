## 1. Verification

- [x] 1.1 Confirm (short script, not assumed) that `ArvoEvent.model_validate_json` does not wrap a JSON-syntax failure in `ArvoEventValidationError`, and that `deserialize` must therefore own `json.loads` itself
- [x] 1.2 Confirm that `CloudEvent.model_validate` accepts a plain parsed dict with no construction-time conformance gate to bypass
- [x] 1.3 Confirm `event.model_dump_json()` and `to_cloud_event(event).model_dump_json()` do not raise for a structurally valid `ArvoEvent`, including one with a non-JSON-native value inside `data`

## 2. `ArvoEventSerializerError`

- [x] 2.1 `src/arvo_core/serializer/errors.py` -- `ArvoEventSerializerError(Exception)`, human-readable message, always raised via `raise ArvoEventSerializerError(...) from original_error`

## 3. `serialize`

- [x] 3.1 `src/arvo_core/serializer/serialize.py` -- `serialize(event: ArvoEvent, *, mode: SerializationMode = "cloudevent") -> str`
- [x] 3.2 `"arvoevent"` mode: `event.model_dump_json()`, no CloudEvent involved
- [x] 3.3 `"cloudevent"` mode: `to_cloud_event(event).model_dump_json()`
- [x] 3.4 No error wrapping -- confirmed total per verification task 1.3

## 4. `deserialize`

- [x] 4.1 `src/arvo_core/serializer/deserialize.py` -- `deserialize(wire: str, *, mode: SerializationMode = "cloudevent", **foreign_fallback: Any) -> ArvoEvent`
- [x] 4.2 Parses `wire` with `json.loads`; a `json.JSONDecodeError` is wrapped in `ArvoEventSerializerError`
- [x] 4.3 A parsed value that is not a `dict` (top-level JSON array or scalar) raises `ArvoEventSerializerError`, in either mode
- [x] 4.4 `"arvoevent"` mode: `ArvoEvent(**parsed)`; a resulting `ArvoEventValidationError` is wrapped in `ArvoEventSerializerError`; `foreign_fallback` is ignored even if supplied
- [x] 4.5 `"cloudevent"` mode: `CloudEvent.model_validate(parsed)` (a `pydantic.ValidationError` here is wrapped in `ArvoEventSerializerError`), then `from_cloud_event(ce, **foreign_fallback)`; a resulting `CloudEventTransformationError` propagates unwrapped

## 5. Public exports

- [x] 5.1 `src/arvo_core/serializer/__init__.py` -- export `serialize`, `deserialize`, `ArvoEventSerializerError`
- [x] 5.2 `src/arvo_core/__init__.py` -- re-export the same three names

## 6. Tests -- serialize

- [x] 6.1 A structurally valid `ArvoEvent` serializes without raising in both modes
- [x] 6.2 `"arvoevent"`-mode output is `ArvoEvent`'s own default JSON shape (round-trips via `ArvoEvent.model_validate_json` directly, independent of this capability)
- [x] 6.3 `"cloudevent"`-mode output is CloudEvent-shaped JSON matching `to_cloud_event`'s own field placement

## 7. Tests -- deserialize, arvoevent mode

- [x] 7.1 Wire JSON from `serialize(event, mode="arvoevent")` deserializes back to the same event via `deserialize(wire, mode="arvoevent")`
- [x] 7.2 Non-JSON input raises `ArvoEventSerializerError` with the original `json.JSONDecodeError` as `.__cause__`
- [x] 7.3 A top-level JSON array or scalar raises `ArvoEventSerializerError`
- [x] 7.4 A structurally invalid parsed value raises `ArvoEventSerializerError` with the original `ArvoEventValidationError` as `.__cause__`
- [x] 7.5 A supplied fallback has no effect on the outcome

## 8. Tests -- deserialize, cloudevent mode

- [x] 8.1 Wire JSON from `serialize(event, mode="cloudevent")` deserializes back to the same event (except `time`, per `arvoevent-cloudevent-transformation`'s own instant-equality guarantee) via `deserialize(wire)`
- [x] 8.2 Non-JSON input raises `ArvoEventSerializerError`
- [x] 8.3 A top-level JSON array or scalar raises `ArvoEventSerializerError`
- [x] 8.4 A parsed value that cannot become a `CloudEvent` at all (missing `source`/`type`) raises `ArvoEventSerializerError`
- [x] 8.5 JSON produced by `mode="arvoevent"`'s `serialize`, passed to `mode="cloudevent"`'s `deserialize`, fails clearly rather than silently misadapting
- [x] 8.6 A foreign (non-Arvo-shaped) CloudEvent's wire JSON adapts correctly with a supplied fallback
- [x] 8.7 A malformed Arvo-shaped CloudEvent's wire JSON raises the underlying `CloudEventTransformationError` unwrapped, not `ArvoEventSerializerError`

## 9. Close out

- [x] 9.1 `uv run ruff check .` and `uv run ruff format --check .` clean
- [x] 9.2 `uv run pyrefly check` clean
- [x] 9.3 `uv run pytest --cov --cov-report=term-missing` -- full suite green, 100% coverage of `src/arvo_core/serializer/**`
- [x] 9.4 `openspec validate arvoevent-serialization --strict` passes
- [x] 9.5 A developer-usage pass: actually serialize and deserialize events as a consumer would (both modes, a foreign CloudEvent, malformed wire input), recording findings in `developer-usage-findings.md`
