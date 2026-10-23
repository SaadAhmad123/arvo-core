import { describe, expect, it, vi } from 'vitest';
import type { ArvoEventHandlerMiddlewareEntry } from '../../../../src/ArvoEventHandler/types/middleware.js';
import {
  ArvoComposedMiddlewareResolutionError,
  ArvoComposedMiddlewareValidationError,
} from '../../../../src/ArvoEventHandler/version/composed-middleware/errors.js';
import { tryCreateArvoComposedMiddleware } from '../../../../src/ArvoEventHandler/version/composed-middleware/factory.js';
import { createMarkingContext, stagesWithLayer } from './fixture.js';

/**
 * Lists built to break resolution and the factory: shapes of array a
 * caller no compiler saw could hand over, and factories that misbehave.
 *
 * Whatever the list, the factory settles to the composite or to one of
 * its two errors. It never rejects, and never hands back something it did
 * not check.
 */

const createFrom = (supplied: unknown, declared: unknown = []) =>
  tryCreateArvoComposedMiddleware({
    // deliberately untyped: these lists are what no compiler would allow
    supplied: supplied as ArvoEventHandlerMiddlewareEntry[],
    declared: declared as ArvoEventHandlerMiddlewareEntry[],
    abortSignal: new AbortController().signal,
  });

const errorOf = async (supplied: unknown, declared: unknown = []) => {
  const attempt = await createFrom(supplied, declared);
  if (attempt.ok) throw new Error('the list was not refused');
  return attempt.error;
};

describe('arrays of unusual shape', () => {
  it('refuses a sparse array, naming the hole', async () => {
    // biome-ignore lint/suspicious/noSparseArray: the hole is the case
    const sparseList = [{ id: 'first' }, , { id: 'third' }];
    const refusal = await errorOf(sparseList);
    expect(refusal).toBeInstanceOf(ArvoComposedMiddlewareValidationError);
    expect(refusal.message).toContain('execute({ middleware })[1]');
  });

  it('refuses an array whose entries cannot be read', async () => {
    const unreadableList = [{ id: 'fine' }];
    Object.defineProperty(unreadableList, 0, {
      get() {
        throw new Error('entry unreadable');
      },
    });
    const refusal = await errorOf(unreadableList);
    expect(refusal.faultKind).toBe('middleware_instantiation_failed');
  });

  it('refuses a Proxy array that throws on every read', async () => {
    const hostileList = new Proxy([{ id: 'fine' }], {
      get(target, property) {
        if (property === 'length') throw new Error('no length');
        return Reflect.get(target, property);
      },
    });
    const refusal = await errorOf(hostileList);
    expect(refusal.faultKind).toBe('middleware_instantiation_failed');
  });

  it('accepts an array subclass, reading only its entries', async () => {
    class LayerList extends Array<{ id: string }> {
      extra = 'ignored';
    }
    const subclassList = LayerList.from([{ id: 'a' }, { id: 'b' }]);
    const attempt = await createFrom(subclassList);
    expect(attempt.ok && attempt.value.count.total).toBe(2);
  });

  it('accepts a frozen array, and freezing does not stop factories being made', async () => {
    const frozenList = Object.freeze([
      { id: 'static' },
      () => ({ id: 'made' }),
    ]);
    const attempt = await createFrom(frozenList);
    expect(attempt.ok && attempt.value.count.total).toBe(2);
  });

  it('refuses an array-like object that is not an array', async () => {
    const refusal = await errorOf({ 0: { id: 'a' }, length: 1 });
    expect(refusal.message).toContain('must be an array');
  });
});

describe('factories that misbehave', () => {
  it('accepts a factory returning a thenable that resolves to a layer', async () => {
    const attempt = await createFrom([
      () => ({
        // biome-ignore lint/suspicious/noThenProperty: a bare thenable is the case
        then(resolve: (layer: { id: string }) => void) {
          resolve({ id: 'from_thenable' });
        },
      }),
    ]);
    expect(attempt.ok).toBe(true);
  });

  it('refuses a factory that returns a function, as not a middleware', async () => {
    const refusal = await errorOf([() => () => ({ id: 'too_deep' })]);
    expect(refusal).toBeInstanceOf(ArvoComposedMiddlewareValidationError);
  });

  it('refuses a factory returning the very instance another entry is, as a conflict', async () => {
    const sharedLayer = { id: 'shared' };
    const refusal = await errorOf([sharedLayer], [() => sharedLayer]);
    expect(refusal.faultKind).toBe('middleware_conflict');
  });

  it('reports a factory that throws something unprintable, without rejecting', async () => {
    const attempt = await createFrom([
      () => {
        throw Object.create(null);
      },
    ]);
    expect(!attempt.ok && attempt.error).toBeInstanceOf(
      ArvoComposedMiddlewareResolutionError,
    );
  });

  it('reports a factory that rejects with a Symbol, without rejecting', async () => {
    const attempt = await createFrom([
      async () => {
        throw Symbol('rejected');
      },
    ]);
    expect(!attempt.ok && attempt.error).toBeInstanceOf(
      ArvoComposedMiddlewareResolutionError,
    );
  });

  it('calls a factory once even where it is listed in both lists', async () => {
    const makeLayer = vi.fn(() => ({
      id: `made_${makeLayer.mock.calls.length}`,
    }));
    const attempt = await createFrom([makeLayer], [makeLayer]);
    expect(makeLayer).toHaveBeenCalledTimes(2);
    expect(attempt.ok && attempt.value.count.total).toBe(2);
  });
});

describe('lists of many thousands of entries', () => {
  it('builds and runs ten thousand layers in order', async () => {
    const { markingContext, recordedMarks } = createMarkingContext();
    const manyLayers = Array.from({ length: 10_000 }, (_, layerIndex) =>
      layerIndex % 2 === 0
        ? { id: `static_${layerIndex}`, before: () => undefined }
        : () => ({ id: `made_${layerIndex}`, before: () => undefined }),
    );
    const attempt = await createFrom(manyLayers);
    if (!attempt.ok) throw attempt.error;
    await attempt.value.before(markingContext);
    expect(recordedMarks).toHaveLength(20_000);
    expect(stagesWithLayer(recordedMarks)[19_998]).toEqual([
      'middleware_before_entered',
      'made_9999',
    ]);
  });

  it('names every one of thousands of repeated ids', async () => {
    const repeatedLayers = Array.from({ length: 5_000 }, () => ({
      id: 'same',
    }));
    const refusal = await errorOf(repeatedLayers);
    expect(refusal).toBeInstanceOf(ArvoComposedMiddlewareValidationError);
    if (refusal instanceof ArvoComposedMiddlewareValidationError) {
      expect(refusal.issues).toHaveLength(4_999);
    }
  });
});
