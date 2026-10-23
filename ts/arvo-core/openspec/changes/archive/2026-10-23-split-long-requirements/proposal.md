## Why

OpenSpec 1.14 warns on any requirement whose text runs past five hundred characters, and strict validation fails on the warning. Forty-three requirements across ten specs exceed it. A long requirement usually states several behaviours at once, which makes each harder to find, to test against and to change alone.

## What Changes

- Each requirement over the limit is split into requirements that each state one behaviour, or has its examples and edge cases moved into scenarios.
- No behaviour changes. Every normative sentence is carried over word for word, except where a pronoun is replaced by the noun it stood for so that a moved sentence reads on its own.
- Scenarios move with the behaviour they exercise. Where an example already stated in prose becomes a scenario, it says exactly what the prose said. Two requirements that no split brings within the limit are reworded instead, and each split-out part gets the one scenario a requirement needs; see design.md.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `arvo-contract`, `arvo-contract-serialization`, `arvo-event`, `arvoevent-cloudevent-transformation`, `arvoevent-construction`, `arvoevent-serialization`, `event-dispatcher`, `event-handler`, `event-handler-dependencies`, `event-handler-middleware`: requirements restructured, none changed in meaning.

## Impact

- `openspec/specs/` only. No source, test, ADR or record outside the specs changes.
- Requirements split out of a parent are added after it in the spec they belong to.

**ADR.** No ADR governs this change. It restates existing requirements and settles nothing an ADR defers.

**Not in scope.** Changing what any requirement requires, adding coverage, renaming requirements that stay within the limit, and the wording of requirements already within it.
