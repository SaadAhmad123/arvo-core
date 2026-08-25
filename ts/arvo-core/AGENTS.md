# arvo-core (TypeScript)

The reference TypeScript implementation of the Arvo Application Model. See [`../../AGENTS.md`](../../AGENTS.md) for repository-wide rules, the record hierarchy, and the ADR governance every language package is bound by.

This file routes and lists commands. It restates no convention.

## Source of truth

**[`openspec/project.md`](openspec/project.md) is canonical for this package.** Read it before writing code. It holds the purpose, the governance rules, the tech stack, and every convention this package holds itself to — error messages, the `Result`/`try`-prefix pairing, optional inputs, dependency policy, TSDoc rules for the public surface, and the testing bar.

Cite it rather than restating it. If a rule you need is not there and it will still be true in two years, it belongs there — not here, and not in a code comment.

- `openspec/specs/` — what this package does today, one spec per capability.
- `openspec/changes/` — what is proposed or in flight. Archived changes move under `openspec/changes/archive/`, so never cite an `openspec/` path from shipped source.

## Commands

Run from this directory. `package.json` is the source of truth for the script list.

| Command | |
|---|---|
| `pnpm test` | Vitest, whole suite |
| `pnpm test:coverage` | With coverage |
| `pnpm lint` | Biome — **required before finishing any change** |
| `pnpm build` | `tsc` to `dist/` |
| `npx tsc --noEmit` | Typecheck without emitting |

Node ≥22 (`.nvmrc` pins v22.23.1) and pnpm 11 — the OpenSpec CLI and pnpm both fail on older runtimes.

## Layout

`tests/` mirrors `src/`. The public surface is whatever `src/index.ts` re-exports — that boundary decides which TSDoc rules in `project.md` apply to a given file.

[`../sandbox/`](../sandbox/) is a private playground linked to this package by `file:`, for exercising the API off disk without publishing. Never built, never shipped.
