import { describe, expect, it } from 'vitest';
import { ArvoComposedMiddleware } from '../../../../src/ArvoEventHandler/version/composed-middleware/index.js';

const composeCounting = (suppliedCount: number, declaredCount: number) =>
  new ArvoComposedMiddleware({
    supplied: Array.from({ length: suppliedCount }, (_, layerIndex) => ({
      id: `supplied_${layerIndex}`,
    })),
    declared: Array.from({ length: declaredCount }, (_, layerIndex) => ({
      id: `declared_${layerIndex}`,
    })),
    abortSignal: new AbortController().signal,
  });

describe('the count', () => {
  it('says how many layers came from each list, and in all', () => {
    expect(composeCounting(2, 3).count).toEqual({
      total: 5,
      supplied: 2,
      declared: 3,
    });
  });

  it('says none where there are none', () => {
    expect(composeCounting(0, 0).count).toEqual({
      total: 0,
      supplied: 0,
      declared: 0,
    });
  });

  it('hands back a fresh value each time, so a caller cannot change it', () => {
    const composite = composeCounting(1, 1);
    const layerCount = composite.count;
    layerCount.total = 99;
    expect(composite.count.total).toBe(2);
  });
});
