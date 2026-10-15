import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import { Client } from 'pg';
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

/** The database name at the end of a connection string. */
const databaseIn = (url: string): string =>
  new URL(url).pathname.replace(/^\//, '');

/**
 * Creates DBOS's system database if it is not there yet.
 *
 * Only the database, never anything in it. DBOS owns its own schema and
 * migrates it at launch; what it will not do is create the database to
 * put that schema in, and a worker pointed at one that does not exist
 * waits rather than failing — which looks exactly like a worker that
 * cannot reach its store.
 *
 * So this belongs to bringing the stack up, beside the migrations and
 * for the same reason: a thing a process needs before it can start is
 * not a thing it should create while starting.
 *
 * @returns Whether it had to be created.
 */
export const ensureDbosDatabase = async (): Promise<boolean> => {
  const config = readConfig('arvo-migrate');
  const wanted = databaseIn(config.dbosSystemUrl);

  // Connected to `postgres`, since a database cannot be created from
  // inside itself.
  const admin = new Client({
    connectionString: new URL('/postgres', config.dbosSystemUrl).toString(),
  });
  await admin.connect();
  try {
    const found = await admin.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [wanted],
    );
    if ((found.rowCount ?? 0) > 0) return false;

    // Not parameterizable: an identifier is not a value. Quoted rather
    // than interpolated bare, and the name comes from configuration this
    // process already validated.
    await admin.query(`CREATE DATABASE "${wanted.replaceAll('"', '""')}"`);
    return true;
  } finally {
    await admin.end();
  }
};

/**
 * Runs every migration not yet run, in order.
 *
 * @returns What it ran, oldest first, so a caller can say whether
 * anything changed.
 */
export const migrateRecords = async (): Promise<readonly string[]> => {
  const config = readConfig('arvo-migrate');

  const applied = await runner({
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

  return applied.map((migration) => migration.name);
};

/** Whether this file is what Node was asked to run, rather than imported. */
const runDirectly =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (runDirectly) {
  ensureDbosDatabase()
    .then(async (created) => {
      if (created) console.log('  created the DBOS system database');
      return migrateRecords();
    })
    .then((applied) => {
      for (const name of applied) console.log(`  ran ${name}`);
      console.log(
        applied.length === 0
          ? '  the store is already at this schema.'
          : `  the store is at this schema, ${applied.length} migration(s) later.`,
      );
    })
    .catch((raised: unknown) => {
      console.error(`\n  the store could not be migrated: ${String(raised)}`);
      process.exitCode = 1;
    });
}
