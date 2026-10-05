import type { Pool, PoolClient } from 'pg';
import type { Catalogue } from '../handler/dependencies.js';

/**
 * The handlers' own data, on a real connection.
 *
 * This is what a mechanism hands a handler through the dependency
 * factory. It is the application's store and not the mechanism's: what
 * records an execution and what a handler reads and writes are different
 * questions with different answers, and conflating them is how a handler
 * ends up knowing what it is running under.
 *
 * One connection per execution, taken when the factory is called and
 * given back when the delivery ends.
 */

/** What an item looks like as a row. */
type ItemRow = { sku: string; held: number };

/**
 * A catalogue holding one connection, and how to give it back.
 *
 * @param pool - Where connections come from, bounded by configuration so
 * a leak shows up as exhaustion rather than as a slow worker.
 */
export const catalogueFor = async (
  pool: Pool,
): Promise<{ catalogue: Catalogue; release: () => void }> => {
  const client: PoolClient = await pool.connect();

  const catalogue: Catalogue = {
    itemsIn: async (category) => {
      const rows = await client.query<ItemRow>(
        'SELECT sku FROM catalogue WHERE category = $1 ORDER BY sku',
        [category],
      );
      return rows.rows.map((row) => row.sku);
    },

    childrenOf: async (category) => {
      // A category's children are the paths one segment longer, which
      // this schema encodes as a prefix. No edge table to keep honest.
      const rows = await client.query<{ category: string }>(
        `SELECT DISTINCT category FROM catalogue
         WHERE category LIKE $1 AND category <> $2
           AND length(category) - length(replace(category, '/', '')) =
               length($2) - length(replace($2, '/', '')) + 1
         ORDER BY category`,
        [`${category}/%`, category],
      );
      return rows.rows.map((row) => row.category);
    },

    heldOf: async (sku) => {
      const rows = await client.query<{ held: number }>(
        'SELECT held FROM catalogue WHERE sku = $1',
        [sku],
      );
      return rows.rows[0]?.held ?? 0;
    },

    reserve: async (sku, wanted) => {
      // Takes what it can and says how much, rather than failing: a
      // handler decides what a short answer means.
      const rows = await client.query<{ held: number }>(
        `UPDATE catalogue
         SET held = held - LEAST(held, $2::int)
         WHERE sku = $1
         RETURNING held`,
        [sku, wanted],
      );
      return rows.rows.length === 0 ? 0 : wanted;
    },
  };

  return { catalogue, release: () => client.release() };
};
