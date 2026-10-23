import { describe, expect, it } from 'vitest';
import { checkCallerName } from '../../../src/ArvoDispatcher/helpers/check-caller-name.js';
import {
  auditCallingOrderHandler,
  auditHandler,
  orderHandler,
  paymentHandler,
} from '../fixtures.js';

describe('the caller-name rules', () => {
  const handlers = [orderHandler(), paymentHandler()];

  it('accepts a well-formed name no handler implements or calls', () => {
    expect(checkCallerName('com_acme_api', handlers)).toEqual([]);
  });

  it.each([
    ['a dot', 'com.acme.api'],
    ['uppercase', 'Com_Acme'],
    ['the empty string', ''],
  ])('refuses a name with %s, naming the grammar', (_description, name) => {
    const [issue] = checkCallerName(name, handlers);
    expect(issue?.message).toContain('single underscores');
  });

  it('refuses something that is not a string', () => {
    expect(checkCallerName(42, handlers)).toHaveLength(1);
  });

  it('refuses a handler’s own type, naming it', () => {
    const [issue] = checkCallerName('com_order_create', [orderHandler()]);
    expect(issue?.message).toContain('a handler here implements');
  });

  it('refuses a service type a handler declares, naming the handler', () => {
    const [issue] = checkCallerName('com_payment_charge', [
      orderHandler(),
      auditHandler(),
    ]);
    expect(issue?.message).toContain('com_order_create');
    expect(issue?.message).toContain('payments');
  });

  it('reports a handler’s own type and another’s service together', () => {
    const issues = checkCallerName('com_order_create', [
      orderHandler(),
      auditCallingOrderHandler(),
    ]);
    expect(issues).toHaveLength(2);
  });
});
