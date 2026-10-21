import { describe, expect, it } from 'vitest';
import { walkFlatMap, walkPayload } from '../../src/ArvoEvent/json.js';

const issuePaths = (walkResult: { issues: { path: string }[] }): string[] =>
  walkResult.issues.map((issue) => issue.path);

const issueMessages = (walkResult: {
  issues: { message: string }[];
}): string[] => walkResult.issues.map((issue) => issue.message);

describe('walkPayload', () => {
  describe('top-level shape guard', () => {
    it('rejects null', () => {
      const walkResult = walkPayload(null, 'data');
      expect(issuePaths(walkResult)).toEqual(['data']);
      expect(issueMessages(walkResult)[0]).toContain(
        'must be an object of JSON values',
      );
    });

    it('rejects undefined', () => {
      expect(walkPayload(undefined, 'data').issues).toHaveLength(1);
    });

    it('rejects an array, because a payload"s keys are what a contract names', () => {
      const walkResult = walkPayload([1, 2], 'data');
      expect(issuePaths(walkResult)).toEqual(['data']);
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
      const walkResult = walkPayload(null, 'data');
      expect(walkResult.value).toEqual({});
      expect(Object.isFrozen(walkResult.value)).toBe(true);
    });

    it('accepts an empty object', () => {
      const walkResult = walkPayload({}, 'data');
      expect(walkResult.issues).toEqual([]);
      expect(walkResult.value).toEqual({});
    });

    it('accepts an object created with a null prototype', () => {
      const nullPrototypeObject = Object.create(null);
      nullPrototypeObject.a = 1;
      expect(walkPayload(nullPrototypeObject, 'data').issues).toEqual([]);
    });
  });

  describe('rejected value classes, one case each', () => {
    it('rejects NaN', () => {
      const walkResult = walkPayload({ n: Number.NaN }, 'data');
      expect(issuePaths(walkResult)).toEqual(['data.n']);
      expect(issueMessages(walkResult)[0]).toContain('finite');
    });

    it('rejects Infinity', () => {
      expect(
        walkPayload({ n: Number.POSITIVE_INFINITY }, 'data').issues,
      ).toHaveLength(1);
    });

    it('rejects -Infinity', () => {
      expect(
        walkPayload({ n: Number.NEGATIVE_INFINITY }, 'data').issues,
      ).toHaveLength(1);
    });

    it('rejects a bigint as a map value', () => {
      const walkResult = walkPayload({ big: 1n }, 'data');
      expect(issuePaths(walkResult)).toEqual(['data.big']);
      expect(issueMessages(walkResult)[0]).toContain('bigint');
    });

    it('rejects a bigint as an array element', () => {
      const walkResult = walkPayload({ xs: [1n] }, 'data');
      expect(issuePaths(walkResult)).toEqual(['data.xs[0]']);
    });

    it('rejects a function', () => {
      const walkResult = walkPayload({ fn: () => 'x' }, 'data');
      expect(issuePaths(walkResult)).toEqual(['data.fn']);
      expect(issueMessages(walkResult)[0]).toContain('function');
    });

    it('rejects a symbol', () => {
      const walkResult = walkPayload({ sym: Symbol('s') }, 'data');
      expect(issuePaths(walkResult)).toEqual(['data.sym']);
      expect(issueMessages(walkResult)[0]).toContain('symbol');
    });

    it('rejects a Map, naming its constructor', () => {
      const walkResult = walkPayload({ m: new Map() }, 'data');
      expect(issueMessages(walkResult)[0]).toContain('Map');
    });

    it('rejects a Set, naming its constructor', () => {
      const walkResult = walkPayload({ s: new Set() }, 'data');
      expect(issueMessages(walkResult)[0]).toContain('Set');
    });

    it('rejects a RegExp, naming its constructor', () => {
      const walkResult = walkPayload({ r: /x/ }, 'data');
      expect(issueMessages(walkResult)[0]).toContain('RegExp');
    });

    it('rejects a class instance, naming its constructor', () => {
      class Widget {
        count = 1;
      }
      const walkResult = walkPayload({ w: new Widget() }, 'data');
      expect(issueMessages(walkResult)[0]).toContain('Widget');
    });

    it('falls back to a generic name for an object with no constructor', () => {
      const walkResult = walkPayload(
        { o: Object.create(Object.create(null)) },
        'data',
      );
      expect(issueMessages(walkResult)[0]).toContain('object');
    });

    it('reports every rejected value rather than stopping at the first', () => {
      const walkResult = walkPayload(
        { a: 1n, b: () => 'x', c: Number.NaN },
        'data',
      );
      expect(issuePaths(walkResult).sort()).toEqual([
        'data.a',
        'data.b',
        'data.c',
      ]);
    });
  });

  describe('toJSON', () => {
    it('walks the return value in place of the original', () => {
      const walkResult = walkPayload(
        { at: { toJSON: () => ({ kind: 'resolved' }) } },
        'data',
      );
      expect(walkResult.issues).toEqual([]);
      expect(walkResult.value).toEqual({ at: { kind: 'resolved' } });
    });

    it('finds toJSON inherited through the prototype chain, not only as an own property', () => {
      const date = new Date('2020-01-01T00:00:00.000Z');
      const walkResult = walkPayload({ when: date }, 'data');
      expect(walkResult.issues).toEqual([]);
      expect(walkResult.value).toEqual({ when: '2020-01-01T00:00:00.000Z' });
    });

    it('honours toJSON at array position', () => {
      const walkResult = walkPayload(
        { xs: [new Date('2020-01-01T00:00:00.000Z')] },
        'data',
      );
      expect(walkResult.value).toEqual({ xs: ['2020-01-01T00:00:00.000Z'] });
    });

    it('rejects a return value that is itself outside the JSON domain, at the same path', () => {
      const walkResult = walkPayload({ bad: { toJSON: () => 1n } }, 'data');
      expect(issuePaths(walkResult)).toEqual(['data.bad']);
      expect(issueMessages(walkResult)[0]).toContain('bigint');
    });

    it('reports a throwing toJSON as an issue rather than letting it escape', () => {
      const walkResult = walkPayload(
        {
          hostile: {
            toJSON() {
              throw new Error('refused');
            },
          },
        },
        'data',
      );
      expect(issuePaths(walkResult)).toEqual(['data.hostile']);
      expect(issueMessages(walkResult)[0]).toContain('toJSON() threw: refused');
    });

    it('reports a non-Error thrown from toJSON', () => {
      const walkResult = walkPayload(
        {
          hostile: {
            toJSON() {
              throw 'a bare string';
            },
          },
        },
        'data',
      );
      expect(issueMessages(walkResult)[0]).toContain('a bare string');
    });

    it('reports a value thrown from toJSON that has no text of its own', () => {
      const walkResult = walkPayload(
        {
          hostile: {
            toJSON() {
              throw Object.create(null);
            },
          },
        },
        'data',
      );
      expect(issueMessages(walkResult)[0]).toContain('toJSON() threw');
    });

    it('catches a cycle created through toJSON rather than exhausting the stack', () => {
      const loopingObject: Record<string, unknown> = {};
      loopingObject.toJSON = () => ({ back: loopingObject });
      const walkResult = walkPayload({ looping: loopingObject }, 'data');
      expect(issueMessages(walkResult).join(' ')).toContain('circular');
    });

    it('accepts a toJSON-bearing value legitimately repeated in two branches', () => {
      const date = new Date('2020-01-01T00:00:00.000Z');
      const walkResult = walkPayload({ a: date, b: date }, 'data');
      expect(walkResult.issues).toEqual([]);
      expect(walkResult.value).toEqual({
        a: '2020-01-01T00:00:00.000Z',
        b: '2020-01-01T00:00:00.000Z',
      });
    });

    it('does not treat a non-callable toJSON property as a serializer', () => {
      const walkResult = walkPayload(
        { o: { toJSON: 'not a function' } },
        'data',
      );
      expect(walkResult.issues).toEqual([]);
      expect(walkResult.value).toEqual({ o: { toJSON: 'not a function' } });
    });
  });

  describe('cycle detection', () => {
    it('rejects a self-referential object', () => {
      const cyclicObject: Record<string, unknown> = { name: 'x' };
      cyclicObject.self = cyclicObject;
      const walkResult = walkPayload(cyclicObject, 'data');
      expect(issuePaths(walkResult)).toEqual(['data.self']);
      expect(issueMessages(walkResult)[0]).toContain('circular');
    });

    it('rejects a self-referential array', () => {
      const cyclicArray: unknown[] = [1];
      cyclicArray.push(cyclicArray);
      const walkResult = walkPayload({ xs: cyclicArray }, 'data');
      expect(issuePaths(walkResult)).toEqual(['data.xs[1]']);
    });

    it('rejects a mutual reference between two objects', () => {
      const cycleStart: Record<string, unknown> = {};
      const cycleEnd: Record<string, unknown> = { a: cycleStart };
      cycleStart.b = cycleEnd;
      const walkResult = walkPayload({ a: cycleStart }, 'data');
      expect(issueMessages(walkResult)[0]).toContain('circular');
    });

    it('accepts a value repeated in two branches, which is not a cycle', () => {
      const sharedReference = { id: 1 };
      const walkResult = walkPayload(
        { left: sharedReference, right: sharedReference },
        'data',
      );
      expect(walkResult.issues).toEqual([]);
      expect(walkResult.value).toEqual({ left: { id: 1 }, right: { id: 1 } });
    });

    it('accepts the same array repeated in two branches', () => {
      const sharedReference = [1, 2];
      const walkResult = walkPayload(
        { left: sharedReference, right: sharedReference },
        'data',
      );
      expect(walkResult.issues).toEqual([]);
    });
  });

  describe('undefined handling', () => {
    it('omits a map key whose value is undefined', () => {
      const walkResult = walkPayload({ kept: 1, dropped: undefined }, 'data');
      expect(walkResult.issues).toEqual([]);
      expect(Object.keys(walkResult.value)).toEqual(['kept']);
    });

    it('replaces an undefined array element with null, preserving positions', () => {
      const walkResult = walkPayload({ xs: [1, undefined, 3] }, 'data');
      expect(walkResult.issues).toEqual([]);
      expect(walkResult.value).toEqual({ xs: [1, null, 3] });
    });

    it('produces a payload equivalent to serializing the original input', () => {
      const payload = { kept: 1, dropped: undefined, xs: [1, undefined, 3] };
      const walkResult = walkPayload(payload, 'data');
      expect(walkResult.value).toEqual(JSON.parse(JSON.stringify(payload)));
    });
  });

  describe('path reporting', () => {
    it('names the exact path several levels deep, including array indices', () => {
      const walkResult = walkPayload(
        { order: { items: [{ price: 1 }, { price: Number.NaN }] } },
        'data',
      );
      expect(issuePaths(walkResult)).toEqual(['data.order.items[1].price']);
    });

    it('brackets and quotes a key that is not an identifier', () => {
      const walkResult = walkPayload({ 'not-an-identifier': 1n }, 'data');
      expect(issuePaths(walkResult)).toEqual(['data["not-an-identifier"]']);
    });

    it('brackets a key beginning with a digit', () => {
      const walkResult = walkPayload({ '1st': 1n }, 'data');
      expect(issuePaths(walkResult)).toEqual(['data["1st"]']);
    });

    it('leaves an identifier key unbracketed, including $ and _', () => {
      const walkResult = walkPayload({ $_a1: 1n }, 'data');
      expect(issuePaths(walkResult)).toEqual(['data.$_a1']);
    });

    it('uses whatever root path it is given', () => {
      const walkResult = walkPayload({ n: 1n }, 'payload');
      expect(issuePaths(walkResult)).toEqual(['payload.n']);
    });
  });

  describe('nesting and freezing', () => {
    it('accepts several levels of nested objects and arrays without false rejection', () => {
      const deepPayload = { a: [{ b: [{ c: [{ d: 'leaf' }] }] }] };
      const walkResult = walkPayload(deepPayload, 'data');
      expect(walkResult.issues).toEqual([]);
      expect(walkResult.value).toEqual(deepPayload);
    });

    it('freezes the returned object', () => {
      const walkResult = walkPayload({ a: 1 }, 'data');
      expect(Object.isFrozen(walkResult.value)).toBe(true);
    });

    it('freezes a nested object', () => {
      const walkResult = walkPayload({ nested: { a: 1 } }, 'data');
      expect(
        Object.isFrozen((walkResult.value as { nested: object }).nested),
      ).toBe(true);
    });

    it('freezes a nested array', () => {
      const walkResult = walkPayload({ xs: [1, 2] }, 'data');
      expect(Object.isFrozen((walkResult.value as { xs: unknown[] }).xs)).toBe(
        true,
      );
    });

    it('freezes an object inside an array', () => {
      const walkResult = walkPayload({ xs: [{ a: 1 }] }, 'data');
      const nestedObject = (walkResult.value as { xs: object[] }).xs[0];
      expect(Object.isFrozen(nestedObject)).toBe(true);
    });

    it('returns a copy, leaving the caller"s input unfrozen', () => {
      const payload = { a: 1 };
      walkPayload(payload, 'data');
      expect(Object.isFrozen(payload)).toBe(false);
    });
  });
});

