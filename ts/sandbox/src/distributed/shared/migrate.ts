import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import { readConfig } from './config.js';

/**
 * Brings the record store to the schema this run expects.
 *
 * A migration rather than schema created on the way past: the store's
 * guarantees are constraints, and a constraint that an application
 * creates when it happens to need it is a constraint that can be
 * missing when it matters. Running this is a step of bringing the stack
 * up, not something a worker does on boot.
 *
 * It takes the same configuration every worker takes, so a migration
 * cannot reach a database no worker would have reached.
 *
 * Run directly: `pnpm run distributed:migrate`.
 */

/** Where the migrations are, found from this file rather than from the shell's cwd. */
const MIGRATIONS = fileURLToPath(
  new URL('../../../infra/postgres/migrations', import.meta.url),
);

/** Where the record of what has been run is kept. */
const LEDGER = 'schema_migrations';

/**
 * Runs every migration not yet run, in order.
 *
 * @returns What it ran, oldest first, so a caller can say whether
 * anything changed.
 */
export const migrateRecords = async (): Promise<readonly string[]> => {
  const config = readConfig('arvo-migrate');

  const ran = await runner({
    databaseUrl: config.recordsUrl,
    dir: MIGRATIONS,
    direction: 'up',
    migrationsTable: LEDGER,
    // One transaction for all of them: a half-migrated store is worse
    // than an unmigrated one, because the second is obvious.
    singleTransaction: true,
    // Order is checked, so a migration slipped in behind one already
    // run is refused rather than applied out of sequence.
    checkOrder: true,
    log: () => {},
  });

  return ran.map((one) => one.name);
};

/** Whether this file is what Node was asked to run, rather than imported. */
const runDirectly =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (runDirectly) {
  migrateRecords()
    .then((ran) => {
      for (const one of ran) console.log(`  ran ${one}`);
      console.log(
        ran.length === 0
          ? '  the store is already at this schema.'
          : `  the store is at this schema, ${ran.length} migration(s) later.`,
      );
    })
    .catch((raised: unknown) => {
      console.error(`\n  the store could not be migrated: ${String(raised)}`);
      process.exitCode = 1;
    });
}
