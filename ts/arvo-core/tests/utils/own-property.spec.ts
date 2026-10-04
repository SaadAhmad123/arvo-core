import { describe, expect, it } from 'vitest';
import { readOwnProperty } from '../../src/utils/own-property.js';

describe('reading a map by a key from outside', () => {
  const declared = { '1.0.0': 'first', '1.1.0': 'second' };

  it('finds what the map holds itself', () => {
    expect(readOwnProperty(declared, '1.0.0')).toBe('first');
  });

  it('finds nothing for a key the map never held', () => {
    expect(readOwnProperty(declared, '9.9.9')).toBeNull();
  });

  it('finds nothing for a property every object inherits', () => {
    for (const inherited of [
      '__proto__',
      'constructor',
      'toString',
      'hasOwnProperty',
      'valueOf',
    ]) {
      expect(
        readOwnProperty(declared, inherited),
        `${inherited} resolved to something nobody declared`,
      ).toBeNull();
    }
  });

  it('finds a key a map genuinely declares under one of those names', () => {
    expect(readOwnProperty({ constructor: 'mine' }, 'constructor')).toBe(
      'mine',
    );
  });

  it('finds nothing in a map that holds nothing', () => {
    expect(readOwnProperty({}, 'anything')).toBeNull();
  });
});
