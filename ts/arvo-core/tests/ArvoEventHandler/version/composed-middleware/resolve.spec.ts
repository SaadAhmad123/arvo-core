import { describe, expect, it, vi } from 'vitest';
import type { IArvoEventHandlerMiddleware } from '../../../../src/ArvoEventHandler/types/middleware.js';
import { ArvoComposedMiddlewareResolutionError } from '../../../../src/ArvoEventHandler/version/composed-middleware/errors.js';
import { tryResolveMiddleware } from '../../../../src/ArvoEventHandler/version/composed-middleware/resolve.js';

const layerNamed = (layerId: string): IArvoEventHandlerMiddleware => ({
  id: layerId,
});

const resolvedOrThrow = async (
  supplied: Parameters<typeof tryResolveMiddleware>[0],
  declared: Parameters<typeof tryResolveMiddleware>[1],
) => {
  const resolution = await tryResolveMiddleware(supplied, declared);
  if (!resolution.ok) throw resolution.error;
  return resolution.value;
};

describe('entries that are already layers', () => {
  it('pass through untouched, supplied and declared kept apart', async () => {
    const tenantLayer = layerNamed('tenant');
    const auditLayer = layerNamed('audit');
    const resolved = await resolvedOrThrow([tenantLayer], [auditLayer]);
    expect(resolved.supplied).toEqual([tenantLayer]);
    expect(resolved.declared).toEqual([auditLayer]);
    expect((resolved.supplied as unknown[])[0]).toBe(tenantLayer);
  });

  it('pass through even where they are not layers, for the constructor to judge', async () => {
    const resolved = await resolvedOrThrow([42 as never], ['text' as never]);
    expect(resolved.supplied).toEqual([42]);
    expect(resolved.declared).toEqual(['text']);
  });
});

describe('ways to make a layer', () => {
  it('are each called once and replaced by what they made', async () => {
    const madeLayer = layerNamed('made');
    const makeLayer = vi.fn(() => madeLayer);
    const resolved = await resolvedOrThrow([makeLayer], []);
    expect(makeLayer).toHaveBeenCalledTimes(1);
    expect(resolved.supplied).toEqual([madeLayer]);
  });

  it('may make their layer asynchronously', async () => {
    const madeLayer = layerNamed('made');
    const resolved = await resolvedOrThrow([], [async () => madeLayer]);
    expect(resolved.declared).toEqual([madeLayer]);
  });

  it('are called supplied first, then declared, each in the order given', async () => {
    const callOrder: string[] = [];
    const makerNamed = (layerId: string) => () => {
      callOrder.push(layerId);
      return layerNamed(layerId);
    };
    await resolvedOrThrow(
      [makerNamed('s0'), makerNamed('s1')],
      [makerNamed('d0'), makerNamed('d1')],
    );
    expect(callOrder).toEqual(['s0', 's1', 'd0', 'd1']);
  });

  it('within a list run concurrently, each started in the order given', async () => {
    const startOrder: string[] = [];
    const finishOrder: string[] = [];
    await resolvedOrThrow(
      [
        async () => {
          startOrder.push('slow');
          await new Promise((resolve) => setTimeout(resolve, 10));
          finishOrder.push('slow');
          return layerNamed('slow');
        },
        () => {
          startOrder.push('fast');
          finishOrder.push('fast');
          return layerNamed('fast');
        },
      ],
      [],
    );
    expect(startOrder).toEqual(['slow', 'fast']);
    expect(finishOrder).toEqual(['fast', 'slow']);
  });

  describe('a way to make a layer, resolved again', () => {
    it('makes a fresh layer every time', async () => {
      const makeLayer = () => layerNamed('made');
      const firstResolution = await resolvedOrThrow([], [makeLayer]);
      const secondResolution = await resolvedOrThrow([], [makeLayer]);
      expect(firstResolution.declared[0]).not.toBe(
        secondResolution.declared[0],
      );
    });
  });
});

describe('a way to make a layer that throws', () => {
  it('fails resolution, naming its position, and resolves no later list', async () => {
    const laterMaker = vi.fn(() => layerNamed('later'));
    const declaredMaker = vi.fn(() => layerNamed('declared'));
    const factoryFailure = new Error('pool exhausted');
    const resolution = await tryResolveMiddleware(
      [
        layerNamed('first'),
        () => {
          throw factoryFailure;
        },
        laterMaker,
      ],
      [declaredMaker],
    );
    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.error).toBeInstanceOf(
      ArvoComposedMiddlewareResolutionError,
    );
    expect(resolution.error.position).toBe('execute({ middleware })[1]');
    expect(resolution.error.cause).toBe(factoryFailure);
    // the rest of its own list was already started; the declared list never is
    expect(laterMaker).toHaveBeenCalledTimes(1);
    expect(declaredMaker).not.toHaveBeenCalled();
  });

  it('names a declared position where a declared one throws', async () => {
    const resolution = await tryResolveMiddleware(
      [],
      [
        layerNamed('first'),
        async () => {
          throw 'no tenant';
        },
      ],
    );
    expect(!resolution.ok && resolution.error.position).toBe(
      'setupArvoEventHandler({ middleware })[1]',
    );
  });
});

describe('nothing to resolve', () => {
  it('resolves empty lists to empty lists', async () => {
    expect(await resolvedOrThrow([], [])).toEqual({
      supplied: [],
      declared: [],
    });
  });
});
