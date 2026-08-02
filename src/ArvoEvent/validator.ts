import { z } from 'zod';
import type { FlatMap, JSONObject } from '../types.js';
import { createTimestamp } from '../utils.js';
import type { ArvoEventValidationIssue } from './errors.js';
import { walkFlatMap, walkPayload } from './json.js';
import type { ArvoEventFields } from './types.js';

const KNOWN_FIELDS = [
  'id',
  'parentid',
  'initid',
  'subject',
  'executionid',
  'category',
  'depth',
  'source',
  'to',
  'domain',
  'type',
  'data',
  'dataschema',
  'baggage',
  'time',
  'traceparent',
  'tracestate',
  'executionunits',
] as const satisfies readonly (keyof ArvoEventFields)[];

/**
 * Fills in every field's default. The five fields with no sensible default —
 * `subject`, `source`, `type`, `data`, `dataschema` — are left as whatever
 * the caller supplied, including `undefined`; the checks below report those
 * as missing rather than silently defaulting them to something arbitrary.
 */
const applyDefaults = (
  input: Record<string, unknown>,
): Record<string, unknown> => ({
  id: input.id ?? crypto.randomUUID(),
  parentid: input.parentid ?? null,
  initid: input.initid ?? null,
  subject: input.subject,
  executionid: input.executionid ?? input.subject,
  category: input.category ?? null,
  depth: input.depth ?? 0,
  source: input.source,
  to: input.to ?? null,
  domain: input.domain ?? null,
  type: input.type,
  data: input.data,
  dataschema: input.dataschema,
  baggage: input.baggage ?? {},
  time: input.time ?? createTimestamp(),
  traceparent: input.traceparent ?? null,
  tracestate: input.tracestate ?? null,
  executionunits: input.executionunits ?? null,
});

const requireNonEmptyString = (
  value: unknown,
  path: string,
  issues: ArvoEventValidationIssue[],
): void => {
  if (value === undefined) {
    issues.push({ path, message: 'is required' });
    return;
  }
  if (typeof value !== 'string' || value.length === 0) {
    issues.push({
      path,
      message: 'must be a non-empty string',
      received: value,
    });
  }
};

const checkNullableNonEmptyString = (
  value: unknown,
  path: string,
  issues: ArvoEventValidationIssue[],
): void => {
  if (value === null) return;
  if (typeof value !== 'string' || value.length === 0) {
    issues.push({
      path,
      message: 'must be null or a non-empty string',
      received: value,
    });
  }
};

const checkDepth = (
  value: unknown,
  issues: ArvoEventValidationIssue[],
): void => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    issues.push({
      path: 'depth',
      message: 'must be a non-negative integer',
      received: value,
    });
  }
};

const isoDateTimeWithOffset = z.iso.datetime({ offset: true });

const checkTime = (
  value: unknown,
  issues: ArvoEventValidationIssue[],
): void => {
  if (
    typeof value !== 'string' ||
    !isoDateTimeWithOffset.safeParse(value).success
  ) {
    issues.push({
      path: 'time',
      message: 'must be an RFC 3339 timestamp carrying a UTC offset',
      received: value,
    });
  }
};

const checkExecutionUnits = (
  value: unknown,
  issues: ArvoEventValidationIssue[],
): void => {
  if (value === null) return;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    issues.push({
      path: 'executionunits',
      message: 'must be null or a finite number',
      received: value,
    });
  }
};

/**
 * When `parentid` is null, `executionid` must equal `subject` and `depth`
 * must be `0` — but neither of those, alone or together, implies rootness.
 * Only `parentid` being null triggers this requirement.
 */
const checkRootConstraint = (
  candidate: Record<string, unknown>,
  issues: ArvoEventValidationIssue[],
): void => {
  if (candidate.parentid !== null) return;

  if (candidate.executionid !== candidate.subject) {
    issues.push({
      path: 'parentid + executionid',
      message:
        'a root event (parentid null) must carry executionid equal to subject, since the root execution is the workflow itself',
      received: {
        executionid: candidate.executionid,
        subject: candidate.subject,
      },
    });
  }

  if (candidate.depth !== 0) {
    issues.push({
      path: 'parentid + depth',
      message:
        'a root event (parentid null) must carry depth 0, the nesting level of the root execution',
      received: candidate.depth,
    });
  }
};