describe('walkFlatMap', () => {
  describe('top-level shape guard', () => {
    it('rejects null', () => {
      const walkResult = walkFlatMap(null, 'baggage');
      expect(issuePaths(walkResult)).toEqual(['baggage']);
      expect(issueMessages(walkResult)[0]).toContain('scalars');
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
      const walkResult = walkFlatMap(null, 'baggage');
      expect(walkResult.value).toEqual({});
      expect(Object.isFrozen(walkResult.value)).toBe(true);
    });

    it('accepts an empty map', () => {
      const walkResult = walkFlatMap({}, 'baggage');
      expect(walkResult.issues).toEqual([]);
      expect(walkResult.value).toEqual({});
    });
  });

  describe('accepted scalars', () => {
    it('accepts a string, number, boolean, and null together', () => {
      const flatMap = { s: 'a', n: 1, b: true, nil: null };
      const walkResult = walkFlatMap(flatMap, 'baggage');
      expect(walkResult.issues).toEqual([]);
      expect(walkResult.value).toEqual(flatMap);
    });
  });

  describe('rejected values', () => {
    it('rejects a nested object as nesting rather than as an inner structure', () => {
      const walkResult = walkFlatMap({ nested: { a: 1 } }, 'baggage');
      expect(issuePaths(walkResult)).toEqual(['baggage.nested']);
      expect(issueMessages(walkResult)[0]).toContain('flat');
    });

    it('rejects a nested array', () => {
      const walkResult = walkFlatMap({ xs: [1] }, 'baggage');
      expect(issuePaths(walkResult)).toEqual(['baggage.xs']);
      expect(issueMessages(walkResult)[0]).toContain('flat');
    });

    it('rejects a non-finite number, reported as a number problem not as nesting', () => {
      const walkResult = walkFlatMap({ n: Number.NaN }, 'baggage');
      expect(issuePaths(walkResult)).toEqual(['baggage.n']);
      expect(issueMessages(walkResult)[0]).toContain('finite');
    });

    it('rejects a bigint', () => {
      const walkResult = walkFlatMap({ big: 1n }, 'baggage');
      expect(issueMessages(walkResult)[0]).toContain('bigint');
    });

    it('rejects a function', () => {
      const walkResult = walkFlatMap({ fn: () => 'x' }, 'baggage');
      expect(issueMessages(walkResult)[0]).toContain('function');
    });

    it('rejects a symbol', () => {
      const walkResult = walkFlatMap({ sym: Symbol('s') }, 'baggage');
      expect(issueMessages(walkResult)[0]).toContain('symbol');
    });

    it('reports one issue per rejected entry, not only the first', () => {
      const walkResult = walkFlatMap({ a: { x: 1 }, b: 1n }, 'baggage');
      expect(issuePaths(walkResult).sort()).toEqual(['baggage.a', 'baggage.b']);
    });

    it('does not invoke toJSON — a Date is nesting here, not a serializable value', () => {
      const walkResult = walkFlatMap({ when: new Date() }, 'baggage');
      expect(issuePaths(walkResult)).toEqual(['baggage.when']);
      expect(issueMessages(walkResult)[0]).toContain('flat');
    });
  });

  describe('undefined handling and paths', () => {
    it('omits an entry whose value is undefined', () => {
      const walkResult = walkFlatMap(
        { kept: 'a', dropped: undefined },
        'baggage',
      );
      expect(walkResult.issues).toEqual([]);
      expect(Object.keys(walkResult.value)).toEqual(['kept']);
    });

    it('brackets a key that is not an identifier', () => {
      const walkResult = walkFlatMap({ 'tenant-id': {} }, 'baggage');
      expect(issuePaths(walkResult)).toEqual(['baggage["tenant-id"]']);
    });

    it('uses whatever root path it is given', () => {
      const walkResult = walkFlatMap({ a: 1n }, 'context');
      expect(issuePaths(walkResult)).toEqual(['context.a']);
    });
  });

  describe('freezing', () => {
    it('freezes the returned map', () => {
      const walkResult = walkFlatMap({ a: 1 }, 'baggage');
      expect(Object.isFrozen(walkResult.value)).toBe(true);
    });

    it('returns a copy, leaving the caller"s input unfrozen', () => {
      const flatMap = { a: 1 };
      walkFlatMap(flatMap, 'baggage');
      expect(Object.isFrozen(flatMap)).toBe(false);
    });
  });
});
