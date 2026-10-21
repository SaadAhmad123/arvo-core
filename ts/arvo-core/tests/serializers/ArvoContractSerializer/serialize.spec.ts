import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoContract } from '../../../src/ArvoContract/index.js';
import { ArvoContractSerializer } from '../../../src/serializers/ArvoContractSerializer/index.js';

const DIALECT = 'https://json-schema.org/draft/2020-12/schema';

const orderContract = (overrides: Record<string, unknown> = {}) =>
  new ArvoContract({
    type: 'com_order_create',
    versions: {
      '1.0.0': {
        input: z.object({ amount: z.number() }),
        outputs: { com_order_created: z.object({ id: z.string() }) },
      },
    },
    ...overrides,
  } as never);

const canonicalForm = (contract: ArvoContract, options?: never) =>
  JSON.parse(new ArvoContractSerializer(options).serialize(contract).schema);

describe('the canonical form', () => {
  it('declares the dialect at every schema position', () => {
    const form = canonicalForm(
      new ArvoContract({
        type: 'com_order_create',
        versions: {
          '1.0.0': {
            input: z.object({ a: z.string() }),
            outputs: { com_a: z.object({ x: z.string() }) },
          },
          '1.1.0': {
            input: z.object({ b: z.string() }),
            outputs: { com_b: z.object({ y: z.string() }) },
          },
        },
      }),
    );
    for (const version of ['1.0.0', '1.1.0']) {
      expect(form.versions[version].input.$schema).toBe(DIALECT);
      for (const emitSchema of Object.values<{ $schema: string }>(
        form.versions[version].outputs,
      )) {
        expect(emitSchema.$schema).toBe(DIALECT);
      }
    }
  });

  it('materializes every optional field at its default', () => {
    const form = canonicalForm(orderContract());
    expect(form.description).toBeNull();
    expect(form.domain).toBeNull();
    expect(form.metadata).toEqual({});
  });

  it('cannot tell an explicit default from an omitted one', () => {
    // Two contracts differing only in whether a default was written are the
    // same contract, so their forms must not differ either.
    const omittedDefaultForm = canonicalForm(orderContract());
    const explicitDefaultForm = canonicalForm(orderContract({ metadata: {} }));
    expect(JSON.stringify(explicitDefaultForm)).toBe(
      JSON.stringify(omittedDefaultForm),
    );
  });

  it('carries the identity fields as declared', () => {
    const form = canonicalForm(
      orderContract({
        uri: '#/services/orders',
        description: 'Creates orders',
        domain: 'order_priority',
        metadata: { owner: 'team_orders' },
      }),
    );
    expect(form.uri).toBe('#/services/orders');
    expect(form.type).toBe('com_order_create');
    expect(form.description).toBe('Creates orders');
    expect(form.domain).toBe('order_priority');
    expect(form.metadata).toEqual({ owner: 'team_orders' });
  });

  it('gives the handler error no position anywhere', () => {
    // It is a fixed function of `type` and the producing version, so every
    // implementation computes it rather than reading it.
    const form = canonicalForm(orderContract());
    expect(JSON.stringify(form)).not.toContain(
      'handler_com_order_create_error',
    );
  });

  it('keeps an empty outputs as an empty object', () => {
    const form = canonicalForm(
      new ArvoContract({
        type: 'com_a_b',
        versions: { '1.0.0': { input: z.object({}), outputs: {} } },
      }),
    );
    expect(form.versions['1.0.0'].outputs).toEqual({});
  });

  it('expresses a recursive schema by reference rather than refusing it', () => {
    const Node: z.ZodType = z.object({
      name: z.string(),
      get children() {
        return z.array(Node);
      },
    });
    const form = canonicalForm(
      new ArvoContract({
        type: 'com_tree_create',
        versions: { '1.0.0': { input: Node as never, outputs: {} } },
      }),
    );
    expect(JSON.stringify(form.versions['1.0.0'].input)).toContain('$ref');
  });
});