/**
 * `initid` is required exactly on a completion. It may appear elsewhere too —
 * this only ever forbids the one combination: a declared completion with
 * nothing to correlate.
 */
const checkCorrelationConstraint = (
  candidate: Record<string, unknown>,
  issues: ArvoEventValidationIssue[],
): void => {
  if (candidate.category === 'io.arvo.complete' && candidate.initid === null) {
    issues.push({
      path: 'category + initid',
      message:
        'an event whose category is io.arvo.complete must carry initid, naming the request it answers',
    });
  }
};

export type ArvoEventValidationOptions = {
  /**
   * Skips the recursive walk of `data` and `baggage` — and the freeze that
   * rides with it — for input already known to be well formed. Field and
   * cross-field rules still run regardless. A trusted event whose payload
   * turns out to hold something the walk would have rejected, such as a
   * non-finite number, is structurally invalid and will fail later, at
   * serialization, rather than here.
   */
  skipPayloadValidation?: boolean;
};

/**
 * Validates raw input against every ArvoEvent structural rule and returns a
 * fully defaulted, normalized result — the shared core behind both
 * construction and admitting an event that arrives as plain data.
 *
 * Order: unrecognised keys, then field rules, then cross-field rules, then
 * the payload walk. Field-level failures aggregate rather than stopping at
 * the first one.
 */
export const validateArvoEvent = (
  input: unknown,
  options: ArvoEventValidationOptions = {},
): { value: ArvoEventFields; issues: ArvoEventValidationIssue[] } => {
  const issues: ArvoEventValidationIssue[] = [];

  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    issues.push({
      path: 'event',
      message: 'must be an object',
      received: input,
    });
    return {
      value: applyDefaults({}) as unknown as ArvoEventFields,
      issues,
    };
  }

  const raw = input as Record<string, unknown>;

  for (const key of Object.keys(raw)) {
    if (!(KNOWN_FIELDS as readonly string[]).includes(key)) {
      issues.push({ path: key, message: 'is not a field of ArvoEvent' });
    }
  }

  const candidate = applyDefaults(raw);

  requireNonEmptyString(candidate.id, 'id', issues);
  checkNullableNonEmptyString(candidate.parentid, 'parentid', issues);
  checkNullableNonEmptyString(candidate.initid, 'initid', issues);
  requireNonEmptyString(candidate.subject, 'subject', issues);
  requireNonEmptyString(candidate.executionid, 'executionid', issues);
  checkNullableNonEmptyString(candidate.category, 'category', issues);
  checkDepth(candidate.depth, issues);
  requireNonEmptyString(candidate.source, 'source', issues);
  checkNullableNonEmptyString(candidate.to, 'to', issues);
  checkNullableNonEmptyString(candidate.domain, 'domain', issues);
  requireNonEmptyString(candidate.type, 'type', issues);
  requireNonEmptyString(candidate.dataschema, 'dataschema', issues);
  checkTime(candidate.time, issues);
  checkExecutionUnits(candidate.executionunits, issues);
  // traceparent and tracestate are deliberately unvalidated — no check here.

  checkRootConstraint(candidate, issues);
  checkCorrelationConstraint(candidate, issues);

  const payload = options.skipPayloadValidation
    ? {
        value: candidate.data as JSONObject,
        issues: [] as ArvoEventValidationIssue[],
      }
    : walkPayload(candidate.data, 'data');
  issues.push(...payload.issues);

  const baggage = options.skipPayloadValidation
    ? {
        value: candidate.baggage as FlatMap,
        issues: [] as ArvoEventValidationIssue[],
      }
    : walkFlatMap(candidate.baggage, 'baggage');
  issues.push(...baggage.issues);

  const value = {
    ...candidate,
    data: payload.value,
    baggage: baggage.value,
  } as ArvoEventFields;

  return { value, issues };
};
