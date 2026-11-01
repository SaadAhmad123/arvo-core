import { describe, expect, it } from 'vitest';
import { resolveOptions } from '../../../../src/outbox/sqlite/helpers/resolve-options.js';

describe('resolving the options of a SQLite outbox', () => {
  it('applies every default where nothing but the file is given', () => {
    expect(resolveOptions({ filename: 'outbox.sqlite' })).toEqual({
      filename: 'outbox.sqlite',
      busyTimeoutMs: 5000,
      retentionMs: {
        seenEvents: 7 * 24 * 60 * 60 * 1000,
        terminalStates: 7 * 24 * 60 * 60 * 1000,
      },
    });
  });

  it('keeps whatever is given, and defaults only the rest', () => {
    expect(
      resolveOptions({
        filename: 'outbox.sqlite',
        busyTimeoutMs: 0,
        retentionMs: { terminalStates: Number.POSITIVE_INFINITY },
      }),
    ).toEqual({
      filename: 'outbox.sqlite',
      busyTimeoutMs: 0,
      retentionMs: {
        seenEvents: 7 * 24 * 60 * 60 * 1000,
        terminalStates: Number.POSITIVE_INFINITY,
      },
    });
  });
});
