# arvo-core

A multi-language monorepo implementing the **Arvo Application Model (AAM)** — a portable, language-independent application model for event-driven systems. Arvo defines how independently built participants compose; it does not execute them.

This file routes. It deliberately restates nothing, because a second copy of a rule is a copy that drifts.

## Read before you work

Records, in order of authority:

1. **`docs/adr/`** — architectural decisions about the model itself. Ecosystem-wide, binding on every language implementation, changed only by supersession rather than by editing. **`docs/adr/README.md` is the index** and is authoritative for which ADRs exist and what status each holds — trust it over any list elsewhere, including this file.
2. **`<lang>/arvo-core/openspec/project.md`** — the canonical context for that language package: purpose, governance, tech stack, and every convention it holds itself to. **This is the source of truth for anything package-level.**
3. **`<lang>/arvo-core/openspec/specs/`** — what that package does today, one spec per capability.

`docs/vision.md` (why Arvo exists, and how the bet could fail) and `docs/why-agent-native-development.md` (why the repository is shaped this way) are non-normative context.

Three rules that follow, and they are not negotiable:

- A change **must not** contradict an accepted ADR. If it needs to, that ADR is superseded first.
- Where an ADR defers a decision, **do not quietly settle it**. Note the deferral and keep it out of scope.
- Cite a record rather than paraphrasing it. Paraphrase is how a subtly different rule gets born.

## Work goes through OpenSpec

Non-trivial work is specified before it is implemented: `/opsx:propose`, then `/opsx:apply`, then `/opsx:archive`. Do not start editing code for new behaviour without a change to implement against.

The `openspec` CLI is **not** on `PATH` — it lives at `node_modules/.bin/openspec`. It acts on the nearest `openspec/` directory, so run it from inside the language package you mean; from the repository root it finds nothing.

## Where things are

| Path | What |
|---|---|
| `ts/arvo-core/` | TypeScript. The reference implementation, the active focus, published to npm. |
| `py/arvo-core/` | Python. Deliberately paused, not at parity, unpublished. See its `README.md` and `KNOWN_ISSUES.md`. |
| `docs/adr/` | The single copy of the ADRs every language references. |

Each language package is self-contained — its own tooling, tests, and `openspec/`. ADR-004 governs how they relate: conformance is judged on observable behaviour, and **API shape is each language's own choice**. Do not port one language's idiom into another on the grounds that it matches.

## Do not touch

- **`src-v3/`** — the pre-ADR TypeScript implementation, retained only as reference. Read it if useful; never copy from it and never edit it. It predates the current ADRs and diverges from them, so code that looks canonical here is not.
- **`coverage/`, `dist/`, `node_modules/`** — generated, wherever they appear.

## Keeping this file honest

Every line here is a pointer, a command, or a fact that lives nowhere else. If something you want to add is already in an ADR or a `project.md`, point at it instead. A line that goes stale must be corrected or cut — a confidently wrong instruction is worse than a missing one, and both humans and agents will believe it.
