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
  isRequired: boolean,
  issues: ErrorIssue[],
  path = key,
): string | undefined => {
  if (!(key in source)) {
    if (isRequired)
      issues.push(new ErrorIssue({ path, message: 'is required' }));
    return undefined;
  }
  const fieldValue = source[key];
  if (
    typeof fieldValue !== 'string' ||
    (isRequired && fieldValue.length === 0)
  ) {
    issues.push(
      new ErrorIssue({
        path,
        message: isRequired ? 'must be a non-empty string' : 'must be a string',
        received: fieldValue,
      }),
    );
    return undefined;
  }
  return fieldValue;
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
  const fieldValue = wrapper[key];
  if (
    fieldValue === null ||
    typeof fieldValue !== 'object' ||
    Array.isArray(fieldValue)
  ) {
    issues.push(
      new ErrorIssue({
        path,
        message: 'must be an object',
        received: fieldValue,
      }),
    );
    return undefined;
  }
  return fieldValue as Record<string, unknown>;
};

const checkSpecVersion = (
  cloudEvent: CloudEvent,
  issues: ErrorIssue[],
): void => {
  if (cloudEvent.specversion !== SPEC_VERSION) {
    issues.push(
      new ErrorIssue({
        path: 'specversion',
        message: `must be exactly "${SPEC_VERSION}"`,
        received: cloudEvent.specversion,
      }),
    );
  }
};

const checkDataContentType = (
  cloudEvent: CloudEvent,
  issues: ErrorIssue[],
): void => {
  const contentType = parseDataContentType(cloudEvent.datacontenttype);
  if (contentType?.mediaType !== ARVO_MEDIA_TYPE) {
    issues.push(
      new ErrorIssue({
        path: 'datacontenttype',
        message: `must have media type "${ARVO_MEDIA_TYPE}"`,
        received: cloudEvent.datacontenttype,
      }),
    );
    return;
  }
  const paramNames = Object.keys(contentType.params);
  const carriesOnlyVersion1 =
    paramNames.length === 1 &&
    paramNames[0] === 'version' &&
    contentType.params.version === '1';
  if (!carriesOnlyVersion1) {
    issues.push(
      new ErrorIssue({
        path: 'datacontenttype',
        message: 'must carry exactly one parameter, version=1, and no others',
        received: cloudEvent.datacontenttype,
      }),
    );
  }
};

const checkDataSchema = (
  cloudEvent: CloudEvent,
  issues: ErrorIssue[],
): void => {
  if (cloudEvent.dataschema !== DATA_SCHEMA) {
    issues.push(
      new ErrorIssue({
        path: 'dataschema',
        message: `must be exactly "${DATA_SCHEMA}"`,
        received: cloudEvent.dataschema,
      }),
    );
  }
};

/** Every scalar Arvo/tracing extension, decoded via the shared `readString` rule — one field each, in the same order the strict path has always checked them in. */
const decodeScalarFields = (
  cloudEventFields: Record<string, unknown>,
  issues: ErrorIssue[],
): Record<string, unknown> => ({
  subject: readString(cloudEventFields, 'subject', true, issues),
  time: readString(cloudEventFields, 'time', true, issues),
  traceparent: readString(cloudEventFields, 'traceparent', false, issues),
  tracestate: readString(cloudEventFields, 'tracestate', false, issues),
  parentid: readString(cloudEventFields, 'arvoparentid', false, issues),
  initid: readString(cloudEventFields, 'arvoinitid', false, issues),
  executionid: readString(cloudEventFields, 'arvoexecutionid', true, issues),
  category: readString(cloudEventFields, 'arvocategory', false, issues),
  to: readString(cloudEventFields, 'arvoto', false, issues),
  domain: readString(cloudEventFields, 'arvodomain', false, issues),
});

const decodeDepth = (
  cloudEventFields: Record<string, unknown>,
  issues: ErrorIssue[],
  codec: DepthCodec,
): number | undefined => {
  if (!('arvodepth' in cloudEventFields)) {
    issues.push(new ErrorIssue({ path: 'arvodepth', message: 'is required' }));
    return undefined;
  }
  const encodedDepth = cloudEventFields.arvodepth;
  const depth =
    typeof encodedDepth === 'string' ? codec.decode(encodedDepth) : null;
  if (depth === null) {
    issues.push(
      new ErrorIssue({
        path: 'arvodepth',
        message:
          'must be the canonical unsigned-decimal encoding of a non-negative integer',
        received: encodedDepth,
      }),
    );
    return undefined;
  }
  return depth;
};

const decodeExecutionUnits = (
  cloudEventFields: Record<string, unknown>,
  issues: ErrorIssue[],
  codec: ExecutionUnitsCodec,
): number | undefined => {
  if (!('arvoexecutionunits' in cloudEventFields)) return undefined;
  const encodedExecutionUnits = cloudEventFields.arvoexecutionunits;
  const executionUnits =
    typeof encodedExecutionUnits === 'string'
      ? codec.decode(encodedExecutionUnits)
      : null;
  if (executionUnits === null) {
    issues.push(
      new ErrorIssue({
        path: 'arvoexecutionunits',
        message:
          'must be the canonical numeric-string encoding of a finite binary64 value',
        received: encodedExecutionUnits,
      }),
    );
    return undefined;
  }
  return executionUnits;
};

/** Unwraps `data`'s three members, reporting the wrapper's own shape violations (not an object, wrong key set) plus each member's own via `readString`/`readWrapperObject`. */
const decodeWrapper = (
  cloudEvent: CloudEvent,
  issues: ErrorIssue[],
): Record<string, unknown> => {
  const wrapper = cloudEvent.data;
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
export const decodeStrict = (cloudEvent: CloudEvent): Decoded => {
  const issues: ErrorIssue[] = [];
  const cloudEventFields = cloudEvent as unknown as Record<string, unknown>;

  checkSpecVersion(cloudEvent, issues);
  checkDataContentType(cloudEvent, issues);
  checkDataSchema(cloudEvent, issues);

  const candidate: Record<string, unknown> = {
    id: cloudEvent.id,
    source: cloudEvent.source,
    type: cloudEvent.type,
    ...decodeScalarFields(cloudEventFields, issues),
    depth: decodeDepth(cloudEventFields, issues, new DepthCodec()),
    executionunits: decodeExecutionUnits(
      cloudEventFields,
      issues,
      new ExecutionUnitsCodec(),
    ),
    ...decodeWrapper(cloudEvent, issues),
  };

  return { candidate, issues };
};
