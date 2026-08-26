import { ErrorIssue } from '../../../../utils/error-issue.js';
import type { CloudEvent } from '../../types.js';
import { DepthCodec } from '../codecs/depth.js';
import { ExecutionUnitsCodec } from '../codecs/execution-units.js';
import {
  ARVO_MEDIA_TYPE,
  DATA_SCHEMA,
  SPEC_VERSION,
  WRAPPER_KEYS,
} from '../constants.js';
import { parseDataContentType } from '../content-type.js';
import type { Decoded } from './index.js';

/** Reads `source[key]` as a required or optional string, reporting exactly one issue on absence or the wrong type. Shared by every scalar extension and wrapper-string field this module decodes. */
const readString = (
  source: Record<string, unknown>,
  key: string,
  required: boolean,
  issues: ErrorIssue[],
  path = key,
): string | undefined => {
  if (!(key in source)) {
    if (required) issues.push(new ErrorIssue({ path, message: 'is required' }));
    return undefined;
  }
  const value = source[key];
  if (typeof value !== 'string' || (required && value.length === 0)) {
    issues.push(
      new ErrorIssue({
        path,
        message: required ? 'must be a non-empty string' : 'must be a string',
        received: value,
      }),
    );
    return undefined;
  }
  return value;
};

/** Reads `wrapper[key]` as a required plain object, reporting exactly one issue on absence or the wrong type. Shared by `arvoeventdata`/`arvoeventbaggage`. */
const readWrapperObject = (
  wrapper: Record<string, unknown>,
  key: string,
  issues: ErrorIssue[],
): Record<string, unknown> | undefined => {
  const path = `data.${key}`;
  if (!(key in wrapper)) {
    issues.push(new ErrorIssue({ path, message: 'is required' }));
    return undefined;
  }
  const value = wrapper[key];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    issues.push(
      new ErrorIssue({ path, message: 'must be an object', received: value }),
    );
    return undefined;
  }
  return value as Record<string, unknown>;
};

const checkSpecVersion = (data: CloudEvent, issues: ErrorIssue[]): void => {
  if (data.specversion !== SPEC_VERSION) {
    issues.push(
      new ErrorIssue({
        path: 'specversion',
        message: `must be exactly "${SPEC_VERSION}"`,
        received: data.specversion,
      }),
    );
  }
};

const checkDataContentType = (data: CloudEvent, issues: ErrorIssue[]): void => {
  const parsed = parseDataContentType(data.datacontenttype);
  if (parsed?.mediaType !== ARVO_MEDIA_TYPE) {
    issues.push(
      new ErrorIssue({
        path: 'datacontenttype',
        message: `must have media type "${ARVO_MEDIA_TYPE}"`,
        received: data.datacontenttype,
      }),
    );
    return;
  }
  const paramNames = Object.keys(parsed.params);
  const carriesOnlyVersion1 =
    paramNames.length === 1 &&
    paramNames[0] === 'version' &&
    parsed.params.version === '1';
  if (!carriesOnlyVersion1) {
    issues.push(
      new ErrorIssue({
        path: 'datacontenttype',
        message: 'must carry exactly one parameter, version=1, and no others',
        received: data.datacontenttype,
      }),
    );
  }
};

const checkDataSchema = (data: CloudEvent, issues: ErrorIssue[]): void => {
  if (data.dataschema !== DATA_SCHEMA) {
    issues.push(
      new ErrorIssue({
        path: 'dataschema',
        message: `must be exactly "${DATA_SCHEMA}"`,
        received: data.dataschema,
      }),
    );
  }
};

/** Every scalar Arvo/tracing extension, decoded via the shared `readString` rule — one field each, in the same order the strict path has always checked them in. */
const decodeScalarFields = (
  raw: Record<string, unknown>,
  issues: ErrorIssue[],
): Record<string, unknown> => ({
  subject: readString(raw, 'subject', true, issues),
  time: readString(raw, 'time', true, issues),
  traceparent: readString(raw, 'traceparent', false, issues),
  tracestate: readString(raw, 'tracestate', false, issues),
  parentid: readString(raw, 'arvoparentid', false, issues),
  initid: readString(raw, 'arvoinitid', false, issues),
  executionid: readString(raw, 'arvoexecutionid', true, issues),
  category: readString(raw, 'arvocategory', false, issues),
  to: readString(raw, 'arvoto', false, issues),
  domain: readString(raw, 'arvodomain', false, issues),
});

