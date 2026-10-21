import { ErrorIssue } from '../../../../utils/error-issue.js';
import type { CloudEvent, ForeignCloudEventFallback } from '../../types.js';
import type { Decoded } from './index.js';

/** `source[key]` if it is present and a string, otherwise `undefined` — no issue reported either way. */
const asString = (
  source: Record<string, unknown>,
  key: string,
): string | undefined => {
  const fieldValue = source[key];
  return typeof fieldValue === 'string' ? fieldValue : undefined;
};

/** Foreign-event adaptation: only `id`/`source`/`type` are unconditional; every other field is mapped when the foreign CloudEvent provides it, otherwise left to `fallback` — a present foreign value always wins over its fallback. */
export const decodeForeign = (
  cloudEvent: CloudEvent,
  foreignFallback?: ForeignCloudEventFallback,
): Decoded => {
  const issues: ErrorIssue[] = [];
  const cloudEventFields = cloudEvent as unknown as Record<string, unknown>;
  const candidate: Record<string, unknown> = {
    id: cloudEvent.id,
    source: cloudEvent.source,
    type: cloudEvent.type,
    subject:
      typeof cloudEvent.subject === 'string'
        ? cloudEvent.subject
        : foreignFallback?.subject,
    time:
      typeof cloudEvent.time === 'string'
        ? cloudEvent.time
        : foreignFallback?.time,
    traceparent: asString(cloudEventFields, 'traceparent'),
    tracestate: asString(cloudEventFields, 'tracestate'),
    parentid: foreignFallback?.parentid,
    initid: foreignFallback?.initid,
    executionid: foreignFallback?.executionid,
    category: foreignFallback?.category,
    depth: foreignFallback?.depth,
    to: foreignFallback?.to,
    domain: foreignFallback?.domain,
    baggage: foreignFallback?.baggage,
    executionunits: foreignFallback?.executionunits,
  };

  if (cloudEvent.data !== undefined) {
    if (
      cloudEvent.data === null ||
      typeof cloudEvent.data !== 'object' ||
      Array.isArray(cloudEvent.data)
    ) {
      issues.push(
        new ErrorIssue({
          path: 'data',
          message: 'must be an object to be adapted from a foreign CloudEvent',
          received: cloudEvent.data,
        }),
      );
    } else {
      candidate.data = cloudEvent.data;
    }
  } else {
    candidate.data = foreignFallback?.data;
  }

  candidate.dataschema = foreignFallback?.dataschema;
  if (!foreignFallback?.dataschema) {
    issues.push(
      new ErrorIssue({
        path: 'dataschema',
        message:
          'is required as a caller-supplied fallback when adapting a foreign CloudEvent',
        received: foreignFallback?.dataschema,
      }),
    );
  }

  return { candidate, issues };
};
