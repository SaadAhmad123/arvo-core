import { ArvoSemanticVersion } from '../semver/index.js';
import type { JSONObject } from '../types.js';
import { ErrorIssue } from '../utils/error-issue.js';
import { isUriReference } from '../utils/uri.js';
import { handlerErrorType } from './handler-error.js';
import type { ArvoContractParam, ArvoContractVersionParam } from './types.js';
import type { VersionedArvoContractParam } from './versioned/types.js';

/** Lowercase alphanumeric segments joined by single underscores. */
const IDENTIFIER_GRAMMAR = /^[a-z0-9]+(_[a-z0-9]+)*$/;

/**
 * A map key rendered for an issue path.
 *
 * Bracketed and quoted because version keys contain dots and a rejected
 * emit key may too: `versions["1.0.0"]` cannot be misread the way
 * `versions.1.0.0` can.
 */
const at = (key: string): string => `[${JSON.stringify(key)}]`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const push = (
  issues: ErrorIssue[],
  path: string,
  message: string,
  received?: unknown,
  blockingReason?: string,
): void => {
  issues.push(new ErrorIssue({ path, message, received, blockingReason }));
};

const checkIdentifier = (
  value: unknown,
  path: string,
  issues: ErrorIssue[],
  blockingReason?: string,
): void => {
  if (typeof value !== 'string' || value.length === 0) {
    push(issues, path, 'must be a non-empty string', value, blockingReason);
    return;
  }
  if (!IDENTIFIER_GRAMMAR.test(value)) {
    push(
      issues,
      path,
      'must be lowercase alphanumeric segments joined by single underscores',
      value,
      blockingReason,
    );
  }
};

const checkUri = (value: unknown, path: string, issues: ErrorIssue[]): void => {
  if (typeof value !== 'string' || value.length === 0) {
    push(issues, path, 'must be a non-empty string', value);
    return;
  }
  if (!isUriReference(value)) {
    push(
      issues,
      path,
      'must be an RFC 3986 URI-reference already in canonical form',
      value,
    );
  }
};

const checkNullableIdentifier = (
  value: unknown,
  path: string,
  issues: ErrorIssue[],
): void => {
  if (value === null) return;
  checkIdentifier(value, path, issues);
};

const checkDescription = (
  value: unknown,
  path: string,
  issues: ErrorIssue[],
): void => {
  if (value === null || typeof value === 'string') return;
  push(issues, path, 'must be a string or null', value);
};

const checkMetadata = (
  value: unknown,
  path: string,
  issues: ErrorIssue[],
): void => {
  if (isRecord(value)) return;
  push(issues, path, 'must be an object', value);
};

/**
 * Whether `value` is a zod object schema.
 *
 * Reads zod's own schema definition rather than using `instanceof`: two
 * copies of zod in one dependency tree — easy to end up with, since it is a
 * peer dependency — make `instanceof` false for a perfectly good schema
 * authored against the other copy.
 */
const isObjectSchema = (value: unknown): boolean =>
  (value as { _zod?: { def?: { type?: string } } })?._zod?.def?.type ===
  'object';

const checkObjectSchema = (
  value: unknown,
  path: string,
  issues: ErrorIssue[],
): void => {
  if (isObjectSchema(value)) return;
  push(issues, path, 'must be a zod object schema', value);
};

const checkVersionKey = (
  key: string,
  path: string,
  issues: ErrorIssue[],
): void => {
  const result = ArvoSemanticVersion.tryCheck(key);
  if (result.ok) return;
  for (const issue of result.error.issues) {
    push(issues, path, issue.message, issue.received);
  }
};

/**
 * The rules a single version must satisfy, wherever it came from.
 *
 * Shared by both classes so that a contract accepting a declaration and a
 * version contract accepting the same values can never disagree.
 */
const checkVersionInterface = (
  params: { type: string; accepts: unknown; emits: unknown },
  prefix: string,
  issues: ErrorIssue[],
): void => {
  checkObjectSchema(params.accepts, `${prefix}accepts`, issues);

  const { emits } = params;
  if (!isRecord(emits)) {
    push(issues, `${prefix}emits`, 'must be an object', emits);
    return;
  }

  const errorType = handlerErrorType(params.type);
  for (const [key, schema] of Object.entries(emits)) {
    const path = `${prefix}emits${at(key)}`;
    checkIdentifier(key, path, issues);
    checkObjectSchema(schema, path, issues);
    if (key === params.type) {
      push(
        issues,
        path,
        'must not reuse the contract type, which already names what this contract accepts',
      );
    }
    if (key === errorType) {
      push(
        issues,
        path,
        'must not reuse the handler error type, which every version already carries',
      );
    }
  }
};

