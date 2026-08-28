import { describe, expect, expectTypeOf, it } from 'vitest';
import { ArvoEvent } from '../../../src/ArvoEvent/index.js';
import { CloudEventTransformationError } from '../../../src/serializers/cloudevent/errors.js';
import { CloudEventConverter } from '../../../src/serializers/cloudevent/index.js';
import type {
  IArvoEventTransformer,
  ICloudEventConverter,
} from '../../../src/serializers/cloudevent/interface.js';
import { CloudEvent } from '../../../src/serializers/cloudevent/types.js';

const baseEvent = () =>
  new ArvoEvent({
    subject: 'subj-1',
    source: 'test/source',
    type: 'test.event',
    data: { hello: 'world' },
    dataschema: 'test://schema/v1',
  });

const isThrown = async (
  fn: () => Promise<unknown>,
): Promise<CloudEventTransformationError> => {
  try {
    await fn();
  } catch (error) {
    if (error instanceof CloudEventTransformationError) return error;
    throw error;
  }
  throw new Error(
    'expected the promise to reject with a CloudEventTransformationError',
  );
};

/** A no-op enrichment stage — passes data through unchanged, records every call it received. */
const passthroughStage = (): ICloudEventConverter & { calls: CloudEvent[] } => {
  const calls: CloudEvent[] = [];
  return {
    calls,
    async convert(data) {
      calls.push(data);
      return data;
    },
    async revert(data) {
      calls.push(data);
      return data;
    },
  };
};

/** An enrichment stage whose `convert`/`revert` always throws. */
const throwingStage = (
  message: string,
): ICloudEventConverter & { calls: number } => {
  const state = { calls: 0 };
  return {
    get calls() {
      return state.calls;
    },
    async convert() {
      state.calls++;
      throw new Error(`convert: ${message}`);
    },
    async revert() {
      state.calls++;
      throw new Error(`revert: ${message}`);
    },
  } as ICloudEventConverter & { calls: number };
};

