# arvo-core (Python)

The Python implementation of the [Arvo Application Model](../../docs/adr/000-arvo-system-identity-and-architectural-principles.md) — governed by the same Architecture Decision Records as every other language implementation in this repository, and free to be idiomatic Python rather than a port of any other implementation's API shape. See [ADR-004](../../docs/adr/004-multi-language-implementation-governance.md) for how language implementations relate to one another.

**Status: paused, not at feature parity, unpublished.** Three capabilities have landed so far, each through this package's own `openspec/` directory, one governed change at a time, the same way the TypeScript implementation was built:

- `arvo-event` — the `ArvoEvent` model, its validation rules, and OpenTelemetry trace-context extraction.
- `arvoevent-cloudevent-transformation` — `ArvoEvent` ↔ CloudEvent conversion, with content-type discrimination and codecs.
- `arvoevent-serialization` — ArvoEvent-shaped and CloudEvent-shaped JSON serialization and deserialization. RFC 8785 is used specifically for the `executionunits` CloudEvent extension; canonical wire serialization remains deferred.

That is deliberately where this implementation stops for now. It is **not** at parity with the TypeScript implementation, which remains the reference and the focus of active development. This package is not published to PyPI and will not be released until the TypeScript implementation is where it needs to be and Python becomes a deliberate focus. Treat what's here as a foundation to resume from rather than something to depend on: the API shape is unsettled and may change without regard for backwards compatibility.

Everything that *is* implemented is fully specified in `openspec/specs/` and covered by tests, so picking the work back up means proposing the next capability, not reconstructing intent.

Known correctness, conformance, and CI gaps discovered after the initial capability work are tracked in [KNOWN_ISSUES.md](KNOWN_ISSUES.md). They must be resolved or deliberately dispositioned through the governed change process before publication.

## Development

This package uses [uv](https://docs.astral.sh/uv/) for dependency management and packaging, targeting Python 3.12+.

```bash
uv sync              # install dependencies
uv run pytest        # run tests
uv run ruff check    # lint
uv run ruff format   # format
uv run pyrefly check # type-check
```

## License

MIT — See [LICENSE.md](LICENSE.md)
