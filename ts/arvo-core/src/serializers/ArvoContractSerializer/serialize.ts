import * as z from 'zod';
import type { ArvoContract } from '../../ArvoContract/index.js';
import type { JSONObject } from '../../types.js';
import type { ErrorIssue } from '../../utils/error-issue.js';
import type { ArvoContractSerializeOptions } from './types.js';
import { demotedCheck, droppedConstraint } from './warnings.js';

/** The dialect ADR-005 pins. Not negotiable, and not caller-settable. */
const JSON_SCHEMA_TARGET = 'draft-2020-12' as const;

/**
 * Conversion settings this serializer chooses, and why each is what it is.
 *
 * `io: 'input'` because a version's schemas describe a wire payload, which is
 * always the input to whoever validates it. Under `'output'` zod emits
 * `additionalProperties: false` for a plain object schema, asserting a
 * rejection that zod itself does not perform — it strips unknown keys instead
 * — which ADR-005 forbids as a check the schema does not actually make.
 *
 * `cycles: 'ref'` because a recursive payload is a legitimate contract and
 * `$ref` is legal in this dialect. Refusing would leave such a contract with
 * no canonical form at all.
 *
 * `unrepresentable: 'any'` because ADR-005 requires a construct the dialect
 * cannot carry to be omitted rather than approximated, and `{}` is this
 * dialect's "unknown". A caller may set `'throw'` to refuse the conversion
 * instead; neither choice affects whether losses are reported.
 */
const CHOSEN_OPTIONS = {
  io: 'input',
  cycles: 'ref',
  reused: 'inline',
  unrepresentable: 'any',
} as const satisfies ArvoContractSerializeOptions;

/**
 * Zod types that carry no constraint by intent rather than by loss.
 *
 * A position holding one of these converts to `{}` exactly as an
 * inexpressible construct does, but nothing was lost: the author asked for
 * no constraint and got none.
 */
const DELIBERATELY_UNCONSTRAINED = new Set(['unknown', 'any']);

/**
 * Records a construct that did not survive the conversion.
 *
 * Reads the outcome rather than being told about it. Zod's `unrepresentable`
 * option only chooses between refusing and substituting `{}` in the version
 * this builds against, so `override` — which sees every node with its own
 * type and path — is where a loss becomes visible: an empty result means the
 * dialect could not carry what was there.
 */
const recordLoss = (
  warnings: ErrorIssue[],
  position: string,
  ctx: {
    zodSchema: { _zod: { def: { type: string } } };
    jsonSchema: object;
    path: (string | number)[];
  },
): void => {
  if (Object.keys(ctx.jsonSchema).length > 0) return;
  const type = ctx.zodSchema._zod.def.type;
  if (DELIBERATELY_UNCONSTRAINED.has(type)) return;
  const path = [position, ...ctx.path].join('.');
  if (warnings.some((issue) => issue.path === path)) return;
  warnings.push(
    droppedConstraint(path, `a ${type} cannot be expressed in JSON Schema`),
  );
};

/**
 * `format` keywords zod emits with no `pattern` beside them, so nothing
 * enforces the check once it is in the form.
 *
 * Where zod emits a `pattern` too, the assertion carries the enforcement and
 * there is nothing to report. These are the ones where it does not.
 */
const unenforcedFormat = (schema: JSONObject): string | null =>
  typeof schema.format === 'string' && schema.pattern === undefined
    ? schema.format
    : null;

/** Walks a converted schema, recording every check demoted to documentation. */
const recordDemotions = (
  node: unknown,
  position: string,
  warnings: ErrorIssue[],
): void => {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const [childIndex, child] of node.entries()) {
      recordDemotions(child, `${position}[${childIndex}]`, warnings);
    }
    return;
  }
  const schema = node as JSONObject;
  const format = unenforcedFormat(schema);
  if (format !== null)
    warnings.push(demotedCheck(position, `format: ${format}`));
  for (const [key, child] of Object.entries(schema)) {
    if (key === 'format' || key === 'pattern') continue;
    recordDemotions(child, `${position}.${key}`, warnings);
  }
};

/**
 * Converts one schema position to JSON Schema, collecting what was lost.
 *
 * Losses are read from the conversion's own output rather than announced by
 * it, which is what `override` is used for here. A caller who supplies their
 * own replaces that inspection rather than composing with it, so no losses
 * are reported for that conversion — the caller has taken the decision this
 * would otherwise report on.
 */
const convert = (
  schema: unknown,
  position: string,
  options: ArvoContractSerializeOptions | undefined,
  warnings: ErrorIssue[],
): JSONObject => {
  const jsonSchema = z.toJSONSchema(schema as never, {
    ...CHOSEN_OPTIONS,
    ...options,
    target: JSON_SCHEMA_TARGET,
    override:
      options?.override ??
      ((ctx) => recordLoss(warnings, position, ctx as never)),
  }) as JSONObject;
  recordDemotions(jsonSchema, position, warnings);
  return jsonSchema;
};

/**
 * Builds a contract's canonical form, and everything the crossing cost.
 *
 * Every field ADR-005 defines is present, including one left at its default —
 * two contracts differing only in whether a default was written explicitly
 * produce the same form. The handler error appears nowhere: it is a fixed
 * function of `type` and the producing version, so every implementation
 * computes it rather than reading it.
 *
 * Throws whatever `z.toJSONSchema` throws; the caller's `tryX` converts it.
 */
export const buildCanonicalForm = (
  contract: ArvoContract,
  options: ArvoContractSerializeOptions | undefined,
): { form: JSONObject; warnings: ErrorIssue[] } => {
  const warnings: ErrorIssue[] = [];
  const versions: JSONObject = {};

  for (const [version, definition] of Object.entries(contract.versions)) {
    const versionPath = `versions[${JSON.stringify(version)}]`;
    const outputs: JSONObject = {};
    for (const [outputType, schema] of Object.entries(definition.outputs)) {
      outputs[outputType] = convert(
        schema,
        `${versionPath}.outputs[${JSON.stringify(outputType)}]`,
        options,
        warnings,
      );
    }
    versions[version] = {
      input: convert(
        definition.input,
        `${versionPath}.input`,
        options,
        warnings,
      ),
      outputs,
    };
  }

  return {
    form: {
      uri: contract.uri,
      type: contract.type,
      description: contract.description,
      domain: contract.domain,
      metadata: contract.metadata,
      versions,
    },
    warnings,
  };
};
