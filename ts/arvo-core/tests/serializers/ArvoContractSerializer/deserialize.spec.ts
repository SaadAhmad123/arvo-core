import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoContract } from '../../../src/ArvoContract/index.js';
import { ArvoContractSerializerError } from '../../../src/serializers/ArvoContractSerializer/errors.js';
import { ArvoContractSerializer } from '../../../src/serializers/ArvoContractSerializer/index.js';

const S = 'https://json-schema.org/draft/2020-12/schema';
const serializer = new ArvoContractSerializer();

const objectSchema = (properties: Record<string, unknown> = {}) => ({
  $schema: S,
  type: 'object',
  properties,
});

const form = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    uri: '#/com/order/create',
    type: 'com_order_create',
    description: null,
    domain: null,
    metadata: {},
    versions: { '1.0.0': { input: objectSchema(), outputs: {} } },
    ...over,
  });

const failureOf = (json: string): ArvoContractSerializerError => {
  const result = serializer.tryDeserialize(json);
  if (result.ok) throw new Error('expected a failure');
  return result.error;
};

describe('a form this serializer produced', () => {
  const original = new ArvoContract({
    type: 'com_order_create',
    description: 'Creates orders',
    domain: 'order_priority',
    metadata: { owner: 'team_orders' },
    versions: {
      '1.0.0': {
        input: z.object({ amount: z.number().min(1) }),
        outputs: { com_order_created: z.object({ id: z.string() }) },
      },
      '1.1.0': { input: z.object({ amount: z.number() }), outputs: {} },
    },
  });

  const { contract } = serializer.deserialize(
    serializer.serialize(original).schema,
  );

  it('keeps the identity fields', () => {
    expect(contract.uri).toBe(original.uri);
    expect(contract.type).toBe(original.type);
    expect(contract.description).toBe('Creates orders');
    expect(contract.domain).toBe('order_priority');
    expect(contract.metadata).toEqual({ owner: 'team_orders' });
  });

  it('keeps every version key', () => {
    expect(Object.keys(contract.versions).sort()).toEqual(['1.0.0', '1.1.0']);
  });

  it('rebuilds each version as a standalone contract', () => {
    expect(contract.versions['1.0.0']?.dataschema).toBe(
      '#/com/order/create/1.0.0',
    );
    expect(contract.versions['1.1.0']?.dataschema).toBe(
      '#/com/order/create/1.1.0',
    );
  });

  it('computes the handler error rather than reading it', () => {
    expect(contract.versions['1.0.0']?.error.type).toBe(
      'handler_com_order_create_error',
    );
  });

  it('keeps the declared outputs', () => {
    expect(Object.keys(contract.versions['1.0.0']?.outputs ?? {})).toEqual([
      'com_order_created',
    ]);
    expect(contract.versions['1.1.0']?.outputs).toEqual({});
  });

  it('reports no losses', () => {
    const { warnings, warningString } = serializer.deserialize(
      serializer.serialize(original).schema,
    );
    expect(warnings).toEqual([]);
    expect(warningString).toBeNull();
  });
});

describe('a form this serializer did not produce', () => {
  it('reads back', () => {
    const { contract } = serializer.deserialize(
      form({
        versions: {
          '2.0.0': {
            input: objectSchema({ email: { type: 'string' } }),
            outputs: { com_order_created: objectSchema() },
          },
        },
      }),
    );
    expect(contract.type).toBe('com_order_create');
    expect(Object.keys(contract.versions)).toEqual(['2.0.0']);
  });

  it('reads back when the optional fields were omitted', () => {
    const { contract } = serializer.deserialize(
      JSON.stringify({
        uri: '#/com/a/b',
        type: 'com_a_b',
        versions: { '1.0.0': { input: objectSchema(), outputs: {} } },
      }),
    );
    expect(contract.description).toBeNull();
    expect(contract.domain).toBeNull();
    expect(contract.metadata).toEqual({});
  });
});

describe('a form that omitted its uri', () => {
  it('derives one from the type, as a declaration would', () => {
    const { contract } = serializer.deserialize(
      JSON.stringify({
        type: 'com_order_create',
        versions: { '1.0.0': { input: objectSchema(), outputs: {} } },
      }),
    );
    expect(contract.uri).toBe('#/com/order/create');
  });
});

describe('failure at this boundary', () => {
  it('reports a string that is not JSON', () => {
    const error = failureOf('not json at all');
    expect(error).toBeInstanceOf(ArvoContractSerializerError);
  });

  it('keeps the original parse failure retrievable', () => {
    expect(failureOf('{ broken').cause).toBeInstanceOf(SyntaxError);
  });

  it('names no position for a failure that had none', () => {
    expect(failureOf('not json at all').issues).toEqual([]);
  });
});

