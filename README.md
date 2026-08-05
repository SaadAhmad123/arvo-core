# Arvo Core

`arvo-core` is the foundational, multi-language implementation of the [Arvo Application Model](docs/adr/000-arvo-system-identity-and-architectural-principles.md) — a portable, language-independent application model for event-driven systems. Each language implementation is a native, idiomatic package for that language, governed by the same Architecture Decision Records.

## Implementations

- [`ts/arvo-core/`](ts/arvo-core/) — TypeScript, published as [`arvo-core`](https://www.npmjs.com/package/arvo-core) on npm.
- [`py/arvo-core/`](py/arvo-core/) — Python, early bootstrap (tooling scaffolding only, no capabilities implemented yet). Not yet published.

Further language implementations are added here as they land, each in its own top-level directory. See [ADR-004](docs/adr/004-multi-language-implementation-governance.md) for how they're governed relative to one another.

## Learn more

- [Vision](docs/vision.md) — the thesis behind Arvo, and how the bet could turn out to be wrong.
- [Architecture Decision Records](docs/adr/) — the governing model, shared across every language implementation.
- [Why this repository is agent-native](docs/why-agent-native-development.md).

Official site: [https://www.arvo.land/](https://www.arvo.land/)

## License

MIT — See [LICENSE.md](LICENSE.md)
