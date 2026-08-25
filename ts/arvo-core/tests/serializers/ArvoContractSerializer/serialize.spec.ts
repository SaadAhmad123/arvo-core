import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoContract } from '../../../src/ArvoContract/index.js';
import { ArvoContractSerializer } from '../../../src/serializers/ArvoContractSerializer/index.js';

const DIALECT = 'https://json-schema.org/draft/2020-12/schema';

const contract = (over: Record<string, unknown> = {}) =>
  new ArvoContract({
    type: 'com_order_create',
    versions: {
      '1.0.0': {
        accepts: z.object({ amount: z.number() }),
        emits: { com_order_created: z.object({ id: z.string() }) },
      },
    },
    ...over,
  } as never);

const formOf = (c: ArvoContract, options?: never) =>
  JSON.parse(new ArvoContractSerializer(options).serialize(c).schema);

describe('the canonical form', () => {
  it('declares the dialect at every schema position', () => {
    const form = formOf(
      new ArvoContract({
        type: 'com_order_create',
        versions: {
          '1.0.0': {
            accepts: z.object({ a: z.string() }),
            emits: { com_a: z.object({ x: z.string() }) },
          },
          '1.1.0': {
            accepts: z.object({ b: z.string() }),
            emits: { com_b: z.object({ y: z.string() }) },
          },
        },
      }),
    );
    for (const version of ['1.0.0', '1.1.0']) {
      expect(form.versions[version].accepts.$schema).toBe(DIALECT);
      for (const emit of Object.values<{ $schema: string }>(
        form.versions[version].emits,
      )) {
        expect(emit.$schema).toBe(DIALECT);
      }
    }
  });

  it('materializes every optional field at its default', () => {
    const form = formOf(contract());
    expect(form.description).toBeNull();
    expect(form.domain).toBeNull();
    expect(form.metadata).toEqual({});
  });

  it('cannot tell an explicit default from an omitted one', () => {
    // Two contracts differing only in whether a default was written are the
    // same contract, so their forms must not differ either.
    const omitted = formOf(contract());
    const explicit = formOf(contract({ metadata: {} }));
    expect(JSON.stringify(explicit)).toBe(JSON.stringify(omitted));
  });

  it('carries the identity fields as declared', () => {
    const form = formOf(
      contract({
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
    const form = formOf(contract());
    expect(JSON.stringify(form)).not.toContain(
      'handler_com_order_create_error',
    );
  });

  it('keeps an empty emits as an empty object', () => {
    const form = formOf(
      new ArvoContract({
        type: 'com_a_b',
        versions: { '1.0.0': { accepts: z.object({}), emits: {} } },
      }),
    );
    expect(form.versions['1.0.0'].emits).toEqual({});
  });

  it('expresses a recursive schema by reference rather than refusing it', () => {
    const Node: z.ZodType = z.object({
      name: z.string(),
      get children() {
        return z.array(Node);
      },
    });
    const form = formOf(
      new ArvoContract({
        type: 'com_tree_create',
        versions: { '1.0.0': { accepts: Node as never, emits: {} } },
      }),
    );
    expect(JSON.stringify(form.versions['1.0.0'].accepts)).toContain('$ref');
  });
});

describe('what the crossing cost', () => {
  const lossy = new ArvoContract({
    type: 'com_a_b',
    versions: {
      '1.0.0': {
        accepts: z.object({ at: z.date(), amount: z.number() }),
        emits: {},
      },
    },
  });

  it('reports an inexpressible constraint rather than raising', () => {
    const result = new ArvoContractSerializer().trySerialize(lossy);
    expect(result.ok).toBe(true);
  });

  it('names the position the constraint occupied', () => {
    const { warnings } = new ArvoContractSerializer().serialize(lossy);
    expect(warnings.map((w) => w.path)).toContain(
      'versions["1.0.0"].accepts.properties.at',
    );
  });

  it('leaves the expressible constraints alone', () => {
    const { warnings } = new ArvoContractSerializer().serialize(lossy);
    expect(warnings.map((w) => w.path)).not.toContain(
      'versions["1.0.0"].accepts.properties.amount',
    );
  });

  it('still produces the form', () => {
    const form = JSON.parse(
      new ArvoContractSerializer().serialize(lossy).schema,
    );
    expect(form.versions['1.0.0'].accepts.properties.at).toEqual({});
  });

  it('reports nothing, and no message, when nothing was lost', () => {
    const { warnings, warningString } = new ArvoContractSerializer().serialize(
      contract(),
    );
    expect(warnings).toEqual([]);
    expect(warningString).toBeNull();
  });

  it('reports a loss inside an emit as well as in accepts', () => {
    const { warnings } = new ArvoContractSerializer().serialize(
      new ArvoContract({
        type: 'com_a_b',
        versions: {
          '1.0.0': {
            accepts: z.object({}),
            emits: { com_a_done: z.object({ at: z.date() }) },
          },
        },
      }),
    );
    expect(warnings.map((w) => w.path)).toContain(
      'versions["1.0.0"].emits["com_a_done"].properties.at',
    );
  });

  it('names the construct that could not be expressed', () => {
    const { warnings } = new ArvoContractSerializer().serialize(lossy);
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
            accepts: z.object({ u: z.unknown(), a: z.any() }),
            emits: {},
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
            accepts: z.object({ at: z.date().optional() }),
            emits: {},
          },
        },
      }),
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.path).toBe('versions["1.0.0"].accepts.properties.at');
  });

  it('reports a format with no pattern as documentation only', () => {
    // z.url() emits `format: "uri"` alone. Nothing may enforce an annotation,
    // so the check the author wrote becomes documentation in the form.
    const { warnings } = new ArvoContractSerializer().serialize(
      new ArvoContract({
        type: 'com_a_b',
        versions: {
          '1.0.0': { accepts: z.object({ u: z.url() }), emits: {} },
        },
      }),
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain('documentation only');
    expect(warnings[0]?.path).toBe('versions["1.0.0"].accepts.properties.u');
  });

  it('does not report a format that keeps its pattern', () => {
    // zod emits `pattern` beside `format` for these, so the assertion still
    // carries the enforcement and nothing has been demoted.
    const { warnings } = new ArvoContractSerializer().serialize(
      new ArvoContract({
        type: 'com_a_b',
        versions: {
          '1.0.0': { accepts: z.object({ e: z.email() }), emits: {} },
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
          '1.0.0': { accepts: z.object({ at: z.date() }), emits: {} },
        },
      }),
    );
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('reports a failure when the caller asks to refuse the conversion', () => {
    const result = new ArvoContractSerializer({
      serialize: { unrepresentable: 'throw' },
    }).trySerialize(
      new ArvoContract({
        type: 'com_a_b',
        versions: {
          '1.0.0': { accepts: z.object({ at: z.date() }), emits: {} },
        },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('stops reporting when the caller supplies their own override', () => {
    // `override` is how losses are found, so replacing it replaces that.
    const { warnings } = new ArvoContractSerializer({
      serialize: { override: () => undefined },
    }).serialize(
      new ArvoContract({
        type: 'com_a_b',
        versions: {
          '1.0.0': { accepts: z.object({ at: z.date() }), emits: {} },
        },
      }),
    );
    expect(warnings).toEqual([]);
  });

  it('the throwing companion raises what the primitive reported', () => {
    const refusing = new ArvoContractSerializer({
      serialize: { unrepresentable: 'throw' },
    });
    const withADate = new ArvoContract({
      type: 'com_a_b',
      versions: { '1.0.0': { accepts: z.object({ at: z.date() }), emits: {} } },
    });
    const reported = refusing.trySerialize(withADate);
    expect(reported.ok).toBe(false);
    if (!reported.ok) {
      expect(() => refusing.serialize(withADate)).toThrow(
        reported.error.message,
      );
    }
  });

  it('cannot be told to target another dialect', () => {
    // `target` is absent from the options type, so this needs a cast to even
    // attempt. The form must still declare 2020-12.
    const form = formOf(contract(), {
      serialize: { target: 'draft-07' },
    } as never);
    expect(form.versions['1.0.0'].accepts.$schema).toBe(DIALECT);
  });
});
