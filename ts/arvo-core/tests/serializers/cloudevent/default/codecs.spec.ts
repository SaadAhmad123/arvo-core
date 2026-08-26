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
      const huge = 10 ** 25;
      expect(codec.encode(huge)).not.toMatch(/e/i);
      expect(codec.encode(huge)).toMatch(/^[1-9][0-9]*$/);
    });
  });

  describe('decode', () => {
    it.each(['0', '1', '42', '1000000'])(
      'decodes canonical %s to its numeric value',
      (value) => {
        expect(codec.decode(value)).toBe(Number(value));
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
    ])('rejects the non-canonical encoding %j', (value) => {
      expect(codec.decode(value)).toBeNull();
    });

    it('round-trips 0 exactly', () => {
      expect(codec.decode(codec.encode(0))).toBe(0);
    });

    it('round-trips a large safe integer exactly', () => {
      const value = Number.MAX_SAFE_INTEGER;
      expect(codec.decode(codec.encode(value))).toBe(value);
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
    ])('encodes %s via JSON.stringify', (value) => {
      expect(codec.encode(value)).toBe(JSON.stringify(value));
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
    ])('decodes canonical %s to its numeric value', (value) => {
      expect(codec.decode(value)).toBe(Number(value));
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
    ])('rejects the non-canonical or non-finite encoding %j', (value) => {
      expect(codec.decode(value)).toBeNull();
    });

    it('round-trips 0 exactly', () => {
      expect(codec.decode(codec.encode(0))).toBe(0);
    });

    it('round-trips -0 by canonicalizing it to 0 (RFC 8785 behavior)', () => {
      expect(codec.encode(-0)).toBe('0');
      expect(Object.is(codec.decode(codec.encode(-0)), 0)).toBe(true);
    });

    it('round-trips a fractional value exactly', () => {
      const value = 12.375;
      expect(codec.decode(codec.encode(value))).toBe(value);
    });

    it('round-trips a large-magnitude value exactly', () => {
      expect(codec.decode(codec.encode(1e300))).toBe(1e300);
    });
  });
});
