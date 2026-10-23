import { describe, expect, it } from 'vitest';
import { checkServiceVersions } from '../../../src/ArvoDispatcher/helpers/check-service-versions.js';
import {
  auditCallingOrderHandler,
  auditHandler,
  orderHandler,
  paymentContractElsewhere,
  paymentContractLaterOnly,
  paymentHandler,
  paymentHandlerFor,
  selfCallingAuditHandler,
} from '../fixtures.js';

describe('the service-version rule', () => {
  it('accepts a service implemented here at the version and uri declared', () => {
    expect(checkServiceVersions([orderHandler(), paymentHandler()])).toEqual(
      [],
    );
  });

  it('accepts a service nobody here implements', () => {
    expect(checkServiceVersions([orderHandler(), auditHandler()])).toEqual([]);
  });

  it('accepts two handlers calling each other', () => {
    expect(
      checkServiceVersions([orderHandler(), auditCallingOrderHandler()]),
    ).toEqual([]);
  });

  it('accepts a handler calling itself', () => {
    expect(checkServiceVersions([selfCallingAuditHandler()])).toEqual([]);
  });

  it('refuses a service declared at a version its implementer lacks', () => {
    const [issue] = checkServiceVersions([
      orderHandler(),
      paymentHandlerFor(paymentContractLaterOnly),
    ]);
    expect(issue?.path).toBe(
      'handlers(com_order_create).contracts.services.payments',
    );
    expect(issue?.message).toContain('version 1.0.0');
    expect(issue?.message).toContain('2.0.0');
  });

  it('refuses a service declared under a uri its implementer does not use', () => {
    const [issue] = checkServiceVersions([
      orderHandler(),
      paymentHandlerFor(paymentContractElsewhere),
    ]);
    expect(issue?.message).toContain(paymentContractElsewhere.uri);
    expect(issue?.message).toContain('unclassifiable');
  });
});
