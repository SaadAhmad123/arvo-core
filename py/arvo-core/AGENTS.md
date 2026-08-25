# arvo-core (Python)

The Python implementation of the Arvo Application Model. See [`../../AGENTS.md`](../../AGENTS.md) for repository-wide rules, the record hierarchy, and the ADR governance every language package is bound by.

This file routes and lists commands. It restates no convention.

## Status, before you change anything

**This package is deliberately paused, is not at parity with the TypeScript implementation, and is unpublished.** Read [`README.md`](README.md) for what that means, and [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md) for the correctness, conformance, and CI gaps found after the initial capability work. Those must be resolved or deliberately dispositioned through the governed change process before publication — not fixed in passing.

Three capabilities have landed. Everything implemented is specified in `openspec/specs/` and covered by tests, so resuming means proposing the next capability, not reconstructing intent.

## Idiomatic Python, not a port

ADR-004 grants each language package freedom over API shape, naming, error-handling mechanism, and module structure. Conformance is judged on observable behaviour alone.

So **do not port the TypeScript implementation's shape here**, and do not treat a difference from it as a discrepancy to reconcile. `openspec/project.md` says this outright: where its conventions differ from `ts/arvo-core/openspec/project.md`'s, that is expected. A `Result` type hand-rolled to mirror TypeScript's would be exercising this freedom *incorrectly*; Python's own established idiom is the right answer.

## Source of truth

**[`openspec/project.md`](openspec/project.md) is canonical for this package.** Read it before writing code. It holds the purpose, the governance rules, the tech stack, and every convention this package holds itself to — error handling, validation, dependency policy, docstrings, and the testing bar.

Cite it rather than restating it. If a rule you need is not there and it will still be true in two years, it belongs there — not here, and not in a code comment.

- `openspec/specs/` — what this package does today, one spec per capability.
- `openspec/changes/` — what is proposed or in flight. Archived changes move under `openspec/changes/archive/`, so never cite an `openspec/` path from shipped source.

## Commands

Run from this directory. `pyproject.toml` is the source of truth for tooling config.

| Command | |
|---|---|
| `uv run pytest` | Whole suite |
| `uv run pytest --cov` | With coverage |
| `uv run ruff check` | Lint — **required before finishing any change** |
| `uv run ruff format` | Format |
| `uv run pyrefly check` | Type check |

Python ≥3.12 (`.python-version` pins 3.12). Dependencies, packaging, and the build backend are all [uv](https://docs.astral.sh/uv/).

Changelog fragments go in `changes.d/`, assembled by Towncrier — see its `README.md`.

The `openspec` CLI is not on `PATH` and this package has no `node_modules` of its own. Use the repository root's copy — `../../node_modules/.bin/openspec` — run from *this* directory, so it acts on this package's `openspec/` rather than TypeScript's.

## Layout

`tests/` mirrors `src/arvo_core/`. `py.typed` ships, so type annotations are part of the public surface.
