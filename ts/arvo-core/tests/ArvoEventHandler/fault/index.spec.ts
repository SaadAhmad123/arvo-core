import { describe, expect, it } from 'vitest';
import { ArvoHandlerFault } from '../../../src/ArvoEventHandler/fault/index.js';
import { initEvent } from '../fixtures.js';

const minimal = (overrides: Record<string, unknown> = {}) =>
  new ArvoHandlerFault({
    faultKind: 'state_schema_rejected',
    message: 'state does not satisfy the schema',
    subject: initEvent.subject,
    executionId: initEvent.executionid,
    eventId: initEvent.id,
    attempt: 0,
    cause: null,
    violations: [],
    timestamp: 1_700_000_000_000,
    retry: null,
    abandonmentEvent: null,
    abandonmentState: null,
    ...overrides,
  } as never);

describe('ArvoHandlerFault', () => {
  it('is an Error, so it can be thrown and caught as one', () => {
    expect(minimal()).toBeInstanceOf(Error);
  });

  it('identifies itself by a name a caller can branch on without instanceof', () => {
    const fault = minimal();
    expect(fault.name).toBe('ArvoHandlerFault');
    expect(fault._tag).toBe('ArvoHandlerFault');
  });

  it('says which fault it is', () => {
    expect(minimal().faultKind).toBe('state_schema_rejected');
  });

  it('says what failed, in its message', () => {
    expect(minimal().message).toBe('state does not satisfy the schema');
  });

  describe('what it says about the delivery', () => {
    it('names the workflow, the execution and the event', () => {
      const fault = minimal();
      expect(fault.subject).toBe(initEvent.subject);
      expect(fault.executionId).toBe(initEvent.executionid);
      expect(fault.eventId).toBe(initEvent.id);
    });

    it('allows no execution, where none was resolved', () => {
      expect(minimal({ executionId: null }).executionId).toBeNull();
    });

    it('says which attempt it was', () => {
      expect(minimal({ attempt: 2 }).attempt).toBe(2);
    });

    it('carries when it happened, as the raiser stamped it', () => {
      expect(minimal({ timestamp: 1_700_000_000_500 }).timestamp).toBe(
        1_700_000_000_500,
      );
    });
  });

  describe('cause and violations', () => {
    it('carries no cause where nothing underlies it', () => {
      expect(minimal().cause).toBeNull();
    });

    it('carries an underlying failure as a string, so the whole survives JSON', () => {
      expect(minimal({ cause: 'ZodError: expected string' }).cause).toBe(
        'ZodError: expected string',
      );
    });

    it('carries no violations where none were collected', () => {
      expect(minimal().violations).toEqual([]);
    });

    it('carries every check that failed, not only the first', () => {
      const fault = minimal({
        violations: ['orderId: expected string', 'attempts: required'],
      });
      expect(fault.violations).toHaveLength(2);
    });

    it('copies the violations, so a caller mutating theirs cannot change it', () => {
      const violations = ['one'];
      const fault = minimal({ violations });
      violations.push('two');
      expect(fault.violations).toHaveLength(1);
    });
  });

  describe('retry', () => {
    it('is null where no retry is in prospect', () => {
      expect(minimal().retry).toBeNull();
    });

    it('carries the figures where one is', () => {
      const fault = minimal({
        retry: {
          maxRetryAttemptsAllowed: 3,
          retryInMs: 300,
          retryAt: 1_700_000_000_300,
        },
      });
      expect(fault.retry?.retryInMs).toBe(300);
      expect(fault.retry?.maxRetryAttemptsAllowed).toBe(3);
    });
  });

  describe('the abandonment pair', () => {
    it('carries neither where the delivery could address nothing', () => {
      const fault = minimal();
      expect(fault.abandonmentEvent).toBeNull();
      expect(fault.abandonmentState).toBeNull();
    });

    it('carries the event to publish where one could be addressed', () => {
      expect(minimal({ abandonmentEvent: initEvent }).abandonmentEvent).toBe(
        initEvent,
      );
    });

    it('carries the record to commit alongside it', () => {
      const record = { lifecycle: 'failure' };
      expect(minimal({ abandonmentState: record }).abandonmentState).toBe(
        record,
      );
    });
  });

  it('cannot be changed once raised', () => {
    const fault = minimal();
    expect(() => {
      (fault as unknown as Record<string, unknown>).faultKind = 'run_timeout';
    }).toThrow();
  });

  describe('as a stored fault', () => {
    it('survives JSON, because a mechanism may dead-letter it', () => {
      const fault = minimal({
        cause: 'ZodError',
        violations: ['orderId: expected string'],
        retry: { maxRetryAttemptsAllowed: 3, retryInMs: 300, retryAt: 1 },
      });
      const stored = JSON.parse(JSON.stringify(fault));
      expect(stored.name).toBe('ArvoHandlerFault');
      expect(stored.faultKind).toBe('state_schema_rejected');
      expect(stored.subject).toBe(initEvent.subject);
      expect(stored.violations).toEqual(['orderId: expected string']);
      expect(stored.retry.retryInMs).toBe(300);
    });

    it('carries the abandonment event, so a mechanism can publish what was stored', () => {
      const stored = minimal({ abandonmentEvent: initEvent }).toJSON();
      expect((stored.abandonmentEvent as Record<string, unknown>).id).toBe(
        initEvent.id,
      );
    });

    it('serializes no stack as null rather than dropping the field', () => {
      const stackless = Object.create(ArvoHandlerFault.prototype, {
        stack: { value: undefined },
        name: { value: 'ArvoHandlerFault' },
        faultKind: { value: 'state_schema_rejected' },
        message: { value: 'no stack here' },
        cause: { value: null },
        violations: { value: [] },
        subject: { value: 's' },
        executionId: { value: null },
        eventId: { value: 'e' },
        attempt: { value: 0 },
        timestamp: { value: 1 },
        retry: { value: null },
        abandonmentEvent: { value: null },
        abandonmentState: { value: null },
      }) as ArvoHandlerFault;
      expect(stackless.toJSON().stack).toBeNull();
    });

    it('carries its stack where the runtime gave it one', () => {
      expect(
        typeof minimal().stack === 'string' || minimal().stack === null,
      ).toBe(true);
    });
  });
});
