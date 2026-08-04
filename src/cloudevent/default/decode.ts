import type { ArvoEventValidationIssue } from '../../ArvoEvent/errors.js';
import type { CloudEvent, ForeignCloudEventFallback } from '../types.js';
import { DepthCodec } from './codecs/depth.js';
import { ExecutionUnitsCodec } from './codecs/execution-units.js';
import {
  ARVO_MEDIA_TYPE,
  DATA_SCHEMA,
  SPEC_VERSION,
  WRAPPER_KEYS,
} from './constants.js';
import { parseDataContentType } from './content-type.js';

export type Decoded = {
  candidate: Record<string, unknown>;
  issues: ArvoEventValidationIssue[];
};

/** Whether `data` claims Arvo shape at all, via either marker — the branch point between attempting strict decoding and foreign adaptation. */
export const claimsArvoShape = (data: CloudEvent): boolean => {
  const parsed = parseDataContentType(data.datacontenttype);
  return (
    parsed?.mediaType === ARVO_MEDIA_TYPE || data.dataschema === DATA_SCHEMA
  );
};

/** Reads `source[key]` as a required or optional string, reporting exactly one issue on absence or the wrong type. Shared by every scalar extension and wrapper-string field this module decodes. */
const readString = (
  source: Record<string, unknown>,
  key: string,
  required: boolean,
  issues: ArvoEventValidationIssue[],
  path = key,
): string | undefined => {
  if (!(key in source)) {
    if (required) issues.push({ path, message: 'is required' });
    return undefined;
  }
  const value = source[key];
  if (typeof value !== 'string' || (required && value.length === 0)) {
    issues.push({
      path,
      message: required ? 'must be a non-empty string' : 'must be a string',
      received: value,
    });
    return undefined;
  }
  return value;
};

/** `source[key]` if it is present and a string, otherwise `undefined` — no issue reported either way. */
const asString = (
  source: Record<string, unknown>,
  key: string,
): string | undefined => {
  const value = source[key];
  return typeof value === 'string' ? value : undefined;
};

/** Reads `wrapper[key]` as a required plain object, reporting exactly one issue on absence or the wrong type. Shared by `arvoeventdata`/`arvoeventbaggage`. */
const readWrapperObject = (
  wrapper: Record<string, unknown>,
  key: string,
  issues: ArvoEventValidationIssue[],
): Record<string, unknown> | undefined => {
  const path = `data.${key}`;
  if (!(key in wrapper)) {
    issues.push({ path, message: 'is required' });
    return undefined;
  }
  const value = wrapper[key];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    issues.push({ path, message: 'must be an object', received: value });
    return undefined;
  }
  return value as Record<string, unknown>;
};

