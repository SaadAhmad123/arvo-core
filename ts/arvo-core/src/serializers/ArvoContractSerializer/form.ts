import { ErrorIssue } from '../../utils/error-issue.js';

/** The dialect every schema-bearing position must declare. */
const DIALECT = 'https://json-schema.org/draft/2020-12/schema';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A map key rendered for an issue path, matching what serialization emits. */
const at = (key: string): string => `[${JSON.stringify(key)}]`;

const push = (
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
    push(issues, path, 'must be a JSON Schema object', schema);
    return;
  }
  if (schema.type !== 'object') {
    push(
      issues,
      path,
      'must carry the literal keyword "type": "object" at its top level',
      schema.type,
    );
  }
  if (schema.$schema !== DIALECT) {
    push(issues, path, `must declare "$schema" as ${DIALECT}`, schema.$schema);
  }
};

/** Checks one version definition and every schema position inside it. */
const checkVersion = (
  definition: unknown,
  path: string,
  issues: ErrorIssue[],
): void => {
  if (!isRecord(definition)) {
    push(issues, path, 'must be an object', definition);
    return;
  }

  checkSchemaPosition(definition.accepts, `${path}.accepts`, issues);

  const { emits } = definition;
  if (!isRecord(emits)) {
    push(issues, `${path}.emits`, 'must be an object', emits);
    return;
  }
  for (const [type, schema] of Object.entries(emits)) {
    checkSchemaPosition(schema, `${path}.emits${at(type)}`, issues);
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
export const validateCanonicalForm = (parsed: unknown): ErrorIssue[] => {
  const issues: ErrorIssue[] = [];

  if (!isRecord(parsed)) {
    push(issues, 'form', 'must be a JSON object', parsed);
    return issues;
  }

  if (typeof parsed.type !== 'string') {
    push(issues, 'type', 'must be a string', parsed.type);
  }

  const { versions } = parsed;
  if (!isRecord(versions)) {
    push(issues, 'versions', 'must be an object', versions);
    return issues;
  }

  const keys = Object.keys(versions);
  if (keys.length === 0) {
    push(issues, 'versions', 'must declare at least one version');
    return issues;
  }

  for (const key of keys) {
    checkVersion(versions[key], `versions${at(key)}`, issues);
  }

  return issues;
};
