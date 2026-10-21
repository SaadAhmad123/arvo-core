import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { convertFromJSONSchema } from '../../../src/serializers/ArvoContractSerializer/deserialize.js';

const DIALECT = 'https://json-schema.org/draft/2020-12/schema';
const objectSchema = (properties: Record<string, unknown>, keywords = {}) => ({
  $schema: DIALECT,
  type: 'object',
  properties,
  ...keywords,
});

const convertInput = (schema: unknown) =>
  convertFromJSONSchema(schema, 'input');

describe('a construct the conversion refuses', () => {
  // Each of these is legal JSON Schema 2020-12 that the conversion cannot
  // represent. Failing is the point: admitting them would produce a contract
  // enforcing less than the form declares, with nothing said about it.
  const unreadable: [string, unknown][] = [
    ['not', objectSchema({ a: { not: { type: 'number' } } })],
    [
      'dependentRequired',
      objectSchema(
        { a: { type: 'string' } },
        { dependentRequired: { a: ['b'] } },
      ),
    ],
    [
      'dependentSchemas',
      objectSchema(
        { a: { type: 'string' } },
        { dependentSchemas: { a: { required: ['b'] } } },
      ),
    ],
    [
      'unevaluatedProperties',
      objectSchema({ a: { type: 'string' } }, { unevaluatedProperties: false }),
    ],
    [
      'if/then/else',
      // Built from a string rather than a literal: `then` is a JSON Schema
      // keyword, and an object literal defining one reads as a thenable.
      objectSchema(
        { a: { type: 'string' } },
        JSON.parse('{"if":{},"then":{"required":["b"]}}'),
      ),
    ],
  ];

  for (const [keyword, schema] of unreadable) {
    it(`refuses ${keyword} rather than reading it weakly`, () => {
      const conversion = convertInput(schema);
      expect(conversion.ok).toBe(false);
    });
  }

  it('names the position it refused', () => {
    const conversion = convertInput(
      objectSchema({ a: { not: { type: 'number' } } }),
    );
    expect(conversion.ok).toBe(false);
    if (!conversion.ok) expect(conversion.error.path).toBe('input');
  });

  it('names the construct it could not read', () => {
    const conversion = convertInput(
      objectSchema({ a: { type: 'string' } }, { unevaluatedProperties: false }),
    );
    expect(conversion.ok).toBe(false);
    if (!conversion.ok) {
      expect(conversion.error.message).toContain('cannot be read');
      expect(conversion.error.message).toContain('unevaluatedProperties');
    }
  });

  it('reads `{ not: {} }`, which the conversion does support', () => {
    // The one exception, and worth pinning: it is what an impossible value
    // looks like, and a form this package writes can contain it.
    expect(convertInput(objectSchema({ a: { not: {} } })).ok).toBe(true);
  });
});

describe('a constraint the conversion drops without saying so', () => {
  it('reports a constraint in a subschema with no type of its own', () => {
    const conversion = convertInput(
      objectSchema({ a: { allOf: [{ type: 'string' }, { minLength: 3 }] } }),
    );
    expect(conversion.ok).toBe(true);
    if (conversion.ok) {
      expect(
        conversion.value.losses.map((loss) => loss.message).join(' '),
      ).toContain('minLength');
      expect(conversion.value.losses[0]?.path).toBe(
        'input.properties.a.allOf[1]',
      );
    }
  });

  it('reports a dropped propertyNames', () => {
    const conversion = convertInput(
      objectSchema({
        a: { type: 'object', propertyNames: { pattern: '^[a-z]+$' } },
      }),
    );
    expect(conversion.ok).toBe(true);
    if (conversion.ok) {
      expect(
        conversion.value.losses.map((loss) => loss.message).join(' '),
      ).toContain('propertyNames');
      expect(conversion.value.losses[0]?.path).toBe('input.properties.a');
    }
  });

  it('reports a dropped uniqueItems', () => {
    const conversion = convertInput(
      objectSchema({
        a: { type: 'array', items: { type: 'string' }, uniqueItems: true },
      }),
    );
    expect(conversion.ok).toBe(true);
    if (conversion.ok) {
      expect(
        conversion.value.losses.map((loss) => loss.message).join(' '),
      ).toContain('uniqueItems');
    }
  });

  it('still returns a usable schema', () => {
    // A weaker contract is still that contract. The loss is reported, not
    // turned into a refusal.
    const conversion = convertInput(
      objectSchema({ a: { allOf: [{ type: 'string' }, { minLength: 3 }] } }),
    );
    expect(conversion.ok).toBe(true);
    if (conversion.ok) expect(conversion.value.schema).toBeDefined();
  });
});

