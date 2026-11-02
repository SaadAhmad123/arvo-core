# Tasks

## 1. Schemas built once

- [x] 1.1 Export the schema builder from `src/ArvoOutboxDriver/helpers/check-capacity.ts`, `check-commit-outcome.ts` and `check-committed-records.ts`, each check taking its schema; build the three in `ArvoOutboxDriver`'s constructor in `src/ArvoOutboxDriver/index.ts`. Update the three helper specs. Verify with the whole suite at 100% coverage.

## 2. Two notes

- [x] 2.1 Add to `deleteExpired()`'s TSDoc in `src/outbox/sqlite/outbox.ts` that it holds the thread until done, and to `filename`'s in `src/outbox/sqlite/types.ts` that a permission change must reach `-wal` and `-shm`. Verify with `pnpm lint`.

## 3. Defaults

- [x] 3.1 Set the defaults in `src/outbox/inmemory/helpers/resolve-options.ts` and `src/outbox/sqlite/helpers/resolve-options.ts`, and their specs. Verify with the whole suite at 100% coverage, `pnpm typecheck`, `pnpm build`, and `pnpm load:inmemory` and `pnpm load:sqlite` in the sandbox.
