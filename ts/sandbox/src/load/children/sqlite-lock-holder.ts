import Database from 'better-sqlite3';
import { childInput } from '../harness/processes.js';

/**
 * Takes the SQLite file's write lock and holds it, as another writer
 * might, then lets it go.
 */

const input = childInput<{
  readonly filename: string;
  readonly holdMs: number;
}>();

const database = new Database(input.filename, { timeout: 10_000 });
database.exec('BEGIN IMMEDIATE');
process.send?.({ kind: 'holding' });
await new Promise((settle) => setTimeout(settle, input.holdMs));
database.exec('COMMIT');
database.close();
process.send?.({ kind: 'released' }, () => process.disconnect?.());