describe("failure of the contract's own rules", () => {
  it('names a malformed emit key', () => {
    const error = failureOf(
      form({
        versions: {
          '1.0.0': {
            input: objectSchema(),
            outputs: { Bad_Key: objectSchema() },
          },
        },
      }),
    );
    expect(error.issues.map((i) => i.path)).toContain(
      'versions["1.0.0"].outputs["Bad_Key"]',
    );
  });

  it('names a malformed version key', () => {
    const error = failureOf(
      form({ versions: { '01.0.0': { input: objectSchema(), outputs: {} } } }),
    );
    expect(error.issues.map((i) => i.path)).toContain('versions["01.0.0"]');
  });

  it('reports several contract faults in one attempt', () => {
    const error = failureOf(
      form({
        domain: 'Bad_Domain',
        versions: {
          '01.0.0': {
            input: objectSchema(),
            outputs: { Bad_Key: objectSchema() },
          },
        },
      }),
    );
    const paths = error.issues.map((i) => i.path);
    expect(paths).toContain('domain');
    expect(paths).toContain('versions["01.0.0"]');
    expect(paths).toContain('versions["01.0.0"].outputs["Bad_Key"]');
  });

  it('carries no cause, the failure being about positions', () => {
    expect(failureOf(form({ domain: 'Bad_Domain' })).cause).toBeUndefined();
  });
});

describe('a malformed form stops before the contract is checked', () => {
  // The two layers overlap on whether a position describes an object, and
  // word it differently. The form answers first, and says the list is partial.
  const error = failureOf(
    form({
      domain: 'Bad_Domain',
      versions: {
        '1.0.0': { input: { $schema: S, type: 'string' }, outputs: {} },
      },
    }),
  );

  it('reports the form fault', () => {
    expect(error.issues.map((i) => i.path)).toContain(
      'versions["1.0.0"].input',
    );
  });

  it('does not also report the contract fault it did not reach', () => {
    expect(error.issues.map((i) => i.path)).not.toContain('domain');
  });

  it('says the list is partial', () => {
    expect(error.issues.some((i) => i.isBlocking)).toBe(true);
    expect(error.message).toContain('not the whole list');
  });

  it('says why it stopped', () => {
    const blocking = error.issues.find((i) => i.isBlocking);
    expect(blocking?.blockingReason).toContain('not well formed');
  });
});

describe('a construct that cannot be read', () => {
  const refusedFor = (input: unknown) =>
    failureOf(form({ versions: { '1.0.0': { input, outputs: {} } } }));

  it('names one the conversion refuses', () => {
    const error = refusedFor({
      $schema: S,
      type: 'object',
      properties: { a: { type: 'string' } },
      unevaluatedProperties: false,
    });
    expect(error.issues[0]?.path).toBe('versions["1.0.0"].input');
    expect(error.issues[0]?.message).toContain('unevaluatedProperties');
  });

  it('names a top-level allOf, which converts to something not an object', () => {
    // Legal under the model, and among the known gaps: the conversion turns
    // it into an intersection, which is not an object schema.
    const error = refusedFor({
      $schema: S,
      type: 'object',
      allOf: [{ properties: { a: { type: 'string' } } }],
    });
    expect(error.issues.map((i) => i.path)).toContain(
      'versions["1.0.0"].input',
    );
  });

  it('names one inside an outputs entry, not only in input', () => {
    const error = failureOf(
      form({
        versions: {
          '1.0.0': {
            input: objectSchema(),
            outputs: {
              com_a_done: {
                $schema: S,
                type: 'object',
                properties: { a: { type: 'string' } },
                unevaluatedProperties: false,
              },
            },
          },
        },
      }),
    );
    expect(error.issues.map((i) => i.path)).toContain(
      'versions["1.0.0"].outputs["com_a_done"]',
    );
  });

  it('names patternProperties, which converts to a record', () => {
    const error = refusedFor({
      $schema: S,
      type: 'object',
      patternProperties: { '^x-': { type: 'string' } },
    });
    expect(error.issues.map((i) => i.path)).toContain(
      'versions["1.0.0"].input',
    );
  });
});

describe('the primitive and its companion', () => {
  const good = form();
  const bad = 'not json';

  it('the primitive does not raise for an expected failure', () => {
    expect(() => serializer.tryDeserialize(bad)).not.toThrow();
    expect(serializer.tryDeserialize(bad).ok).toBe(false);
  });

  it('the companion raises what the primitive reported', () => {
    const reported = serializer.tryDeserialize(bad);
    expect(reported.ok).toBe(false);
    if (!reported.ok) {
      expect(() => serializer.deserialize(bad)).toThrow(reported.error.message);
    }
  });

  it('both agree on success', () => {
    const primitive = serializer.tryDeserialize(good);
    const companion = serializer.deserialize(good);
    expect(primitive.ok).toBe(true);
    if (primitive.ok) {
      expect(primitive.value.contract.uri).toBe(companion.contract.uri);
      expect(primitive.value.warningString).toBe(companion.warningString);
    }
  });

  it('both agree on failure', () => {
    expect(serializer.tryDeserialize(bad).ok).toBe(false);
    expect(() => serializer.deserialize(bad)).toThrow(
      ArvoContractSerializerError,
    );
  });

  it('holds for the outbound pair too', () => {
    const contract = new ArvoContract({
      type: 'com_a_b',
      versions: { '1.0.0': { input: z.object({}), outputs: {} } },
    });
    const primitive = serializer.trySerialize(contract);
    expect(primitive.ok).toBe(true);
    if (primitive.ok) {
      expect(primitive.value.schema).toBe(
        serializer.serialize(contract).schema,
      );
    }
  });
});
