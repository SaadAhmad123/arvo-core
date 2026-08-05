# arvo-core (Python)

The Python implementation of the [Arvo Application Model](../../docs/adr/000-arvo-system-identity-and-architectural-principles.md) — governed by the same Architecture Decision Records as every other language implementation in this repository, and free to be idiomatic Python rather than a port of any other implementation's API shape. See [ADR-004](../../docs/adr/004-multi-language-implementation-governance.md) for how language implementations relate to one another.

**Status: early bootstrap.** This package is currently tooling scaffolding only — no part of the Arvo Application Model (ArvoEvent, CloudEvent transformation, etc.) is implemented yet. That work proceeds through this package's own `openspec/` directory, one governed change at a time, the same way the TypeScript implementation was built.

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
