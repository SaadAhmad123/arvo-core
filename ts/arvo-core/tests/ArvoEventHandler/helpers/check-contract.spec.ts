import { describe, expect, it } from 'vitest';
import { checkContract } from '../../../src/ArvoEventHandler/helpers/check-contract.js';
import { orderContract, orderVersion } from '../fixtures.js';

describe('the contract a handler implements', () => {
  it('accepts a contract', () => {
    expect(checkContract(orderContract)).toEqual([]);
  });

  it('refuses a version of one, a handler implementing the whole contract', () => {
    expect(checkContract(orderVersion)).toHaveLength(1);
  });

  it('refuses something that is not a contract at all', () => {
    expect(checkContract({ type: 'com_order_create' })).toHaveLength(1);
    expect(checkContract(null)).toHaveLength(1);
    expect(checkContract(undefined)).toHaveLength(1);
  });
});

describe('what a refusal tells the reader', () => {
  const [issue] = checkContract('com_order_create');

  it('names the field it is about', () => {
    expect(issue?.path).toBe('contract');
  });

  it('shows what was given instead', () => {
    expect(issue?.received).toBe('com_order_create');
  });

  it('stops the remaining rules, which all read the contract', () => {
    expect(issue?.isBlocking).toBe(true);
    expect(issue?.blockingReason).toContain('version');
  });
});
