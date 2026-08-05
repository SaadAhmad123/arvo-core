import type { ArvoEventValidationIssue } from '../../../ArvoEvent/errors.js';
import type { CloudEvent, ForeignCloudEventFallback } from '../../types.js';
import type { Decoded } from './index.js';

/** `source[key]` if it is present and a string, otherwise `undefined` — no issue reported either way. */
const asString = (
  source: Record<string, unknown>,
  key: string,
): string | undefined => {
  const value = source[key];
  return typeof value === 'string' ? value : undefined;
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
