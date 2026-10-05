import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { catalogueFor } from '../../../src/distributed/shared/catalogue.js';
import { readConfig } from '../../../src/distributed/shared/config.js';

/**
 * What the handlers are given, against the database that holds it.
 *
 * Every number the scenario fans out over, walks down or stops at comes
 * from this table, so a catalogue that answered differently than the
 * migration seeded would make a mechanism look wrong for arriving at
 * the right answer. These assertions are about the seed as much as
 * about the query.
 *
 * It needs the stack up and migrated: `pnpm run distributed:up` then
 * `pnpm run distributed:migrate`.
 */

/** The category a run fans out over, which is also the tree it walks. */
const WIDE = 'orders';

/** The chain seeded deeper than the walk's declared bound. */
const DEEP = 'deep';

describe('the catalogue', () => {
  let pool: Pool;
  let poolSize: number;

  beforeAll(() => {
    const config = readConfig('arvo-catalogue-spec');
    poolSize = config.recordsPoolSize;
    pool = new Pool({
      connectionString: config.recordsUrl,
      max: poolSize,
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('answers with more items than any run fans out over', async () => {
    const { catalogue, release } = await catalogueFor(pool);
    try {
      const items = await catalogue.itemsIn(WIDE);
      // the scenario's width, which the seed must exceed rather than meet
      expect(items.length).toBeGreaterThan(500);
      // ordered, so two mechanisms fan out over the same items in the
      // same order and a difference between them is theirs
      expect([...items]).toEqual([...items].sort());
    } finally {
      release();
    }
  });

  it('holds some of what it lists and none of the rest', async () => {
    const { catalogue, release } = await catalogueFor(pool);
    try {
      const items = await catalogue.itemsIn(WIDE);
      const held = await Promise.all(items.map((sku) => catalogue.heldOf(sku)));

      // both kinds exist, so a run's answer can distinguish what it
      // checked from what it found sufficient
      expect(held.some((amount) => amount > 0)).toBe(true);
      expect(held.some((amount) => amount === 0)).toBe(true);
    } finally {
      release();
    }
  });

  it('answers nothing for an item it has never heard of', async () => {
    const { catalogue, release } = await catalogueFor(pool);
    try {
      expect(await catalogue.heldOf('sku-that-does-not-exist')).toBe(0);
    } finally {
      release();
    }
  });

  it('descends one level at a time and no further', async () => {
    const { catalogue, release } = await catalogueFor(pool);
    try {
      const children = await catalogue.childrenOf(WIDE);
      expect(children.length).toBeGreaterThan(0);

      for (const child of children) {
        expect(child.startsWith(`${WIDE}/`)).toBe(true);
        // exactly one segment deeper: a walk that was handed its
        // grandchildren would visit a node twice and still terminate
        expect(child.slice(WIDE.length + 1)).not.toContain('/');
      }

      // and the level below is reachable, so the tree is a tree
      const first = children[0];
      expect(first).toBeDefined();
      if (first !== undefined) {
        expect((await catalogue.childrenOf(first)).length).toBeGreaterThan(0);
      }
    } finally {
      release();
    }
  });

  it('is deeper in one place than a walk is allowed to go', async () => {
    const { catalogue, release } = await catalogueFor(pool);
    try {
      let where: string | undefined = DEEP;
      let levels = 0;

      while (where !== undefined) {
        levels += 1;
        const children: readonly string[] = await catalogue.childrenOf(where);
        where = children[0];
      }

      // the walk's declared bound, which this must exceed so one
      // variant of the scenario crosses it on purpose
      expect(levels).toBeGreaterThan(12);
    } finally {
      release();
    }
  });

  it('gives its connection back, so a run cannot exhaust the pool', async () => {
    // more executions than the pool holds, each opening and closing in
    // turn: a catalogue that leaked would hang here rather than fail
    for (let execution = 0; execution < poolSize * 2; execution += 1) {
      const { catalogue, release } = await catalogueFor(pool);
      await catalogue.heldOf('sku-wide-0001');
      release();
    }

    expect(pool.idleCount).toBeGreaterThan(0);
    expect(pool.waitingCount).toBe(0);
  });
});
