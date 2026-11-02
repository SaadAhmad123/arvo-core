# Design

## Context

See proposal.md. Each check helper in `src/ArvoOutboxDriver/helpers/` builds its zod schema inside the call, to keep project.md's **Module-level state** rule.

## Decisions

### Schemas built once, held by the driver

Each helper exports its builder, `buildCapacitySchema`, `buildCommitOutcomeSchema` and `buildCommittedRecordsSchema`, and its check takes the schema it checks against. `ArvoOutboxDriver`'s constructor builds the three and holds them in a private field, as it builds and holds its serializer, so no schema is held at module level and none is built twice.

*Alternative:* a schema held at module level. Rejected by project.md: a schema is an instance.

### Defaults

| | Was | Is | Why |
|---|---|---|---|
| In-memory buffer size, each | 10,000 | 50,000 | ten thousand states fill in under a minute at a modest steady load |
| In-memory seen events kept | 5 minutes | 1 minute | deleting a seen event is safe: a queue holds it |
| In-memory terminal states kept | 1 hour | 10 minutes | an hour of finished executions outgrows any buffer a single process can afford; ten minutes still outlasts common redelivery windows |
| SQLite busy wait | 5 s | 1 s | a SQLite call holds the thread while it waits |
| SQLite seen events and terminal states kept | 7 days | 1 day | a week of traffic grows the file; a day still outlasts common redelivery windows |

The in-memory sweep then runs every six seconds, a tenth of the shorter retention.

## Risks / Trade-offs

- [A deployment whose queue redelivers later than the new retention] → Each retention's TSDoc already says to make it longer than the queue may take; such a deployment sets it.
