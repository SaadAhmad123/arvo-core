import type Database from 'better-sqlite3';
import { walSizeLimitBytes } from './defaults.js';

/**
 * Sets what an outbox needs of its connection before it reads anything,
 * each setting chosen over SQLite's or the library's own default:
 *
 * - nothing a file defines may run functions, so a tampered file runs none;
 * - a file it creates gives deleted space back, which SQLite fixes before
 *   the first table, so this must come before anything is created;
 * - readers do not wait on writers;
 * - every commit is synced to disk in full, since the library opens a file
 *   already writing ahead of its log at a level a power cut can undo;
 * - what is deleted is overwritten, not left readable in the file;
 * - the log written ahead of is cut back once checkpointed.
 */
export const configureConnection = (database: Database.Database): void => {
  database.pragma('trusted_schema = OFF');
  database.pragma('auto_vacuum = INCREMENTAL');
  database.pragma('journal_mode = WAL');
  database.pragma('synchronous = FULL');
  database.pragma('secure_delete = ON');
  database.pragma(`journal_size_limit = ${walSizeLimitBytes}`);
};