const decodeDepth = (
  raw: Record<string, unknown>,
  issues: ErrorIssue[],
  codec: DepthCodec,
): number | undefined => {
  if (!('arvodepth' in raw)) {
    issues.push(new ErrorIssue({ path: 'arvodepth', message: 'is required' }));
    return undefined;
  }
  const encoded = raw.arvodepth;
  const decoded = typeof encoded === 'string' ? codec.decode(encoded) : null;
  if (decoded === null) {
    issues.push(
      new ErrorIssue({
        path: 'arvodepth',
        message:
          'must be the canonical unsigned-decimal encoding of a non-negative integer',
        received: encoded,
      }),
    );
    return undefined;
  }
  return decoded;
};

const decodeExecutionUnits = (
  raw: Record<string, unknown>,
  issues: ErrorIssue[],
  codec: ExecutionUnitsCodec,
): number | undefined => {
  if (!('arvoexecutionunits' in raw)) return undefined;
  const encoded = raw.arvoexecutionunits;
  const decoded = typeof encoded === 'string' ? codec.decode(encoded) : null;
  if (decoded === null) {
    issues.push(
      new ErrorIssue({
        path: 'arvoexecutionunits',
        message:
          'must be the canonical numeric-string encoding of a finite binary64 value',
        received: encoded,
      }),
    );
    return undefined;
  }
  return decoded;
};

/** Unwraps `data`'s three members, reporting the wrapper's own shape violations (not an object, wrong key set) plus each member's own via `readString`/`readWrapperObject`. */
const decodeWrapper = (
  data: CloudEvent,
  issues: ErrorIssue[],
): Record<string, unknown> => {
  const wrapper = data.data;
  if (
    wrapper === null ||
    typeof wrapper !== 'object' ||
    Array.isArray(wrapper)
  ) {
    issues.push(
      new ErrorIssue({
        path: 'data',
        message: `must be an object carrying exactly ${WRAPPER_KEYS.join(', ')}`,
        received: wrapper,
      }),
    );
    return {};
  }

  const wrapperRecord = wrapper as Record<string, unknown>;
  const extraKeys = Object.keys(wrapperRecord).filter(
    (key) => !(WRAPPER_KEYS as readonly string[]).includes(key),
  );
  if (extraKeys.length > 0) {
    issues.push(
      new ErrorIssue({
        path: 'data',
        message: `must not carry keys other than ${WRAPPER_KEYS.join(', ')} (found: ${extraKeys.join(', ')})`,
        received: extraKeys,
      }),
    );
  }

  return {
    data: readWrapperObject(wrapperRecord, 'arvoeventdata', issues),
    dataschema: readString(
      wrapperRecord,
      'arvoeventdataschema',
      true,
      issues,
      'data.arvoeventdataschema',
    ),
    baggage: readWrapperObject(wrapperRecord, 'arvoeventbaggage', issues),
  };
};

/** Strict Arvo-shaped decoding: every condition is checked individually, and all of them, not just the first failure, are reported together. */
export const decodeStrict = (data: CloudEvent): Decoded => {
  const issues: ErrorIssue[] = [];
  const raw = data as unknown as Record<string, unknown>;

  checkSpecVersion(data, issues);
  checkDataContentType(data, issues);
  checkDataSchema(data, issues);

  const candidate: Record<string, unknown> = {
    id: data.id,
    source: data.source,
    type: data.type,
    ...decodeScalarFields(raw, issues),
    depth: decodeDepth(raw, issues, new DepthCodec()),
    executionunits: decodeExecutionUnits(
      raw,
      issues,
      new ExecutionUnitsCodec(),
    ),
    ...decodeWrapper(data, issues),
  };

  return { candidate, issues };
};
