import { describe, expect, it } from 'vitest';
import type { IArvoEventHandlerMiddleware } from '../../../../src/ArvoEventHandler/types/middleware.js';
import { initEvent } from '../../fixtures.js';
import {
  composeLayers,
  createMarkingContext,
  stagesWithLayer,
} from './fixture.js';

const emittedEvents = () => [initEvent, initEvent];

describe('after', () => {
  it('runs the after parts in reverse order, each with the context and the emission', async () => {
    const { markingContext } = createMarkingContext();
    const partOrder: string[] = [];
    const emissionsSeen: unknown[] = [];
    const loggingLayer = (layerId: string): IArvoEventHandlerMiddleware => ({
      id: layerId,
      after: (ctx, emission) => {
        expect(ctx).toBe(markingContext);
        partOrder.push(layerId);
        emissionsSeen.push(emission);
      },
    });
    const emission = emittedEvents();
    await composeLayers([
      loggingLayer('a'),
      loggingLayer('b'),
      loggingLayer('c'),
    ]).after(markingContext, emission);
    expect(partOrder).toEqual(['c', 'b', 'a']);
    expect(
      emissionsSeen.every((seenEmission) => seenEmission === emission),
    ).toBe(true);
  });

  it('hands over an array emission frozen, so no part can change it', async () => {
    const { markingContext } = createMarkingContext();
    let pushFailure: unknown = null;
    await composeLayers([
      {
        id: 'meddler',
        after: (_, emission) => {
          try {
            (emission as unknown[]).push('extra');
          } catch (thrown) {
            pushFailure = thrown;
          }
        },
      },
    ]).after(markingContext, emittedEvents());
    expect(pushFailure).toBeInstanceOf(TypeError);
  });

  it('hands over an emission that is one event, or nothing, as it is', async () => {
    const { markingContext } = createMarkingContext();
    const emissionsSeen: unknown[] = [];
    const watchingLayer: IArvoEventHandlerMiddleware = {
      id: 'watcher',
      after: (_, emission) => void emissionsSeen.push(emission),
    };
    const oneEvent = initEvent;
    await composeLayers([watchingLayer]).after(markingContext, oneEvent);
    await composeLayers([watchingLayer]).after(markingContext, undefined);
    expect(emissionsSeen).toEqual([oneEvent, undefined]);
  });

  it('passes over a layer with no after part, marking nothing for it', async () => {
    const { markingContext, recordedMarks } = createMarkingContext();
    await composeLayers([{ id: 'only_before', before: () => undefined }]).after(
      markingContext,
      undefined,
    );
    expect(recordedMarks).toEqual([]);
  });

  it('marks each part entered and returned, by id, with the clock not fired', async () => {
    const { markingContext, recordedMarks } = createMarkingContext();
    await composeLayers([
      { id: 'a', after: () => undefined },
      { id: 'b', after: async () => undefined },
    ]).after(markingContext, undefined);
    expect(stagesWithLayer(recordedMarks)).toEqual([
      ['middleware_after_entered', 'b'],
      ['middleware_after_returned', 'b'],
      ['middleware_after_entered', 'a'],
      ['middleware_after_returned', 'a'],
    ]);
    expect(
      recordedMarks.every(
        ([, attributes]) => attributes['middleware.aborted'] === false,
      ),
    ).toBe(true);
  });

  describe('after, with a part that returns something', () => {
    it('reads nothing it returns', async () => {
      const { markingContext } = createMarkingContext();
      const returningLayer = {
        id: 'returner',
        after: () => ({ type: 'evt_smuggled' }),
      } as unknown as IArvoEventHandlerMiddleware;
      await expect(
        composeLayers([returningLayer]).after(markingContext, undefined),
      ).resolves.toBeUndefined();
    });
  });
});

describe('an after part that throws', () => {
  it('is marked failed with what it threw, and the remaining parts still run', async () => {
    const { markingContext, recordedMarks } = createMarkingContext();
    let earlierLayerRan = false;
    await composeLayers([
      {
        id: 'earlier',
        after: () => {
          earlierLayerRan = true;
        },
      },
      {
        id: 'broken',
        after: () => {
          throw new TypeError('bad audit row');
        },
      },
    ]).after(markingContext, undefined);
    expect(earlierLayerRan).toBe(true);
    expect(recordedMarks[1]).toEqual([
      'middleware_after_failed',
      {
        'middleware.id': 'broken',
        'middleware.aborted': false,
        'error.name': 'TypeError',
        'error.message': 'bad audit row',
      },
    ]);
  });

  it('describes a thrown value that is not an Error', async () => {
    const { markingContext, recordedMarks } = createMarkingContext();
    await composeLayers([
      {
        id: 'broken',
        after: async () => {
          throw 'plain text';
        },
      },
    ]).after(markingContext, undefined);
    expect(recordedMarks[1]?.[1]).toMatchObject({
      'error.name': 'string',
      'error.message': 'plain text',
    });
  });

  it('never makes after itself throw', async () => {
    const { markingContext } = createMarkingContext();
    await expect(
      composeLayers([
        {
          id: 'broken',
          after: () => {
            throw new Error('boom');
          },
        },
      ]).after(markingContext, undefined),
    ).resolves.toBeUndefined();
  });
});

describe('after, once the clock has fired', () => {
  it('starts no part', async () => {
    const { markingContext, recordedMarks } = createMarkingContext();
    const abortController = new AbortController();
    abortController.abort();
    let partRan = false;
    await composeLayers(
      [
        {
          id: 'a',
          after: () => {
            partRan = true;
          },
        },
      ],
      abortController,
    ).after(markingContext, undefined);
    expect(partRan).toBe(false);
    expect(recordedMarks).toEqual([]);
  });

  it('still marks a part that returns late, and starts the next one not', async () => {
    const { markingContext, recordedMarks } = createMarkingContext();
    const abortController = new AbortController();
    let nextPartRan = false;
    await composeLayers(
      [
        {
          id: 'next',
          after: () => {
            nextPartRan = true;
          },
        },
        {
          id: 'slow',
          after: () => {
            abortController.abort();
          },
        },
      ],
      abortController,
    ).after(markingContext, undefined);
    expect(nextPartRan).toBe(false);
    expect(recordedMarks).toEqual([
      [
        'middleware_after_entered',
        { 'middleware.id': 'slow', 'middleware.aborted': false },
      ],
      [
        'middleware_after_returned',
        { 'middleware.id': 'slow', 'middleware.aborted': true },
      ],
    ]);
  });

  it('still marks a part that fails late', async () => {
    const { markingContext, recordedMarks } = createMarkingContext();
    const abortController = new AbortController();
    await composeLayers(
      [
        {
          id: 'slow',
          after: () => {
            abortController.abort();
            throw new Error('too late');
          },
        },
      ],
      abortController,
    ).after(markingContext, undefined);
    expect(recordedMarks[1]).toEqual([
      'middleware_after_failed',
      {
        'middleware.id': 'slow',
        'middleware.aborted': true,
        'error.name': 'Error',
        'error.message': 'too late',
      },
    ]);
  });
});
