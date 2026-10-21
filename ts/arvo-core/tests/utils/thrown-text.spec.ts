import { describe, expect, it } from 'vitest';
import { textOfThrown } from '../../src/utils/thrown-text.js';

describe('textOfThrown', () => {
  it('reads an Error as its message', () => {
    expect(textOfThrown(new TypeError('bad input'))).toBe('bad input');
  });

  it.each([
    ['a string', 'plain text', 'plain text'],
    ['a number', 42, '42'],
    ['undefined', undefined, 'undefined'],
    ['null', null, 'null'],
    ['a Symbol', Symbol('thrown'), 'Symbol(thrown)'],
  ])('renders %s as text', (_label, thrownValue, expectedText) => {
    expect(textOfThrown(thrownValue)).toBe(expectedText);
  });

  it('describes a null-prototype object, which has no text of its own', () => {
    expect(textOfThrown(Object.create(null))).toBe('{}');
  });

  it('describes an object whose toString throws', () => {
    const hostileValue = {
      reason: 'hidden',
      toString() {
        throw new Error('no text');
      },
    };
    expect(textOfThrown(hostileValue)).toBe('{"reason":"hidden"}');
  });

  it('still answers for an Error whose message cannot be read', () => {
    const unreadableError = Object.defineProperty(new Error('x'), 'message', {
      get() {
        throw new Error('message unreadable');
      },
    });
    expect(textOfThrown(unreadableError)).toBe(
      'a thrown value that could not be turned into text',
    );
  });
});
