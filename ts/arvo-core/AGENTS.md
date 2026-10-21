# arvo-core (TypeScript)

The reference TypeScript implementation of the Arvo Application Model. See [`../../AGENTS.md`](../../AGENTS.md) for repository-wide rules, the record hierarchy, and the ADR governance every language package is bound by.

This file routes and lists commands. It restates no convention.

## Source of truth

**[`openspec/project.md`](openspec/project.md) is canonical for this package.** Read it before writing code. It holds the purpose, the governance rules, the tech stack, and every convention this package holds itself to — error messages, the `Result`/`try`-prefix pairing, optional inputs, dependency policy, TSDoc rules for the public surface, and the testing bar.

Cite it rather than restating it. If a rule you need is not there and it will still be true in two years, it belongs there — not here, and not in a code comment.

- `openspec/specs/` — what this package does today, one spec per capability.
- `openspec/changes/` — what is proposed or in flight. Archived changes move under `openspec/changes/archive/`, so never cite an `openspec/` path from shipped source.

## No type-cast shortcuts

**Never write a cast whose job is to stop the compiler checking** in this package's TypeScript: `as never`, `as unknown as T`, `null as T`, `x as T` to paper over a mismatch, or a non-null `!`. When types do not line up, find out why and fix that: carry the generic parameters through, annotate the declaration, or narrow with a real runtime check.

The only escape hatch is the developer's explicit approval. Raise the cast with them first: what it is, where, and why the types cannot be made to flow. Write it only once they have approved it, with the reason in a comment beside it. An approved cast lives where the mismatch originates, not where it is felt: once, in the narrowest private place inside the code that owns the mismatch, so every caller stays fully typed and never sees it.

Tests may build deliberately invalid input to exercise runtime validation. Say so on that line.

## Commands

Run from this directory. `package.json` is the source of truth for the script list.

| Command | |
|---|---|
| `pnpm test` | Vitest, whole suite |
| `pnpm test:coverage` | With coverage |
| `pnpm lint` | Biome — **required before finishing any change** |
| `pnpm build` | `tsc` to `dist/` |
| `pnpm typecheck` | Typecheck **`src` and `tests`** — `tsconfig.json` excludes `tests`, so `npx tsc --noEmit` checks neither the specs nor their fixtures |

Node ≥22 (`.nvmrc` pins v22.23.1) and pnpm 11 — the OpenSpec CLI and pnpm both fail on older runtimes.

## Layout

`tests/` mirrors `src/`. The public surface is whatever `src/index.ts` re-exports — that boundary decides which TSDoc rules in `project.md` apply to a given file.

[`../sandbox/`](../sandbox/) is a private playground linked to this package by `file:`, for exercising the API off disk without publishing. Never built, never shipped.
