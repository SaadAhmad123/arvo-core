import { describe, expect, it } from 'vitest';
import {
  bufferCapacity,
  isDrained,
} from '../../../../src/outbox/inmemory/helpers/buffer-capacity.js';

/** A buffer meant to hold ten, and at most twelve. */
const buffer = Object.freeze({ size: 10, tolerance: 0.2 });

describe("one in-memory buffer's capacity", () => {
  it.each([
    [0, 'available'],
    [10, 'available'],
    [11, 'tolerating'],
    [12, 'tolerating'],
    [13, 'exhausted'],
  ] as const)('holding %i answers %s', (held, status) => {
    expect(bufferCapacity({ held, buffer, tolerating: false })).toEqual({
      status,
      held,
      size: 10,
      limit: 12,
    });
  });

  it('stays tolerating while the steady flag is set, though back within its size', () => {
    expect(bufferCapacity({ held: 9, buffer, tolerating: true }).status).toBe(
      'tolerating',
    );
  });

  it('is exhausted past its limit, the steady flag notwithstanding', () => {
    expect(bufferCapacity({ held: 13, buffer, tolerating: true }).status).toBe(
      'exhausted',
    );
  });

  it('is never tolerating with no tolerance', () => {
    const exactBuffer = { size: 10, tolerance: 0 };
    expect(
      [10, 11].map(
        (held) =>
          bufferCapacity({ held, buffer: exactBuffer, tolerating: false })
            .status,
      ),
    ).toEqual(['available', 'exhausted']);
  });

  it('answers its limit as a whole number, rounded down', () => {
    expect(
      bufferCapacity({
        held: 0,
        buffer: { size: 10, tolerance: 0.25 },
        tolerating: false,
      }).limit,
    ).toBe(12);
  });

  it.each([
    [9, false],
    [8, true],
    [0, true],
  ])('holding %i is drained: %s', (held, drained) => {
    expect(isDrained(held, buffer)).toBe(drained);
  });
});
