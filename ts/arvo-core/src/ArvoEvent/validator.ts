import { z } from 'zod';
import type { FlatMap, JSONObject } from '../types.js';
import { ErrorIssue } from '../utils/error-issue.js';
import { createTimestamp } from '../utils/index.js';
import { isUriReference } from '../utils/uri.js';
import { walkFlatMap, walkPayload } from './json.js';
import type { ArvoEventFields, ArvoEventValidationOptions } from './types.js';

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
  executionunits: normalizeExecutionUnits(input.executionunits ?? null),
});

const requireNonEmptyString = (
  value: unknown,
  path: string,
  issues: ErrorIssue[],
): void => {
  if (value === undefined) {
    issues.push(new ErrorIssue({ path, message: 'is required' }));
    return;
  }
  if (typeof value !== 'string' || value.length === 0) {
    issues.push(
      new ErrorIssue({
        path,
        message: 'must be a non-empty string',
        received: value,
      }),
    );
  }
};

const checkNullableNonEmptyString = (
  value: unknown,
  path: string,
  issues: ErrorIssue[],
): void => {
  if (value === null) return;
  if (typeof value !== 'string' || value.length === 0) {
    issues.push(
      new ErrorIssue({
        path,
        message: 'must be null or a non-empty string',
        received: value,
      }),
    );
  }
};

const checkDepth = (value: unknown, issues: ErrorIssue[]): void => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    issues.push(
      new ErrorIssue({
        path: 'depth',
        message: 'must be a non-negative integer',
        received: value,
      }),
    );
  }
};

const isoDateTimeWithOffset = z.iso.datetime({ offset: true });

const checkTime = (value: unknown, issues: ErrorIssue[]): void => {
  if (
    typeof value !== 'string' ||
    !isoDateTimeWithOffset.safeParse(value).success
  ) {
    issues.push(
      new ErrorIssue({
        path: 'time',
        message: 'must be an RFC 3339 timestamp carrying a UTC offset',
        received: value,
      }),
    );
  }
};

/**
 * Every finite JavaScript `number` is already IEEE 754 binary64, so this
 * check is identical to plain finiteness in this runtime — the domain is
 * stated explicitly for conformance across a future non-JS implementation,
 * not because anything finite here could fail it.
 */
const checkExecutionUnits = (value: unknown, issues: ErrorIssue[]): void => {
  if (value === null) return;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    issues.push(
      new ErrorIssue({
        path: 'executionunits',
        message: 'must be null or a finite IEEE 754 binary64 number',
        received: value,
      }),
    );
  }
};

/** `-0` and `0` are never distinguished by ArvoEvent; normalize at the door. */
const normalizeExecutionUnits = (value: unknown): unknown =>
  typeof value === 'number' && Object.is(value, -0) ? 0 : value;

/** Every top-level string field subject to the character-domain restriction — see {@link findForbiddenCodePoint}. */
const CHARACTER_DOMAIN_FIELDS = [
  'id',
  'parentid',
  'initid',
  'subject',
  'executionid',
  'category',
  'source',
  'to',
  'domain',
  'type',
  'dataschema',
  'traceparent',
  'tracestate',
] as const satisfies readonly (keyof ArvoEventFields)[];

/**
 * C0/C1 controls, `DEL`, and Unicode noncharacters are exactly the standard
 * Unicode categories `\p{Cc}` and `\p{Noncharacter_Code_Point}` — native
 * `RegExp` Unicode property escapes, tied to the engine's own Unicode
 * Character Database rather than a hand-maintained range table.
 *
 * Unpaired surrogates need no property escape of their own: under the `u`
 * flag the engine already matches by code point, combining a valid
 * high/low pair into the one supplementary-plane token it represents. A
 * bare `[\uD800-\uDFFF]` class therefore only ever matches a surrogate that
 * arrived without its other half — a valid pair is never tokenized down to
 * one of its individual code units for this class to see.
 */
const FORBIDDEN_CODE_POINT =
  /[\p{Cc}\p{Noncharacter_Code_Point}\uD800-\uDFFF]/u;

