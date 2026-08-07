# sandbox (Python)

A playground for trying out `arvo-core` (py) directly off disk, without publishing it to PyPI first. Not part of the published package.

`arvo-core` is linked here as an editable install (`[tool.uv.sources]` in `pyproject.toml`, pointing at `../arvo-core`) — edits to `py/arvo-core/src/` show up immediately, no build or reinstall step.

## Setup

```bash
cd py/sandbox && uv sync
```

## Use

Edit `src/sandbox/__init__.py`, then:

```bash
uv run sandbox
```
