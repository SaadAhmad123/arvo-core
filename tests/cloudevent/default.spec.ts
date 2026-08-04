import { describe, expect, it } from 'vitest';
import { ArvoEvent } from '../../src/ArvoEvent/index.js';
import type { ArvoEventParam } from '../../src/ArvoEvent/types.js';
import { CloudEventTransformationError } from '../../src/cloudevent/errors.js';
import { CloudEventConverter } from '../../src/cloudevent/index.js';
import { CloudEvent } from '../../src/cloudevent/types.js';

const converter = () => new CloudEventConverter();

const TRACEPARENT = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
const TRACESTATE = 'congo=t61rcWkgMzE';

const fullParam = (): ArvoEventParam<'test.event', { hello: string }> => ({
  parentid: 'parent-1',
  initid: 'init-1',
  subject: 'subj-1',
  executionid: 'exec-1',
  category: 'io.arvo.complete',
  depth: 3,
  source: 'test/source',
  to: 'to-target',
  domain: 'domain-x',
  type: 'test.event',
  data: { hello: 'world' },
  dataschema: 'test://schema/v1',
  baggage: { k: 'v', n: 1, b: true, nul: null },
  time: '2024-01-01T00:00:00.000+00:00',
  executionunits: 12.5,
  traceparent: TRACEPARENT,
  tracestate: TRACESTATE,
});

const minimalParam = (): ArvoEventParam<'test.event', { hello: string }> => ({
  subject: 'subj-1',
  source: 'test/source',
  type: 'test.event',
  data: { hello: 'world' },
  dataschema: 'test://schema/v1',
});

/** Constructs a `CloudEvent` from a raw shape, bypassing `cloudevents`' own construction-time conformance check — for building malformed fixtures this module's own decode logic must reject on its own terms. */
const rawCloudEvent = (fields: Record<string, unknown>): CloudEvent =>
  new CloudEvent(fields as never, false);

/** A plain object cast directly to `CloudEvent`, bypassing the class's constructor entirely — needed where the constructor itself would silently fill a gap this module's own decode logic must still reject on its own terms (e.g. `cloudevents` defaults a missing `time` to the current instant). */
const looseCloudEvent = (fields: Record<string, unknown>): CloudEvent =>
  fields as never as CloudEvent;

/**
 * The real wire path — `JSON.stringify`/`JSON.parse`, not the in-memory
 * object passed directly — because `CloudEvent.prototype.toJSON()` (which
 * only `JSON.stringify` ever triggers) mutates `time` on the way out.
 * `converter().revert(await converter().convert(event))` alone never
 * exercises that method at all.
 */
const wireRoundTrip = async (event: ArvoEvent): Promise<ArvoEvent> => {
  const ce = await converter().convert(event);
  const wireBody = JSON.stringify(ce);
  const received = new CloudEvent(JSON.parse(wireBody), false);
  return converter().revert(received);
};