/** A contract with defaults applied and `uri` derived. */
export type NormalizedContract = {
  type: string;
  uri: string;
  description: string | null;
  domain: string | null;
  metadata: JSONObject;
  versions: Record<string, ArvoContractVersionParam>;
};

/**
 * `type` with every `_` replaced by `/`, prefixed with `#/`.
 *
 * Every occurrence, not the first. ADR-005 states the rule that way because a
 * language whose `replace` stops at the first match would derive a different
 * `uri` from the same `type`; `replaceAll` carries no such ambiguity.
 */
const deriveUri = (type: string): string => `#/${type.replaceAll('_', '/')}`;

/**
 * Applies defaults and derives `uri`, so that every check below sees the
 * values that will actually be stored rather than what the caller supplied.
 *
 * Only ever called with a `type` already known to be a valid identifier, so
 * derivation cannot fail and needs no fallback.
 */
const normalize = (param: ArvoContractParam): NormalizedContract => ({
  type: param.type,
  uri: param.uri ?? deriveUri(param.type),
  description: param.description ?? null,
  domain: param.domain ?? null,
  metadata: param.metadata ?? {},
  versions: param.versions ?? {},
});

/**
 * Why validation stops when `type` is invalid.
 *
 * Stated once and shared by both entry points, so a caller sees the same
 * explanation whichever one rejected their declaration.
 */
const TYPE_IS_LOAD_BEARING =
  'the uri, the handler error type, and the rule against an emits key reusing the contract type are all derived from it';

/**
 * The outcome of validating a contract declaration.
 *
 * A normalized contract exists only when `type` was valid: `uri` is derived
 * from it, so there is nothing to normalize until it holds.
 */
export type ArvoContractValidation =
  | { blocked: true; issues: ErrorIssue[] }
  | { blocked: false; value: NormalizedContract; issues: ErrorIssue[] };

/**
 * Normalizes a contract declaration and collects everything wrong with it.
 *
 * Never throws, and never stops at the first problem: the returned `issues`
 * holds every broken rule, so one attempt reports all of them.
 *
 * The exception is `type`, which is checked first and on its own. The `uri`,
 * the handler error type, and the rule against an `emits` key reusing the
 * contract type are all computed from it, so with `type` broken those rules
 * would judge values the declaration never established. Reporting them would
 * mean quoting values the caller never supplied.
 */
export const validateArvoContract = (
  param: ArvoContractParam,
): ArvoContractValidation => {
  const blocking: ErrorIssue[] = [];
  checkIdentifier(param.type, 'type', blocking, TYPE_IS_LOAD_BEARING);
  if (blocking.length > 0) return { blocked: true, issues: blocking };

  const issues: ErrorIssue[] = [];
  const value = normalize(param);

  checkUri(value.uri, 'uri', issues);
  checkDescription(value.description, 'description', issues);
  checkNullableIdentifier(value.domain, 'domain', issues);
  checkMetadata(value.metadata, 'metadata', issues);

  if (!isRecord(param.versions)) {
    push(issues, 'versions', 'must be an object', param.versions);
    return { blocked: false, value, issues };
  }

  const keys = Object.keys(value.versions);
  if (keys.length === 0) {
    push(issues, 'versions', 'must declare at least one version');
    return { blocked: false, value, issues };
  }

  for (const key of keys) {
    const path = `versions${at(key)}`;
    checkVersionKey(key, path, issues);

    const definition = value.versions[key];
    if (!isRecord(definition)) {
      push(issues, path, 'must be an object', definition);
      continue;
    }

    checkVersionInterface(
      {
        type: value.type,
        accepts: definition.accepts,
        emits: definition.emits,
      },
      `${path}.`,
      issues,
    );
  }

  return { blocked: false, value, issues };
};

/**
 * Collects everything wrong with a directly-constructed version contract.
 *
 * Applies the same rules a contract applies to the version it materializes,
 * so a version obtained either way is the same thing. A contract that
 * declares successfully can never produce a version that fails here.
 */
export const validateVersionedArvoContract = (
  param: VersionedArvoContractParam,
): { issues: ErrorIssue[] } => {
  const blocking: ErrorIssue[] = [];
  checkIdentifier(param.type, 'type', blocking, TYPE_IS_LOAD_BEARING);
  if (blocking.length > 0) return { issues: blocking };

  const issues: ErrorIssue[] = [];

  checkUri(param.uri, 'uri', issues);
  checkDescription(param.description, 'description', issues);
  checkNullableIdentifier(param.domain, 'domain', issues);
  checkMetadata(param.metadata, 'metadata', issues);
  checkVersionKey(param.version as string, 'version', issues);

  checkVersionInterface(
    {
      type: param.type,
      accepts: param.accepts,
      emits: param.emits,
    },
    '',
    issues,
  );

  return { issues };
};
