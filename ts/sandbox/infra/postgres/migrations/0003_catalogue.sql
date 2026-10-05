-- The handlers' own data.
--
-- Not the mechanism's. What records an execution and what a handler
-- reads and writes are different questions: a mechanism may keep its
-- records wherever it likes, and the handlers still read this, through
-- the dependency factory, on a connection taken per execution.
--
-- Seeded here so the shape of a run is a fact about the store rather
-- than a literal in a test: how wide a fan-out can go, how deep a walk
-- can descend, and which items come back short are all read from these
-- rows.

CREATE TABLE catalogue (
  sku        TEXT    NOT NULL PRIMARY KEY,
  category   TEXT    NOT NULL,
  held       INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT catalogue_held_non_negative CHECK (held >= 0)
);

CREATE INDEX catalogue_by_category ON catalogue (category, sku);

-- ------------------------------------------------------- the wide category

-- More items than any run fans out over, so a width is a decision rather
-- than whatever happened to be there.
INSERT INTO catalogue (sku, category, held)
SELECT
  'sku-wide-' || to_char(position, 'FM0000'),
  'orders',
  -- Most are held and some are not, so a run's answer distinguishes what
  -- it checked from what it found sufficient.
  CASE WHEN position % 7 = 0 THEN 0 ELSE 5 END
FROM generate_series(1, 600) AS position;

-- -------------------------------------------------------- the shallow tree

-- Beneath the wide category, so one run fans out over it and walks it at
-- the same time.
INSERT INTO catalogue (sku, category, held)
SELECT
  'sku-branch-' || branch || '-' || shelf || '-' || bin || '-' || item,
  concat_ws(
    '/',
    'orders',
    'branch-' || branch,
    CASE WHEN shelf > 0 THEN 'shelf-' || shelf END,
    CASE WHEN bin   > 0 THEN 'bin-'   || bin   END
  ),
  4
FROM generate_series(1, 3) AS branch
CROSS JOIN generate_series(0, 3) AS shelf
CROSS JOIN generate_series(0, 3) AS bin
CROSS JOIN generate_series(1, 2) AS item
-- a bin under no shelf is not a place, so the levels fill in order
WHERE shelf > 0 OR bin = 0;

-- ---------------------------------------------------------- the deep chain

-- One child per level, further down than a walk is allowed to go, so one
-- variant of a run reaches its declared bound with children unvisited.
WITH RECURSIVE chain (level, path) AS (
  SELECT 1, 'deep'
  UNION ALL
  SELECT level + 1, path || '/level-' || to_char(level + 1, 'FM00')
  FROM chain
  WHERE level < 24
)
INSERT INTO catalogue (sku, category, held)
SELECT 'sku-deep-' || to_char(level, 'FM00'), path, 2
FROM chain;
