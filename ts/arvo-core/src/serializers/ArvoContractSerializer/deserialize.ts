import { err, ok } from 'neverthrow';
import * as z from 'zod';
import type * as zc from 'zod/v4/core';
import type { ArvoContractParam } from '../../ArvoContract/types.js';
import { validateArvoContract } from '../../ArvoContract/validator.js';
import { fromNeverthrow } from '../../result.js';
import type { Result } from '../../types.js';
import { ErrorIssue } from '../../utils/error-issue.js';
import { validateCanonicalForm } from './form.js';
import { demotedCheck, droppedConstraint } from './warnings.js';

/**
 * Keywords whose absence means a constraint stopped being enforced.
 *
 * JSON Schema 2020-12's assertion keywords, plus `propertyNames` — an
 * applicator, but one whose loss removes a real check. Annotations
 * (`title`, `description`, `examples`) are absent: losing them costs
 * documentation, not enforcement. So are the applicators that only widen,
 * such as `additionalProperties`.
 *
 * `format` is absent because it never reaches the comparison: it is removed
 * before conversion and reported separately. See {@link withoutFormat}.
 *
 * This list is ours to keep, and it is the safe kind to own. Missing an entry
 * costs a warning that should have been raised; it never changes what a
 * contract declares as its input.
 */
const CONSTRAINT_KEYWORDS = new Set([
  'type',
  'enum',
  'const',
  'multipleOf',
  'maximum',
  'exclusiveMaximum',
  'minimum',
  'exclusiveMinimum',
  'maxLength',
  'minLength',
  'pattern',
  'maxItems',
  'minItems',
  'uniqueItems',
  'maxContains',
  'minContains',
  'maxProperties',
  'minProperties',
  'required',
  'dependentRequired',
  'propertyNames',
]);

/**
 * Every constraint a schema states, keyed by where it states it.
 *
 * The value is included in the key's entry so that a constraint which
 * survived in name but changed in strength still reads as a difference.
 */
const collectConstraints = (
  node: unknown,
  path = '',
  constraints = new Map<string, string>(),
): Map<string, string> => {
  if (node === null || typeof node !== 'object') return constraints;
  if (Array.isArray(node)) {
    for (const [childIndex, child] of node.entries()) {
      collectConstraints(child, `${path}[${childIndex}]`, constraints);
    }
    return constraints;
  }
  for (const [key, child] of Object.entries(node)) {
    if (CONSTRAINT_KEYWORDS.has(key)) {
      constraints.set(`${path}.${key}`, JSON.stringify(child));
    } else {
      collectConstraints(child, `${path}.${key}`, constraints);
    }
  }
  return constraints;
};

/**
 * Constraints the input stated that the conversion no longer states.
 *
 * Measured rather than looked up. A conversion drops some constraints without
 * raising anything — a keyword group with no `type` of its own to attach to,
 * for instance — and no list of what it cannot do would stay true, because
 * what it can do is documented as changing. Comparing what went in against
 * what came back out asks the conversion what it actually did.
 *
 * Only losses count. A conversion also *adds* keywords on the way back, and
 * an addition takes nothing away.
 */
const lostConstraints = (
  originalSchema: unknown,
  roundTrippedSchema: unknown,
  position: string,
): ErrorIssue[] => {
  const statedConstraints = collectConstraints(originalSchema);
  const keptConstraints = collectConstraints(roundTrippedSchema);
  const losses: ErrorIssue[] = [];
  for (const [constraintPath, constraintValue] of statedConstraints) {
    if (keptConstraints.get(constraintPath) === constraintValue) continue;
    const keyword = constraintPath.slice(constraintPath.lastIndexOf('.') + 1);
    losses.push(
      droppedConstraint(
        `${position}${constraintPath.slice(0, constraintPath.lastIndexOf('.'))}`,
        `${keyword} is no longer enforced`,
      ),
    );
  }
  return losses;
};

