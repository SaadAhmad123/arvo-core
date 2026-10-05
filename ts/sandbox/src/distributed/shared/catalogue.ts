import type { Pool, PoolClient } from 'pg';
import type { Catalogue } from '../handler/dependencies.js';

/**
 * The catalogue, against the database that holds it.
 *
 * Opened for one execution and closed with it, which is the only shape
 * in which ADR-000's rule — that nothing live survives a suspension —
 * holds by construction rather than by discipline. A pool shared across
 * executions would satisfy the type and lose the property.
 *
 * Bounded on purpose: a worker that leaks a connection per execution
 * exhausts the pool rather than slowing down, and exhaustion is a
 * failure a handler can see.
 */

/** What a category is made of, as the catalogue stores it. */
type CatalogueRow = { sku: string; held: number };

/**
 * A catalogue holding one connection for one execution.
 *
 * @param pool - Where connections come from, bounded by configuration.
 * @returns The catalogue, and how to give the connection back.
 */
export const catalogueFor = async (
  pool: Pool,
): Promise<{ catalogue: Catalogue; release: () => void }> => {
  const client: PoolClient = await pool.connect();

  const catalogue: Catalogue = {
    itemsIn: async (category) => {
      const found = await client.query<CatalogueRow>(
        'SELECT sku, held FROM catalogue WHERE category = $1 ORDER BY sku',
        [category],
      );
      return found.rows.map((row) => row.sku);
    },

    childrenOf: async (category) => {
      // A category's children are the categories one level under it,
      // which this schema encodes as a prefix. Enough to make a tree
      // without a second table to keep honest.
      const found = await client.query<{ category: string }>(
        `SELECT DISTINCT category FROM catalogue
         WHERE category LIKE $1 AND category <> $2
           AND length(category) - length(replace(category, '/', '')) =
               length($2) - length(replace($2, '/', '')) + 1
         ORDER BY category`,
        [`${category}/%`, category],
      );
      return found.rows.map((row) => row.category);
    },

    heldOf: async (sku) => {
      const found = await client.query<{ held: number }>(
        'SELECT held FROM catalogue WHERE sku = $1',
        [sku],
      );
      return found.rows[0]?.held ?? 0;
    },
  };

  return { catalogue, release: () => client.release() };
};
