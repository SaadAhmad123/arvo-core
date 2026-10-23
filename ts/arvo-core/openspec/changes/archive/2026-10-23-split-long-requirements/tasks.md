## 1. Split the long requirements

- [x] 1.1 Write the delta specs under `specs/` for each modified capability: the shortened parent as MODIFIED, each split-out requirement as ADDED.
- [x] 1.2 Run the sentence comparison over every spec and account for each difference it lists.
- [x] 1.3 Validate the delta specs with `openspec validate split-long-requirements --strict`, accepting only the refusal of moved scenarios.

## 2. Archive

- [x] 2.1 Apply each delta to its main spec in place, and archive the change without syncing specs.
- [x] 2.2 Reword the two requirements no split brings within the limit, and add the one scenario each needs.
- [x] 2.3 Validate every spec with `openspec validate --specs --strict`, with no warnings.
