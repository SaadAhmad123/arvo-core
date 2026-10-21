import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoEvent } from '../../../../src/ArvoEvent/index.js';
import { ArvoExecutionStateValidationError } from '../../../../src/ArvoEventHandler/state/errors.js';
import { ArvoExecutionState } from '../../../../src/ArvoEventHandler/state/index.js';
import { ArvoExecutionStateSerializerError } from '../../../../src/ArvoEventHandler/state/serializer/errors.js';
import { ArvoExecutionStateSerializer } from '../../../../src/ArvoEventHandler/state/serializer/index.js';
import { chargedEvent, initEvent } from '../../fixtures.js';
import { buildState, orderData } from '../fixtures.js';

const serializer = new ArvoExecutionStateSerializer(orderData);

/** The record's wire form as a plain object, for reaching into it. */
const wireObject = async (
  state = buildState(),
): Promise<Record<string, unknown>> =>
  JSON.parse(await serializer.serialize(state));

/** A wire string built from the whole form with the given fields replaced. */
const overriddenWire = async (
  overrides: Record<string, unknown>,
): Promise<string> => JSON.stringify({ ...(await wireObject()), ...overrides });

describe('ArvoExecutionStateSerializer', () => {
  describe('a round trip', () => {
    it('gives back everything that was written', async () => {
      const originalState = buildState();
      const restoredState = await serializer.deserialize(
        await serializer.serialize(originalState),
      );

      expect(restoredState.subject).toBe(originalState.subject);
      expect(restoredState.executionId).toBe(originalState.executionId);
      expect(restoredState.parentExecutionId).toBe(
        originalState.parentExecutionId,
      );
      expect(restoredState.depth).toBe(originalState.depth);
      expect(restoredState.source).toBe(originalState.source);
      expect(restoredState.version).toBe(originalState.version);
      expect(restoredState.lifecycle).toBe(originalState.lifecycle);
      expect(restoredState.lifecycleDescription).toBe(
        originalState.lifecycleDescription,
      );
      expect(restoredState.recordFormatVersion).toBe(
        originalState.recordFormatVersion,
      );
      expect(restoredState.casVersion).toBe(originalState.casVersion);
    });

    it('gives back the data', async () => {
      const restoredState = await serializer.deserialize(
        await serializer.serialize(buildState()),
      );
      expect(restoredState.data).toEqual({ orderId: 'o-1', attempts: 2 });
    });

    it('gives back an execution that had written nothing', async () => {
      const restoredState = await serializer.deserialize(
        await serializer.serialize(buildState({ data: null })),
      );
      expect(restoredState.data).toBeNull();
    });

    it('gives back the event log in the order it was written', async () => {
      const restoredState = await serializer.deserialize(
        await serializer.serialize(buildState()),
      );
      expect(restoredState.eventIds).toEqual([
        { id: initEvent.id, direction: 'received' },
        { id: chargedEvent.id, direction: 'emitted' },
      ]);
    });

    it('gives back a record, not the plain object it was stored as', async () => {
      const restoredState = await serializer.deserialize(
        await serializer.serialize(buildState()),
      );
      expect(restoredState).toBeInstanceOf(ArvoExecutionState);
    });
  });

  describe('the events it holds', () => {
    it('gives back the event that opened the execution as an event', async () => {
      const restoredState = await serializer.deserialize(
        await serializer.serialize(buildState()),
      );
      expect(restoredState.initEvent).toBeInstanceOf(ArvoEvent);
      expect(restoredState.initEvent.id).toBe(initEvent.id);
    });

    it('gives back the triggering event as an event', async () => {
      const restoredState = await serializer.deserialize(
        await serializer.serialize(buildState()),
      );
      expect(restoredState.triggeringEvent).toBeInstanceOf(ArvoEvent);
      expect(restoredState.triggeringEvent.type).toBe(chargedEvent.type);
    });

    it('gives back an event carrying everything it carried', async () => {
      const restoredState = await serializer.deserialize(
        await serializer.serialize(buildState()),
      );
      expect(restoredState.initEvent.data).toEqual(initEvent.data);
      expect(restoredState.initEvent.subject).toBe(initEvent.subject);
      expect(restoredState.initEvent.dataschema).toBe(initEvent.dataschema);
    });

    it('writes an event in the event format, not as a CloudEvent', async () => {
      const wire = await wireObject();
      expect(wire.initEvent).toMatchObject({ id: initEvent.id });
      expect(wire.initEvent).not.toHaveProperty('specversion');
    });
  });

  describe('what it is waiting on', () => {
    it('gives it back as a map', async () => {
      const restoredState = await serializer.deserialize(
        await serializer.serialize(buildState()),
      );
      expect(restoredState.inFlightEventMap).toBeInstanceOf(Map);
      expect(restoredState.inFlightEventMap.size).toBe(2);
    });

    it('gives back an answered request as the event that answered it', async () => {
      const restoredState = await serializer.deserialize(
        await serializer.serialize(buildState()),
      );
      const answerEvent = restoredState.inFlightEventMap.get('emitted-1');
      expect(answerEvent).toBeInstanceOf(ArvoEvent);
      expect(answerEvent?.id).toBe(chargedEvent.id);
    });

    it('gives back an unanswered one as nothing', async () => {
      const restoredState = await serializer.deserialize(
        await serializer.serialize(buildState()),
      );
      expect(restoredState.inFlightEventMap.get('emitted-2')).toBeNull();
    });

    it('gives back an empty one', async () => {
      const restoredState = await serializer.deserialize(
        await serializer.serialize(buildState({ inFlightEventMap: new Map() })),
      );
      expect(restoredState.inFlightEventMap.size).toBe(0);
    });
  });

  describe('the schema it was built with', () => {
    it('reads data back exactly as it was stored', async () => {
      const defaultingData = z.object({
        orderId: z.string(),
        currency: z.string().default('GBP'),
      });
      const wire = await overriddenWire({ data: { orderId: 'o-1' } });
      const restoredState = await new ArvoExecutionStateSerializer(
        defaultingData,
      ).deserialize(wire);
      expect(restoredState.data).toEqual({ orderId: 'o-1' });
    });

    it('does not fill in what the schema would have defaulted', async () => {
      const defaultingData = z.object({
        orderId: z.string(),
        currency: z.string().default('GBP'),
      });
      const wire = await overriddenWire({ data: { orderId: 'o-1' } });
      const restoredState = await new ArvoExecutionStateSerializer(
        defaultingData,
      ).deserialize(wire);
      expect(restoredState.data).not.toHaveProperty('currency');
    });

    it('refuses data that schema does not accept', async () => {
      const wire = await overriddenWire({ data: { orderId: 42, attempts: 1 } });
      const deserialization = await serializer.tryDeserialize(wire);
      expect(!deserialization.ok && deserialization.error).toBeInstanceOf(
        ArvoExecutionStateValidationError,
      );
    });

    it('names where in the data the problem is', async () => {
      const wire = await overriddenWire({ data: { orderId: 42, attempts: 1 } });
      const deserialization = await serializer.tryDeserialize(wire);
      expect(
        !deserialization.ok &&
          (deserialization.error as ArvoExecutionStateValidationError).issues[0]
            ?.path,
      ).toBe('data.orderId');
    });
  });

  describe('a string it cannot read', () => {
    it('refuses one that is not JSON', async () => {
      const deserialization =
        await serializer.tryDeserialize('not json at all');
      expect(!deserialization.ok && deserialization.error).toBeInstanceOf(
        ArvoExecutionStateSerializerError,
      );
    });

    it('keeps the underlying failure', async () => {
      const deserialization = await serializer.tryDeserialize('{');
      expect(!deserialization.ok && deserialization.error.cause).toBeInstanceOf(
        Error,
      );
    });

    it('refuses JSON that is not an object', async () => {
      const deserialization = await serializer.tryDeserialize('"a string"');
      expect(!deserialization.ok && deserialization.error).toBeInstanceOf(
        ArvoExecutionStateSerializerError,
      );
    });
  });

  describe('a record it can read but cannot trust', () => {
    it('refuses one missing what it must carry', async () => {
      const deserialization = await serializer.tryDeserialize(
        await overriddenWire({ subject: undefined }),
      );
      expect(!deserialization.ok && deserialization.error).toBeInstanceOf(
        ArvoExecutionStateValidationError,
      );
    });

    it('refuses one whose fields are out of their domain', async () => {
      const deserialization = await serializer.tryDeserialize(
        await overriddenWire({ depth: -1 }),
      );
      expect(!deserialization.ok && deserialization.error).toBeInstanceOf(
        ArvoExecutionStateValidationError,
      );
    });

    it('refuses an event that will not restore', async () => {
      const deserialization = await serializer.tryDeserialize(
        await overriddenWire({ initEvent: { id: 'nowhere near an event' } }),
      );
      expect(!deserialization.ok && deserialization.error).toBeInstanceOf(
        ArvoExecutionStateValidationError,
      );
    });

    it('names the event that would not restore', async () => {
      const deserialization = await serializer.tryDeserialize(
        await overriddenWire({ triggeringEvent: { id: 'no' } }),
      );
      expect(
        !deserialization.ok &&
          (deserialization.error as ArvoExecutionStateValidationError).issues[0]
            ?.path,
      ).toBe('triggeringEvent');
    });

    it('names the awaited answer that would not restore', async () => {
      const deserialization = await serializer.tryDeserialize(
        await overriddenWire({
          inFlightEventMap: [['emitted-1', { id: 'no' }]],
        }),
      );
      expect(
        !deserialization.ok &&
          (deserialization.error as ArvoExecutionStateValidationError).issues[0]
            ?.path,
      ).toBe('inFlightEventMap[emitted-1]');
    });

    it('refuses a collection that was not written as one', async () => {
      const deserialization = await serializer.tryDeserialize(
        await overriddenWire({ inFlightEventMap: 'not a collection' }),
      );
      expect(!deserialization.ok && deserialization.error).toBeInstanceOf(
        ArvoExecutionStateValidationError,
      );
    });

    it('gives back nothing half restored', async () => {
      const deserialization = await serializer.tryDeserialize(
        await overriddenWire({ depth: -1 }),
      );
      expect(deserialization.ok).toBe(false);
      expect('value' in deserialization).toBe(false);
    });
  });

  describe('a collection written oddly', () => {
    it('reads an entry that is only an id as awaiting an answer', async () => {
      const deserialization = await serializer.tryDeserialize(
        await overriddenWire({ inFlightEventMap: [['emitted-1']] }),
      );
      expect(
        deserialization.ok &&
          deserialization.value.inFlightEventMap.get('emitted-1'),
      ).toBe(null);
    });

    it('refuses an entry that is not a pair at all', async () => {
      const deserialization = await serializer.tryDeserialize(
        await overriddenWire({ inFlightEventMap: ['emitted-1'] }),
      );
      expect(!deserialization.ok && deserialization.error).toBeInstanceOf(
        ArvoExecutionStateValidationError,
      );
    });
  });

  describe('writing one it cannot turn into a string', () => {
    it('refuses an event that cannot be turned into JSON', async () => {
      const unwritableEvent = Object.create(ArvoEvent.prototype) as ArvoEvent;
      const circularData: Record<string, unknown> = {};
      circularData.self = circularData;
      Object.assign(unwritableEvent, { ...initEvent, data: circularData });

      const serialization = await serializer.trySerialize(
        buildState({ initEvent: unwritableEvent }),
      );
      expect(!serialization.ok && serialization.error).toBeInstanceOf(
        ArvoExecutionStateSerializerError,
      );
    });

    it('refuses an awaited answer that cannot be turned into JSON', async () => {
      const unwritableEvent = Object.create(ArvoEvent.prototype) as ArvoEvent;
      const circularData: Record<string, unknown> = {};
      circularData.self = circularData;
      Object.assign(unwritableEvent, { ...chargedEvent, data: circularData });

      const serialization = await serializer.trySerialize(
        buildState({
          inFlightEventMap: new Map([['emitted-1', unwritableEvent]]),
        }),
      );
      expect(!serialization.ok && serialization.error).toBeInstanceOf(
        ArvoExecutionStateSerializerError,
      );
    });

    it('refuses the triggering event where it cannot be turned into JSON', async () => {
      const unwritableEvent = Object.create(ArvoEvent.prototype) as ArvoEvent;
      const circularData: Record<string, unknown> = {};
      circularData.self = circularData;
      Object.assign(unwritableEvent, { ...chargedEvent, data: circularData });

      const serialization = await serializer.trySerialize(
        buildState({ triggeringEvent: unwritableEvent }),
      );
      expect(!serialization.ok && serialization.error).toBeInstanceOf(
        ArvoExecutionStateSerializerError,
      );
    });

    it('refuses data that will not serialize', async () => {
      const circularData: Record<string, unknown> = {
        orderId: 'o-1',
        attempts: 1,
      };
      circularData.self = circularData;
      const serialization = await serializer.trySerialize(
        buildState({ data: circularData as never }),
      );
      expect(!serialization.ok && serialization.error).toBeInstanceOf(
        ArvoExecutionStateSerializerError,
      );
    });

    it('keeps the underlying failure', async () => {
      const circularData: Record<string, unknown> = {
        orderId: 'o-1',
        attempts: 1,
      };
      circularData.self = circularData;
      const serialization = await serializer.trySerialize(
        buildState({ data: circularData as never }),
      );
      expect(!serialization.ok && serialization.error.cause).toBeInstanceOf(
        Error,
      );
    });
  });

  describe('the throwing forms', () => {
    it('throws what writing reports', async () => {
      const circularData: Record<string, unknown> = { orderId: 'o-1' };
      circularData.self = circularData;
      await expect(
        serializer.serialize(buildState({ data: circularData as never })),
      ).rejects.toBeInstanceOf(ArvoExecutionStateSerializerError);
    });

    it('throws what reading reports', async () => {
      await expect(serializer.deserialize('not json')).rejects.toBeInstanceOf(
        ArvoExecutionStateSerializerError,
      );
    });

    it('gives back a record where reading succeeds', async () => {
      const restoredState = await serializer.deserialize(
        await serializer.serialize(buildState()),
      );
      expect(restoredState.casVersion).toBe(7);
    });

    it('gives back a string where writing succeeds', async () => {
      expect(typeof (await serializer.serialize(buildState()))).toBe('string');
    });
  });

  describe('one built without a schema', () => {
    const schemalessSerializer = new ArvoExecutionStateSerializer();

    it('writes a record out', async () => {
      expect(typeof (await schemalessSerializer.serialize(buildState()))).toBe(
        'string',
      );
    });

    it('writes what a bound one writes', async () => {
      const state = buildState();
      expect(await schemalessSerializer.serialize(state)).toBe(
        await serializer.serialize(state),
      );
    });

    it('refuses to read one back, having nothing to check data against', async () => {
      const deserialization = await schemalessSerializer.tryDeserialize(
        await schemalessSerializer.serialize(buildState()),
      );
      expect(!deserialization.ok && deserialization.error).toBeInstanceOf(
        ArvoExecutionStateSerializerError,
      );
    });

    it('says why it refuses', async () => {
      const deserialization = await schemalessSerializer.tryDeserialize('{}');
      expect(!deserialization.ok && deserialization.error.message).toContain(
        'without a schema',
      );
    });
  });
});
