import { ArvoSemanticVersion } from '../semver/index.js';
import type { JSONObject } from '../types.js';
import { ErrorIssue } from '../utils/error-issue.js';
import { pathSegmentForKey } from '../utils/issue-path.js';
import { isUriReference } from '../utils/uri.js';
import { handlerErrorType } from './handler-error.js';
import { isContractIdentifier } from './identifier.js';
import type { ArvoContractParam, ArvoContractVersionParam } from './types.js';
import type { VersionedArvoContractParam } from './versioned/types.js';

const isRecord = (candidate: unknown): candidate is Record<string, unknown> =>
  typeof candidate === 'object' &&
  candidate !== null &&
  !Array.isArray(candidate);

const pushIssue = (
  issues: ErrorIssue[],
  path: string,
  message: string,
  received?: unknown,
  blockingReason?: string,
): void => {
  issues.push(new ErrorIssue({ path, message, received, blockingReason }));
};

const checkIdentifier = (
  identifier: unknown,
  path: string,
  issues: ErrorIssue[],
  blockingReason?: string,
): void => {
  if (typeof identifier !== 'string' || identifier.length === 0) {
    pushIssue(
      issues,
      path,
      'must be a non-empty string',
      identifier,
      blockingReason,
    );
    return;
  }
  if (!isContractIdentifier(identifier)) {
    pushIssue(
      issues,
      path,
      'must be lowercase alphanumeric segments joined by single underscores',
      identifier,
      blockingReason,
    );
  }
};

const checkUri = (uri: unknown, path: string, issues: ErrorIssue[]): void => {
  if (typeof uri !== 'string' || uri.length === 0) {
    pushIssue(issues, path, 'must be a non-empty string', uri);
    return;
  }
  if (!isUriReference(uri)) {
    pushIssue(
      issues,
      path,
      'must be an RFC 3986 URI-reference already in canonical form',
      uri,
    );
  }
};

const checkNullableIdentifier = (
  identifier: unknown,
  path: string,
  issues: ErrorIssue[],
): void => {
  if (identifier === null) return;
  checkIdentifier(identifier, path, issues);
};

const checkDescription = (
  description: unknown,
  path: string,
  issues: ErrorIssue[],
): void => {
  if (description === null || typeof description === 'string') return;
  pushIssue(issues, path, 'must be a string or null', description);
};

const checkMetadata = (
  metadata: unknown,
  path: string,
  issues: ErrorIssue[],
): void => {
  if (isRecord(metadata)) return;
  pushIssue(issues, path, 'must be an object', metadata);
};

/**
 * Whether `value` is a zod object schema.
 *
 * Reads zod's own schema definition rather than using `instanceof`: two
 * copies of zod in one dependency tree — easy to end up with, since it is a
 * peer dependency — make `instanceof` false for a perfectly good schema
 * authored against the other copy.
 */
const isObjectSchema = (schema: unknown): boolean =>
  (schema as { _zod?: { def?: { type?: string } } })?._zod?.def?.type ===
  'object';

const checkObjectSchema = (
  schema: unknown,
  path: string,
  issues: ErrorIssue[],
): void => {
  if (isObjectSchema(schema)) return;
  pushIssue(issues, path, 'must be a zod object schema', schema);
};

const checkVersionKey = (
  versionKey: string,
  path: string,
  issues: ErrorIssue[],
): void => {
  const attempt = ArvoSemanticVersion.tryCheck(versionKey);
  if (attempt.ok) return;
  for (const issue of attempt.error.issues) {
    pushIssue(issues, path, issue.message, issue.received);
  }
};

/**
 * The rules a single version must satisfy, wherever it came from.
 *
 * Shared by both classes so that a contract accepting a declaration and a
 * version contract accepting the same values can never disagree.
 */
const checkVersionInterface = (
  versionInterface: { type: string; input: unknown; outputs: unknown },
  pathPrefix: string,
  issues: ErrorIssue[],
): void => {
  checkObjectSchema(versionInterface.input, `${pathPrefix}input`, issues);

  const { outputs } = versionInterface;
  if (!isRecord(outputs)) {
    pushIssue(issues, `${pathPrefix}outputs`, 'must be an object', outputs);
    return;
  }

  const errorType = handlerErrorType(versionInterface.type);
  for (const [outputType, schema] of Object.entries(outputs)) {
    const path = `${pathPrefix}outputs${pathSegmentForKey(outputType)}`;
    checkIdentifier(outputType, path, issues);
    checkObjectSchema(schema, path, issues);
    if (outputType === versionInterface.type) {
      pushIssue(
        issues,
        path,
        "must not reuse the contract type, which already names this contract's input",
      );
    }
    if (outputType === errorType) {
      pushIssue(
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
  'the uri, the handler error type, and the rule against an outputs key reusing the contract type are all derived from it';

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
 * the handler error type, and the rule against an `outputs` key reusing the
 * contract type are all computed from it, so with `type` broken those rules
 * would judge values the declaration never established. Reporting them would
 * mean quoting values the caller never supplied.
 */
export const validateArvoContract = (
  param: ArvoContractParam,
): ArvoContractValidation => {
  const blockingIssues: ErrorIssue[] = [];
  checkIdentifier(param.type, 'type', blockingIssues, TYPE_IS_LOAD_BEARING);
  if (blockingIssues.length > 0)
    return { blocked: true, issues: blockingIssues };

  const issues: ErrorIssue[] = [];
  const contract = normalize(param);

  checkUri(contract.uri, 'uri', issues);
  checkDescription(contract.description, 'description', issues);
  checkNullableIdentifier(contract.domain, 'domain', issues);
  checkMetadata(contract.metadata, 'metadata', issues);

  if (!isRecord(param.versions)) {
    pushIssue(issues, 'versions', 'must be an object', param.versions);
    return { blocked: false, value: contract, issues };
  }

  const versionKeys = Object.keys(contract.versions);
  if (versionKeys.length === 0) {
    pushIssue(issues, 'versions', 'must declare at least one version');
    return { blocked: false, value: contract, issues };
  }

  for (const version of versionKeys) {
    const path = `versions${pathSegmentForKey(version)}`;
    checkVersionKey(version, path, issues);

    const definition = contract.versions[version];
    if (!isRecord(definition)) {
      pushIssue(issues, path, 'must be an object', definition);
      continue;
    }

    checkVersionInterface(
      {
        type: contract.type,
        input: definition.input,
        outputs: definition.outputs,
      },
      `${path}.`,
      issues,
    );
  }

  return { blocked: false, value: contract, issues };
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
  const blockingIssues: ErrorIssue[] = [];
  checkIdentifier(param.type, 'type', blockingIssues, TYPE_IS_LOAD_BEARING);
  if (blockingIssues.length > 0) return { issues: blockingIssues };

  const issues: ErrorIssue[] = [];

  checkUri(param.uri, 'uri', issues);
  checkDescription(param.description, 'description', issues);
  checkNullableIdentifier(param.domain, 'domain', issues);
  checkMetadata(param.metadata, 'metadata', issues);
  checkVersionKey(param.version as string, 'version', issues);

  checkVersionInterface(
    {
      type: param.type,
      input: param.input,
      outputs: param.outputs,
    },
    '',
    issues,
  );

  return { issues };
};
