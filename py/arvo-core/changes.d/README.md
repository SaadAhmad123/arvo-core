# Changelog fragments

This directory holds one file per change, assembled into `CHANGELOG.md` at release time by [Towncrier](https://towncrier.readthedocs.io/).

Add a file named `<issue-or-PR-number>.<type>.md` (e.g. `12.feature.md`), containing a short, human-readable description of the change. Valid `<type>` values: `breaking`, `feature`, `fix`, `doc`, `misc`.

```bash
uv run towncrier create 12.feature.md
```
