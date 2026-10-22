import { describe, expect, it } from 'vitest';
import {
  CONTRACT_IDENTIFIER_GRAMMAR,
  isContractIdentifier,
} from '../../src/ArvoContract/identifier.js';

describe('the contract-declared identifier grammar', () => {
  it.each(['com_order_create', 'a', 'a1_b2', '0_9', 'order'])(
    'accepts %s: lowercase alphanumeric segments joined by single underscores',
    (identifier) => {
      expect(isContractIdentifier(identifier)).toBe(true);
    },
  );

  it.each([
    ['uppercase', 'Com_Order'],
    ['a leading underscore', '_order'],
    ['a trailing underscore', 'order_'],
    ['a doubled underscore', 'com__order'],
    ['a dot', 'com.order'],
    ['a hyphen', 'com-order'],
    ['a space', 'com order'],
    ['the empty string', ''],
  ])('refuses %s', (_description, identifier) => {
    expect(isContractIdentifier(identifier)).toBe(false);
  });

  it('is one grammar, exposed as the expression the predicate tests', () => {
    expect(CONTRACT_IDENTIFIER_GRAMMAR.test('com_order_create')).toBe(true);
    expect(CONTRACT_IDENTIFIER_GRAMMAR.test('Com')).toBe(false);
  });
});
