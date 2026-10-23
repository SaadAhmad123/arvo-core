## Context

See proposal.md, Why. The limit counts a requirement's text, not its scenarios.

## Decisions

### How a requirement is shortened

In order of preference:

1. **Split by behaviour.** Where a requirement states two or more behaviours, each that an existing scenario exercises becomes its own requirement, named for that behaviour, and takes those scenarios with it. The parent keeps its name and what remains.
2. **Move an example into a scenario.** Where the text spells out an example or an edge case, it becomes a scenario of the same requirement, saying exactly what the text said.
3. **Leave a sentence where it is** if neither applies. A part with no scenario of its own is not split off, because every requirement must carry one.

### What may change in a sentence

Nothing, except a pronoun or a reference such as "it" or "this", replaced by the noun it stood for. Cross-references to another requirement by name are updated where that requirement's name changed; none is renamed here, so none should.

### How it is checked

A script compares each spec before and after, sentence by sentence, and lists every sentence that is missing, added or altered. Each entry is a pronoun replacement, an example turned scenario, or a defect. Strict validation of the specs then passes with no warnings.

### Applied in place, not through the archive

OpenSpec refuses a MODIFIED requirement that omits a scenario the current spec still has, even where the scenario moves to an ADDED requirement, and refuses REMOVED and ADDED under one name. A split cannot pass through a delta. The delta specs under `specs/` are therefore the record of what moved where, and a script applies each to its main spec in place: the shortened parent replaces the original where it stood, and each split-out requirement follows the parent its scenarios came from. The change is archived without syncing specs.

### Two requirements reworded

Two requirements could not fall within the limit by moving sentences, so each was reworded, its meaning unchanged:

- **Prerequisite Failures Report Distinct Positions** keeps its five failures and positions with a shorter lead-in and table header. Its sentence on positions being the values themselves becomes **A Reported Position Is The Value Itself**, with one scenario stating that rule.
- **Arvo-Shaped Discrimination** keeps its attribute conditions as a list. Its extension conditions become **Extensions Of An Arvo-Shaped CloudEvent**, with one scenario for a missing `arvoexecutionid`, a case the suite already tests.

These are the only scenarios this change writes.
