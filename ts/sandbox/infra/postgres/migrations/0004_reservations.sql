-- What an idempotency key buys, where the handler passes one.
--
-- Taking stock is the write §11.5 shows happening twice: two workers can
-- both carry out one delivery, and compare-and-swap on the record does
-- not prevent it — it only decides whose record is kept, after both
-- writes have already landed here.
--
-- The key is the primary key, so the second attempt to claim it loses to
-- a constraint rather than to a decision taken in application code. What
-- it then reads back is what the first attempt took, so a repeat answers
-- the same as the original instead of answering zero.

CREATE TABLE reservation (
  -- One of the keys an executor is given. Which scope it came from is the
  -- handler's choice and not recorded here: what this table enforces is
  -- that one key takes stock once.
  idempotency_key TEXT        NOT NULL PRIMARY KEY,
  sku             TEXT        NOT NULL REFERENCES catalogue (sku),
  taken           INTEGER     NOT NULL,
  claimed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT reservation_taken_non_negative CHECK (taken >= 0)
);

CREATE INDEX reservation_by_sku ON reservation (sku, claimed_at);
