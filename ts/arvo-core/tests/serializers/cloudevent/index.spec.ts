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

const thrownError = async (
  operation: () => Promise<unknown>,
): Promise<CloudEventTransformationError> => {
  try {
    await operation();
  } catch (error_) {
    if (error_ instanceof CloudEventTransformationError) return error_;
    throw error_;
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
    async convert(cloudEvent) {
      calls.push(cloudEvent);
      return cloudEvent;
    },
    async revert(cloudEvent) {
      calls.push(cloudEvent);
      return cloudEvent;
    },
  };
};

/** An enrichment stage whose `convert`/`revert` always throws. */
const throwingStage = (
  message: string,
): ICloudEventConverter & { calls: number } => {
  const callTally = { calls: 0 };
  return {
    get calls() {
      return callTally.calls;
    },
    async convert() {
      callTally.calls++;
      throw new Error(`convert: ${message}`);
    },
    async revert() {
      callTally.calls++;
      throw new Error(`revert: ${message}`);
    },
  } as ICloudEventConverter & { calls: number };
};

describe('CloudEventConverter', () => {
  describe('construction', () => {
    it('defaults to the standard ArvoEvent<->CloudEvent mapping with no arguments', async () => {
      const converter = new CloudEventConverter();
      const event = baseEvent();
      const cloudEvent = await converter.convert(event);
      expect(cloudEvent.specversion).toBe('1.0');
      const restoredEvent = await converter.revert(cloudEvent);
      expect(JSON.parse(JSON.stringify(restoredEvent))).toEqual(
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
      const cloudEvent = await converter.convert(baseEvent());
      expect(cloudEvent.id).toBe('custom');
      expect(cloudEvent.source).toBe('custom/source');
    });

    it('accepts an empty converters array explicitly, behaving like the default', async () => {
      const converter = new CloudEventConverter(undefined, []);
      const event = baseEvent();
      const cloudEvent = await converter.convert(event);
      const restoredEvent = await converter.revert(cloudEvent);
      expect(JSON.parse(JSON.stringify(restoredEvent))).toEqual(
        JSON.parse(JSON.stringify(event)),
      );
    });
  });

  describe('appended enrichment stages', () => {
    it('runs an appended stage forward on convert/tryConvert, after the base mapping', async () => {
      const stage = passthroughStage();
      const converter = new CloudEventConverter(undefined, [stage]);
      const cloudEvent = await converter.convert(baseEvent());
      expect(stage.calls).toHaveLength(1);
      expect(stage.calls[0]?.id).toBe(cloudEvent.id);
    });

    it('unwinds an appended stage in reverse order before the base mapping runs on revert', async () => {
      const callOrder: string[] = [];
      const stage: ICloudEventConverter = {
        async convert(cloudEvent) {
          callOrder.push('stage.convert');
          return cloudEvent;
        },
        async revert(cloudEvent) {
          callOrder.push('stage.revert');
          return cloudEvent;
        },
      };
      const converter = new CloudEventConverter(undefined, [stage]);
      const cloudEvent = await converter.convert(baseEvent());
      callOrder.length = 0;
      await converter.revert(cloudEvent);
      expect(callOrder).toEqual(['stage.revert']);
    });

    it('runs multiple appended stages forward in array order on convert', async () => {
      const callOrder: string[] = [];
      const namedStage = (name: string): ICloudEventConverter => ({
        async convert(cloudEvent) {
          callOrder.push(`${name}.convert`);
          return cloudEvent;
        },
        async revert(cloudEvent) {
          callOrder.push(`${name}.revert`);
          return cloudEvent;
        },
      });
      const converter = new CloudEventConverter(undefined, [
        namedStage('a'),
        namedStage('b'),
        namedStage('c'),
      ]);
      await converter.convert(baseEvent());
      expect(callOrder).toEqual(['a.convert', 'b.convert', 'c.convert']);
    });

    it('unwinds multiple appended stages in reverse array order on revert', async () => {
      const callOrder: string[] = [];
      const namedStage = (name: string): ICloudEventConverter => ({
        async convert(cloudEvent) {
          return cloudEvent;
        },
        async revert(cloudEvent) {
          callOrder.push(`${name}.revert`);
          return cloudEvent;
        },
      });
      const converter = new CloudEventConverter(undefined, [
        namedStage('a'),
        namedStage('b'),
        namedStage('c'),
      ]);
      const cloudEvent = await converter.convert(baseEvent());
      await converter.revert(cloudEvent);
      expect(callOrder).toEqual(['c.revert', 'b.revert', 'a.revert']);
    });
  });

  describe('stage failures', () => {
    it('reports a convert-stage failure as kind: "stage", naming direction/stageIndex/cause', async () => {
      const stage = throwingStage('boom');
      const converter = new CloudEventConverter(undefined, [stage]);
      const conversion = await converter.tryConvert(baseEvent());
      expect(conversion.ok).toBe(false);
      if (conversion.ok) throw new Error('unreachable');
      expect(conversion.error.detail).toMatchObject({
        kind: 'stage',
        direction: 'convert',
        stageIndex: 1,
      });
      if (conversion.error.detail.kind === 'stage') {
        expect((conversion.error.detail.cause as Error).message).toBe(
          'convert: boom',
        );
      }
    });

    it('convert throws the same CloudEventTransformationError tryConvert reports', async () => {
      const converter = new CloudEventConverter(undefined, [
        throwingStage('boom'),
      ]);
      const error = await thrownError(() => converter.convert(baseEvent()));
      expect(error.detail.kind).toBe('stage');
    });

    it('reports a revert-stage failure as kind: "stage", naming direction/stageIndex/cause', async () => {
      const stage = throwingStage('boom');
      const converter = new CloudEventConverter(undefined, [stage]);
      const cloudEvent = new CloudEvent<Record<string, unknown>>({
        id: 'x',
        source: 's',
        type: 't',
        specversion: '1.0',
      });
      const reversion = await converter.tryRevert(cloudEvent);
      expect(reversion.ok).toBe(false);
      if (reversion.ok) throw new Error('unreachable');
      expect(reversion.error.detail).toMatchObject({
        kind: 'stage',
        direction: 'revert',
        stageIndex: 1,
      });
      if (reversion.error.detail.kind === 'stage') {
        expect((reversion.error.detail.cause as Error).message).toBe(
          'revert: boom',
        );
      }
    });

    it('revert throws the same CloudEventTransformationError tryRevert reports', async () => {
      const converter = new CloudEventConverter(undefined, [
        throwingStage('boom'),
      ]);
      const cloudEvent = new CloudEvent<Record<string, unknown>>({
        id: 'x',
        source: 's',
        type: 't',
        specversion: '1.0',
      });
      const error = await thrownError(() => converter.revert(cloudEvent));
      expect(error.detail.kind).toBe('stage');
    });

    it('stops the convert pipeline at the first failing stage; a later stage never runs', async () => {
      const laterStage = passthroughStage();
      const converter = new CloudEventConverter(undefined, [
        throwingStage('boom'),
        laterStage,
      ]);
      await converter.tryConvert(baseEvent());
      expect(laterStage.calls).toHaveLength(0);
    });

    it('stops the revert pipeline at the first failing stage; a later (earlier-in-array) stage never runs', async () => {
      const earlierStage = passthroughStage();
      const cloudEvent = new CloudEvent<Record<string, unknown>>({
        id: 'x',
        source: 's',
        type: 't',
        specversion: '1.0',
      });
      const converter = new CloudEventConverter(undefined, [
        earlierStage,
        throwingStage('boom'),
      ]);
      await converter.tryRevert(cloudEvent);
      expect(earlierStage.calls).toHaveLength(0);
    });

    it('numbers stageIndex correctly across multiple appended stages, for convert', async () => {
      const converter = new CloudEventConverter(undefined, [
        passthroughStage(),
        throwingStage('boom'),
      ]);
      const conversion = await converter.tryConvert(baseEvent());
      if (conversion.ok) throw new Error('unreachable');
      expect(conversion.error.detail).toMatchObject({
        kind: 'stage',
        stageIndex: 2,
      });
    });

    it('numbers stageIndex correctly across multiple appended stages, for revert', async () => {
      const cloudEvent = new CloudEvent<Record<string, unknown>>({
        id: 'x',
        source: 's',
        type: 't',
        specversion: '1.0',
      });
      const converter = new CloudEventConverter(undefined, [
        passthroughStage(),
        throwingStage('boom'),
      ]);
      const reversion = await converter.tryRevert(cloudEvent);
      if (reversion.ok) throw new Error('unreachable');
      expect(reversion.error.detail).toMatchObject({
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
      const conversion = await converter.tryConvert(baseEvent());
      if (conversion.ok) throw new Error('unreachable');
      expect(conversion.error.detail).toMatchObject({
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
      const conversion = await converter.tryConvert(baseEvent());
      const reversion = await converter.tryRevert(
        new CloudEvent({ id: 'x', source: 's', type: 't', specversion: '1.0' }),
      );
      expect(conversion.ok).toBe(false);
      expect(reversion.ok).toBe(false);
    });
  });

  describe('CloudEventTransformationError passthrough (not double-wrapped)', () => {
    it('passes through a structural rejection from the base transformer as-is, not wrapped as kind: "stage"', async () => {
      const converter = new CloudEventConverter();
      const cloudEvent = new CloudEvent<Record<string, unknown>>({
        id: 'x',
        source: 's',
        type: 't',
        specversion: '1.0',
      });
      const reversion = await converter.tryRevert(cloudEvent, {
        dataschema: 'unknown/0.0.0',
      });
      expect(reversion.ok).toBe(false);
      if (reversion.ok) throw new Error('unreachable');
      expect(reversion.error.detail.kind).toBe('foreign');
    });

    it("preserves a stage's own thrown CloudEventTransformationError unchanged when it throws one deliberately", async () => {
      const deliberateError = new CloudEventTransformationError({
        kind: 'stage',
        direction: 'convert',
        stageIndex: 99,
        cause: 'deliberate',
      });
      const stage: ICloudEventConverter = {
        async convert() {
          throw deliberateError;
        },
        async revert(cloudEvent) {
          return cloudEvent;
        },
      };
      const converter = new CloudEventConverter(undefined, [stage]);
      const conversion = await converter.tryConvert(baseEvent());
      if (conversion.ok) throw new Error('unreachable');
      expect(conversion.error).toBe(deliberateError);
      expect(conversion.error.detail).toMatchObject({ stageIndex: 99 });
    });
  });

  describe('foreignFallback reaches only the base transformer', () => {
    it('passes foreignFallback through to a custom transformer that declares the extra parameter', async () => {
      let receivedFallback: unknown;
      const transformer: IArvoEventTransformer = {
        async convert() {
          return new CloudEvent({
            id: 'x',
            source: 's',
            type: 't',
            specversion: '1.0',
          });
        },
        async revert(_cloudEvent, foreignFallback) {
          receivedFallback = foreignFallback;
          return baseEvent();
        },
      };
      const converter = new CloudEventConverter(transformer);
      const cloudEvent = new CloudEvent<Record<string, unknown>>({
        id: 'x',
        source: 's',
        type: 't',
        specversion: '1.0',
      });
      await converter.revert(cloudEvent, { dataschema: 'unknown/0.0.0' });
      expect(receivedFallback).toEqual({ dataschema: 'unknown/0.0.0' });
    });

    it('does not pass foreignFallback to an appended ICloudEventConverter stage', async () => {
      let receivedArgCount = -1;
      const stage: ICloudEventConverter = {
        async convert(cloudEvent) {
          return cloudEvent;
        },
        async revert(...revertArguments: unknown[]) {
          receivedArgCount = revertArguments.length;
          return revertArguments[0] as CloudEvent;
        },
      };
      const converter = new CloudEventConverter(undefined, [stage]);
      const cloudEvent = await converter.convert(baseEvent());
      await converter.revert(cloudEvent, { dataschema: 'unknown/0.0.0' });
      expect(receivedArgCount).toBe(1);
    });
  });

  describe('type-level contract', () => {
    it('ICloudEventConverter requires both convert and revert', () => {
      // @ts-expect-error missing `revert`
      const _missingRevert: ICloudEventConverter = {
        async convert(cloudEvent) {
          return cloudEvent;
        },
      };
      // @ts-expect-error missing `convert`
      const _missingConvert: ICloudEventConverter = {
        async revert(cloudEvent) {
          return cloudEvent;
        },
      };
      expectTypeOf<ICloudEventConverter>().toHaveProperty('convert');
      expectTypeOf<ICloudEventConverter>().toHaveProperty('revert');
    });

    it('IArvoEventTransformer requires both convert and revert, with revert accepting foreignFallback', () => {
      // @ts-expect-error missing `revert`
      const _missingRevert: IArvoEventTransformer = {
        async convert(_event) {
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
        async revert(cloudEvent) {
          return cloudEvent as never;
        },
      };
      expectTypeOf<IArvoEventTransformer['revert']>().parameters.toEqualTypeOf<
        [
          data: CloudEvent,
          foreignFallback?:
            | import('../../../src/serializers/cloudevent/types.js').ForeignCloudEventFallback
            | undefined,
        ]
      >();
    });
  });
});