/** Strict Arvo-shaped decoding: every condition is checked individually, and all of them, not just the first failure, are reported together. */
export const decodeStrict = (data: CloudEvent): Decoded => {
  const issues: ArvoEventValidationIssue[] = [];
  const raw = data as unknown as Record<string, unknown>;
  const candidate: Record<string, unknown> = {
    id: data.id,
    source: data.source,
    type: data.type,
  };
  const depthCodec = new DepthCodec();
  const executionUnitsCodec = new ExecutionUnitsCodec();

  if (data.specversion !== SPEC_VERSION) {
    issues.push({
      path: 'specversion',
      message: `must be exactly "${SPEC_VERSION}"`,
      received: data.specversion,
    });
  }

  const parsedContentType = parseDataContentType(data.datacontenttype);
  if (parsedContentType?.mediaType !== ARVO_MEDIA_TYPE) {
    issues.push({
      path: 'datacontenttype',
      message: `must have media type "${ARVO_MEDIA_TYPE}"`,
      received: data.datacontenttype,
    });
  } else {
    const paramNames = Object.keys(parsedContentType.params);
    const carriesOnlyVersion1 =
      paramNames.length === 1 &&
      paramNames[0] === 'version' &&
      parsedContentType.params.version === '1';
    if (!carriesOnlyVersion1) {
      issues.push({
        path: 'datacontenttype',
        message: 'must carry exactly one parameter, version=1, and no others',
        received: data.datacontenttype,
      });
    }
  }

  if (data.dataschema !== DATA_SCHEMA) {
    issues.push({
      path: 'dataschema',
      message: `must be exactly "${DATA_SCHEMA}"`,
      received: data.dataschema,
    });
  }

  candidate.subject = readString(raw, 'subject', true, issues);
  candidate.time = readString(raw, 'time', false, issues);
  candidate.traceparent = readString(raw, 'traceparent', false, issues);
  candidate.tracestate = readString(raw, 'tracestate', false, issues);
  candidate.parentid = readString(raw, 'arvoparentid', false, issues);
  candidate.initid = readString(raw, 'arvoinitid', false, issues);
  candidate.executionid = readString(raw, 'arvoexecutionid', true, issues);
  candidate.category = readString(raw, 'arvocategory', false, issues);
  candidate.to = readString(raw, 'arvoto', false, issues);
  candidate.domain = readString(raw, 'arvodomain', false, issues);

  if ('arvodepth' in raw) {
    const encoded = raw.arvodepth;
    const decoded =
      typeof encoded === 'string' ? depthCodec.decode(encoded) : null;
    if (decoded === null) {
      issues.push({
        path: 'arvodepth',
        message:
          'must be the canonical unsigned-decimal encoding of a non-negative integer',
        received: encoded,
      });
    } else {
      candidate.depth = decoded;
    }
  } else {
    issues.push({ path: 'arvodepth', message: 'is required' });
  }

  if ('arvoexecutionunits' in raw) {
    const encoded = raw.arvoexecutionunits;
    const decoded =
      typeof encoded === 'string' ? executionUnitsCodec.decode(encoded) : null;
    if (decoded === null) {
      issues.push({
        path: 'arvoexecutionunits',
        message:
          'must be the canonical numeric-string encoding of a finite binary64 value',
        received: encoded,
      });
    } else {
      candidate.executionunits = decoded;
    }
  }

  const wrapper = data.data;
  if (
    wrapper === null ||
    typeof wrapper !== 'object' ||
    Array.isArray(wrapper)
  ) {
    issues.push({
      path: 'data',
      message: `must be an object carrying exactly ${WRAPPER_KEYS.join(', ')}`,
      received: wrapper,
    });
  } else {
    const wrapperRecord = wrapper as Record<string, unknown>;
    const extraKeys = Object.keys(wrapperRecord).filter(
      (key) => !(WRAPPER_KEYS as readonly string[]).includes(key),
    );
    if (extraKeys.length > 0) {
      issues.push({
        path: 'data',
        message: `must not carry keys other than ${WRAPPER_KEYS.join(', ')} (found: ${extraKeys.join(', ')})`,
        received: extraKeys,
      });
    }
    candidate.data = readWrapperObject(wrapperRecord, 'arvoeventdata', issues);
    candidate.dataschema = readString(
      wrapperRecord,
      'arvoeventdataschema',
      true,
      issues,
      'data.arvoeventdataschema',
    );
    candidate.baggage = readWrapperObject(
      wrapperRecord,
      'arvoeventbaggage',
      issues,
    );
  }

  return { candidate, issues };
};

/** Foreign-event adaptation: only `id`/`source`/`type` are unconditional; every other field is mapped when the foreign CloudEvent provides it, otherwise left to `fallback` — a present foreign value always wins over its fallback. */
export const decodeForeign = (
  data: CloudEvent,
  fallback?: ForeignCloudEventFallback,
): Decoded => {
  const issues: ArvoEventValidationIssue[] = [];
  const raw = data as unknown as Record<string, unknown>;
  const candidate: Record<string, unknown> = {
    id: data.id,
    source: data.source,
    type: data.type,
    subject:
      typeof data.subject === 'string' ? data.subject : fallback?.subject,
    time: typeof data.time === 'string' ? data.time : fallback?.time,
    traceparent: asString(raw, 'traceparent'),
    tracestate: asString(raw, 'tracestate'),
    parentid: fallback?.parentid,
    initid: fallback?.initid,
    executionid: fallback?.executionid,
    category: fallback?.category,
    depth: fallback?.depth,
    to: fallback?.to,
    domain: fallback?.domain,
    baggage: fallback?.baggage,
    executionunits: fallback?.executionunits,
  };

  if (data.data !== undefined) {
    if (
      data.data === null ||
      typeof data.data !== 'object' ||
      Array.isArray(data.data)
    ) {
      issues.push({
        path: 'data',
        message: 'must be an object to be adapted from a foreign CloudEvent',
        received: data.data,
      });
    } else {
      candidate.data = data.data;
    }
  } else {
    candidate.data = fallback?.data;
  }

  candidate.dataschema = fallback?.dataschema;
  if (!fallback?.dataschema) {
    issues.push({
      path: 'dataschema',
      message:
        'is required as a caller-supplied fallback when adapting a foreign CloudEvent',
      received: fallback?.dataschema,
    });
  }

  return { candidate, issues };
};
