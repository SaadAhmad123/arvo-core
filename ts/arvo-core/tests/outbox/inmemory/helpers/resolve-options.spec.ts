import { describe, expect, it } from 'vitest';
import { resolveOptions } from '../../../../src/outbox/inmemory/helpers/resolve-options.js';

describe('resolving the options of an in-memory outbox', () => {
  it('applies every default where nothing is given', () => {
    const resolvedOptions = resolveOptions({});
    expect(resolvedOptions.buffers).toEqual({
      events: { size: 50_000, tolerance: 0.2 },
      states: { size: 50_000, tolerance: 0.2 },
    });
    expect(resolvedOptions.retentionMs).toEqual({
      seenEvents: 60 * 1000,
      terminalStates: 10 * 60 * 1000,
    });
    expect(resolvedOptions.clock()).toBeInstanceOf(Date);
  });

  it('keeps whatever is given, and defaults only the rest', () => {
    const clock = () => new Date(0);
    const resolvedOptions = resolveOptions({
      clock,
      buffers: { states: { size: 5, tolerance: 0 } },
      retentionMs: { seenEvents: 0 },
    });
    expect(resolvedOptions.clock).toBe(clock);
    expect(resolvedOptions.buffers).toEqual({
      events: { size: 50_000, tolerance: 0.2 },
      states: { size: 5, tolerance: 0 },
    });
    expect(resolvedOptions.retentionMs).toEqual({
      seenEvents: 0,
      terminalStates: 10 * 60 * 1000,
    });
  });

  it.each([
    [5 * 60 * 1000, 60 * 60 * 1000, 30 * 1000],
    [60 * 60 * 1000, 60 * 60 * 1000, 6 * 60 * 1000],
    [2000, 60 * 60 * 1000, 1000],
    [0, 60 * 60 * 1000, 1000],
  ])(
    'sweeps, with retentions of %i and %i, every %i milliseconds',
    (seenEvents, terminalStates, sweepIntervalMs) => {
      expect(
        resolveOptions({ retentionMs: { seenEvents, terminalStates } })
          .sweepIntervalMs,
      ).toBe(sweepIntervalMs);
    },
  );
});