/**
 * The schema with every `format` keyword removed, and each one that mattered
 * recorded as a check demoted to documentation.
 *
 * `format` is an annotation, and an annotation states no check — so no
 * implementation may enforce one, or the same bytes would mean different
 * things in different languages. The conversion used here does enforce it, so
 * the keyword is withheld from it rather than the enforcement being switched
 * off, which is not something the conversion offers.
 *
 * The form itself is untouched. A reader of the JSON still sees `format` and
 * still learns what the author meant; only the schema built from it declines
 * to act on it.
 *
 * A `format` sitting beside a `pattern` is removed just the same but reported
 * as nothing: the pattern is an assertion, so it carries the enforcement for
 * every reader and no check was lost.
 */
const withoutFormat = (
  node: unknown,
  position: string,
  demotions: ErrorIssue[],
): unknown => {
  if (node === null || typeof node !== 'object') return node;
  if (Array.isArray(node)) {
    return node.map((child, childIndex) =>
      withoutFormat(child, `${position}[${childIndex}]`, demotions),
    );
  }
  const schema = node as Record<string, unknown>;
  if (typeof schema.format === 'string' && schema.pattern === undefined) {
    demotions.push(demotedCheck(position, `format: ${schema.format}`));
  }
  const strippedSchema: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(schema)) {
    if (key === 'format') continue;
    strippedSchema[key] = withoutFormat(child, `${position}.${key}`, demotions);
  }
  return strippedSchema;
};

/**
 * Reads the keyword a conversion refused out of its own complaint.
 *
 * `String` rather than a check for an `Error`: it handles either, and a
 * conversion that threw something other than an `Error` still has to be
 * reported rather than crashing the read.
 */
const errorHeadline = (error: unknown): string => String(error).split('\n')[0];

/**
 * Converts one schema position from JSON Schema to a native schema, and
 * reports what the conversion cost.
 *
 * Two outcomes only. Either the schema converts, possibly having lost
 * constraints the dialect stated and the conversion cannot express — reported
 * and returned — or the conversion refuses it outright, which is named rather
 * than turned into a schema enforcing less than the form declared.
 */
export const convertFromJSONSchema = (
  schema: unknown,
  position: string,
): Result<{ schema: zc.$ZodType; losses: ErrorIssue[] }, ErrorIssue> => {
  const demotions: ErrorIssue[] = [];
  const schemaWithoutFormat = withoutFormat(schema, position, demotions);

  let zodSchema: zc.$ZodType;
  try {
    zodSchema = z.fromJSONSchema(schemaWithoutFormat as never);
  } catch (error_) {
    return fromNeverthrow(
      err(
        new ErrorIssue({
          path: position,
          message: `cannot be read: ${errorHeadline(error_)}`,
        }),
      ),
    );
  }

  const losses: ErrorIssue[] = [...demotions];
  try {
    losses.push(
      ...lostConstraints(
        schemaWithoutFormat,
        z.toJSONSchema(zodSchema as never, {
          target: 'draft-2020-12',
          io: 'input',
          cycles: 'ref',
          reused: 'inline',
          unrepresentable: 'any',
        }),
        position,
      ),
    );
  } catch {
    // A schema that converts in but not back out tells us nothing about what
    // was lost. The schema itself is sound, so the contract still reads.
  }

  return fromNeverthrow(ok({ schema: zodSchema, losses }));
};

/**
 * Why a malformed form stops the run before the contract's own rules are
 * reached.
 *
 * Not merely tidiness. The two layers overlap on one rule — whether a schema
 * position describes an object — and each words it differently, so running
 * both would report one fault twice. The form is the artifact that actually
 * carries the keyword, so it answers first, and what depends on a form being
 * well formed waits.
 */
const FORM_IS_PREREQUISITE =
  'the form itself is not well formed, so the contract it would build was not checked';

/** A form read into the pieces a contract is declared from. */
export type ReadForm = {
  param: ArvoContractParam;
  losses: ErrorIssue[];
};

