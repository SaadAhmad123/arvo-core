import type {
  ArvoDependencyScope,
  IArvoEventHandlerDependency,
} from 'arvo-core';
import type { Pool, PoolClient } from 'pg';
import type {
  Catalogue,
  DistributedDependencies,
} from '../handler/dependencies.js';

/**
 * The handlers' own data, on a connection held for one execution.
 *
 * This is what a mechanism hands a handler. It is the application's
 * store and not the mechanism's: what records an execution and what a
 * handler reads are different questions, and conflating them is how a
 * handler ends up knowing what it is running under.
 *
 * The connection is taken when the handler opens this and given back
 * when it closes it, so nothing live survives a suspension by
 * construction rather than because a mechanism remembered to release it.
 */

/** What an item looks like as a row. */
type ItemRow = { sku: string; held: number };

/** The catalogue, against one connection. */
const catalogueOn = (client: PoolClient): Catalogue => ({
  itemsIn: async (category) => {
    const rows = await client.query<ItemRow>(
      'SELECT sku FROM catalogue WHERE category = $1 ORDER BY sku',
      [category],
    );
    return rows.rows.map((row) => row.sku);
  },

  childrenOf: async (category) => {
    // A category's children are the paths one segment longer, which this
    // schema encodes as a prefix. No edge table to keep honest.
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
    // Takes what it can and says how much rather than failing: a handler
    // decides what a short answer means.
    const rows = await client.query<{ held: number }>(
      `UPDATE catalogue
       SET held = held - LEAST(held, $2::int)
       WHERE sku = $1
       RETURNING held`,
      [sku, wanted],
    );
    return rows.rows.length === 0 ? 0 : wanted;
  },
});

/**
 * What the handlers in this run are given, on a pooled connection.
 *
 * One of these per worker rather than per execution: opening and closing
 * are what belong to an execution, and both are safe to call again.
 */
export class PostgresCatalogue
  implements IArvoEventHandlerDependency<DistributedDependencies>
{
  #client: PoolClient | null = null;
  #scope: ArvoDependencyScope | null = null;

  constructor(private readonly pool: Pool) {}

  /**
   * Takes a connection for this execution.
   *
   * @param scope - The execution being opened for.
   */
  async open(scope: ArvoDependencyScope): Promise<void> {
    this.#scope = scope;
    // idempotent: a second open holds the connection the first took
    this.#client ??= await this.pool.connect();
  }

  /** Gives the connection back. Safe where none was ever taken. */
  async close(): Promise<void> {
    this.#client?.release();
    this.#client = null;
    this.#scope = null;
  }

  get attributes(): DistributedDependencies {
    if (this.#client === null || this.#scope === null) {
      throw new Error('this catalogue is not open');
    }
    return {
      catalogue: catalogueOn(this.#client),
      executionId: this.#scope.executionId,
      attempt: this.#scope.attempt,
      resumed: this.#scope.state,
    };
  }
}
