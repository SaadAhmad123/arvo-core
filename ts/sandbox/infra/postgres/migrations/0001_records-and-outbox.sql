-- The execution record store, and the outbox beside it.
--
-- These two tables are where ADR-006's first and fifth obligations are
-- actually met, so the guarantees are in the schema rather than in
-- application code that remembers to be careful.
--
--   obligation 1  a record and the events committed with it are written
--                 in one transaction, and nothing is published until
--                 that transaction has committed
--   obligation 5  a record at revision 0 may only be created where none
--                 exists, and any later one must be exactly one greater
--
-- The second of those is a unique constraint and a conditional update
-- rather than a read-then-write, because a read-then-write is only a
-- lock if everybody agrees to take it.
--
-- Run by the migration tool, which wraps it in one transaction of its
-- own, so nothing here opens one.

-- ---------------------------------------------------------------- records

CREATE TABLE execution_record (
  -- ADR-006's derived identity: sixty-four lowercase hexadecimal
  -- characters, and the key everything is addressed by
  execution_id   TEXT        NOT NULL,

  -- ADR-007's compare-and-swap counter. Part of the key, so two writers
  -- at one revision is a constraint violation rather than a lost write.
  cas_version    BIGINT      NOT NULL,

  -- the workflow, which groups the records of one run
  subject        TEXT        NOT NULL,

  -- the contract this execution belongs to, and the version that owns
  -- it for its whole life
  source         TEXT        NOT NULL,
  version        TEXT        NOT NULL,

  -- where it rests. Terminal values accept nothing further.
  lifecycle      TEXT        NOT NULL,

  -- the record itself, exactly as the handler wrote it. Stored whole
  -- because the handler is its only author and a mechanism must not
  -- interpret it.
  document       JSONB       NOT NULL,

  written_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (execution_id, cas_version),

  CONSTRAINT execution_record_lifecycle_known CHECK (
    lifecycle IN ('idle', 'waiting', 'success', 'error', 'cancelled', 'failure')
  ),
  CONSTRAINT execution_record_revision_non_negative CHECK (cas_version >= 0)
);

-- Each of these raises an error code of its own, so a writer that loses
-- can tell what it lost to without reading a message: AR001 is a
-- revision out of sequence, AR002 an attempt to alter one already
-- written, and the primary key's own 23505 is another writer having
-- reached that revision first.
--
-- A record is written once and never altered. Obligation 5 is about who
-- may write the next revision; this is about there being no other way to
-- change what a revision says. Both frameworks have a way to write
-- twice, and neither may use it.
CREATE FUNCTION execution_record_is_written_once() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'revision % of execution % has already been written',
    OLD.cas_version, OLD.execution_id
    USING ERRCODE = 'AR002';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER execution_record_immutable
  BEFORE UPDATE OR DELETE ON execution_record
  FOR EACH ROW EXECUTE FUNCTION execution_record_is_written_once();

-- And a revision must be exactly one past the one before it. The primary
-- key already makes two writers at one revision impossible and makes
-- revision 0 a create-if-absent; this is the other half, so a writer
-- that read a stale record cannot land a revision out of sequence.
--
-- In the database rather than in application code, because a check every
-- writer has to remember to make is a check one of them will not.
CREATE FUNCTION execution_record_revision_follows() RETURNS trigger AS $$
BEGIN
  IF NEW.cas_version = 0 THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM execution_record
    WHERE execution_id = NEW.execution_id
      AND cas_version = NEW.cas_version - 1
  ) THEN
    RAISE EXCEPTION
      'revision % of execution % does not follow the revision before it',
      NEW.cas_version, NEW.execution_id
      USING ERRCODE = 'AR001';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER execution_record_in_sequence
  BEFORE INSERT ON execution_record
  FOR EACH ROW EXECUTE FUNCTION execution_record_revision_follows();

-- What a read of one execution answers with: its latest revision.
CREATE INDEX execution_record_latest
  ON execution_record (execution_id, cas_version DESC);

-- A workflow's records, for finding every execution of one run.
CREATE INDEX execution_record_by_subject
  ON execution_record (subject, written_at);

-- Which executions are still alive, for finding what a run is waiting on.
CREATE INDEX execution_record_unfinished
  ON execution_record (lifecycle, written_at)
  WHERE lifecycle IN ('idle', 'waiting');

-- ----------------------------------------------------------------- outbox

CREATE TABLE outbox (
  -- the event's own id, which ADR-001 makes globally unique. Being the
  -- key is what makes committing the same event twice impossible rather
  -- than merely unlikely.
  event_id       TEXT        NOT NULL PRIMARY KEY,

  -- which execution produced it, and at which revision, so an event can
  -- never be traced to a record that was never committed
  execution_id   TEXT        NOT NULL,
  cas_version    BIGINT      NOT NULL,

  -- where it is going, so a publisher needs to read nothing but this row
  addressed_to   TEXT,
  subject        TEXT        NOT NULL,
  event_type     TEXT        NOT NULL,
  domain         TEXT,

  -- the event as it was committed, byte for byte. Recovery republishes
  -- exactly this rather than asking an executor to produce it again,
  -- which is why nothing here requires a handler to be deterministic.
  payload        TEXT        NOT NULL,

  committed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at   TIMESTAMPTZ,

  -- An event may only exist alongside the record it was committed with.
  -- This is obligation 1 as a constraint: there is no way to write one
  -- without the other, and no way to delete the record and keep it.
  CONSTRAINT outbox_belongs_to_a_committed_record
    FOREIGN KEY (execution_id, cas_version)
    REFERENCES execution_record (execution_id, cas_version)
    ON DELETE CASCADE
);

-- What a publisher claims next: committed, not yet published, oldest first.
CREATE INDEX outbox_unpublished
  ON outbox (committed_at)
  WHERE published_at IS NULL;

-- Everything one execution emitted, for comparing a replay against the run.
CREATE INDEX outbox_by_execution
  ON outbox (execution_id, cas_version);

-- ------------------------------------------------- what the handlers read

-- Dependencies a handler resolves through its factory, so that what an
-- executor is given comes from somewhere real rather than from a literal.
-- What goes in it is the next migration's business; the shape is this
-- one's, because a seed that invents its own columns is a seed that
-- stops matching the store.

CREATE TABLE catalogue (
  sku            TEXT        NOT NULL PRIMARY KEY,
  category       TEXT        NOT NULL,
  held           INTEGER     NOT NULL DEFAULT 0,
  CONSTRAINT catalogue_held_non_negative CHECK (held >= 0)
);

CREATE INDEX catalogue_by_category ON catalogue (category, sku);