const findForbiddenCodePoint = (
  value: string,
): { codePoint: number } | null => {
  const match = FORBIDDEN_CODE_POINT.exec(value);
  return match ? { codePoint: match[0].codePointAt(0) as number } : null;
};

const checkCharacterDomain = (
  value: unknown,
  path: string,
  issues: ErrorIssue[],
): void => {
  if (typeof value !== 'string' || value.length === 0) return;
  const violation = findForbiddenCodePoint(value);
  if (violation) {
    const codePointHex = violation.codePoint
      .toString(16)
      .toUpperCase()
      .padStart(4, '0');
    issues.push(
      new ErrorIssue({
        path,
        message: `must not contain U+${codePointHex} — control characters, Unicode noncharacters, and unpaired surrogates are forbidden`,
        received: value,
      }),
    );
  }
};

const checkUriReference = (
  value: unknown,
  path: string,
  issues: ErrorIssue[],
): void => {
  if (typeof value !== 'string' || value.length === 0) return;
  if (!isUriReference(value)) {
    issues.push(
      new ErrorIssue({
        path,
        message: 'must be a valid RFC 3986 URI-reference',
        received: value,
      }),
    );
  }
};

/**
 * When `parentid` is null, `executionid` must equal `subject` and `depth`
 * must be `0` — but neither of those, alone or together, implies rootness.
 * Only `parentid` being null triggers this requirement.
 */
const checkRootConstraint = (
  candidate: Record<string, unknown>,
  issues: ErrorIssue[],
): void => {
  if (candidate.parentid !== null) return;

  if (candidate.executionid !== candidate.subject) {
    issues.push(
      new ErrorIssue({
        path: 'parentid + executionid',
        message:
          'a root event (parentid null) must carry executionid equal to subject, since the root execution is the workflow itself',
        received: {
          executionid: candidate.executionid,
          subject: candidate.subject,
        },
      }),
    );
  }

  if (candidate.depth !== 0) {
    issues.push(
      new ErrorIssue({
        path: 'parentid + depth',
        message:
          'a root event (parentid null) must carry depth 0, the nesting level of the root execution',
        received: candidate.depth,
      }),
    );
  }
};

/**
 * `initid` is required exactly on a completion. It may appear elsewhere too —
 * this only ever forbids the one combination: a declared completion with
 * nothing to correlate.
 */
const checkCorrelationConstraint = (
  candidate: Record<string, unknown>,
  issues: ErrorIssue[],
): void => {
  if (candidate.category === 'io.arvo.complete' && candidate.initid === null) {
    issues.push(
      new ErrorIssue({
        path: 'category + initid',
        message:
          'an event whose category is io.arvo.complete must carry initid, naming the request it answers',
      }),
    );
  }
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
): { value: ArvoEventFields; issues: ErrorIssue[] } => {
  const issues: ErrorIssue[] = [];

  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    issues.push(
      new ErrorIssue({
        path: 'event',
        message: 'must be an object',
        received: input,
      }),
    );
    return {
      value: applyDefaults({}) as unknown as ArvoEventFields,
      issues,
    };
  }

  const raw = input as Record<string, unknown>;

  for (const key of Object.keys(raw)) {
    if (!(KNOWN_FIELDS as readonly string[]).includes(key)) {
      issues.push(
        new ErrorIssue({ path: key, message: 'is not a field of ArvoEvent' }),
      );
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
  checkUriReference(candidate.source, 'source', issues);
  checkUriReference(candidate.dataschema, 'dataschema', issues);
  // traceparent and tracestate remain unvalidated for format and content —
  // only the character-domain check below, shared with every other
  // top-level string field, applies to them.
  for (const field of CHARACTER_DOMAIN_FIELDS) {
    checkCharacterDomain(candidate[field], field, issues);
  }

  checkRootConstraint(candidate, issues);
  checkCorrelationConstraint(candidate, issues);

  const payload = options.skipPayloadValidation
    ? {
        value: candidate.data as JSONObject,
        issues: [] as ErrorIssue[],
      }
    : walkPayload(candidate.data, 'data');
  issues.push(...payload.issues);

  const baggage = options.skipPayloadValidation
    ? {
        value: candidate.baggage as FlatMap,
        issues: [] as ErrorIssue[],
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
