import { describe, expect, it } from 'vitest';
import type { IArvoEventHandlerMiddleware } from '../../../../src/ArvoEventHandler/types/middleware.js';
import {
  composeLayers,
  createMarkingContext,
  stagesWithLayer,
} from './fixture.js';

describe('before', () => {
  it('runs the before parts in order, each with the context it was given', async () => {
    const { markingContext } = createMarkingContext();
    const partOrder: string[] = [];
    const contextsSeen: unknown[] = [];
    const loggingLayer = (layerId: string): IArvoEventHandlerMiddleware => ({
      id: layerId,
      before: (ctx) => {
        partOrder.push(layerId);
        contextsSeen.push(ctx);
      },
    });
    await composeLayers([
      loggingLayer('a'),
      loggingLayer('b'),
      loggingLayer('c'),
    ]).before(markingContext);
    expect(partOrder).toEqual(['a', 'b', 'c']);
    expect(
      contextsSeen.every((seenContext) => seenContext === markingContext),
    ).toBe(true);
  });

  it('passes over a layer with no before part, marking nothing for it', async () => {
    const { markingContext, recordedMarks } = createMarkingContext();
    await composeLayers([{ id: 'only_after', after: () => undefined }]).before(
      markingContext,
    );
    expect(recordedMarks).toEqual([]);
  });

  it('calls each part as a method of its layer', async () => {
    const { markingContext } = createMarkingContext();
    class Counter implements IArvoEventHandlerMiddleware<'counter'> {
      readonly id = 'counter' as const;
      calls = 0;
      before() {
        this.calls += 1;
      }
    }
    const counterLayer = new Counter();
    await composeLayers([counterLayer]).before(markingContext);
    expect(counterLayer.calls).toBe(1);
  });

  it('marks each part entered and returned, by id, with the clock not fired', async () => {
    const { markingContext, recordedMarks } = createMarkingContext();
    await composeLayers([
      { id: 'a', before: () => undefined },
      { id: 'b', before: async () => undefined },
    ]).before(markingContext);
    expect(stagesWithLayer(recordedMarks)).toEqual([
      ['middleware_before_entered', 'a'],
      ['middleware_before_returned', 'a'],
      ['middleware_before_entered', 'b'],
      ['middleware_before_returned', 'b'],
    ]);
    expect(
      recordedMarks.every(
        ([, attributes]) => attributes['middleware.aborted'] === false,
      ),
    ).toBe(true);
  });

  it('never names the composite itself in a mark', async () => {
    const { markingContext, recordedMarks } = createMarkingContext();
    await composeLayers([{ id: 'a', before: () => undefined }]).before(
      markingContext,
    );
    expect(
      recordedMarks.some(
        ([, attributes]) => attributes['middleware.id'] === 'arvo.composed',
      ),
    ).toBe(false);
  });

  describe('before, with parts that take time or return something', () => {
    it('waits for an asynchronous part before starting the next', async () => {
      const { markingContext } = createMarkingContext();
      const partOrder: string[] = [];
      await composeLayers([
        {
          id: 'slow',
          before: async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            partOrder.push('slow');
          },
        },
        { id: 'fast', before: () => void partOrder.push('fast') },
      ]).before(markingContext);
      expect(partOrder).toEqual(['slow', 'fast']);
    });

    it('reads nothing a part returns', async () => {
      const { markingContext } = createMarkingContext();
      const returningLayer = {
        id: 'returner',
        before: () => ({ type: 'evt_smuggled' }),
      } as unknown as IArvoEventHandlerMiddleware;
      await expect(
        composeLayers([returningLayer]).before(markingContext),
      ).resolves.toBeUndefined();
    });
  });
});

describe('a before part that throws', () => {
  it('reaches the caller exactly as thrown, and no further part runs', async () => {
    const { markingContext, recordedMarks } = createMarkingContext();
    const beforeFailure = new Error('no tenant');
    let laterPartRan = false;
    const composite = composeLayers([
      {
        id: 'broken',
        before: () => {
          throw beforeFailure;
        },
      },
      {
        id: 'later',
        before: () => {
          laterPartRan = true;
        },
      },
    ]);
    await expect(composite.before(markingContext)).rejects.toBe(beforeFailure);
    expect(laterPartRan).toBe(false);
    expect(stagesWithLayer(recordedMarks)).toEqual([
      ['middleware_before_entered', 'broken'],
    ]);
  });

  it('reaches the caller even where what is thrown is not an Error', async () => {
    const { markingContext } = createMarkingContext();
    await expect(
      composeLayers([
        {
          id: 'broken',
          before: async () => {
            throw 'plain text';
          },
        },
      ]).before(markingContext),
    ).rejects.toBe('plain text');
  });
});

describe('before, once the clock has fired', () => {
  it('starts no part', async () => {
    const { markingContext, recordedMarks } = createMarkingContext();
    const abortController = new AbortController();
    abortController.abort();
    let partRan = false;
    await composeLayers(
      [
        {
          id: 'a',
          before: () => {
            partRan = true;
          },
        },
      ],
      abortController,
    ).before(markingContext);
    expect(partRan).toBe(false);
    expect(recordedMarks).toEqual([]);
  });

  it('lets the part already running finish, marks its return as late, and starts the next one not', async () => {
    const { markingContext, recordedMarks } = createMarkingContext();
    const abortController = new AbortController();
    let nextPartRan = false;
    await composeLayers(
      [
        {
          id: 'slow',
          before: () => {
            abortController.abort(); // the clock fires while this part runs
          },
        },
        {
          id: 'next',
          before: () => {
            nextPartRan = true;
          },
        },
      ],
      abortController,
    ).before(markingContext);
    expect(nextPartRan).toBe(false);
    expect(recordedMarks).toEqual([
      [
        'middleware_before_entered',
        { 'middleware.id': 'slow', 'middleware.aborted': false },
      ],
      [
        'middleware_before_returned',
        { 'middleware.id': 'slow', 'middleware.aborted': true },
      ],
    ]);
  });
});
