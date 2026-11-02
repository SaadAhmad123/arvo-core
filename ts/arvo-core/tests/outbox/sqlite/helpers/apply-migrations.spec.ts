import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { applyMigrations } from '../../../../src/outbox/sqlite/helpers/apply-migrations.js';

/** Two steps, each adding one table. */
const twoMigrations = Object.freeze([
  'create table first_step (value text)',
  'create table second_step (value text)',
]);

/** The tables a database holds, by name. */
const tableNames = (database: Database.Database) =>
  database
    .prepare<[], { name: string }>(
      "select name from sqlite_schema where type = 'table' order by name",
    )
    .all()
    .map((table) => table.name);

/** Runs the migrations as an outbox does: in one locked write. */
const applyInLockedWrite = (
  database: Database.Database,
  migrations: readonly string[],
) =>
  database
    .transaction(() =>
      applyMigrations({ database, migrations, filename: 'outbox.sqlite' }),
    )
    .immediate();

describe('applying migrations to a file', () => {
  it('runs every step on a new file, and records how many', () => {
    const database = new Database(':memory:');
    applyInLockedWrite(database, twoMigrations);
    expect(tableNames(database)).toEqual(['first_step', 'second_step']);
    expect(database.pragma('user_version', { simple: true })).toBe(2);
  });

  it('runs only the steps a file has not yet run', () => {
    const database = new Database(':memory:');
    applyInLockedWrite(database, twoMigrations.slice(0, 1));
    database.exec("insert into first_step values ('kept')");
    applyInLockedWrite(database, twoMigrations);
    expect(tableNames(database)).toEqual(['first_step', 'second_step']);
    expect(database.prepare('select value from first_step').all()).toEqual([
      { value: 'kept' },
    ]);
  });

  it('runs nothing on a file that has run every step', () => {
    const database = new Database(':memory:');
    applyInLockedWrite(database, twoMigrations);
    expect(() => applyInLockedWrite(database, twoMigrations)).not.toThrow();
    expect(database.pragma('user_version', { simple: true })).toBe(2);
  });

  it('leaves the file as it was where a step fails', () => {
    const database = new Database(':memory:');
    applyInLockedWrite(database, twoMigrations.slice(0, 1));
    expect(() =>
      applyInLockedWrite(database, [...twoMigrations, 'this is not sql']),
    ).toThrow();
    expect(tableNames(database)).toEqual(['first_step']);
    expect(database.pragma('user_version', { simple: true })).toBe(1);
  });

  it('refuses a file that has run more steps than there are, running nothing', () => {
    const database = new Database(':memory:');
    database.pragma('user_version = 3');
    expect(() => applyInLockedWrite(database, twoMigrations)).toThrow(
      'ArvoSqliteOutbox cannot open outbox.sqlite: its outbox tables are at version 3, and this outbox knows only versions up to 2. Open it with the version of arvo-core that wrote it.',
    );
    expect(tableNames(database)).toEqual([]);
  });
});
