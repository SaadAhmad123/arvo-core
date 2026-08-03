import { describe, expect, it } from 'vitest';
import { walkFlatMap, walkPayload } from '../../src/ArvoEvent/json.js';

const pathsOf = (result: { issues: { path: string }[] }): string[] =>
  result.issues.map((issue) => issue.path);

const messagesOf = (result: { issues: { message: string }[] }): string[] =>
  result.issues.map((issue) => issue.message);

describe('walkPayload', () => {
  describe('top-level shape guard', () => {
    it('rejects null', () => {
      const result = walkPayload(null, 'data');
      expect(pathsOf(result)).toEqual(['data']);
      expect(messagesOf(result)[0]).toContain('must be an object of JSON values');
    });

    it('rejects undefined', () => {
      expect(walkPayload(undefined, 'data').issues).toHaveLength(1);
    });

    it('rejects an array, because a payload"s keys are what a contract names', () => {
      const result = walkPayload([1, 2], 'data');
      expect(pathsOf(result)).toEqual(['data']);
    });

    it('rejects a string', () => {
      expect(walkPayload('hello', 'data').issues).toHaveLength(1);
    });

    it('rejects a number', () => {
      expect(walkPayload(42, 'data').issues).toHaveLength(1);
    });

    it('rejects a boolean', () => {
      expect(walkPayload(true, 'data').issues).toHaveLength(1);
    });

    it('returns a frozen empty object when the top level is rejected', () => {
      const result = walkPayload(null, 'data');
      expect(result.value).toEqual({});
      expect(Object.isFrozen(result.value)).toBe(true);
    });

    it('accepts an empty object', () => {
      const result = walkPayload({}, 'data');
      expect(result.issues).toEqual([]);
      expect(result.value).toEqual({});
    });

    it('accepts an object created with a null prototype', () => {
      const bare = Object.create(null);
      bare.a = 1;
      expect(walkPayload(bare, 'data').issues).toEqual([]);
    });
  });

  describe('rejected value classes, one case each', () => {
    it('rejects NaN', () => {
      const result = walkPayload({ n: Number.NaN }, 'data');
      expect(pathsOf(result)).toEqual(['data.n']);
      expect(messagesOf(result)[0]).toContain('finite');
    });

    it('rejects Infinity', () => {
      expect(walkPayload({ n: Number.POSITIVE_INFINITY }, 'data').issues).toHaveLength(1);
    });

    it('rejects -Infinity', () => {
      expect(walkPayload({ n: Number.NEGATIVE_INFINITY }, 'data').issues).toHaveLength(1);
    });

    it('rejects a bigint as a map value', () => {
      const result = walkPayload({ big: 1n }, 'data');
      expect(pathsOf(result)).toEqual(['data.big']);
      expect(messagesOf(result)[0]).toContain('bigint');
    });

    it('rejects a bigint as an array element', () => {
      const result = walkPayload({ xs: [1n] }, 'data');
      expect(pathsOf(result)).toEqual(['data.xs[0]']);
    });

    it('rejects a function', () => {
      const result = walkPayload({ fn: () => 'x' }, 'data');
      expect(pathsOf(result)).toEqual(['data.fn']);
      expect(messagesOf(result)[0]).toContain('function');
    });

    it('rejects a symbol', () => {
      const result = walkPayload({ sym: Symbol('s') }, 'data');
      expect(pathsOf(result)).toEqual(['data.sym']);
      expect(messagesOf(result)[0]).toContain('symbol');
    });

    it('rejects a Map, naming its constructor', () => {
      const result = walkPayload({ m: new Map() }, 'data');
      expect(messagesOf(result)[0]).toContain('Map');
    });

    it('rejects a Set, naming its constructor', () => {
      const result = walkPayload({ s: new Set() }, 'data');
      expect(messagesOf(result)[0]).toContain('Set');
    });

    it('rejects a RegExp, naming its constructor', () => {
      const result = walkPayload({ r: /x/ }, 'data');
      expect(messagesOf(result)[0]).toContain('RegExp');
    });

    it('rejects a class instance, naming its constructor', () => {
      class Widget {
        count = 1;
      }
      const result = walkPayload({ w: new Widget() }, 'data');
      expect(messagesOf(result)[0]).toContain('Widget');
    });

    it('falls back to a generic name for an object with no constructor', () => {
      const result = walkPayload({ o: Object.create(Object.create(null)) }, 'data');
      expect(messagesOf(result)[0]).toContain('object');
    });

    it('reports every rejected value rather than stopping at the first', () => {
      const result = walkPayload(
        { a: 1n, b: () => 'x', c: Number.NaN },
        'data',
      );
      expect(pathsOf(result).sort()).toEqual(['data.a', 'data.b', 'data.c']);
    });
  });

  describe('toJSON', () => {
    it('walks the return value in place of the original', () => {
      const result = walkPayload(
        { at: { toJSON: () => ({ kind: 'resolved' }) } },
        'data',
      );
      expect(result.issues).toEqual([]);
      expect(result.value).toEqual({ at: { kind: 'resolved' } });
    });

    it('finds toJSON inherited through the prototype chain, not only as an own property', () => {
      const when = new Date('2020-01-01T00:00:00.000Z');
      const result = walkPayload({ when }, 'data');
      expect(result.issues).toEqual([]);
      expect(result.value).toEqual({ when: '2020-01-01T00:00:00.000Z' });
    });

    it('honours toJSON at array position', () => {
      const result = walkPayload(
        { xs: [new Date('2020-01-01T00:00:00.000Z')] },
        'data',
      );
      expect(result.value).toEqual({ xs: ['2020-01-01T00:00:00.000Z'] });
    });

    it('rejects a return value that is itself outside the JSON domain, at the same path', () => {
      const result = walkPayload({ bad: { toJSON: () => 1n } }, 'data');
      expect(pathsOf(result)).toEqual(['data.bad']);
      expect(messagesOf(result)[0]).toContain('bigint');
    });

    it('reports a throwing toJSON as an issue rather than letting it escape', () => {
      const result = walkPayload(
        {
          hostile: {
            toJSON() {
              throw new Error('refused');
            },
          },
        },
        'data',
      );
      expect(pathsOf(result)).toEqual(['data.hostile']);
      expect(messagesOf(result)[0]).toContain('toJSON() threw: refused');
    });

    it('reports a non-Error thrown from toJSON', () => {
      const result = walkPayload(
        {
          hostile: {
            toJSON() {
              throw 'a bare string';
            },
          },
        },
        'data',
      );
      expect(messagesOf(result)[0]).toContain('a bare string');
    });

    it('catches a cycle created through toJSON rather than exhausting the stack', () => {
      const looping: Record<string, unknown> = {};
      looping.toJSON = () => ({ back: looping });
      const result = walkPayload({ looping }, 'data');
      expect(messagesOf(result).join(' ')).toContain('circular');
    });

    it('accepts a toJSON-bearing value legitimately repeated in two branches', () => {
      const when = new Date('2020-01-01T00:00:00.000Z');
      const result = walkPayload({ a: when, b: when }, 'data');
      expect(result.issues).toEqual([]);
      expect(result.value).toEqual({
        a: '2020-01-01T00:00:00.000Z',
        b: '2020-01-01T00:00:00.000Z',
      });
    });

    it('does not treat a non-callable toJSON property as a serializer', () => {
      const result = walkPayload({ o: { toJSON: 'not a function' } }, 'data');
      expect(result.issues).toEqual([]);
      expect(result.value).toEqual({ o: { toJSON: 'not a function' } });
    });
  });

  describe('cycle detection', () => {
    it('rejects a self-referential object', () => {
      const cyclic: Record<string, unknown> = { name: 'x' };
      cyclic.self = cyclic;
      const result = walkPayload(cyclic, 'data');
      expect(pathsOf(result)).toEqual(['data.self']);
      expect(messagesOf(result)[0]).toContain('circular');
    });

    it('rejects a self-referential array', () => {
      const xs: unknown[] = [1];
      xs.push(xs);
      const result = walkPayload({ xs }, 'data');
      expect(pathsOf(result)).toEqual(['data.xs[1]']);
    });

    it('rejects a mutual reference between two objects', () => {
      const a: Record<string, unknown> = {};
      const b: Record<string, unknown> = { a };
      a.b = b;
      const result = walkPayload({ a }, 'data');
      expect(messagesOf(result)[0]).toContain('circular');
    });

    it('accepts a value repeated in two branches, which is not a cycle', () => {
      const shared = { id: 1 };
      const result = walkPayload({ left: shared, right: shared }, 'data');
      expect(result.issues).toEqual([]);
      expect(result.value).toEqual({ left: { id: 1 }, right: { id: 1 } });
    });

    it('accepts the same array repeated in two branches', () => {
      const shared = [1, 2];
      const result = walkPayload({ left: shared, right: shared }, 'data');
      expect(result.issues).toEqual([]);
    });
  });

  describe('undefined handling', () => {
    it('omits a map key whose value is undefined', () => {
      const result = walkPayload({ kept: 1, dropped: undefined }, 'data');
      expect(result.issues).toEqual([]);
      expect(Object.keys(result.value)).toEqual(['kept']);
    });

    it('replaces an undefined array element with null, preserving positions', () => {
      const result = walkPayload({ xs: [1, undefined, 3] }, 'data');
      expect(result.issues).toEqual([]);
      expect(result.value).toEqual({ xs: [1, null, 3] });
    });

    it('produces a payload equivalent to serializing the original input', () => {
      const input = { kept: 1, dropped: undefined, xs: [1, undefined, 3] };
      const result = walkPayload(input, 'data');
      expect(result.value).toEqual(JSON.parse(JSON.stringify(input)));
    });
  });

  describe('path reporting', () => {
    it('names the exact path several levels deep, including array indices', () => {
      const result = walkPayload(
        { order: { items: [{ price: 1 }, { price: Number.NaN }] } },
        'data',
      );
      expect(pathsOf(result)).toEqual(['data.order.items[1].price']);
    });

    it('brackets and quotes a key that is not an identifier', () => {
      const result = walkPayload({ 'not-an-identifier': 1n }, 'data');
      expect(pathsOf(result)).toEqual(['data["not-an-identifier"]']);
    });

    it('brackets a key beginning with a digit', () => {
      const result = walkPayload({ '1st': 1n }, 'data');
      expect(pathsOf(result)).toEqual(['data["1st"]']);
    });

    it('leaves an identifier key unbracketed, including $ and _', () => {
      const result = walkPayload({ $_a1: 1n }, 'data');
      expect(pathsOf(result)).toEqual(['data.$_a1']);
    });

    it('uses whatever root path it is given', () => {
      const result = walkPayload({ n: 1n }, 'payload');
      expect(pathsOf(result)).toEqual(['payload.n']);
    });
  });

  describe('nesting and freezing', () => {
    it('accepts several levels of nested objects and arrays without false rejection', () => {
      const deep = { a: [{ b: [{ c: [{ d: 'leaf' }] }] }] };
      const result = walkPayload(deep, 'data');
      expect(result.issues).toEqual([]);
      expect(result.value).toEqual(deep);
    });

    it('freezes the returned object', () => {
      const result = walkPayload({ a: 1 }, 'data');
      expect(Object.isFrozen(result.value)).toBe(true);
    });

    it('freezes a nested object', () => {
      const result = walkPayload({ nested: { a: 1 } }, 'data');
      expect(Object.isFrozen((result.value as { nested: object }).nested)).toBe(
        true,
      );
    });

    it('freezes a nested array', () => {
      const result = walkPayload({ xs: [1, 2] }, 'data');
      expect(Object.isFrozen((result.value as { xs: unknown[] }).xs)).toBe(true);
    });

    it('freezes an object inside an array', () => {
      const result = walkPayload({ xs: [{ a: 1 }] }, 'data');
      const inner = (result.value as { xs: object[] }).xs[0];
      expect(Object.isFrozen(inner)).toBe(true);
    });

    it('returns a copy, leaving the caller"s input unfrozen', () => {
      const input = { a: 1 };
      walkPayload(input, 'data');
      expect(Object.isFrozen(input)).toBe(false);
    });
  });
});