/** The shape a form has once its own rules have passed. */
type CheckedForm = {
  uri?: unknown;
  type: string;
  description?: unknown;
  domain?: unknown;
  metadata?: unknown;
  versions: Record<
    string,
    { input: unknown; outputs: Record<string, unknown> }
  >;
};

/** One form issue, marked as the reason nothing after it was checked. */
const asBlocking = (issue: ErrorIssue): ErrorIssue =>
  new ErrorIssue({
    path: issue.path,
    message: issue.message,
    received: issue.received,
    blockingReason: FORM_IS_PREREQUISITE,
  });

/** Converts one version's schemas, collecting refusals and losses apart. */
const readVersion = (
  definition: { input: unknown; outputs: Record<string, unknown> },
  versionPath: string,
  issues: ErrorIssue[],
  losses: ErrorIssue[],
): { input: unknown; outputs: Record<string, unknown> } | null => {
  const outputs: Record<string, unknown> = {};
  for (const [outputType, schema] of Object.entries(definition.outputs)) {
    const conversion = convertFromJSONSchema(
      schema,
      `${versionPath}.outputs[${JSON.stringify(outputType)}]`,
    );
    if (conversion.ok) {
      outputs[outputType] = conversion.value.schema;
      losses.push(...conversion.value.losses);
    } else {
      issues.push(conversion.error);
    }
  }

  const inputConversion = convertFromJSONSchema(
    definition.input,
    `${versionPath}.input`,
  );
  if (!inputConversion.ok) {
    issues.push(inputConversion.error);
    return null;
  }
  losses.push(...inputConversion.value.losses);
  return { input: inputConversion.value.schema, outputs };
};

/**
 * The form's fields as a contract declaration.
 *
 * An absent optional field is left absent rather than passed as its default,
 * so the contract applies its own default and there is one place that decides
 * what a default is.
 */
const asDeclaration = (
  form: CheckedForm,
  versions: Record<string, unknown>,
): ArvoContractParam =>
  ({
    ...(typeof form.uri === 'string' ? { uri: form.uri } : {}),
    type: form.type,
    ...(typeof form.description === 'string'
      ? { description: form.description }
      : {}),
    ...(typeof form.domain === 'string' ? { domain: form.domain } : {}),
    ...(form.metadata !== undefined && form.metadata !== null
      ? { metadata: form.metadata }
      : {}),
    versions,
  }) as ArvoContractParam;

/**
 * Reads a parsed canonical form into a contract declaration.
 *
 * Ordered, and the order is the design. The form's own rules are checked
 * against the JSON first, because a conversion erases what they check. Then
 * each schema position is converted, measuring what the conversion dropped.
 * Only then are the contract's own rules applied — and by calling the
 * validator rather than building a contract and catching, so that everything
 * it finds arrives with everything found before it.
 */
export const readCanonicalForm = (
  rawForm: unknown,
): Result<ReadForm, ErrorIssue[]> => {
  const formIssues = validateCanonicalForm(rawForm);
  if (formIssues.length > 0) {
    const [firstIssue, ...laterIssues] = formIssues;
    return fromNeverthrow(
      err([asBlocking(firstIssue as ErrorIssue), ...laterIssues]),
    );
  }

  const form = rawForm as CheckedForm;
  const issues: ErrorIssue[] = [];
  const losses: ErrorIssue[] = [];
  const versions: Record<string, unknown> = {};

  for (const [version, definition] of Object.entries(form.versions)) {
    const versionSchemas = readVersion(
      definition,
      `versions[${JSON.stringify(version)}]`,
      issues,
      losses,
    );
    if (versionSchemas !== null) versions[version] = versionSchemas;
  }

  if (issues.length > 0) return fromNeverthrow(err(issues));

  const param = asDeclaration(form, versions);
  const validation = validateArvoContract(param);
  if (validation.issues.length > 0)
    return fromNeverthrow(err(validation.issues));

  return fromNeverthrow(ok({ param, losses }));
};