describe('CloudEventConverter', () => {
  describe('construction', () => {
    it('defaults to the standard ArvoEvent<->CloudEvent mapping with no arguments', async () => {
      const converter = new CloudEventConverter();
      const event = baseEvent();
      const ce = await converter.convert(event);
      expect(ce.specversion).toBe('1.0');
      const back = await converter.revert(ce);
      expect(JSON.parse(JSON.stringify(back))).toEqual(
        JSON.parse(JSON.stringify(event)),
      );
    });

    it('accepts a custom transformer, replacing the standard mapping entirely', async () => {
      const customTransformer: IArvoEventTransformer = {
        async convert() {
          return new CloudEvent({
            id: 'custom',
            source: 'custom/source',
            type: 'custom.type',
            specversion: '1.0',
          });
        },
        async revert() {
          return baseEvent();
        },
      };
      const converter = new CloudEventConverter(customTransformer);
      const ce = await converter.convert(baseEvent());
      expect(ce.id).toBe('custom');
      expect(ce.source).toBe('custom/source');
    });

    it('accepts an empty converters array explicitly, behaving like the default', async () => {
      const converter = new CloudEventConverter(undefined, []);
      const event = baseEvent();
      const ce = await converter.convert(event);
      const back = await converter.revert(ce);
      expect(JSON.parse(JSON.stringify(back))).toEqual(
        JSON.parse(JSON.stringify(event)),
      );
    });
  });

  describe('appended enrichment stages', () => {
    it('runs an appended stage forward on convert/tryConvert, after the base mapping', async () => {
      const stage = passthroughStage();
      const converter = new CloudEventConverter(undefined, [stage]);
      const ce = await converter.convert(baseEvent());
      expect(stage.calls).toHaveLength(1);
      expect(stage.calls[0]?.id).toBe(ce.id);
    });

    it('unwinds an appended stage in reverse order before the base mapping runs on revert', async () => {
      const order: string[] = [];
      const stage: ICloudEventConverter = {
        async convert(data) {
          order.push('stage.convert');
          return data;
        },
        async revert(data) {
          order.push('stage.revert');
          return data;
        },
      };
      const converter = new CloudEventConverter(undefined, [stage]);
      const ce = await converter.convert(baseEvent());
      order.length = 0;
      await converter.revert(ce);
      expect(order).toEqual(['stage.revert']);
    });

    it('runs multiple appended stages forward in array order on convert', async () => {
      const order: string[] = [];
      const makeStage = (name: string): ICloudEventConverter => ({
        async convert(data) {
          order.push(`${name}.convert`);
          return data;
        },
        async revert(data) {
          order.push(`${name}.revert`);
          return data;
        },
      });
      const converter = new CloudEventConverter(undefined, [
        makeStage('a'),
        makeStage('b'),
        makeStage('c'),
      ]);
      await converter.convert(baseEvent());
      expect(order).toEqual(['a.convert', 'b.convert', 'c.convert']);
    });

    it('unwinds multiple appended stages in reverse array order on revert', async () => {
      const order: string[] = [];
      const makeStage = (name: string): ICloudEventConverter => ({
        async convert(data) {
          return data;
        },
        async revert(data) {
          order.push(`${name}.revert`);
          return data;
        },
      });
      const converter = new CloudEventConverter(undefined, [
        makeStage('a'),
        makeStage('b'),
        makeStage('c'),
      ]);
      const ce = await converter.convert(baseEvent());
      await converter.revert(ce);
      expect(order).toEqual(['c.revert', 'b.revert', 'a.revert']);
    });
  });

  describe('stage failures', () => {
    it('reports a convert-stage failure as kind: "stage", naming direction/stageIndex/cause', async () => {
      const stage = throwingStage('boom');
      const converter = new CloudEventConverter(undefined, [stage]);
      const result = await converter.tryConvert(baseEvent());
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.error.detail).toMatchObject({
        kind: 'stage',
        direction: 'convert',
        stageIndex: 1,
      });
      if (result.error.detail.kind === 'stage') {
        expect((result.error.detail.cause as Error).message).toBe(
          'convert: boom',
        );
      }
    });

    it('convert throws the same CloudEventTransformationError tryConvert reports', async () => {
      const converter = new CloudEventConverter(undefined, [
        throwingStage('boom'),
      ]);
      const error = await isThrown(() => converter.convert(baseEvent()));
      expect(error.detail.kind).toBe('stage');
    });

    it('reports a revert-stage failure as kind: "stage", naming direction/stageIndex/cause', async () => {
      const stage = throwingStage('boom');
      const converter = new CloudEventConverter(undefined, [stage]);
      const ce = new CloudEvent({
        id: 'x',
        source: 's',
        type: 't',
        specversion: '1.0',
      });
      const result = await converter.tryRevert(ce);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.error.detail).toMatchObject({
        kind: 'stage',
        direction: 'revert',
        stageIndex: 1,
      });
      if (result.error.detail.kind === 'stage') {
        expect((result.error.detail.cause as Error).message).toBe(
          'revert: boom',
        );
      }
    });

    it('revert throws the same CloudEventTransformationError tryRevert reports', async () => {
      const converter = new CloudEventConverter(undefined, [
        throwingStage('boom'),
      ]);
      const ce = new CloudEvent({
        id: 'x',
        source: 's',
        type: 't',
        specversion: '1.0',
      });
      const error = await isThrown(() => converter.revert(ce));
      expect(error.detail.kind).toBe('stage');
    });

    it('stops the convert pipeline at the first failing stage; a later stage never runs', async () => {
      const later = passthroughStage();
      const converter = new CloudEventConverter(undefined, [
        throwingStage('boom'),
        later,
      ]);
      await converter.tryConvert(baseEvent());
      expect(later.calls).toHaveLength(0);
    });

    it('stops the revert pipeline at the first failing stage; a later (earlier-in-array) stage never runs', async () => {
      const earlierInArray = passthroughStage();
      const ce = new CloudEvent({
        id: 'x',
        source: 's',
        type: 't',
        specversion: '1.0',
      });
      const converter = new CloudEventConverter(undefined, [
        earlierInArray,
        throwingStage('boom'),
      ]);
      await converter.tryRevert(ce);
      expect(earlierInArray.calls).toHaveLength(0);
    });

    it('numbers stageIndex correctly across multiple appended stages, for convert', async () => {
      const converter = new CloudEventConverter(undefined, [
        passthroughStage(),
        throwingStage('boom'),
      ]);
      const result = await converter.tryConvert(baseEvent());
      if (result.ok) throw new Error('unreachable');
      expect(result.error.detail).toMatchObject({
        kind: 'stage',
        stageIndex: 2,
      });
    });

    it('numbers stageIndex correctly across multiple appended stages, for revert', async () => {
      const ce = new CloudEvent({
        id: 'x',
        source: 's',
        type: 't',
        specversion: '1.0',
      });
      const converter = new CloudEventConverter(undefined, [
        passthroughStage(),
        throwingStage('boom'),
      ]);
      const result = await converter.tryRevert(ce);
      if (result.ok) throw new Error('unreachable');
      expect(result.error.detail).toMatchObject({
        kind: 'stage',
        stageIndex: 2,
      });
    });

    it('numbers the base transformer as stageIndex 0 when it is the one that fails', async () => {
      const failingTransformer: IArvoEventTransformer = {
        async convert() {
          throw new Error('base failed');
        },
        async revert() {
          throw new Error('base failed');
        },
      };
      const converter = new CloudEventConverter(failingTransformer);
      const result = await converter.tryConvert(baseEvent());
      if (result.ok) throw new Error('unreachable');
      expect(result.error.detail).toMatchObject({
        kind: 'stage',
        direction: 'convert',
        stageIndex: 0,
      });
    });

    it('never throws from tryConvert/tryRevert even when every stage fails', async () => {
      const converter = new CloudEventConverter(undefined, [
        throwingStage('a'),
        throwingStage('b'),
      ]);
      const convertResult = await converter.tryConvert(baseEvent());
      const revertResult = await converter.tryRevert(
        new CloudEvent({ id: 'x', source: 's', type: 't', specversion: '1.0' }),
      );
      expect(convertResult.ok).toBe(false);
      expect(revertResult.ok).toBe(false);
    });
  });

  describe('CloudEventTransformationError passthrough (not double-wrapped)', () => {
    it('passes through a structural rejection from the base transformer as-is, not wrapped as kind: "stage"', async () => {
      const converter = new CloudEventConverter();
      const ce = new CloudEvent({
        id: 'x',
        source: 's',
        type: 't',
        specversion: '1.0',
      });
      const result = await converter.tryRevert(ce, {
        dataschema: 'unknown/0.0.0',
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.error.detail.kind).toBe('foreign');
    });

    it("preserves a stage's own thrown CloudEventTransformationError unchanged when it throws one deliberately", async () => {
      const deliberate = new CloudEventTransformationError({
        kind: 'stage',
        direction: 'convert',
        stageIndex: 99,
        cause: 'deliberate',
      });
      const stage: ICloudEventConverter = {
        async convert() {
          throw deliberate;
        },
        async revert(data) {
          return data;
        },
      };
      const converter = new CloudEventConverter(undefined, [stage]);
      const result = await converter.tryConvert(baseEvent());
      if (result.ok) throw new Error('unreachable');
      expect(result.error).toBe(deliberate);
      expect(result.error.detail).toMatchObject({ stageIndex: 99 });
    });
  });

  describe('foreignFallback reaches only the base transformer', () => {
    it('passes foreignFallback through to a custom transformer that declares the extra parameter', async () => {
      let received: unknown;
      const transformer: IArvoEventTransformer = {
        async convert() {
          return new CloudEvent({
            id: 'x',
            source: 's',
            type: 't',
            specversion: '1.0',
          });
        },
        async revert(_data, foreignFallback) {
          received = foreignFallback;
          return baseEvent();
        },
      };
      const converter = new CloudEventConverter(transformer);
      const ce = new CloudEvent({
        id: 'x',
        source: 's',
        type: 't',
        specversion: '1.0',
      });
      await converter.revert(ce, { dataschema: 'unknown/0.0.0' });
      expect(received).toEqual({ dataschema: 'unknown/0.0.0' });
    });

    it('does not pass foreignFallback to an appended ICloudEventConverter stage', async () => {
      let receivedArgCount = -1;
      const stage: ICloudEventConverter = {
        async convert(data) {
          return data;
        },
        async revert(...args: unknown[]) {
          receivedArgCount = args.length;
          return args[0] as CloudEvent;
        },
      };
      const converter = new CloudEventConverter(undefined, [stage]);
      const ce = await converter.convert(baseEvent());
      await converter.revert(ce, { dataschema: 'unknown/0.0.0' });
      expect(receivedArgCount).toBe(1);
    });
  });

  describe('type-level contract', () => {
    it('ICloudEventConverter requires both convert and revert', () => {
      // @ts-expect-error missing `revert`
      const _missingRevert: ICloudEventConverter = {
        async convert(data) {
          return data;
        },
      };
      // @ts-expect-error missing `convert`
      const _missingConvert: ICloudEventConverter = {
        async revert(data) {
          return data;
        },
      };
      expectTypeOf<ICloudEventConverter>().toHaveProperty('convert');
      expectTypeOf<ICloudEventConverter>().toHaveProperty('revert');
    });

    it('IArvoEventTransformer requires both convert and revert, with revert accepting foreignFallback', () => {
      // @ts-expect-error missing `revert`
      const _missingRevert: IArvoEventTransformer = {
        async convert(_data) {
          return new CloudEvent({
            id: 'x',
            source: 's',
            type: 't',
            specversion: '1.0',
          });
        },
      };
      // @ts-expect-error missing `convert`
      const _missingConvert: IArvoEventTransformer = {
        async revert(data) {
          return data as never;
        },
      };
      expectTypeOf<IArvoEventTransformer['revert']>().parameters.toEqualTypeOf<
        [
          CloudEvent,
          (
            | import('../../../src/cloudevent/types.js').ForeignCloudEventFallback
            | undefined
          ),
        ]
      >();
    });
  });
});
