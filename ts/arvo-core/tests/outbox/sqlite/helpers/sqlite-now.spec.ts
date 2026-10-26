import { describe, expect, it } from 'vitest';
import { readSqliteNow } from '../../../../src/outbox/sqlite/helpers/sqlite-now.js';

describe("reading SQLite's clock", () => {
  it('answers the time SQLite gave', () => {
    expect(
      readSqliteNow({ get: () => ({ now: '2026-01-01T00:00:00.000Z' }) }),
    ).toBe('2026-01-01T00:00:00.000Z');
  });

  it('throws where SQLite gave no time', () => {
    expect(() => readSqliteNow({ get: () => undefined })).toThrow(
      'ArvoSqliteOutbox asked SQLite for the current time and got no answer; nothing was committed.',
    );
  });
});
