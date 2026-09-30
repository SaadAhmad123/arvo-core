import { describe, expect, it } from 'vitest';
import { checkContract } from '../../../src/ArvoEventHandler/helpers/check-contract.js';
import { orderContract } from './fixtures.js';

describe('checkContract', () => {
  it('accepts a contract', () => {
    expect(checkContract(orderContract)).toEqual([]);
  });

  it.each([
    ['a version rather than a contract', orderContract.versions['1.0.0']],
    ['a plain object', {}],
    ['undefined', undefined],
    ['null', null],
    ['a string', 'com_order_create'],
  ])('refuses %s', (_label, value) => {
    expect(checkContract(value)).toHaveLength(1);
  });

  it('reports against the contract, carrying what was given', () => {
    const [issue] = checkContract(42);
    expect(issue?.path).toBe('contract');
    expect(issue?.received).toBe(42);
  });

  it('blocks, because every other rule reads the contract', () => {
    const [issue] = checkContract({});
    expect(issue?.isBlocking).toBe(true);
    expect(issue?.blockingReason).toContain(
      'every other rule reads the contract',
    );
  });
});
