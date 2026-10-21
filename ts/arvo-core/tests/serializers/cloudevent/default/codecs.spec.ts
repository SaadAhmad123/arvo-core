import { describe, expect, it } from 'vitest';
import { DepthCodec } from '../../../../src/serializers/cloudevent/default/codecs/depth.js';
import { ExecutionUnitsCodec } from '../../../../src/serializers/cloudevent/default/codecs/execution-units.js';

describe('DepthCodec', () => {
  const codec = new DepthCodec();

  describe('encode', () => {
    it.each([0, 1, 2, 42, 1000000, Number.MAX_SAFE_INTEGER])(
      'encodes %i to its plain decimal string',
      (depth) => {
        expect(codec.encode(depth)).toBe(depth.toString());
      },
    );

    it('never emits exponential notation for a very large integer', () => {
      const hugeDepth = 10 ** 25;
      expect(codec.encode(hugeDepth)).not.toMatch(/e/i);
      expect(codec.encode(hugeDepth)).toMatch(/^[1-9][0-9]*$/);
    });
  });

  describe('decode', () => {
    it.each(['0', '1', '42', '1000000'])(
      'decodes canonical %s to its numeric value',
      (encoding) => {
        expect(codec.decode(encoding)).toBe(Number(encoding));
      },
    );

    it.each([
      '-1',
      '01',
      '00',
      '1.0',
      '1e1',
      '1E1',
      ' 1',
      '1 ',
      '',
      '+1',
      'abc',
      '1.',
      '.1',
    ])('rejects the non-canonical encoding %j', (encoding) => {
      expect(codec.decode(encoding)).toBeNull();
    });

    it('round-trips 0 exactly', () => {
      expect(codec.decode(codec.encode(0))).toBe(0);
    });

    it('round-trips a large safe integer exactly', () => {
      const depth = Number.MAX_SAFE_INTEGER;
      expect(codec.decode(codec.encode(depth))).toBe(depth);
    });
  });
});

describe('ExecutionUnitsCodec', () => {
  const codec = new ExecutionUnitsCodec();

  describe('encode', () => {
    it.each([
      0,
      1,
      -1,
      0.5,
      -3.25,
      1e21,
      Number.MAX_SAFE_INTEGER,
      Number.MIN_SAFE_INTEGER,
    ])('encodes %s via JSON.stringify', (executionUnits) => {
      expect(codec.encode(executionUnits)).toBe(JSON.stringify(executionUnits));
    });
  });

  describe('decode', () => {
    it.each([
      '0',
      '1',
      '-1',
      '0.5',
      '-3.25',
      '1e+21',
      String(Number.MAX_SAFE_INTEGER),
    ])('decodes canonical %s to its numeric value', (encoding) => {
      expect(codec.decode(encoding)).toBe(Number(encoding));
    });

    it.each([
      '1.50',
      '01',
      '1.0',
      '+1',
      ' 1',
      '1 ',
      '',
      'abc',
      'Infinity',
      '-Infinity',
      'NaN',
    ])('rejects the non-canonical or non-finite encoding %j', (encoding) => {
      expect(codec.decode(encoding)).toBeNull();
    });

    it('round-trips 0 exactly', () => {
      expect(codec.decode(codec.encode(0))).toBe(0);
    });

    it('round-trips -0 by canonicalizing it to 0 (RFC 8785 behavior)', () => {
      expect(codec.encode(-0)).toBe('0');
      expect(Object.is(codec.decode(codec.encode(-0)), 0)).toBe(true);
    });

    it('round-trips a fractional value exactly', () => {
      const executionUnits = 12.375;
      expect(codec.decode(codec.encode(executionUnits))).toBe(executionUnits);
    });

    it('round-trips a large-magnitude value exactly', () => {
      expect(codec.decode(codec.encode(1e300))).toBe(1e300);
    });
  });
});