describe('a fully expressible schema', () => {
  it('reports nothing', () => {
    const conversion = convertInput(
      objectSchema(
        { a: { type: 'string', minLength: 3 } },
        { required: ['a'] },
      ),
    );
    expect(conversion.ok).toBe(true);
    if (conversion.ok) expect(conversion.value.losses).toEqual([]);
  });

  it('reports nothing for constraints nested and inside arrays', () => {
    const conversion = convertInput(
      objectSchema({
        a: {
          type: 'object',
          properties: { b: { type: 'number', minimum: 1 } },
        },
        c: { type: 'array', items: { type: 'string' }, minItems: 2 },
      }),
    );
    expect(conversion.ok).toBe(true);
    if (conversion.ok) expect(conversion.value.losses).toEqual([]);
  });

  it('does not mistake an added keyword for a loss', () => {
    // The conversion adds `additionalProperties` on the way back. An addition
    // takes nothing away, so it must not be reported.
    const conversion = convertInput(
      objectSchema({ a: { type: 'string' } }, { required: ['a'] }),
    );
    expect(conversion.ok).toBe(true);
    if (conversion.ok) expect(conversion.value.losses).toEqual([]);
  });

  it('reports nothing for a self-referencing schema', () => {
    const conversion = convertInput({
      $schema: DIALECT,
      type: 'object',
      properties: { next: { $ref: '#' } },
    });
    expect(conversion.ok).toBe(true);
    if (conversion.ok) expect(conversion.value.losses).toEqual([]);
  });
});

describe('an annotation keyword states no check', () => {
  // `format` is an annotation, so no implementation may enforce one — the
  // same bytes would otherwise mean different things in different languages.
  // The conversion used here does enforce it, so it is withheld from the
  // conversion rather than the form being rewritten.

  it('does not enforce a format the form documents', () => {
    const conversion = convertInput(
      objectSchema({ u: { type: 'string', format: 'uri' } }),
    );
    expect(conversion.ok).toBe(true);
    if (conversion.ok) {
      expect(z.safeParse(conversion.value.schema, { u: 'nope' }).success).toBe(
        true,
      );
    }
  });

  it('reports it as documentation rather than a drop', () => {
    const conversion = convertInput(
      objectSchema({ u: { type: 'string', format: 'uri' } }),
    );
    expect(conversion.ok).toBe(true);
    if (conversion.ok) {
      expect(conversion.value.losses).toHaveLength(1);
      expect(conversion.value.losses[0]?.message).toContain(
        'documentation only',
      );
      expect(conversion.value.losses[0]?.path).toBe('input.properties.u');
    }
  });

  it('reports nothing when a pattern carries the enforcement', () => {
    // The pattern is an assertion, so every reader enforces it and no check
    // was lost by withholding the annotation beside it.
    const conversion = convertInput(
      objectSchema({
        e: { type: 'string', format: 'email', pattern: '^[a-z]+@[a-z]+$' },
      }),
    );
    expect(conversion.ok).toBe(true);
    if (conversion.ok) {
      expect(conversion.value.losses).toEqual([]);
      expect(z.safeParse(conversion.value.schema, { e: 'nope' }).success).toBe(
        false,
      );
    }
  });

  it('reaches a format nested inside another schema', () => {
    const conversion = convertInput(
      objectSchema({
        a: {
          type: 'object',
          properties: { u: { type: 'string', format: 'uri' } },
        },
      }),
    );
    expect(conversion.ok).toBe(true);
    if (conversion.ok) {
      expect(conversion.value.losses[0]?.path).toBe(
        'input.properties.a.properties.u',
      );
    }
  });
});
