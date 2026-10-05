-- What the handlers read, so nothing an executor is given is a literal.
--
-- The scenario's numbers come from here rather than from the code that
-- runs it. A run asks the catalogue what exists and fans out over the
-- answer, which means the width of a fan-out, the shape of a tree and
-- the depth a walk can reach are all facts about this table. Putting
-- them in a migration is what makes them the same facts for every
-- mechanism.
--
-- Three things are seeded, each for a reason the scenario names:
--
--   the wide category   more items than any run fans out over, so a
--                       width is a decision rather than whatever
--                       happened to be there
--   the shallow tree    branching, and shallower than the walk's
--                       declared bound, so one variant respects the
--                       boundary without reaching it
--   the deep chain      one child per level, and deeper than that
--                       bound, so the other variant crosses it on
--                       purpose and must stop itself
--
-- Categories are paths, and a category's children are the paths one
-- segment longer. The store keeps no edges: a tree that exists in two
-- places is a tree that can disagree with itself.

-- -------------------------------------------------------- the wide category

-- Every item a fan-out could reach for. Deliberately more than any run
-- takes, so a run that took all of them would be a different test.
INSERT INTO catalogue (sku, category, held)
SELECT
  'sku-wide-' || to_char(n, 'FM0000'),
  'orders',
  -- Most are held and some are not, so a run's answer distinguishes
  -- *checked* from *sufficient*. Every answer being the same answer
  -- would let a mechanism lose some and still look right.
  CASE WHEN n % 7 = 0 THEN 0 ELSE 5 END
FROM generate_series(1, 600) AS n;

-- --------------------------------------------------------- the shallow tree

-- Beneath the wide category, so one run can fan out over it and walk it
-- at the same time — which is the whole point of the orchestrator.
INSERT INTO catalogue (sku, category, held)
SELECT
  'sku-branch-' || first || '-' || second || '-' || third || '-' || item,
  concat_ws(
    '/',
    'orders',
    'branch-' || first,
    CASE WHEN second > 0 THEN 'shelf-' || second END,
    CASE WHEN third  > 0 THEN 'bin-'   || third  END
  ),
  4
FROM generate_series(1, 3) AS first
CROSS JOIN generate_series(0, 3) AS second
CROSS JOIN generate_series(0, 3) AS third
CROSS JOIN generate_series(1, 2) AS item
-- A bin under no shelf is not a place, so the levels fill in order.
WHERE second > 0 OR third = 0;

-- ----------------------------------------------------------- the deep chain

-- One child per level, far enough down that a walk reaches its declared
-- bound with children still unvisited. A bound nothing ever meets is a
-- bound nothing has tested.
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
