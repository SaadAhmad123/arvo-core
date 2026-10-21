import { ErrorIssue } from '../../utils/error-issue.js';

/** The dialect every schema-bearing position must declare. */
const DIALECT = 'https://json-schema.org/draft/2020-12/schema';

const isRecord = (candidate: unknown): candidate is Record<string, unknown> =>
  typeof candidate === 'object' &&
  candidate !== null &&
  !Array.isArray(candidate);

/** A map key rendered for an issue path, matching what serialization writes. */
const pathSegmentForKey = (key: string): string => `[${JSON.stringify(key)}]`;

const pushIssue = (
  issues: ErrorIssue[],
  path: string,
  message: string,
  received?: unknown,
): void => {
  issues.push(new ErrorIssue({ path, message, received }));
};

/**
 * Checks one schema-bearing position.
 *
 * The literal `"type": "object"` is checked here and nowhere later because a
 * conversion erases the distinction: a schema composed with `allOf` can
 * permit only objects while never carrying the keyword, and once it has been
 * converted there is no way to tell which it was. A payload is always an
 * object of JSON values, so a position permitting anything else describes a
 * shape no event can take.
 */
const checkSchemaPosition = (
  schema: unknown,
  path: string,
  issues: ErrorIssue[],
): void => {
  if (!isRecord(schema)) {
    pushIssue(issues, path, 'must be a JSON Schema object', schema);
    return;
  }
  if (schema.type !== 'object') {
    pushIssue(
      issues,
      path,
      'must carry the literal keyword "type": "object" at its top level',
      schema.type,
    );
  }
  if (schema.$schema !== DIALECT) {
    pushIssue(
      issues,
      path,
      `must declare "$schema" as ${DIALECT}`,
      schema.$schema,
    );
  }
};

/** Checks one version definition and every schema position inside it. */
const checkVersion = (
  definition: unknown,
  path: string,
  issues: ErrorIssue[],
): void => {
  if (!isRecord(definition)) {
    pushIssue(issues, path, 'must be an object', definition);
    return;
  }

  checkSchemaPosition(definition.input, `${path}.input`, issues);

  const { outputs } = definition;
  if (!isRecord(outputs)) {
    pushIssue(issues, `${path}.outputs`, 'must be an object', outputs);
    return;
  }
  for (const [outputType, schema] of Object.entries(outputs)) {
    checkSchemaPosition(
      schema,
      `${path}.outputs${pathSegmentForKey(outputType)}`,
      issues,
    );
  }
};

/**
 * Collects everything wrong with a parsed canonical form, before any of its
 * schemas is converted.
 *
 * Only what a conversion would destroy or a contract cannot check for itself.
 * Identifier grammar, version-key grammar and emit-key collisions all belong
 * to the contract's own rules and are left to it, so they are reported once
 * rather than twice in different words.
 *
 * Deliberately lenient about an absent optional field. A form is required to
 * carry `description`, `domain` and `metadata` even at their defaults, but
 * that binds whoever *writes* one; refusing to read a form that omitted them
 * would reject a contract whose identity is intact over a field carrying no
 * information.
 */
export const validateCanonicalForm = (form: unknown): ErrorIssue[] => {
  const issues: ErrorIssue[] = [];

  if (!isRecord(form)) {
    pushIssue(issues, 'form', 'must be a JSON object', form);
    return issues;
  }

  if (typeof form.type !== 'string') {
    pushIssue(issues, 'type', 'must be a string', form.type);
  }

  const { versions } = form;
  if (!isRecord(versions)) {
    pushIssue(issues, 'versions', 'must be an object', versions);
    return issues;
  }

  const versionKeys = Object.keys(versions);
  if (versionKeys.length === 0) {
    pushIssue(issues, 'versions', 'must declare at least one version');
    return issues;
  }

  for (const version of versionKeys) {
    checkVersion(
      versions[version],
      `versions${pathSegmentForKey(version)}`,
      issues,
    );
  }

  return issues;
};
