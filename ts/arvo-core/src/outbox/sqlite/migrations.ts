/**
 * The steps that build an outbox's tables in its file, oldest first. A file
 * records, as SQLite's `user_version`, how many it has run, so opening runs
 * the rest, in order, and a new file runs them all.
 *
 * To change the tables, **append** a step; never edit or reorder one once
 * released, since files already ran it. A step only adds, so an outbox still
 * at the release before keeps working on the same file. **The statements in
 * `statements.ts` are written against the tables as the latest step leaves
 * them: change them in the same commit as the step.** Preparing them fails
 * where a column they use is missing, so a step forgotten stops the outbox
 * opening rather than misreading the file.
 */

/**
 * Every step, oldest first.
 *
 * Step 1: the state and event tables. `sequence` is commit order, and never
 * reused, so ties in `committed_at` keep the order committed. Every
 * `committed_at` and `seen_at` is in the form `toISOString` writes, which
 * sorts as it reads. Only an execution's latest state is kept, with when it
 * was last committed. The index of terminal states lists
 * `ARVO_TERMINAL_LIFECYCLES` as written, not built from it, so the step never
 * changes; a test fails where the two disagree, calling for a step that
 * rebuilds the index.
 */
export const outboxMigrations: readonly string[] = Object.freeze([
  `
create table arvo_outbox_state (
  execution_id text not null,
  cas_version integer not null check (cas_version >= 0),
  subject text not null,
  source text not null,
  version text not null,
  lifecycle text not null,
  document text not null check (json_valid(document)),
  committed_at text not null,
  primary key (execution_id, cas_version)
) strict, without rowid;

create table arvo_outbox_event (
  sequence integer primary key autoincrement,
  id text not null unique,
  subject text not null,
  execution_id text not null,
  cas_version integer check (cas_version >= 0),
  parent_id text,
  init_id text,
  triggering_event_id text not null,
  source text not null,
  type text not null,
  to_destination text,
  domain text,
  time text not null,
  payload text not null,
  committed_at text not null,
  seen integer not null default 0 check (seen in (0, 1)),
  seen_at text,
  leased_until text,
  check ((seen = 0) = (seen_at is null))
) strict;

create index arvo_outbox_state_terminal_by_commit
  on arvo_outbox_state (committed_at)
  where lifecycle in ('success', 'error', 'cancelled', 'failure');

create index arvo_outbox_event_by_execution
  on arvo_outbox_event (execution_id, sequence);

create index arvo_outbox_event_by_triggering_event
  on arvo_outbox_event (triggering_event_id, sequence);

create index arvo_outbox_event_unseen_by_landing
  on arvo_outbox_event (committed_at, sequence) where seen = 0;

create index arvo_outbox_event_seen_by_seen_at
  on arvo_outbox_event (seen_at, sequence) where seen = 1;
`,
]);
