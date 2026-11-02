import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ArvoSqliteOutbox,
  ArvoSqliteOutboxValidationError,
  createArvoSqliteOutbox,
  tryCreateArvoSqliteOutbox,
} from '../../../src/outbox/sqlite/index.js';

/** A file name nothing has used, which the factories must not create. */
const unusedFilename = () =>
  join(tmpdir(), `arvo-sqlite-factory-${crypto.randomUUID()}.sqlite`);

describe('building a SQLite outbox through its factories', () => {
  it('answers the outbox where the options are valid, touching no file', () => {
    const filename = unusedFilename();
    const outboxResult = tryCreateArvoSqliteOutbox({ filename });
    expect(outboxResult.ok && outboxResult.value).toBeInstanceOf(
      ArvoSqliteOutbox,
    );
    expect(createArvoSqliteOutbox({ filename })).toBeInstanceOf(
      ArvoSqliteOutbox,
    );
    expect(existsSync(filename)).toBe(false);
  });

  it('answers the validation error as a value, or throws it', () => {
    const invalidOptions = { filename: unusedFilename(), busyTimeoutMs: -1 };
    const outboxResult = tryCreateArvoSqliteOutbox(invalidOptions);
    expect(!outboxResult.ok && outboxResult.error).toBeInstanceOf(
      ArvoSqliteOutboxValidationError,
    );
    expect(() => createArvoSqliteOutbox(invalidOptions)).toThrow(
      ArvoSqliteOutboxValidationError,
    );
  });
});

describe('building a SQLite outbox through its factory, where something else throws', () => {
  it('lets anything but a validation error go up as it arrived', () => {
    const optionReadFailure = new Error('the options could not be read');
    // deliberately an option that throws when read, as a proxy could
    const unreadableOptions = Object.defineProperty(
      { filename: unusedFilename() },
      'busyTimeoutMs',
      {
        enumerable: true,
        get: () => {
          throw optionReadFailure;
        },
      },
    );
    expect(() => tryCreateArvoSqliteOutbox(unreadableOptions)).toThrow(
      optionReadFailure,
    );
  });
});
