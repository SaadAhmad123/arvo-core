/**
 * The tables and indexes an outbox needs, each created only where missing,
 * so a file that already has them is left as it is.
 *
 * `sequence` is commit order, and never reused, so ties in `committed_at`
 * keep the order committed. `committed_at` and `seen_at` are in the form
 * `toISOString` writes, which sorts as it reads. Only an execution's latest
 * state is kept.
 */
export const outboxSchema = `
create table if not exists arvo_outbox_state (
  execution_id text not null,
  cas_version integer not null,
  subject text not null,
  source text not null,
  version text not null,
  lifecycle text not null,
  document text not null,
  primary key (execution_id, cas_version)
) strict, without rowid;

create table if not exists arvo_outbox_event (
  sequence integer primary key autoincrement,
  id text not null unique,
  subject text not null,
  execution_id text not null,
  cas_version integer,
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

create index if not exists arvo_outbox_event_by_execution
  on arvo_outbox_event (execution_id, sequence);

create index if not exists arvo_outbox_event_by_triggering_event
  on arvo_outbox_event (triggering_event_id, sequence);

create index if not exists arvo_outbox_event_unseen_by_landing
  on arvo_outbox_event (committed_at, sequence) where seen = 0;

create index if not exists arvo_outbox_event_seen_by_seen_at
  on arvo_outbox_event (seen_at, sequence) where seen = 1;
`;
