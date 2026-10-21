import { describe, expect, it } from 'vitest';
import { ArvoEventValidationError } from '../../../src/ArvoEvent/errors.js';
import { ArvoEvent } from '../../../src/ArvoEvent/index.js';
import type { ArvoEventParam } from '../../../src/ArvoEvent/types.js';
import { ArvoEventSerializerError } from '../../../src/serializers/ArvoEventSerializer/errors.js';
import { ArvoEventSerializer } from '../../../src/serializers/ArvoEventSerializer/index.js';
import { CloudEventTransformationError } from '../../../src/serializers/cloudevent/errors.js';
import { CloudEventConverter } from '../../../src/serializers/cloudevent/index.js';
import type { ICloudEventConverter } from '../../../src/serializers/cloudevent/interface.js';
import { CloudEvent } from '../../../src/serializers/cloudevent/types.js';

const baseParam = (): ArvoEventParam<'test.event', { hello: string }> => ({
  subject: 'subj-1',
  source: 'test/source',
  type: 'test.event',
  data: { hello: 'world' },
  dataschema: 'test://schema/v1',
});

const baseEvent = () => new ArvoEvent(baseParam());

/**
 * An enrichment stage that hands back a value `JSON.stringify` itself
 * rejects. Not a real `CloudEvent` instance -- nothing downstream of a
 * stage checks that, only that `convert`/`revert` themselves resolve.
 */
const circularStage = (): ICloudEventConverter => ({
  async convert() {
    const circularRecord: Record<string, unknown> = {};
    circularRecord.self = circularRecord;
    return circularRecord as never;
  },
  async revert(cloudEvent) {
    return cloudEvent;
  },
});

/** An enrichment stage whose `convert` always throws. */
const throwingStage = (): ICloudEventConverter => ({
  async convert() {
    throw new Error('stage boom');
  },
  async revert(cloudEvent) {
    return cloudEvent;
  },
});