describe('what the crossing cost', () => {
  const lossyContract = new ArvoContract({
    type: 'com_a_b',
    versions: {
      '1.0.0': {
        input: z.object({ at: z.date(), amount: z.number() }),
        outputs: {},
      },
    },
  });

  it('reports an inexpressible constraint rather than raising', () => {
    const serialization = new ArvoContractSerializer().trySerialize(
      lossyContract,
    );
    expect(serialization.ok).toBe(true);
  });

  it('names the position the constraint occupied', () => {
    const { warnings } = new ArvoContractSerializer().serialize(lossyContract);
    expect(warnings.map((warning) => warning.path)).toContain(
      'versions["1.0.0"].input.properties.at',
    );
  });

  it('leaves the expressible constraints alone', () => {
    const { warnings } = new ArvoContractSerializer().serialize(lossyContract);
    expect(warnings.map((warning) => warning.path)).not.toContain(
      'versions["1.0.0"].input.properties.amount',
    );
  });

  it('still produces the form', () => {
    const form = JSON.parse(
      new ArvoContractSerializer().serialize(lossyContract).schema,
    );
    expect(form.versions['1.0.0'].input.properties.at).toEqual({});
  });

  it('reports nothing, and no message, when nothing was lost', () => {
    const { warnings, warningString } = new ArvoContractSerializer().serialize(
      orderContract(),
    );
    expect(warnings).toEqual([]);
    expect(warningString).toBeNull();
  });

  it('reports a loss inside an emit as well as in input', () => {
    const { warnings } = new ArvoContractSerializer().serialize(
      new ArvoContract({
        type: 'com_a_b',
        versions: {
          '1.0.0': {
            input: z.object({}),
            outputs: { com_a_done: z.object({ at: z.date() }) },
          },
        },
      }),
    );
    expect(warnings.map((warning) => warning.path)).toContain(
      'versions["1.0.0"].outputs["com_a_done"].properties.at',
    );
  });

  it('names the construct that could not be expressed', () => {
    const { warnings } = new ArvoContractSerializer().serialize(lossyContract);
    expect(warnings[0]?.message).toContain('a date');
  });

  it('does not report a field left deliberately unconstrained', () => {
    // `unknown` converts to `{}` exactly as a loss does, but nothing was
    // lost: the author asked for no constraint and got none.
    const { warnings } = new ArvoContractSerializer().serialize(
      new ArvoContract({
        type: 'com_a_b',
        versions: {
          '1.0.0': {
            input: z.object({ u: z.unknown(), a: z.any() }),
            outputs: {},
          },
        },
      }),
    );
    expect(warnings).toEqual([]);
  });

  it('reports one loss per position, not one per visit', () => {
    // An optional unrepresentable field is visited twice — once as the type,
    // once as the wrapper — and both results are empty. One field, one loss.
    const { warnings } = new ArvoContractSerializer().serialize(
      new ArvoContract({
        type: 'com_a_b',
        versions: {
          '1.0.0': {
            input: z.object({ at: z.date().optional() }),
            outputs: {},
          },
        },
      }),
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.path).toBe('versions["1.0.0"].input.properties.at');
  });

  it('reports a format with no pattern as documentation only', () => {
    // z.url() outputs `format: "uri"` alone. Nothing may enforce an annotation,
    // so the check the author wrote becomes documentation in the form.
    const { warnings } = new ArvoContractSerializer().serialize(
      new ArvoContract({
        type: 'com_a_b',
        versions: {
          '1.0.0': { input: z.object({ u: z.url() }), outputs: {} },
        },
      }),
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain('documentation only');
    expect(warnings[0]?.path).toBe('versions["1.0.0"].input.properties.u');
  });

  it('does not report a format that keeps its pattern', () => {
    // zod outputs `pattern` beside `format` for these, so the assertion still
    // carries the enforcement and nothing has been demoted.
    const { warnings } = new ArvoContractSerializer().serialize(
      new ArvoContract({
        type: 'com_a_b',
        versions: {
          '1.0.0': { input: z.object({ e: z.email() }), outputs: {} },
        },
      }),
    );
    expect(warnings).toEqual([]);
  });
});

describe('conversion options', () => {
  it('reports losses whatever the caller sets', () => {
    // Reporting is read off the output, so no option can switch it off.
    const { warnings } = new ArvoContractSerializer({
      serialize: { unrepresentable: 'any' },
    }).serialize(
      new ArvoContract({
        type: 'com_a_b',
        versions: {
          '1.0.0': { input: z.object({ at: z.date() }), outputs: {} },
        },
      }),
    );
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('reports a failure when the caller asks to refuse the conversion', () => {
    const serialization = new ArvoContractSerializer({
      serialize: { unrepresentable: 'throw' },
    }).trySerialize(
      new ArvoContract({
        type: 'com_a_b',
        versions: {
          '1.0.0': { input: z.object({ at: z.date() }), outputs: {} },
        },
      }),
    );
    expect(serialization.ok).toBe(false);
  });

  it('stops reporting when the caller supplies their own override', () => {
    // `override` is how losses are found, so replacing it replaces that.
    const { warnings } = new ArvoContractSerializer({
      serialize: { override: () => undefined },
    }).serialize(
      new ArvoContract({
        type: 'com_a_b',
        versions: {
          '1.0.0': { input: z.object({ at: z.date() }), outputs: {} },
        },
      }),
    );
    expect(warnings).toEqual([]);
  });

  it('the throwing companion raises what the primitive reported', () => {
    const refusingSerializer = new ArvoContractSerializer({
      serialize: { unrepresentable: 'throw' },
    });
    const contractWithDate = new ArvoContract({
      type: 'com_a_b',
      versions: { '1.0.0': { input: z.object({ at: z.date() }), outputs: {} } },
    });
    const serialization = refusingSerializer.trySerialize(contractWithDate);
    expect(serialization.ok).toBe(false);
    if (!serialization.ok) {
      expect(() => refusingSerializer.serialize(contractWithDate)).toThrow(
        serialization.error.message,
      );
    }
  });

  it('cannot be told to target another dialect', () => {
    // `target` is absent from the options type, so this needs a cast to even
    // attempt. The form must still declare 2020-12.
    const form = canonicalForm(orderContract(), {
      serialize: { target: 'draft-07' },
    } as never);
    expect(form.versions['1.0.0'].input.$schema).toBe(DIALECT);
  });
});