describe('walkFlatMap', () => {
  describe('top-level shape guard', () => {
    it('rejects null', () => {
      const result = walkFlatMap(null, 'baggage');
      expect(pathsOf(result)).toEqual(['baggage']);
      expect(messagesOf(result)[0]).toContain('scalars');
    });

    it('rejects undefined', () => {
      expect(walkFlatMap(undefined, 'baggage').issues).toHaveLength(1);
    });

    it('rejects an array', () => {
      expect(walkFlatMap([], 'baggage').issues).toHaveLength(1);
    });

    it('rejects a string', () => {
      expect(walkFlatMap('x', 'baggage').issues).toHaveLength(1);
    });

    it('rejects a number', () => {
      expect(walkFlatMap(1, 'baggage').issues).toHaveLength(1);
    });

    it('returns a frozen empty map when the top level is rejected', () => {
      const result = walkFlatMap(null, 'baggage');
      expect(result.value).toEqual({});
      expect(Object.isFrozen(result.value)).toBe(true);
    });

    it('accepts an empty map', () => {
      const result = walkFlatMap({}, 'baggage');
      expect(result.issues).toEqual([]);
      expect(result.value).toEqual({});
    });
  });

  describe('accepted scalars', () => {
    it('accepts a string, number, boolean, and null together', () => {
      const input = { s: 'a', n: 1, b: true, nil: null };
      const result = walkFlatMap(input, 'baggage');
      expect(result.issues).toEqual([]);
      expect(result.value).toEqual(input);
    });
  });

  describe('rejected values', () => {
    it('rejects a nested object as nesting rather than as an inner structure', () => {
      const result = walkFlatMap({ nested: { a: 1 } }, 'baggage');
      expect(pathsOf(result)).toEqual(['baggage.nested']);
      expect(messagesOf(result)[0]).toContain('flat');
    });

    it('rejects a nested array', () => {
      const result = walkFlatMap({ xs: [1] }, 'baggage');
      expect(pathsOf(result)).toEqual(['baggage.xs']);
      expect(messagesOf(result)[0]).toContain('flat');
    });

    it('rejects a non-finite number, reported as a number problem not as nesting', () => {
      const result = walkFlatMap({ n: Number.NaN }, 'baggage');
      expect(pathsOf(result)).toEqual(['baggage.n']);
      expect(messagesOf(result)[0]).toContain('finite');
    });

    it('rejects a bigint', () => {
      const result = walkFlatMap({ big: 1n }, 'baggage');
      expect(messagesOf(result)[0]).toContain('bigint');
    });

    it('rejects a function', () => {
      const result = walkFlatMap({ fn: () => 'x' }, 'baggage');
      expect(messagesOf(result)[0]).toContain('function');
    });

    it('rejects a symbol', () => {
      const result = walkFlatMap({ sym: Symbol('s') }, 'baggage');
      expect(messagesOf(result)[0]).toContain('symbol');
    });

    it('reports one issue per rejected entry, not only the first', () => {
      const result = walkFlatMap({ a: { x: 1 }, b: 1n }, 'baggage');
      expect(pathsOf(result).sort()).toEqual(['baggage.a', 'baggage.b']);
    });

    it('does not invoke toJSON — a Date is nesting here, not a serializable value', () => {
      const result = walkFlatMap({ when: new Date() }, 'baggage');
      expect(pathsOf(result)).toEqual(['baggage.when']);
      expect(messagesOf(result)[0]).toContain('flat');
    });
  });

  describe('undefined handling and paths', () => {
    it('omits an entry whose value is undefined', () => {
      const result = walkFlatMap({ kept: 'a', dropped: undefined }, 'baggage');
      expect(result.issues).toEqual([]);
      expect(Object.keys(result.value)).toEqual(['kept']);
    });

    it('brackets a key that is not an identifier', () => {
      const result = walkFlatMap({ 'tenant-id': {} }, 'baggage');
      expect(pathsOf(result)).toEqual(['baggage["tenant-id"]']);
    });

    it('uses whatever root path it is given', () => {
      const result = walkFlatMap({ a: 1n }, 'context');
      expect(pathsOf(result)).toEqual(['context.a']);
    });
  });

  describe('freezing', () => {
    it('freezes the returned map', () => {
      const result = walkFlatMap({ a: 1 }, 'baggage');
      expect(Object.isFrozen(result.value)).toBe(true);
    });

    it('returns a copy, leaving the caller"s input unfrozen', () => {
      const input = { a: 1 };
      walkFlatMap(input, 'baggage');
      expect(Object.isFrozen(input)).toBe(false);
    });
  });
});
