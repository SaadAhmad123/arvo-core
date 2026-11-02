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
  ] as const)('holding %i answers %s', (heldCount, status) => {
    expect(bufferCapacity({ heldCount, buffer, tolerating: false })).toEqual({
      status,
      heldCount,
      targetCount: 10,
      limitCount: 12,
    });
  });

  it('stays tolerating while the steady flag is set, though back within its size', () => {
    expect(
      bufferCapacity({ heldCount: 9, buffer, tolerating: true }).status,
    ).toBe('tolerating');
  });

  it('is exhausted past its limit, the steady flag notwithstanding', () => {
    expect(
      bufferCapacity({ heldCount: 13, buffer, tolerating: true }).status,
    ).toBe('exhausted');
  });

  it('is never tolerating with no tolerance', () => {
    const exactBuffer = { size: 10, tolerance: 0 };
    expect(
      [10, 11].map(
        (heldCount) =>
          bufferCapacity({ heldCount, buffer: exactBuffer, tolerating: false })
            .status,
      ),
    ).toEqual(['available', 'exhausted']);
  });

  it('answers its limit as a whole number, rounded down', () => {
    expect(
      bufferCapacity({
        heldCount: 0,
        buffer: { size: 10, tolerance: 0.25 },
        tolerating: false,
      }).limitCount,
    ).toBe(12);
  });

  it.each([
    [9, false],
    [8, true],
    [0, true],
  ])('holding %i is drained: %s', (heldCount, expectedDrained) => {
    expect(isDrained(heldCount, buffer)).toBe(expectedDrained);
  });
});
