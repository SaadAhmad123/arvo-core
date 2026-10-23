import { describe, expect, it } from 'vitest';
import type { IArvoEventHandlerMiddleware } from '../../../../src/ArvoEventHandler/types/middleware.js';
import { ArvoComposedMiddlewareValidationError } from '../../../../src/ArvoEventHandler/version/composed-middleware/errors.js';
import { tryCreateArvoComposedMiddleware } from '../../../../src/ArvoEventHandler/version/composed-middleware/factory.js';
import {
  composeLayers,
  createMarkingContext,
  stagesWithLayer,
} from './fixture.js';

/**
 * Layers built to break the composite: values a caller no compiler saw
 * could hand over, and parts that misbehave in every way a part can.
 *
 * Whatever a layer does, the composite keeps its promises: a refusal is
 * the validation error, a before failure reaches the caller as it was
 * thrown, and after never throws.
 */

/** Builds the composite through its factory, as the version does. */
const createFrom = (supplied: unknown[]) =>
  tryCreateArvoComposedMiddleware({
    // deliberately untyped: these layers are what no compiler would allow
    supplied: supplied as IArvoEventHandlerMiddleware[],
    declared: [],
    abortSignal: new AbortController().signal,
  });

const refusalOf = async (supplied: unknown[]) => {
  const attempt = await createFrom(supplied);
  if (attempt.ok) throw new Error('the layers were not refused');
  return attempt.error;
};

const compositeOf = async (supplied: unknown[]) => {
  const attempt = await createFrom(supplied);
  if (!attempt.ok) throw attempt.error;
  return attempt.value;
};

/** Values that cannot be turned into text without throwing. */
const unprintableValues = (): [string, unknown][] => [
  ['a null-prototype object', Object.create(null)],
  [
    'an object whose toString throws',
    {
      toString() {
        throw new Error('no text for you');
      },
    },
  ],
  ['a Symbol', Symbol('thrown')],
  ['undefined', undefined],
  ['null', null],
  [
    'an Error whose name cannot be read',
    Object.defineProperty(new Error('nameless'), 'name', {
      get() {
        throw new Error('name unreadable');
      },
    }),
  ],
  [
    'an Error whose message cannot be read',
    Object.defineProperty(new Error('hidden'), 'message', {
      get() {
        throw new Error('message unreadable');
      },
    }),
  ],
];

describe('a layer whose parts cannot be read', () => {
  it.each([
    [
      'id',
      {
        get id(): string {
          throw new Error('no id');
        },
      },
    ],
    [
      'before',
      {
        id: 'x',
        get before() {
          throw new Error('no before');
        },
      },
    ],
    [
      'after',
      {
        id: 'x',
        get after() {
          throw new Error('no after');
        },
      },
    ],
  ])(
    'is refused where reading its %s throws',
    async (_partName, hostileLayer) => {
      const refusal = await refusalOf([hostileLayer]);
      expect(refusal).toBeInstanceOf(ArvoComposedMiddlewareValidationError);
      expect(refusal.faultKind).toBe('middleware_instantiation_failed');
      expect(refusal.message).toContain('execute({ middleware })[0]');
    },
  );

  it('is refused where it is a Proxy that throws on every read', async () => {
    const hostileProxy = new Proxy(
      {},
      {
        get() {
          throw new Error('nothing here can be read');
        },
        has() {
          throw new Error('nothing here can be asked about');
        },
      },
    );
    const refusal = await refusalOf([hostileProxy]);
    expect(refusal.faultKind).toBe('middleware_instantiation_failed');
  });
});

describe('a layer whose parts change between reads', () => {
  it('runs the part that was checked, whatever is there later', async () => {
    const { markingContext } = createMarkingContext();
    let beforeReads = 0;
    let beforeRan = false;
    const shiftingLayer = {
      id: 'shifting',
      get before() {
        beforeReads += 1;
        return beforeReads === 1
          ? () => {
              beforeRan = true;
            }
          : 'no longer a function';
      },
    };
    const composite = await compositeOf([shiftingLayer]);
    await composite.before(markingContext);
    expect(beforeRan).toBe(true);
  });

  it('marks it by the id that was checked', async () => {
    const { markingContext, recordedMarks } = createMarkingContext();
    let idReads = 0;
    const shiftingLayer = {
      get id() {
        idReads += 1;
        return idReads === 1 ? 'checked' : 'something_else';
      },
      before: () => undefined,
    };
    const composite = await compositeOf([shiftingLayer]);
    await composite.before(markingContext);
    expect(stagesWithLayer(recordedMarks)).toEqual([
      ['middleware_before_entered', 'checked'],
      ['middleware_before_returned', 'checked'],
    ]);
  });
});

