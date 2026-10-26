import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, describe, expect, it } from 'vitest';
import { configureConnection } from '../../../../src/outbox/sqlite/helpers/configure-connection.js';
import { walSizeLimitBytes } from '../../../../src/outbox/sqlite/helpers/defaults.js';

const temporaryDirectory = mkdtempSync(
  join(tmpdir(), 'arvo-sqlite-connection-'),
);
afterAll(() => rmSync(temporaryDirectory, { recursive: true, force: true }));

/** A connection configured as an outbox configures its own, on a file it has written before. */
const reopenedConnection = () => {
  const filename = join(temporaryDirectory, `${crypto.randomUUID()}.sqlite`);
  const firstConnection = new Database(filename);
  configureConnection(firstConnection);
  firstConnection.exec('create table written (note text)');
  firstConnection.close();
  const connection = new Database(filename);
  configureConnection(connection);
  return connection;
};

describe('a connection an outbox configures', () => {
  it('syncs every commit to disk in full, even on a file already writing ahead of its log', () => {
    const connection = reopenedConnection();
    expect(connection.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(connection.pragma('synchronous', { simple: true })).toBe(2);
    connection.close();
  });

  it('trusts nothing a file defines to run functions', () => {
    const connection = reopenedConnection();
    expect(connection.pragma('trusted_schema', { simple: true })).toBe(0);
    connection.close();
  });

  it('overwrites what it deletes', () => {
    const connection = reopenedConnection();
    expect(connection.pragma('secure_delete', { simple: true })).toBe(1);
    connection.close();
  });

  it('bounds the log it writes ahead of', () => {
    const connection = reopenedConnection();
    expect(connection.pragma('journal_size_limit', { simple: true })).toBe(
      walSizeLimitBytes,
    );
    connection.close();
  });

  it('gives deleted space back to the disk on a file it creates', () => {
    const connection = reopenedConnection();
    expect(connection.pragma('auto_vacuum', { simple: true })).toBe(2);
    connection.close();
  });
});
