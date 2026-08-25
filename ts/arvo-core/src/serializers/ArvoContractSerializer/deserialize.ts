import * as z from 'zod';
import type * as zc from 'zod/v4/core';
import { ErrorIssue } from '../../utils/error-issue.js';
import { droppedConstraint } from './warnings.js';

/**
 * Keywords whose absence means a constraint stopped being enforced.
 *
 * JSON Schema 2020-12's assertion keywords, plus `format`, plus
 * `propertyNames` — an applicator, but one whose loss removes a real check.
 * Annotations (`title`, `description`, `examples`) are absent: losing them
 * costs documentation, not enforcement. So are the applicators that only
 * widen, such as `additionalProperties`.
 *
 * This list is ours to keep, and it is the safe kind to own. Missing an entry
 * costs a warning that should have been raised; it never changes what a
 * contract accepts.
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
  'format',
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
  into = new Map<string, string>(),
): Map<string, string> => {
  if (node === null || typeof node !== 'object') return into;
  if (Array.isArray(node)) {
    for (const [i, child] of node.entries()) {
      collectConstraints(child, `${path}[${i}]`, into);
    }
    return into;
  }
  for (const [key, value] of Object.entries(node)) {
    if (CONSTRAINT_KEYWORDS.has(key)) {
      into.set(`${path}.${key}`, JSON.stringify(value));
    } else {
      collectConstraints(value, `${path}.${key}`, into);
    }
  }
  return into;
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
  before: unknown,
  after: unknown,
  position: string,
): ErrorIssue[] => {
  const stated = collectConstraints(before);
  const kept = collectConstraints(after);
  const losses: ErrorIssue[] = [];
  for (const [where, value] of stated) {
    if (kept.get(where) === value) continue;
    const keyword = where.slice(where.lastIndexOf('.') + 1);
    losses.push(
      droppedConstraint(
        `${position}${where.slice(0, where.lastIndexOf('.'))}`,
        `${keyword} is no longer enforced`,
      ),
    );
  }
  return losses;
};

/** Reads the keyword a conversion refused out of its own complaint. */
const refusalOf = (error: unknown): string =>
  error instanceof Error ? error.message.split('\n')[0] : String(error);

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
):
  | { ok: true; schema: zc.$ZodType; losses: ErrorIssue[] }
  | { ok: false; issue: ErrorIssue } => {
  let native: zc.$ZodType;
  try {
    native = z.fromJSONSchema(schema as never);
  } catch (error) {
    return {
      ok: false,
      issue: new ErrorIssue({
        path: position,
        message: `cannot be read: ${refusalOf(error)}`,
      }),
    };
  }

  let losses: ErrorIssue[] = [];
  try {
    losses = lostConstraints(
      schema,
      z.toJSONSchema(native as never, {
        target: 'draft-2020-12',
        io: 'input',
        cycles: 'ref',
        reused: 'inline',
        unrepresentable: 'any',
      }),
      position,
    );
  } catch {
    // A schema that converts in but not back out tells us nothing about what
    // was lost. The schema itself is sound, so the contract still reads.
  }

  return { ok: true, schema: native, losses };
};
