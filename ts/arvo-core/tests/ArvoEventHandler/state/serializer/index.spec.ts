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
const wireOf = async (state = buildState()): Promise<Record<string, unknown>> =>
  JSON.parse(await serializer.serialize(state));

/** A wire string built from the whole form with the given fields replaced. */
const wireWith = async (overrides: Record<string, unknown>): Promise<string> =>
  JSON.stringify({ ...(await wireOf()), ...overrides });

describe('ArvoExecutionStateSerializer', () => {
  describe('a round trip', () => {
    it('gives back everything that was written', async () => {
      const before = buildState();
      const after = await serializer.deserialize(
        await serializer.serialize(before),
      );

      expect(after.subject).toBe(before.subject);
      expect(after.executionId).toBe(before.executionId);
      expect(after.parentExecutionId).toBe(before.parentExecutionId);
      expect(after.depth).toBe(before.depth);
      expect(after.source).toBe(before.source);
      expect(after.version).toBe(before.version);
      expect(after.lifecycle).toBe(before.lifecycle);
      expect(after.lifecycleDescription).toBe(before.lifecycleDescription);
      expect(after.recordFormatVersion).toBe(before.recordFormatVersion);
      expect(after.casVersion).toBe(before.casVersion);
    });

    it('gives back the data', async () => {
      const after = await serializer.deserialize(
        await serializer.serialize(buildState()),
      );
      expect(after.data).toEqual({ orderId: 'o-1', attempts: 2 });
    });

    it('gives back an execution that had written nothing', async () => {
      const after = await serializer.deserialize(
        await serializer.serialize(buildState({ data: null })),
      );
      expect(after.data).toBeNull();
    });

    it('gives back the event log in the order it was written', async () => {
      const after = await serializer.deserialize(
        await serializer.serialize(buildState()),
      );
      expect(after.eventIds).toEqual([
        { id: initEvent.id, direction: 'received' },
        { id: chargedEvent.id, direction: 'emitted' },
      ]);
    });

    it('gives back the contracts snapshot', async () => {
      const before = buildState();
      const after = await serializer.deserialize(
        await serializer.serialize(before),
      );
      expect(after.contracts).toEqual(before.contracts);
    });

    it('gives back a record, not the plain object it was stored as', async () => {
      const after = await serializer.deserialize(
        await serializer.serialize(buildState()),
      );
      expect(after).toBeInstanceOf(ArvoExecutionState);
    });
  });

  describe('the events it holds', () => {
    it('gives back the event that opened the execution as an event', async () => {
      const after = await serializer.deserialize(
        await serializer.serialize(buildState()),
      );
      expect(after.initEvent).toBeInstanceOf(ArvoEvent);
      expect(after.initEvent.id).toBe(initEvent.id);
    });

    it('gives back the triggering event as an event', async () => {
      const after = await serializer.deserialize(
        await serializer.serialize(buildState()),
      );
      expect(after.triggeringEvent).toBeInstanceOf(ArvoEvent);
      expect(after.triggeringEvent.type).toBe(chargedEvent.type);
    });

    it('gives back an event carrying everything it carried', async () => {
      const after = await serializer.deserialize(
        await serializer.serialize(buildState()),
      );
      expect(after.initEvent.data).toEqual(initEvent.data);
      expect(after.initEvent.subject).toBe(initEvent.subject);
      expect(after.initEvent.dataschema).toBe(initEvent.dataschema);
    });

    it('writes an event in the event format, not as a CloudEvent', async () => {
      const wire = await wireOf();
      expect(wire.initEvent).toMatchObject({ id: initEvent.id });
      expect(wire.initEvent).not.toHaveProperty('specversion');
    });
  });

  describe('what it is waiting on', () => {
    it('gives it back as a map', async () => {
      const after = await serializer.deserialize(
        await serializer.serialize(buildState()),
      );
      expect(after.inFlightEventMap).toBeInstanceOf(Map);
      expect(after.inFlightEventMap.size).toBe(2);
    });

    it('gives back an answered request as the event that answered it', async () => {
      const after = await serializer.deserialize(
        await serializer.serialize(buildState()),
      );
      const answer = after.inFlightEventMap.get('emitted-1');
      expect(answer).toBeInstanceOf(ArvoEvent);
      expect(answer?.id).toBe(chargedEvent.id);
    });

    it('gives back an unanswered one as nothing', async () => {
      const after = await serializer.deserialize(
        await serializer.serialize(buildState()),
      );
      expect(after.inFlightEventMap.get('emitted-2')).toBeNull();
    });

    it('gives back an empty one', async () => {
      const after = await serializer.deserialize(
        await serializer.serialize(buildState({ inFlightEventMap: new Map() })),
      );
      expect(after.inFlightEventMap.size).toBe(0);
    });
  });

  describe('the schema it was built with', () => {
    it('reads data back exactly as it was stored', async () => {
      const withDefault = z.object({
        orderId: z.string(),
        currency: z.string().default('GBP'),
      });
      const wire = await wireWith({ data: { orderId: 'o-1' } });
      const after = await new ArvoExecutionStateSerializer(
        withDefault,
      ).deserialize(wire);
      expect(after.data).toEqual({ orderId: 'o-1' });
    });

    it('does not fill in what the schema would have defaulted', async () => {
      const withDefault = z.object({
        orderId: z.string(),
        currency: z.string().default('GBP'),
      });
      const wire = await wireWith({ data: { orderId: 'o-1' } });
      const after = await new ArvoExecutionStateSerializer(
        withDefault,
      ).deserialize(wire);
      expect(after.data).not.toHaveProperty('currency');
    });

    it('refuses data that schema does not accept', async () => {
      const wire = await wireWith({ data: { orderId: 42, attempts: 1 } });
      const result = await serializer.tryDeserialize(wire);
      expect(!result.ok && result.error).toBeInstanceOf(
        ArvoExecutionStateValidationError,
      );
    });

    it('names where in the data the problem is', async () => {
      const wire = await wireWith({ data: { orderId: 42, attempts: 1 } });
      const result = await serializer.tryDeserialize(wire);
      expect(
        !result.ok &&
          (result.error as ArvoExecutionStateValidationError).issues[0]?.path,
      ).toBe('data.orderId');
    });
  });

  describe('a string it cannot read', () => {
    it('refuses one that is not JSON', async () => {
      const result = await serializer.tryDeserialize('not json at all');
      expect(!result.ok && result.error).toBeInstanceOf(
        ArvoExecutionStateSerializerError,
      );
    });

    it('keeps the underlying failure', async () => {
      const result = await serializer.tryDeserialize('{');
      expect(!result.ok && result.error.cause).toBeInstanceOf(Error);
    });

    it('refuses JSON that is not an object', async () => {
      const result = await serializer.tryDeserialize('"a string"');
      expect(!result.ok && result.error).toBeInstanceOf(
        ArvoExecutionStateSerializerError,
      );
    });
  });

  describe('a record it can read but cannot trust', () => {
    it('refuses one missing what it must carry', async () => {
      const result = await serializer.tryDeserialize(
        await wireWith({ subject: undefined }),
      );
      expect(!result.ok && result.error).toBeInstanceOf(
        ArvoExecutionStateValidationError,
      );
    });

    it('refuses one whose fields are out of their domain', async () => {
      const result = await serializer.tryDeserialize(
        await wireWith({ depth: -1 }),
      );
      expect(!result.ok && result.error).toBeInstanceOf(
        ArvoExecutionStateValidationError,
      );
    });

    it('refuses an event that will not restore', async () => {
      const result = await serializer.tryDeserialize(
        await wireWith({ initEvent: { id: 'nowhere near an event' } }),
      );
      expect(!result.ok && result.error).toBeInstanceOf(
        ArvoExecutionStateValidationError,
      );
    });

    it('names the event that would not restore', async () => {
      const result = await serializer.tryDeserialize(
        await wireWith({ triggeringEvent: { id: 'no' } }),
      );
      expect(
        !result.ok &&
          (result.error as ArvoExecutionStateValidationError).issues[0]?.path,
      ).toBe('triggeringEvent');
    });

    it('names the awaited answer that would not restore', async () => {
      const result = await serializer.tryDeserialize(
        await wireWith({ inFlightEventMap: [['emitted-1', { id: 'no' }]] }),
      );
      expect(
        !result.ok &&
          (result.error as ArvoExecutionStateValidationError).issues[0]?.path,
      ).toBe('inFlightEventMap[emitted-1]');
    });

    it('refuses a collection that was not written as one', async () => {
      const result = await serializer.tryDeserialize(
        await wireWith({ inFlightEventMap: 'not a collection' }),
      );
      expect(!result.ok && result.error).toBeInstanceOf(
        ArvoExecutionStateValidationError,
      );
    });

    it('gives back nothing half restored', async () => {
      const result = await serializer.tryDeserialize(
        await wireWith({ depth: -1 }),
      );
      expect(result.ok).toBe(false);
      expect('value' in result).toBe(false);
    });
  });

  describe('a collection written oddly', () => {
    it('reads an entry that is only an id as awaiting an answer', async () => {
      const result = await serializer.tryDeserialize(
        await wireWith({ inFlightEventMap: [['emitted-1']] }),
      );
      expect(result.ok && result.value.inFlightEventMap.get('emitted-1')).toBe(
        null,
      );
    });

    it('refuses an entry that is not a pair at all', async () => {
      const result = await serializer.tryDeserialize(
        await wireWith({ inFlightEventMap: ['emitted-1'] }),
      );
      expect(!result.ok && result.error).toBeInstanceOf(
        ArvoExecutionStateValidationError,
      );
    });
  });

  describe('writing one it cannot turn into a string', () => {
    it('refuses an event that cannot be turned into JSON', async () => {
      const unwritable = Object.create(ArvoEvent.prototype) as ArvoEvent;
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      Object.assign(unwritable, { ...initEvent, data: circular });

      const result = await serializer.trySerialize(
        buildState({ initEvent: unwritable }),
      );
      expect(!result.ok && result.error).toBeInstanceOf(
        ArvoExecutionStateSerializerError,
      );
    });

    it('refuses an awaited answer that cannot be turned into JSON', async () => {
      const unwritable = Object.create(ArvoEvent.prototype) as ArvoEvent;
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      Object.assign(unwritable, { ...chargedEvent, data: circular });

      const result = await serializer.trySerialize(
        buildState({ inFlightEventMap: new Map([['emitted-1', unwritable]]) }),
      );
      expect(!result.ok && result.error).toBeInstanceOf(
        ArvoExecutionStateSerializerError,
      );
    });

    it('refuses the triggering event where it cannot be turned into JSON', async () => {
      const unwritable = Object.create(ArvoEvent.prototype) as ArvoEvent;
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      Object.assign(unwritable, { ...chargedEvent, data: circular });

      const result = await serializer.trySerialize(
        buildState({ triggeringEvent: unwritable }),
      );
      expect(!result.ok && result.error).toBeInstanceOf(
        ArvoExecutionStateSerializerError,
      );
    });

    it('refuses data that will not serialize', async () => {
      const circular: Record<string, unknown> = { orderId: 'o-1', attempts: 1 };
      circular.self = circular;
      const result = await serializer.trySerialize(
        buildState({ data: circular as never }),
      );
      expect(!result.ok && result.error).toBeInstanceOf(
        ArvoExecutionStateSerializerError,
      );
    });

    it('keeps the underlying failure', async () => {
      const circular: Record<string, unknown> = { orderId: 'o-1', attempts: 1 };
      circular.self = circular;
      const result = await serializer.trySerialize(
        buildState({ data: circular as never }),
      );
      expect(!result.ok && result.error.cause).toBeInstanceOf(Error);
    });
  });

  describe('the throwing forms', () => {
    it('throws what writing reports', async () => {
      const circular: Record<string, unknown> = { orderId: 'o-1' };
      circular.self = circular;
      await expect(
        serializer.serialize(buildState({ data: circular as never })),
      ).rejects.toBeInstanceOf(ArvoExecutionStateSerializerError);
    });

    it('throws what reading reports', async () => {
      await expect(serializer.deserialize('not json')).rejects.toBeInstanceOf(
        ArvoExecutionStateSerializerError,
      );
    });

    it('gives back a record where reading succeeds', async () => {
      const after = await serializer.deserialize(
        await serializer.serialize(buildState()),
      );
      expect(after.casVersion).toBe(7);
    });

    it('gives back a string where writing succeeds', async () => {
      expect(typeof (await serializer.serialize(buildState()))).toBe('string');
    });
  });

  describe('one built without a schema', () => {
    const writeOnly = new ArvoExecutionStateSerializer();

    it('writes a record out', async () => {
      expect(typeof (await writeOnly.serialize(buildState()))).toBe('string');
    });

    it('writes what a bound one writes', async () => {
      const state = buildState();
      expect(await writeOnly.serialize(state)).toBe(
        await serializer.serialize(state),
      );
    });

    it('refuses to read one back, having nothing to check data against', async () => {
      const result = await writeOnly.tryDeserialize(
        await writeOnly.serialize(buildState()),
      );
      expect(!result.ok && result.error).toBeInstanceOf(
        ArvoExecutionStateSerializerError,
      );
    });

    it('says why it refuses', async () => {
      const result = await writeOnly.tryDeserialize('{}');
      expect(!result.ok && result.error.message).toContain('without a schema');
    });
  });
});