const conformingArvoShapedFields = (): Record<string, unknown> => ({
  id: 'id-1',
  source: 'test/source',
  type: 'test.event',
  subject: 'subj-1',
  time: '2024-01-01T00:00:00.000+00:00',
  specversion: '1.0',
  datacontenttype: 'application/vnd.arvo.event+json;version=1',
  dataschema: 'https://www.arvo.land/schemas/cloudevent-data/v1',
  arvoexecutionid: 'subj-1',
  arvodepth: '0',
  data: {
    arvoeventdata: { hello: 'world' },
    arvoeventdataschema: 'test://schema/v1',
    arvoeventbaggage: {},
  } as Record<string, unknown>,
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

describe('ArvoToCloudEventConverter (default stage)', () => {
  describe('forward mapping', () => {
    it('carries native attributes unchanged', async () => {
      const event = new ArvoEvent(fullParam());
      const ce = await converter().convert(event);
      expect(ce.id).toBe(event.id);
      expect(ce.source).toBe(event.source);
      expect(ce.type).toBe(event.type);
      expect(ce.subject).toBe(event.subject);
      expect(ce.time).toBe(event.time);
    });

    it('fixes the protocol-level constants regardless of the source event', async () => {
      const ce = await converter().convert(new ArvoEvent(minimalParam()));
      expect(ce.specversion).toBe('1.0');
      expect(ce.datacontenttype).toBe(
        'application/vnd.arvo.event+json;version=1',
      );
      expect(ce.dataschema).toBe(
        'https://www.arvo.land/schemas/cloudevent-data/v1',
      );
      expect(
        (ce as never as { data_base64?: unknown }).data_base64,
      ).toBeUndefined();
    });

    it('carries traceparent/tracestate as extensions when present', async () => {
      const ce = await converter().convert(new ArvoEvent(fullParam()));
      expect(ce.traceparent).toBe(fullParam().traceparent);
      expect(ce.tracestate).toBe(fullParam().tracestate);
    });

    it('omits traceparent/tracestate when null', async () => {
      const ce = await converter().convert(new ArvoEvent(minimalParam()));
      expect('traceparent' in ce).toBe(false);
      expect('tracestate' in ce).toBe(false);
    });

    const scalarExtensions: [keyof ArvoEventParam, string][] = [
      ['parentid', 'arvoparentid'],
      ['initid', 'arvoinitid'],
      ['category', 'arvocategory'],
      ['to', 'arvoto'],
      ['domain', 'arvodomain'],
    ];

    for (const [field, extension] of scalarExtensions) {
      it(`carries ${field} as ${extension} when present`, async () => {
        const ce = await converter().convert(new ArvoEvent(fullParam()));
        expect((ce as never as Record<string, unknown>)[extension]).toBe(
          fullParam()[field],
        );
      });

      it(`omits ${extension} when ${field} is null`, async () => {
        const ce = await converter().convert(new ArvoEvent(minimalParam()));
        expect(extension in ce).toBe(false);
      });
    }

    it('carries executionid as arvoexecutionid, always present', async () => {
      const ce = await converter().convert(new ArvoEvent(minimalParam()));
      expect((ce as never as Record<string, unknown>).arvoexecutionid).toBe(
        'subj-1',
      );
    });

    it.each([0, 1, 42, 1000000])(
      'encodes arvodepth %i as its canonical decimal string',
      async (depth) => {
        const ce = await converter().convert(
          new ArvoEvent({
            ...minimalParam(),
            parentid: depth > 0 ? 'parent-1' : undefined,
            depth,
          }),
        );
        expect((ce as never as Record<string, unknown>).arvodepth).toBe(
          String(depth),
        );
      },
    );

    it.each([0.5, -3.25, 1e21, Number.MAX_SAFE_INTEGER])(
      'encodes arvoexecutionunits %s canonically',
      async (executionunits) => {
        const ce = await converter().convert(
          new ArvoEvent({ ...minimalParam(), executionunits }),
        );
        expect(
          (ce as never as Record<string, unknown>).arvoexecutionunits,
        ).toBe(JSON.stringify(executionunits));
      },
    );

    it('omits arvoexecutionunits when null', async () => {
      const ce = await converter().convert(new ArvoEvent(minimalParam()));
      expect('arvoexecutionunits' in ce).toBe(false);
    });

    it('wraps data/dataschema/baggage under exactly arvoeventdata/arvoeventdataschema/arvoeventbaggage', async () => {
      const event = new ArvoEvent(fullParam());
      const ce = await converter().convert(event);
      expect(Object.keys(ce.data as object).sort()).toEqual(
        ['arvoeventbaggage', 'arvoeventdata', 'arvoeventdataschema'].sort(),
      );
      expect(
        (ce.data as never as { arvoeventdata: unknown }).arvoeventdata,
      ).toEqual(event.data);
      expect(
        (ce.data as never as { arvoeventdataschema: unknown })
          .arvoeventdataschema,
      ).toBe(event.dataschema);
      expect(
        (ce.data as never as { arvoeventbaggage: unknown }).arvoeventbaggage,
      ).toEqual(event.baggage);
    });
  });

  describe('round-trip losslessness', () => {
    it('round-trips a fully populated event field for field', async () => {
      const event = new ArvoEvent(fullParam());
      const back = await converter().revert(await converter().convert(event));
      expect(JSON.parse(JSON.stringify(back))).toEqual(
        JSON.parse(JSON.stringify(event)),
      );
    });

    it('round-trips a minimal (all-null) event field for field', async () => {
      const event = new ArvoEvent(minimalParam());
      const back = await converter().revert(await converter().convert(event));
      expect(JSON.parse(JSON.stringify(back))).toEqual(
        JSON.parse(JSON.stringify(event)),
      );
    });

    it('round-trips a supplied -0 executionunits as 0', async () => {
      const event = new ArvoEvent({ ...minimalParam(), executionunits: -0 });
      const back = await converter().revert(await converter().convert(event));
      expect(Object.is(back.executionunits, 0)).toBe(true);
    });

    describe('through the real wire (JSON.stringify/JSON.parse, not the in-memory object)', () => {
      it('round-trips a fully populated event field for field, time omitted (default)', async () => {
        const event = new ArvoEvent({ ...fullParam(), time: undefined });
        const back = await wireRoundTrip(event);
        expect(JSON.parse(JSON.stringify(back))).toEqual(
          JSON.parse(JSON.stringify(event)),
        );
      });

      it('round-trips a minimal (all-null) event field for field', async () => {
        const event = new ArvoEvent(minimalParam());
        const back = await wireRoundTrip(event);
        expect(JSON.parse(JSON.stringify(back))).toEqual(
          JSON.parse(JSON.stringify(event)),
        );
      });

      it('round-trips a supplied -0 executionunits as 0', async () => {
        const event = new ArvoEvent({ ...minimalParam(), executionunits: -0 });
        const back = await wireRoundTrip(event);
        expect(Object.is(back.executionunits, 0)).toBe(true);
      });

      it('is idempotent across two wire round trips', async () => {
        const event = new ArvoEvent({ ...fullParam(), time: undefined });
        const once = await wireRoundTrip(event);
        const twice = await wireRoundTrip(once);
        expect(JSON.parse(JSON.stringify(twice))).toEqual(
          JSON.parse(JSON.stringify(event)),
        );
      });

      it('does NOT preserve an explicit non-UTC time — known, documented residual gap', async () => {
        const event = new ArvoEvent({
          ...minimalParam(),
          time: '2026-08-04T19:52:45.042+05:00',
        });
        const back = await wireRoundTrip(event);
        // This assertion is the regression guard in the other direction: if
        // this ever starts passing, either the gap was silently closed (say
        // so in tryRevert/revert's TSDoc and developer-usage-findings.md
        // Finding 6) or something is now silently swallowing a real
        // mismatch that should be visible.
        expect(back.time).not.toBe(event.time);
      });
    });
  });

  describe('discriminator and strict reversal', () => {
    it('reverses a fully conforming CloudEvent successfully', async () => {
      const ce = rawCloudEvent(conformingArvoShapedFields());
      const event = await converter().revert(ce);
      expect(event.subject).toBe('subj-1');
      expect(event.executionid).toBe('subj-1');
    });

    it('rejects the wrong specversion', async () => {
      const ce = rawCloudEvent({
        ...conformingArvoShapedFields(),
        specversion: '2.0',
      });
      const error = await isThrown(() => converter().revert(ce));
      expect(error.detail.kind).toBe('strict');
      expect(
        error.detail.kind === 'strict' &&
          error.detail.issues.some((i) => i.path === 'specversion'),
      ).toBe(true);
    });

    it.each([
      ['application/json;version=1', 'wrong media type'],
      ['application/vnd.arvo.event+json', 'missing version param'],
      ['application/vnd.arvo.event+json;version=2', 'wrong version value'],
      ['application/vnd.arvo.event+json;version=1;extra=x', 'extra params'],
    ])('rejects datacontenttype: %s (%s)', async (datacontenttype) => {
      const ce = rawCloudEvent({
        ...conformingArvoShapedFields(),
        datacontenttype,
      });
      const error = await isThrown(() => converter().revert(ce));
      expect(error.detail.kind).toBe('strict');
      expect(
        error.detail.kind === 'strict' &&
          error.detail.issues.some((i) => i.path === 'datacontenttype'),
      ).toBe(true);
    });

    it('accepts a case-varied media type and parameter name', async () => {
      const ce = rawCloudEvent({
        ...conformingArvoShapedFields(),
        datacontenttype: 'Application/Vnd.Arvo.Event+JSON;VERSION=1',
      });
      await expect(converter().revert(ce)).resolves.toBeInstanceOf(ArvoEvent);
    });

    it('rejects a case-varied version value (case-sensitive)', async () => {
      const ce = rawCloudEvent({
        ...conformingArvoShapedFields(),
        datacontenttype: 'application/vnd.arvo.event+json;version=X',
      });
      const error = await isThrown(() => converter().revert(ce));
      expect(error.detail.kind).toBe('strict');
    });

    it('rejects the wrong dataschema', async () => {
      const ce = rawCloudEvent({
        ...conformingArvoShapedFields(),
        dataschema: 'https://example.com/other',
      });
      const error = await isThrown(() => converter().revert(ce));
      expect(error.detail.kind).toBe('strict');
      expect(
        error.detail.kind === 'strict' &&
          error.detail.issues.some((i) => i.path === 'dataschema'),
      ).toBe(true);
    });

    it('rejects a missing subject', async () => {
      const fields = conformingArvoShapedFields();
      fields.subject = undefined;
      const error = await isThrown(() =>
        converter().revert(rawCloudEvent(fields)),
      );
      expect(
        error.detail.kind === 'strict' &&
          error.detail.issues.some((i) => i.path === 'subject'),
      ).toBe(true);
    });

    it('rejects a missing time', async () => {
      const fields = conformingArvoShapedFields();
      fields.time = undefined;
      const error = await isThrown(() =>
        converter().revert(looseCloudEvent(fields)),
      );
      expect(
        error.detail.kind === 'strict' &&
          error.detail.issues.some((i) => i.path === 'time'),
      ).toBe(true);
    });

    it('rejects a wrapper missing a required key', async () => {
      const fields = conformingArvoShapedFields();
      fields.data = { arvoeventdata: {}, arvoeventdataschema: 'x://y' };
      const error = await isThrown(() =>
        converter().revert(rawCloudEvent(fields)),
      );
      expect(
        error.detail.kind === 'strict' &&
          error.detail.issues.some((i) => i.path === 'data.arvoeventbaggage'),
      ).toBe(true);
    });

    it('rejects a wrapper with an extra key', async () => {
      const fields = conformingArvoShapedFields();
      fields.data = { ...(fields.data as Record<string, unknown>), extra: 1 };
      const error = await isThrown(() =>
        converter().revert(rawCloudEvent(fields)),
      );
      expect(
        error.detail.kind === 'strict' &&
          error.detail.issues.some((i) => i.path === 'data'),
      ).toBe(true);
    });

    it.each(['arvoeventdata', 'arvoeventbaggage'] as const)(
      'rejects a wrong-typed wrapper key %s',
      async (key) => {
        const fields = conformingArvoShapedFields();
        fields.data = {
          ...(fields.data as Record<string, unknown>),
          [key]: 'not-an-object',
        };
        const error = await isThrown(() =>
          converter().revert(rawCloudEvent(fields)),
        );
        expect(
          error.detail.kind === 'strict' &&
            error.detail.issues.some((i) => i.path === `data.${key}`),
        ).toBe(true);
      },
    );

    it('rejects a wrong-typed arvoeventdataschema', async () => {
      const fields = conformingArvoShapedFields();
      fields.data = {
        ...(fields.data as Record<string, unknown>),
        arvoeventdataschema: 123,
      };
      const error = await isThrown(() =>
        converter().revert(rawCloudEvent(fields)),
      );
      expect(
        error.detail.kind === 'strict' &&
          error.detail.issues.some(
            (i) => i.path === 'data.arvoeventdataschema',
          ),
      ).toBe(true);
    });

    it('rejects a missing arvoexecutionid', async () => {
      const fields = conformingArvoShapedFields();
      fields.arvoexecutionid = undefined;
      const error = await isThrown(() =>
        converter().revert(rawCloudEvent(fields)),
      );
      expect(
        error.detail.kind === 'strict' &&
          error.detail.issues.some((i) => i.path === 'arvoexecutionid'),
      ).toBe(true);
    });

    it.each(['-1', '01', '1.0', '1e1'])(
      'rejects a non-canonical arvodepth encoding: %s',
      async (arvodepth) => {
        const ce = rawCloudEvent({
          ...conformingArvoShapedFields(),
          arvodepth,
        });
        const error = await isThrown(() => converter().revert(ce));
        expect(
          error.detail.kind === 'strict' &&
            error.detail.issues.some((i) => i.path === 'arvodepth'),
        ).toBe(true);
      },
    );

    it('rejects a present-but-wrong-typed optional extension', async () => {
      const ce = rawCloudEvent({
        ...conformingArvoShapedFields(),
        arvocategory: 42,
      });
      const error = await isThrown(() => converter().revert(ce));
      expect(
        error.detail.kind === 'strict' &&
          error.detail.issues.some((i) => i.path === 'arvocategory'),
      ).toBe(true);
    });

    it('rejects a non-string arvodepth', async () => {
      const fields = conformingArvoShapedFields();
      fields.arvodepth = 0;
      const error = await isThrown(() =>
        converter().revert(looseCloudEvent(fields)),
      );
      expect(
        error.detail.kind === 'strict' &&
          error.detail.issues.some((i) => i.path === 'arvodepth'),
      ).toBe(true);
    });

    it('rejects a non-string arvoexecutionunits', async () => {
      const fields = conformingArvoShapedFields();
      fields.arvoexecutionunits = 1.5;
      const error = await isThrown(() =>
        converter().revert(looseCloudEvent(fields)),
      );
      expect(
        error.detail.kind === 'strict' &&
          error.detail.issues.some((i) => i.path === 'arvoexecutionunits'),
      ).toBe(true);
    });

    it('rejects an arvoexecutionunits failing its RFC 8785 round-trip check', async () => {
      const ce = rawCloudEvent({
        ...conformingArvoShapedFields(),
        arvoexecutionunits: '1.50',
      });
      const error = await isThrown(() => converter().revert(ce));
      expect(
        error.detail.kind === 'strict' &&
          error.detail.issues.some((i) => i.path === 'arvoexecutionunits'),
      ).toBe(true);
    });

    it('treats a CloudEvent claiming neither marker as foreign, not malformed', async () => {
      const ce = rawCloudEvent({
        id: 'id-1',
        source: 'foreign/source',
        type: 'foreign.event',
        specversion: '1.0',
      });
      const event = await converter().revert(ce, {
        dataschema: 'unknown/0.0.0',
        subject: 'fallback-subject',
        data: {},
      });
      expect(event).toBeInstanceOf(ArvoEvent);
    });

    it('rejects a partial-marker-match as malformed, distinguishably from foreign', async () => {
      const ce = rawCloudEvent({
        id: 'id-1',
        source: 'test/source',
        type: 'test.event',
        specversion: '1.0',
        dataschema: 'https://www.arvo.land/schemas/cloudevent-data/v1',
        // datacontenttype absent, subject/time/data absent -> claims via dataschema only
      });
      const error = await isThrown(() => converter().revert(ce));
      expect(error.detail.kind).toBe('strict');
    });

    it('fails a discriminator-passing candidate that violates a structural rule (Root Event Constraint)', async () => {
      const fields = conformingArvoShapedFields();
      fields.arvoparentid = undefined; // parentid null -> root event
      fields.arvoexecutionid = 'not-equal-to-subject'; // violates root constraint (executionid must equal subject)
      const error = await isThrown(() =>
        converter().revert(rawCloudEvent(fields)),
      );
      expect(
        error.detail.kind === 'strict' &&
          error.detail.issues.some((i) => i.path === 'parentid + executionid'),
      ).toBe(true);
    });

    it('never throws for any strict-path failure — always resolves through tryRevert', async () => {
      const ce = rawCloudEvent({
        ...conformingArvoShapedFields(),
        specversion: '2.0',
      });
      const result = await converter().tryRevert(ce);
      expect(result.ok).toBe(false);
    });
  });

  describe('foreign adaptation', () => {
    const foreign = (extra: Record<string, unknown> = {}) =>
      rawCloudEvent({
        id: 'f-1',
        source: 'foreign/source',
        type: 'foreign.type',
        specversion: '1.0',
        ...extra,
      });

    it('maps id/source/type unconditionally', async () => {
      const event = await converter().revert(foreign(), {
        dataschema: 'unknown/0.0.0',
        subject: 'fallback-subject',
        data: {},
      });
      expect(event.id).toBe('f-1');
      expect(event.source).toBe('foreign/source');
      expect(event.type).toBe('foreign.type');
    });

    it('maps subject/time/data when present, falls back otherwise', async () => {
      const event = await converter().revert(foreign(), {
        dataschema: 'unknown/0.0.0',
        subject: 'fallback-subject',
        data: { a: 1 },
      });
      expect(event.subject).toBe('fallback-subject');
      expect(event.data).toEqual({ a: 1 });
    });

    it('falls back to a caller-supplied time when the foreign CloudEvent genuinely has none', async () => {
      const ce = looseCloudEvent({
        id: 'f-1',
        source: 'foreign/source',
        type: 'foreign.type',
        specversion: '1.0',
      });
      const event = await converter().revert(ce, {
        dataschema: 'unknown/0.0.0',
        subject: 'fallback-subject',
        data: {},
        time: '2024-06-01T00:00:00.000+00:00',
      });
      expect(event.time).toBe('2024-06-01T00:00:00.000+00:00');
    });

    it('lets a present foreign subject/time/data win over a caller-supplied fallback', async () => {
      const ce = foreign({
        subject: 'foreign-subject',
        time: '2024-01-01T00:00:00.000+00:00',
        data: { a: 1 },
      });
      const event = await converter().revert(ce, {
        dataschema: 'unknown/0.0.0',
        subject: 'fallback-subject',
        data: { b: 2 },
      });
      expect(event.subject).toBe('foreign-subject');
      expect(event.data).toEqual({ a: 1 });
    });

    it('maps traceparent/tracestate when present', async () => {
      const ce = foreign({ traceparent: '00-abc-def-01', tracestate: 'k=v' });
      const event = await converter().revert(ce, {
        dataschema: 'unknown/0.0.0',
        subject: 'fallback-subject',
        data: {},
      });
      expect(event.traceparent).toBe('00-abc-def-01');
      expect(event.tracestate).toBe('k=v');
    });

    it('fails adaptation, naming dataschema, when the caller supplies no fallback dataschema', async () => {
      const error = await isThrown(() =>
        converter().revert(foreign({ data: {} })),
      );
      expect(
        error.detail.kind === 'foreign' &&
          error.detail.issues.some((i) => i.path === 'dataschema'),
      ).toBe(true);
    });

    it('fails adaptation, naming data, when foreign data is present but not an object', async () => {
      const ce = foreign({ data: 'not-an-object' });
      const error = await isThrown(() =>
        converter().revert(ce, { dataschema: 'unknown/0.0.0' }),
      );
      expect(
        error.detail.kind === 'foreign' &&
          error.detail.issues.some((i) => i.path === 'data'),
      ).toBe(true);
    });

    it('never interprets an arvo-prefixed attribute on a foreign event', async () => {
      const ce = foreign({ arvoparentid: 'should-be-ignored', data: {} });
      const event = await converter().revert(ce, {
        dataschema: 'unknown/0.0.0',
        subject: 'fallback-subject',
      });
      expect(event.parentid).toBeNull();
    });

    it('still runs the assembled candidate through structural validation', async () => {
      const ce = foreign({ source: 'not a valid uri reference', data: {} });
      const error = await isThrown(() =>
        converter().revert(ce, { dataschema: 'unknown/0.0.0' }),
      );
      expect(
        error.detail.kind === 'foreign' &&
          error.detail.issues.some((i) => i.path === 'source'),
      ).toBe(true);
    });
  });
});
