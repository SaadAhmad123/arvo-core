import type Database from 'better-sqlite3';

/**
 * Runs every step the file has not yet run, in order, and records how many
 * it has run. Throws, running nothing, where the file has run more steps
 * than there are: it was written by a newer release. Call it inside one
 * locked write, so a failing step leaves the file as it was and a second
 * opening waits, then finds nothing to run.
 */
export const applyMigrations = (param: {
  readonly database: Database.Database;
  readonly migrations: readonly string[];
  readonly filename: string;
}): void => {
  const fileVersion = Number(
    param.database.pragma('user_version', { simple: true }),
  );
  if (fileVersion > param.migrations.length) {
    throw new Error(
      `ArvoSqliteOutbox cannot open ${param.filename}: its outbox tables are at version ${fileVersion}, and this outbox knows only versions up to ${param.migrations.length}. Open it with the version of arvo-core that wrote it.`,
    );
  }
  for (const migration of param.migrations.slice(fileVersion)) {
    param.database.exec(migration);
  }
  param.database.pragma(`user_version = ${param.migrations.length}`);
};
