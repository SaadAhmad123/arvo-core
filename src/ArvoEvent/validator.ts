import { z } from 'zod';
import type { FlatMap, JSONObject } from '../types.js';
import { createTimestamp } from '../utils.js';
import type { ArvoEventValidationIssue } from './errors.js';
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

/**
 * Every finite JavaScript `number` is already IEEE 754 binary64, so this
 * check is identical to plain finiteness in this runtime — the domain is
 * stated explicitly for conformance across a future non-JS implementation,
 * not because anything finite here could fail it.
 */
const checkExecutionUnits = (
  value: unknown,
  issues: ArvoEventValidationIssue[],
): void => {
  if (value === null) return;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    issues.push({
      path: 'executionunits',
      message: 'must be null or a finite IEEE 754 binary64 number',
      received: value,
    });
  }
};

/** `-0` and `0` are never distinguished by ArvoEvent; normalize at the door. */
const normalizeExecutionUnits = (value: unknown): unknown =>
  typeof value === 'number' && Object.is(value, -0) ? 0 : value;

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
 * Finds the first code point in `value` that ArvoEvent's top-level string
 * fields forbid: a C0 or C1 control character, `DEL`, a Unicode
 * noncharacter, or an unpaired UTF-16 surrogate.
 *
 * Iterates by code point (`for...of`), not by UTF-16 code unit. JavaScript's
 * string iterator combines a valid surrogate pair into the one supplementary
 * code point it represents, and — critically — does not repair or replace a
 * lone surrogate; it yields it as itself. So a single pass already
 * distinguishes a valid pair from an unpaired half without any separate
 * pairing logic.
 */
const findForbiddenCodePoint = (
  value: string,
): { codePoint: number } | null => {
  for (const char of value) {
    const codePoint = char.codePointAt(0) as number;
    const isC0Control = codePoint <= 0x1f;
    const isDelOrC1Control = codePoint >= 0x7f && codePoint <= 0x9f;
    // U+FDD0–U+FDEF, plus the last two code points of every plane
    // (U+xFFFE/U+xFFFF) — the low 16 bits being 0xFFFE or 0xFFFF is exactly
    // that second set, regardless of which plane's high bits sit above them.
    const isNoncharacter =
      (codePoint >= 0xfdd0 && codePoint <= 0xfdef) ||
      (codePoint & 0xfffe) === 0xfffe;
    // A valid pair already combined into a supplementary code point above;
    // anything still in this range arrived unpaired.
    const isUnpairedSurrogate = codePoint >= 0xd800 && codePoint <= 0xdfff;
    if (
      isC0Control ||
      isDelOrC1Control ||
      isNoncharacter ||
      isUnpairedSurrogate
    ) {
      return { codePoint };
    }
  }
  return null;
};

const checkCharacterDomain = (
  value: unknown,
  path: string,
  issues: ArvoEventValidationIssue[],
): void => {
  if (typeof value !== 'string' || value.length === 0) return;
  const violation = findForbiddenCodePoint(value);
  if (violation) {
    const codePointHex = violation.codePoint
      .toString(16)
      .toUpperCase()
      .padStart(4, '0');
    issues.push({
      path,
      message: `must not contain U+${codePointHex} — control characters, Unicode noncharacters, and unpaired surrogates are forbidden`,
      received: value,
    });
  }
};

// RFC 3986 URI-reference, built from the grammar's own productions rather
// than a WHATWG URL check: the platform URL parser requires a base to
// resolve a relative reference at all, and percent-encodes characters this
// rule must reject instead of silently rewriting. IP-literal authorities
// (bracketed IPv6 hosts) are not modeled — reg-name's character set already
// covers every realistic Arvo source/dataschema identifier.
const UNRESERVED = 'A-Za-z0-9\\-._~';
const SUB_DELIMS = "!$&'()*+,;=";
const PCT_ENCODED = '%[0-9A-Fa-f]{2}';
const PCHAR = `(?:[${UNRESERVED}${SUB_DELIMS}:@]|${PCT_ENCODED})`;
const USERINFO = `(?:[${UNRESERVED}${SUB_DELIMS}:]|${PCT_ENCODED})*`;
const REG_NAME = `(?:[${UNRESERVED}${SUB_DELIMS}]|${PCT_ENCODED})*`;
const AUTHORITY = `(?:${USERINFO}@)?${REG_NAME}(?::[0-9]*)?`;
const SEGMENT = `${PCHAR}*`;
const SEGMENT_NZ = `${PCHAR}+`;
const SEGMENT_NZ_NC = `(?:[${UNRESERVED}${SUB_DELIMS}@]|${PCT_ENCODED})+`;
const PATH_ABEMPTY = `(?:/${SEGMENT})*`;
const PATH_ABSOLUTE = `/(?:${SEGMENT_NZ}(?:/${SEGMENT})*)?`;
const PATH_NOSCHEME = `${SEGMENT_NZ_NC}(?:/${SEGMENT})*`;
const PATH_ROOTLESS = `${SEGMENT_NZ}(?:/${SEGMENT})*`;
const QUERY_OR_FRAGMENT = `(?:${PCHAR}|[/?])*`;
const SCHEME = '[A-Za-z][A-Za-z0-9+\\-.]*';
const HIER_PART = `(?://${AUTHORITY}${PATH_ABEMPTY}|${PATH_ABSOLUTE}|${PATH_ROOTLESS}|)`;
const RELATIVE_PART = `(?://${AUTHORITY}${PATH_ABEMPTY}|${PATH_ABSOLUTE}|${PATH_NOSCHEME}|)`;
const URI = `${SCHEME}:${HIER_PART}(?:\\?${QUERY_OR_FRAGMENT})?(?:#${QUERY_OR_FRAGMENT})?`;
const RELATIVE_REF = `${RELATIVE_PART}(?:\\?${QUERY_OR_FRAGMENT})?(?:#${QUERY_OR_FRAGMENT})?`;
const URI_REFERENCE = new RegExp(`^(?:${URI}|${RELATIVE_REF})$`);

const checkUriReference = (
  value: unknown,
  path: string,
  issues: ArvoEventValidationIssue[],
): void => {
  if (typeof value !== 'string' || value.length === 0) return;
  if (!URI_REFERENCE.test(value)) {
    issues.push({
      path,
      message: 'must be a valid RFC 3986 URI-reference',
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
