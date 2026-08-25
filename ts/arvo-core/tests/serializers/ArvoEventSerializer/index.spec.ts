import { describe, expect, it } from 'vitest';
import { ArvoEventValidationError } from '../../../src/ArvoEvent/errors.js';
import { ArvoEvent } from '../../../src/ArvoEvent/index.js';
import type { ArvoEventParam } from '../../../src/ArvoEvent/types.js';
import { CloudEventTransformationError } from '../../../src/cloudevent/errors.js';
import { CloudEventConverter } from '../../../src/cloudevent/index.js';
import type { ICloudEventConverter } from '../../../src/cloudevent/interface.js';
import { CloudEvent } from '../../../src/cloudevent/types.js';
import { ArvoEventSerializerError } from '../../../src/serializers/ArvoEventSerializer/errors.js';
import { ArvoEventSerializer } from '../../../src/serializers/ArvoEventSerializer/index.js';

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
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    return circular as never;
  },
  async revert(data) {
    return data;
  },
});

/** An enrichment stage whose `convert` always throws. */
const throwingStage = (): ICloudEventConverter => ({
  async convert() {
    throw new Error('stage boom');
  },
  async revert(data) {
    return data;
  },
});

describe('ArvoEventSerializer', () => {
  describe('construction and mode selection', () => {
    it('defaults to cloudevent mode with a default-constructed CloudEventConverter', async () => {
      const serializer = new ArvoEventSerializer();
      const event = baseEvent();
      const wire = await serializer.serialize(event);
      const parsed = JSON.parse(wire);
      expect(parsed.specversion).toBe('1.0');
    });

    it('uses a caller-supplied CloudEventConverter, including custom enrichment stages, for both serialize and deserialize', async () => {
      const calls: string[] = [];
      const stage: ICloudEventConverter = {
        async convert(data) {
          calls.push('convert');
          return data;
        },
        async revert(data) {
          calls.push('revert');
          return data;
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
      const parsed = JSON.parse(wire);
      expect(parsed.specversion).toBeUndefined();
      expect(parsed.datacontenttype).toBeUndefined();
      expect(parsed.subject).toBe('subj-1');
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
      const expected = JSON.stringify(await converter.convert(event));
      expect(wire).toBe(expected);
    });

    it("trySerialize never rejects/throws in either mode's default configuration", async () => {
      for (const mode of [
        { type: 'arvoevent' as const },
        { type: 'cloudevent' as const },
      ]) {
        const serializer = new ArvoEventSerializer(mode);
        const result = await serializer.trySerialize(baseEvent());
        expect(result.ok).toBe(true);
      }
    });

    it('reports a throwing custom stage as CloudEventTransformationError (kind: stage), unwrapped', async () => {
      const converter = new CloudEventConverter(undefined, [throwingStage()]);
      const serializer = new ArvoEventSerializer({
        type: 'cloudevent',
        converter,
      });
      const result = await serializer.trySerialize(baseEvent());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(CloudEventTransformationError);
        expect(
          (result.error as CloudEventTransformationError).detail.kind,
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
      const result = await serializer.trySerialize(baseEvent());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(ArvoEventSerializerError);
        expect((result.error as ArvoEventSerializerError).cause).toBeInstanceOf(
          TypeError,
        );
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
      const back = await serializer.deserialize(wire);
      expect(JSON.parse(JSON.stringify(back))).toEqual(
        JSON.parse(JSON.stringify(event)),
      );
    });

    it('full round trip reconstructs the event field for field, in cloudevent mode', async () => {
      const serializer = new ArvoEventSerializer();
      const event = baseEvent();
      const wire = await serializer.serialize(event);
      const back = await serializer.deserialize(wire);
      expect(JSON.parse(JSON.stringify(back))).toEqual(
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
      const ce = await converter.convert(event);
      const wireBody = JSON.stringify(ce);
      // the caller only ever has the JSON string — no CloudEvent construction of their own
      const back = await serializer.deserialize(wireBody);
      expect(back.subject).toBe(event.subject);
    });

    it('reports non-JSON input as ArvoEventSerializerError, with the SyntaxError available via .cause', async () => {
      const serializer = new ArvoEventSerializer();
      const result = await serializer.tryDeserialize('not json at all');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(ArvoEventSerializerError);
        expect((result.error as ArvoEventSerializerError).cause).toBeInstanceOf(
          SyntaxError,
        );
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
      const result = await serializer.tryDeserialize(
        JSON.stringify({ nonsense: true }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(ArvoEventSerializerError);
        expect((result.error as ArvoEventSerializerError).cause).toBeInstanceOf(
          ArvoEventValidationError,
        );
      }
    });

    it('cloudevent mode: a CloudEvent-shaped-but-invalid parsed object reports CloudEventTransformationError (kind: strict), unwrapped', async () => {
      const converter = new CloudEventConverter();
      const serializer = new ArvoEventSerializer({
        type: 'cloudevent',
        converter,
      });
      const malformed = {
        id: 'id-1',
        source: 'test/source',
        type: 'test.event',
        specversion: '1.0',
        datacontenttype: 'application/vnd.arvo.event+json;version=1',
        // arvosubject deliberately missing -- Arvo-shaped but not strictly valid
      };
      const result = await serializer.tryDeserialize(JSON.stringify(malformed));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(CloudEventTransformationError);
        expect(
          (result.error as CloudEventTransformationError).detail.kind,
        ).toBe('strict');
      }

      const directResult = await converter.tryRevert(
        new CloudEvent(malformed as never, false),
      );
      expect(directResult.ok).toBe(false);
    });

    it('cloudevent mode: a foreign-shaped parsed object with a supplied foreignFallback adapts correctly', async () => {
      const serializer = new ArvoEventSerializer();
      const foreign = {
        id: 'x1',
        source: 'https://partner.example.com/orders',
        type: 'com.partner.order.shipped',
        specversion: '1.0',
      };
      const result = await serializer.tryDeserialize(JSON.stringify(foreign), {
        dataschema: 'unknown/0.0.0',
        subject: 's1',
        data: {},
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.type).toBe('com.partner.order.shipped');
      }
    });

    it('arvoevent mode: a foreignFallback has no effect', async () => {
      const serializer = new ArvoEventSerializer({ type: 'arvoevent' });
      const event = baseEvent();
      const wire = await serializer.serialize(event);
      const withFallback = await serializer.deserialize(wire, {
        dataschema: 'ignored/0.0.0',
        subject: 'ignored',
        data: { ignored: true },
      });
      const withoutFallback = await serializer.deserialize(wire);
      expect(JSON.parse(JSON.stringify(withFallback))).toEqual(
        JSON.parse(JSON.stringify(withoutFallback)),
      );
    });

    it('deserialize<T, D>/tryDeserialize<T, D> compile with explicit type parameters and return the asserted shape, with no extra runtime validation of D', async () => {
      const serializer = new ArvoEventSerializer({ type: 'arvoevent' });
      const event = baseEvent();
      const wire = await serializer.serialize(event);
      const typed = await serializer.deserialize<
        'test.event',
        { hello: string }
      >(wire);
      expect(typed.type).toBe('test.event');
      expect(typed.data.hello).toBe('world');

      // no runtime validation of D's shape beyond what tryParse already performs
      const wrongShapeWire = await serializer.serialize(event);
      const wronglyTyped = await serializer.deserialize<
        'test.event',
        { nonexistent: number }
      >(wrongShapeWire);
      expect(wronglyTyped.data).toEqual({ hello: 'world' });
    });

    it('cloudevent mode: rejects a parsed value with no specversion field before attempting foreign adaptation', async () => {
      const serializer = new ArvoEventSerializer();
      const result = await serializer.tryDeserialize(
        JSON.stringify({ id: 'x', source: 's' }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(CloudEventTransformationError);
        const detail = (result.error as CloudEventTransformationError).detail;
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
      const result = await cloudModeSerializer.tryDeserialize(wire);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(CloudEventTransformationError);
      }
    });
  });
});