describe('layers of unusual make', () => {
  it.each([
    ['frozen', Object.freeze({ id: 'frozen', before: () => undefined })],
    ['sealed', Object.seal({ id: 'sealed', before: () => undefined })],
    [
      'null-prototype',
      Object.assign(Object.create(null), {
        id: 'bare',
        before: () => undefined,
      }),
    ],
  ])('runs a %s layer like any other', async (_label, unusualLayer) => {
    const { markingContext, recordedMarks } = createMarkingContext();
    const composite = await compositeOf([unusualLayer]);
    await composite.before(markingContext);
    expect(recordedMarks).toHaveLength(2);
  });

  it('runs a layer whose parts live on its prototype chain, called on the layer', async () => {
    const { markingContext } = createMarkingContext();
    class BaseLayer {
      seen: unknown[] = [];
      before(ctx: unknown) {
        this.seen.push(ctx);
      }
    }
    class DerivedLayer extends BaseLayer {
      readonly id = 'derived';
    }
    const derivedLayer = new DerivedLayer();
    const composite = await compositeOf([derivedLayer]);
    await composite.before(markingContext);
    expect(derivedLayer.seen).toEqual([markingContext]);
  });

  it.each([
    ['__proto__'],
    ['constructor'],
    ['hasOwnProperty'],
    [''],
    ['x'.repeat(10_000)],
    ['名前 🧩'],
  ])('accepts the id %j, and catches it repeated', async (unusualId) => {
    await expect(compositeOf([{ id: unusualId }])).resolves.toBeDefined();
    const refusal = await refusalOf([{ id: unusualId }, { id: unusualId }]);
    expect(refusal.faultKind).toBe('middleware_conflict');
  });
});

describe('parts that settle strangely', () => {
  it('waits for a part that returns a thenable rather than a promise', async () => {
    const { markingContext } = createMarkingContext();
    const partOrder: string[] = [];
    const composite = composeLayers([
      {
        id: 'thenable',
        before: () =>
          ({
            // biome-ignore lint/suspicious/noThenProperty: a bare thenable is the case
            then(resolve: () => void) {
              setTimeout(() => {
                partOrder.push('thenable');
                resolve();
              }, 5);
            },
          }) as unknown as Promise<void>, // deliberately a bare thenable
      },
      { id: 'next', before: () => void partOrder.push('next') },
    ]);
    await composite.before(markingContext);
    expect(partOrder).toEqual(['thenable', 'next']);
  });

  it('lets a part that never settles hold the composite, for the run clock to cut', async () => {
    const { markingContext } = createMarkingContext();
    const composite = composeLayers([
      { id: 'stuck', before: () => new Promise<void>(() => undefined) },
    ]);
    const outcome = await Promise.race([
      composite.before(markingContext).then(() => 'settled'),
      new Promise((resolve) => setTimeout(() => resolve('still waiting'), 30)),
    ]);
    expect(outcome).toBe('still waiting');
  });

  it('marks nothing as a failure for a part that rejects after the clock fired, and starts nothing after it', async () => {
    const { markingContext, recordedMarks } = createMarkingContext();
    const abortController = new AbortController();
    let nextRan = false;
    const composite = composeLayers(
      [
        {
          id: 'next',
          after: () => {
            nextRan = true;
          },
        },
        {
          id: 'late',
          after: async () => {
            abortController.abort();
            await new Promise((resolve) => setTimeout(resolve, 5));
            throw new Error('too late');
          },
        },
      ],
      abortController,
    );
    await expect(
      composite.after(markingContext, undefined),
    ).resolves.toBeUndefined();
    expect(nextRan).toBe(false);
    expect(recordedMarks.at(-1)?.[1]['middleware.aborted']).toBe(true);
  });
});

describe('a before part that throws something unprintable', () => {
  it.each(unprintableValues())(
    'lets %s reach the caller exactly as thrown',
    async (_label, thrownValue) => {
      const { markingContext } = createMarkingContext();
      const composite = composeLayers([
        {
          id: 'hostile',
          before: () => {
            throw thrownValue;
          },
        },
      ]);
      const outcome = await composite.before(markingContext).then(
        () => ({ settled: 'resolved' as const }),
        (error_: unknown) => ({ settled: 'rejected' as const, thrown: error_ }),
      );
      expect(outcome).toEqual({ settled: 'rejected', thrown: thrownValue });
    },
  );
});

describe('an after part that throws something unprintable', () => {
  it.each(unprintableValues())(
    'is marked failed and passed over for %s, after never throwing',
    async (_label, thrownValue) => {
      const { markingContext, recordedMarks } = createMarkingContext();
      let earlierRan = false;
      const composite = composeLayers([
        {
          id: 'earlier',
          after: () => {
            earlierRan = true;
          },
        },
        {
          id: 'hostile',
          after: () => {
            throw thrownValue;
          },
        },
      ]);
      await expect(
        composite.after(markingContext, undefined),
      ).resolves.toBeUndefined();
      expect(earlierRan).toBe(true);
      expect(stagesWithLayer(recordedMarks)).toContainEqual([
        'middleware_after_failed',
        'hostile',
      ]);
    },
  );
});
