import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArvoOutboxDriver, type IArvoOutbox } from 'arvo-core';
import {
  type ArvoMemoryOutboxOptions,
  createArvoMemoryOutbox,
} from 'arvo-core/outbox/inmemory';
import {
  type ArvoSqliteOutboxOptions,
  createArvoSqliteOutbox,
} from 'arvo-core/outbox/sqlite';
import { timeOutbox } from './timed-outbox.js';

/**
 * The outbox a check runs against, behind one shape, so a check written
 * once runs against both.
 */

/** An outbox opened for one check, behind a driver, its timings kept. */
export type OpenedSubject = {
  readonly outbox: IArvoOutbox;
  readonly driver: ArvoOutboxDriver;
  /** The file a SQLite subject is kept in; none for in-memory. */
  readonly filename: string | null;
  /** Writes each outbox operation's timings to the report. */
  readonly reportTimings: (check: string) => void;
  /** The SQLite outbox's own call deleting everything expired; none for in-memory. */
  readonly deleteExpired:
    | (() => { readonly events: number; readonly states: number })
    | null;
  /** Closes the outbox and deletes whatever it kept on disk. */
  readonly close: () => Promise<void>;
};

/** How a check gets a new outbox of one kind. */
export type LoadSubject = {
  readonly name: 'inmemory' | 'sqlite';
  readonly open: (options?: {
    readonly inmemory?: ArvoMemoryOutboxOptions;
    readonly sqlite?: Partial<ArvoSqliteOutboxOptions>;
  }) => Promise<OpenedSubject>;
};

/** Buffers large enough that a check not about room never runs out of it. */
const ROOMY_BUFFERS = Object.freeze({
  events: Object.freeze({ size: 2_000_000, tolerance: 0.5 }),
  states: Object.freeze({ size: 500_000, tolerance: 0.5 }),
});

/** Wraps an outbox in timing and a driver, and opens it. */
const openBehindDriver = async (
  outbox: IArvoOutbox,
  filename: string | null,
  deleteExpired: OpenedSubject['deleteExpired'] = null,
): Promise<OpenedSubject> => {
  const timing = timeOutbox(outbox);
  const driver = new ArvoOutboxDriver({ outbox: timing.timedOutbox });
  await driver.open();
  return {
    outbox,
    driver,
    filename,
    reportTimings: timing.report,
    deleteExpired,
    close: async () => {
      await driver.close();
      if (filename !== null) {
        for (const suffix of ['', '-wal', '-shm']) {
          rmSync(`${filename}${suffix}`, { force: true });
        }
      }
    },
  };
};

export const inMemorySubject: LoadSubject = {
  name: 'inmemory',
  open: (options) =>
    openBehindDriver(
      createArvoMemoryOutbox({ buffers: ROOMY_BUFFERS, ...options?.inmemory }),
      null,
    ),
};

/** Where a SQLite subject keeps its files: inside the container, never the host. */
export const sqliteFolder = (): string => process.env.LOAD_DISK ?? tmpdir();

export const sqliteSubject: LoadSubject = {
  name: 'sqlite',
  open: (options) => {
    const filename =
      options?.sqlite?.filename ??
      join(sqliteFolder(), `${crypto.randomUUID()}.sqlite`);
    const outbox = createArvoSqliteOutbox({ ...options?.sqlite, filename });
    return openBehindDriver(outbox, filename, () => outbox.deleteExpired());
  },
};
