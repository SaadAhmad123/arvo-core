import { describe, expect, it } from 'vitest';
import { convertFromJSONSchema } from '../../../src/serializers/ArvoContractSerializer/deserialize.js';

const S = 'https://json-schema.org/draft/2020-12/schema';
const of = (properties: Record<string, unknown>, extra = {}) => ({
  $schema: S,
  type: 'object',
  properties,
  ...extra,
});

const read = (schema: unknown) => convertFromJSONSchema(schema, 'accepts');

describe('a construct the conversion refuses', () => {
  // Each of these is legal JSON Schema 2020-12 that the conversion cannot
  // represent. Failing is the point: admitting them would produce a contract
  // enforcing less than the form declares, with nothing said about it.
  const refused: [string, unknown][] = [
    ['not', of({ a: { not: { type: 'number' } } })],
    [
      'dependentRequired',
      of({ a: { type: 'string' } }, { dependentRequired: { a: ['b'] } }),
    ],
    [
      'dependentSchemas',
      of(
        { a: { type: 'string' } },
        { dependentSchemas: { a: { required: ['b'] } } },
      ),
    ],
    [
      'unevaluatedProperties',
      of({ a: { type: 'string' } }, { unevaluatedProperties: false }),
    ],
    [
      'if/then/else',
      of({ a: { type: 'string' } }, { if: {}, then: { required: ['b'] } }),
    ],
  ];

  for (const [name, schema] of refused) {
    it(`refuses ${name} rather than reading it weakly`, () => {
      const result = read(schema);
      expect(result.ok).toBe(false);
    });
  }

  it('names the position it refused', () => {
    const result = read(of({ a: { not: { type: 'number' } } }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue.path).toBe('accepts');
  });

  it('names the construct it could not read', () => {
    const result = read(
      of({ a: { type: 'string' } }, { unevaluatedProperties: false }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issue.message).toContain('cannot be read');
      expect(result.issue.message).toContain('unevaluatedProperties');
    }
  });

  it('reads `{ not: {} }`, which the conversion does support', () => {
    // The one exception, and worth pinning: it is what an impossible value
    // looks like, and a form this package writes can contain it.
    expect(read(of({ a: { not: {} } })).ok).toBe(true);
  });
});

describe('a constraint the conversion drops without saying so', () => {
  it('reports a constraint in a subschema with no type of its own', () => {
    const result = read(
      of({ a: { allOf: [{ type: 'string' }, { minLength: 3 }] } }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.losses.map((l) => l.message).join(' ')).toContain(
        'minLength',
      );
      expect(result.losses[0]?.path).toBe('accepts.properties.a.allOf[1]');
    }
  });

  it('reports a dropped propertyNames', () => {
    const result = read(
      of({ a: { type: 'object', propertyNames: { pattern: '^[a-z]+$' } } }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.losses.map((l) => l.message).join(' ')).toContain(
        'propertyNames',
      );
      expect(result.losses[0]?.path).toBe('accepts.properties.a');
    }
  });

  it('reports a dropped uniqueItems', () => {
    const result = read(
      of({
        a: { type: 'array', items: { type: 'string' }, uniqueItems: true },
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.losses.map((l) => l.message).join(' ')).toContain(
        'uniqueItems',
      );
    }
  });

  it('still returns a usable schema', () => {
    // A weaker contract is still that contract. The loss is reported, not
    // turned into a refusal.
    const result = read(
      of({ a: { allOf: [{ type: 'string' }, { minLength: 3 }] } }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.schema).toBeDefined();
  });
});

describe('a fully expressible schema', () => {
  it('reports nothing', () => {
    const result = read(
      of({ a: { type: 'string', minLength: 3 } }, { required: ['a'] }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.losses).toEqual([]);
  });

  it('reports nothing for constraints nested and inside arrays', () => {
    const result = read(
      of({
        a: {
          type: 'object',
          properties: { b: { type: 'number', minimum: 1 } },
        },
        c: { type: 'array', items: { type: 'string' }, minItems: 2 },
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.losses).toEqual([]);
  });

  it('does not mistake an added keyword for a loss', () => {
    // The conversion adds `additionalProperties` on the way back. An addition
    // takes nothing away, so it must not be reported.
    const result = read(of({ a: { type: 'string' } }, { required: ['a'] }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.losses).toEqual([]);
  });

  it('reports nothing for a self-referencing schema', () => {
    const result = read({
      $schema: S,
      type: 'object',
      properties: { next: { $ref: '#' } },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.losses).toEqual([]);
  });
});
