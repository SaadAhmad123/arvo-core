-- Where an event goes when nothing running will carry it further.
--
-- Three different things end up here, and the column says which, because
-- a table that mixed them would be a table nobody could act on:
--
--   left_the_lattice     the event carries a domain, so no handler may
--                        be given it. The execution that asked rests at
--                        waiting until something outside answers.
--   addressed_outside    nothing here implements what it is addressed
--                        to. A run's final answer is this: its caller
--                        asked for the run and is not a handler.
--   nothing_will_retry   a delivery that failed in a way no further
--                        attempt could fix, and that carried no
--                        abandonment of its own to commit. ADR-008's
--                        last resort, and §13.12's poison path.
--
-- All three are a person's to look at, which is the point: a failure
-- nobody can find is a failure that will be met blind.

CREATE TABLE needs_a_person (
  -- the event's own id, so the same event arriving here twice is one row
  event_id       TEXT        NOT NULL PRIMARY KEY,

  -- which of the three this is
  why            TEXT        NOT NULL,

  -- what a person searches by
  subject        TEXT        NOT NULL,
  execution_id   TEXT,
  event_type     TEXT        NOT NULL,
  addressed_to   TEXT,
  domain         TEXT,

  -- what went wrong, where anything did
  message        TEXT,

  -- the event as it stood, so answering it needs nothing else
  payload        TEXT        NOT NULL,

  noticed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- when something outside dealt with it, which only the first two ever
  -- have set
  answered_at    TIMESTAMPTZ,

  CONSTRAINT needs_a_person_why_known CHECK (
    why IN ('left_the_lattice', 'addressed_outside', 'nothing_will_retry')
  )
);

-- What is still outstanding, which is what a person is looking for.
CREATE INDEX needs_a_person_outstanding
  ON needs_a_person (why, noticed_at)
  WHERE answered_at IS NULL;

-- Everything one run put here, for finding what a run is waiting on.
CREATE INDEX needs_a_person_by_subject ON needs_a_person (subject);