describe('ArvoEventSerializer', () => {
  describe('construction and mode selection', () => {
    it('defaults to cloudevent mode with a default-constructed CloudEventConverter', async () => {
      const serializer = new ArvoEventSerializer();
      const event = baseEvent();
      const wire = await serializer.serialize(event);
      const wireJson = JSON.parse(wire);
      expect(wireJson.specversion).toBe('1.0');
    });

    it('uses a caller-supplied CloudEventConverter, including custom enrichment stages, for both serialize and deserialize', async () => {
      const calls: string[] = [];
      const stage: ICloudEventConverter = {
        async convert(cloudEvent) {
          calls.push('convert');
          return cloudEvent;
        },
        async revert(cloudEvent) {
          calls.push('revert');
          return cloudEvent;
        },
      };
      const converter = new CloudEventConverter(undefined, [stage]);
      const serializer = new ArvoEventSerializer({
        type: 'cloudevent',
        converter,
      });
      const wire = await serializer.serialize(baseEvent());
      await serializer.deserialize(wire);
      expect(calls).toEqual(['convert', 'revert']);
    });

    it('arvoevent mode never touches CloudEvent shape at all', async () => {
      const serializer = new ArvoEventSerializer({ type: 'arvoevent' });
      const wire = await serializer.serialize(baseEvent());
      const wireJson = JSON.parse(wire);
      expect(wireJson.specversion).toBeUndefined();
      expect(wireJson.datacontenttype).toBeUndefined();
      expect(wireJson.subject).toBe('subj-1');
    });
  });

  describe('serialize / trySerialize', () => {
    it("arvoevent mode: matches ArvoEvent's own default JSON.stringify output exactly", async () => {
      const serializer = new ArvoEventSerializer({ type: 'arvoevent' });
      const event = baseEvent();
      const wire = await serializer.serialize(event);
      expect(JSON.parse(wire)).toEqual(JSON.parse(JSON.stringify(event)));
    });

    it('cloudevent mode: matches JSON.stringify(await converter.convert(event)) through the real wire path', async () => {
      const converter = new CloudEventConverter();
      const serializer = new ArvoEventSerializer({
        type: 'cloudevent',
        converter,
      });
      const event = baseEvent();
      const wire = await serializer.serialize(event);
      const expectedWire = JSON.stringify(await converter.convert(event));
      expect(wire).toBe(expectedWire);
    });

    it('arvoevent mode: an event that will not stringify reports ArvoEventSerializerError rather than rejecting', async () => {
      const serializer = new ArvoEventSerializer({ type: 'arvoevent' });
      const circularRecord: Record<string, unknown> = {};
      circularRecord.self = circularRecord;
      const unserializableEvent = Object.create(
        ArvoEvent.prototype,
      ) as ArvoEvent;
      Object.assign(unserializableEvent, {
        ...baseEvent(),
        data: circularRecord,
      });

      const serialization = await serializer.trySerialize(unserializableEvent);
      expect(serialization.ok).toBe(false);
      expect(!serialization.ok && serialization.error).toBeInstanceOf(
        ArvoEventSerializerError,
      );
    });

    it('arvoevent mode: that failure keeps the TypeError as its cause', async () => {
      const serializer = new ArvoEventSerializer({ type: 'arvoevent' });
      const circularRecord: Record<string, unknown> = {};
      circularRecord.self = circularRecord;
      const unserializableEvent = Object.create(
        ArvoEvent.prototype,
      ) as ArvoEvent;
      Object.assign(unserializableEvent, {
        ...baseEvent(),
        data: circularRecord,
      });

      const serialization = await serializer.trySerialize(unserializableEvent);
      expect(!serialization.ok && serialization.error.cause).toBeInstanceOf(
        TypeError,
      );
    });

    it('arvoevent mode: serialize throws that same error', async () => {
      const serializer = new ArvoEventSerializer({ type: 'arvoevent' });
      const circularRecord: Record<string, unknown> = {};
      circularRecord.self = circularRecord;
      const unserializableEvent = Object.create(
        ArvoEvent.prototype,
      ) as ArvoEvent;
      Object.assign(unserializableEvent, {
        ...baseEvent(),
        data: circularRecord,
      });

      await expect(
        serializer.serialize(unserializableEvent),
      ).rejects.toBeInstanceOf(ArvoEventSerializerError);
    });

    it("trySerialize never rejects/throws in either mode's default configuration", async () => {
      for (const mode of [
        { type: 'arvoevent' as const },
        { type: 'cloudevent' as const },
      ]) {
        const serializer = new ArvoEventSerializer(mode);
        const serialization = await serializer.trySerialize(baseEvent());
        expect(serialization.ok).toBe(true);
      }
    });

    it('reports a throwing custom stage as CloudEventTransformationError (kind: stage), unwrapped', async () => {
      const converter = new CloudEventConverter(undefined, [throwingStage()]);
      const serializer = new ArvoEventSerializer({
        type: 'cloudevent',
        converter,
      });
      const serialization = await serializer.trySerialize(baseEvent());
      expect(serialization.ok).toBe(false);
      if (!serialization.ok) {
        expect(serialization.error).toBeInstanceOf(
          CloudEventTransformationError,
        );
        expect(
          (serialization.error as CloudEventTransformationError).detail.kind,
        ).toBe('stage');
      }
    });

    it('serialize throws that same CloudEventTransformationError when the stage fails', async () => {
      const converter = new CloudEventConverter(undefined, [throwingStage()]);
      const serializer = new ArvoEventSerializer({
        type: 'cloudevent',
        converter,
      });
      await expect(serializer.serialize(baseEvent())).rejects.toBeInstanceOf(
        CloudEventTransformationError,
      );
    });

    it("reports a custom stage's circular-reference output as ArvoEventSerializerError, with the TypeError available via .cause", async () => {
      const converter = new CloudEventConverter(undefined, [circularStage()]);
      const serializer = new ArvoEventSerializer({
        type: 'cloudevent',
        converter,
      });
      const serialization = await serializer.trySerialize(baseEvent());
      expect(serialization.ok).toBe(false);
      if (!serialization.ok) {
        expect(serialization.error).toBeInstanceOf(ArvoEventSerializerError);
        expect(
          (serialization.error as ArvoEventSerializerError).cause,
        ).toBeInstanceOf(TypeError);
      }
    });

    it('serialize throws that same ArvoEventSerializerError for the circular-reference case', async () => {
      const converter = new CloudEventConverter(undefined, [circularStage()]);
      const serializer = new ArvoEventSerializer({
        type: 'cloudevent',
        converter,
      });
      await expect(serializer.serialize(baseEvent())).rejects.toBeInstanceOf(
        ArvoEventSerializerError,
      );
    });
  });

  describe('deserialize / tryDeserialize', () => {
    it('full round trip reconstructs the event field for field, in arvoevent mode', async () => {
      const serializer = new ArvoEventSerializer({ type: 'arvoevent' });
      const event = baseEvent();
      const wire = await serializer.serialize(event);
      const restoredEvent = await serializer.deserialize(wire);
      expect(JSON.parse(JSON.stringify(restoredEvent))).toEqual(
        JSON.parse(JSON.stringify(event)),
      );
    });

    it('full round trip reconstructs the event field for field, in cloudevent mode', async () => {
      const serializer = new ArvoEventSerializer();
      const event = baseEvent();
      const wire = await serializer.serialize(event);
      const restoredEvent = await serializer.deserialize(wire);
      expect(JSON.parse(JSON.stringify(restoredEvent))).toEqual(
        JSON.parse(JSON.stringify(event)),
      );
    });

    it('cloudevent mode: a plain JSON.parse object (not a real CloudEvent instance) deserializes correctly with no caller-side wrapping', async () => {
      const converter = new CloudEventConverter();
      const serializer = new ArvoEventSerializer({
        type: 'cloudevent',
        converter,
      });
      const event = baseEvent();
      const cloudEvent = await converter.convert(event);
      const wireBody = JSON.stringify(cloudEvent);
      // the caller only ever has the JSON string — no CloudEvent construction of their own
      const restoredEvent = await serializer.deserialize(wireBody);
      expect(restoredEvent.subject).toBe(event.subject);
    });

    it('reports non-JSON input as ArvoEventSerializerError, with the SyntaxError available via .cause', async () => {
      const serializer = new ArvoEventSerializer();
      const deserialization =
        await serializer.tryDeserialize('not json at all');
      expect(deserialization.ok).toBe(false);
      if (!deserialization.ok) {
        expect(deserialization.error).toBeInstanceOf(ArvoEventSerializerError);
        expect(
          (deserialization.error as ArvoEventSerializerError).cause,
        ).toBeInstanceOf(SyntaxError);
      }
    });

    it('deserialize throws that same ArvoEventSerializerError for non-JSON input', async () => {
      const serializer = new ArvoEventSerializer();
      await expect(
        serializer.deserialize('not json at all'),
      ).rejects.toBeInstanceOf(ArvoEventSerializerError);
    });

    it('arvoevent mode: a structurally invalid parsed object reports ArvoEventSerializerError, with the ArvoEventValidationError available via .cause', async () => {
      const serializer = new ArvoEventSerializer({ type: 'arvoevent' });
      const deserialization = await serializer.tryDeserialize(
        JSON.stringify({ nonsense: true }),
      );
      expect(deserialization.ok).toBe(false);
      if (!deserialization.ok) {
        expect(deserialization.error).toBeInstanceOf(ArvoEventSerializerError);
        expect(
          (deserialization.error as ArvoEventSerializerError).cause,
        ).toBeInstanceOf(ArvoEventValidationError);
      }
    });

    it('cloudevent mode: a CloudEvent-shaped-but-invalid parsed object reports CloudEventTransformationError (kind: strict), unwrapped', async () => {
      const converter = new CloudEventConverter();
      const serializer = new ArvoEventSerializer({
        type: 'cloudevent',
        converter,
      });
      const malformedEvent = {
        id: 'id-1',
        source: 'test/source',
        type: 'test.event',
        specversion: '1.0',
        datacontenttype: 'application/vnd.arvo.event+json;version=1',
        // arvosubject deliberately missing -- Arvo-shaped but not strictly valid
      };
      const deserialization = await serializer.tryDeserialize(
        JSON.stringify(malformedEvent),
      );
      expect(deserialization.ok).toBe(false);
      if (!deserialization.ok) {
        expect(deserialization.error).toBeInstanceOf(
          CloudEventTransformationError,
        );
        expect(
          (deserialization.error as CloudEventTransformationError).detail.kind,
        ).toBe('strict');
      }

      const directReversion = await converter.tryRevert(
        new CloudEvent(malformedEvent as never, false),
      );
      expect(directReversion.ok).toBe(false);
    });

    it('cloudevent mode: a foreign-shaped parsed object with a supplied foreignFallback adapts correctly', async () => {
      const serializer = new ArvoEventSerializer();
      const foreignEvent = {
        id: 'x1',
        source: 'https://partner.example.com/orders',
        type: 'com.partner.order.shipped',
        specversion: '1.0',
      };
      const deserialization = await serializer.tryDeserialize(
        JSON.stringify(foreignEvent),
        {
          dataschema: 'unknown/0.0.0',
          subject: 's1',
          data: {},
        },
      );
      expect(deserialization.ok).toBe(true);
      if (deserialization.ok) {
        expect(deserialization.value.type).toBe('com.partner.order.shipped');
      }
    });

    it('arvoevent mode: a foreignFallback has no effect', async () => {
      const serializer = new ArvoEventSerializer({ type: 'arvoevent' });
      const event = baseEvent();
      const wire = await serializer.serialize(event);
      const eventWithFallback = await serializer.deserialize(wire, {
        dataschema: 'ignored/0.0.0',
        subject: 'ignored',
        data: { ignored: true },
      });
      const eventWithoutFallback = await serializer.deserialize(wire);
      expect(JSON.parse(JSON.stringify(eventWithFallback))).toEqual(
        JSON.parse(JSON.stringify(eventWithoutFallback)),
      );
    });

    it('deserialize<T, D>/tryDeserialize<T, D> compile with explicit type parameters and return the asserted shape, with no extra runtime validation of D', async () => {
      const serializer = new ArvoEventSerializer({ type: 'arvoevent' });
      const event = baseEvent();
      const wire = await serializer.serialize(event);
      const typedEvent = await serializer.deserialize<
        'test.event',
        { hello: string }
      >(wire);
      expect(typedEvent.type).toBe('test.event');
      expect(typedEvent.data.hello).toBe('world');

      // no runtime validation of D's shape beyond what tryParse already performs
      const wrongShapeWire = await serializer.serialize(event);
      const wronglyTypedEvent = await serializer.deserialize<
        'test.event',
        { nonexistent: number }
      >(wrongShapeWire);
      expect(wronglyTypedEvent.data).toEqual({ hello: 'world' });
    });

    it('cloudevent mode: rejects a parsed value with no specversion field before attempting foreign adaptation', async () => {
      const serializer = new ArvoEventSerializer();
      const deserialization = await serializer.tryDeserialize(
        JSON.stringify({ id: 'x', source: 's' }),
      );
      expect(deserialization.ok).toBe(false);
      if (!deserialization.ok) {
        expect(deserialization.error).toBeInstanceOf(
          CloudEventTransformationError,
        );
        const detail = (deserialization.error as CloudEventTransformationError)
          .detail;
        expect(detail.kind).toBe('foreign');
        if (detail.kind === 'foreign') {
          expect(
            detail.issues.some((issue) => issue.path === 'specversion'),
          ).toBe(true);
        }
      }
    });

    it('cloudevent mode: JSON produced by an arvoevent-mode serialize fails clearly via the specversion guard, not a plausible-looking wrong ArvoEvent', async () => {
      const arvoModeSerializer = new ArvoEventSerializer({ type: 'arvoevent' });
      const cloudModeSerializer = new ArvoEventSerializer();
      const wire = await arvoModeSerializer.serialize(baseEvent());
      const deserialization = await cloudModeSerializer.tryDeserialize(wire);
      expect(deserialization.ok).toBe(false);
      if (!deserialization.ok) {
        expect(deserialization.error).toBeInstanceOf(
          CloudEventTransformationError,
        );
      }
    });
  });
});
