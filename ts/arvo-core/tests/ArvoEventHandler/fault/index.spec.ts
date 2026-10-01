import { describe, expect, it } from 'vitest';
import { ArvoHandlerFault } from '../../../src/ArvoEventHandler/fault/index.js';
import type { ArvoHandlerFaultParam } from '../../../src/ArvoEventHandler/fault/types.js';
import { initEvent } from '../fixtures.js';

const minimal = (overrides: Partial<ArvoHandlerFaultParam> = {}) =>
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
  });

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

  describe('what it says about the execution', () => {
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
    it('carries neither where the execution could address nothing', () => {
      const fault = minimal();
      expect(fault.abandonmentEvent).toBeNull();
      expect(fault.abandonmentState).toBeNull();
    });

    it('carries the event to publish where one could be addressed', () => {
      const written = JSON.stringify(initEvent);
      expect(minimal({ abandonmentEvent: written }).abandonmentEvent).toBe(
        written,
      );
    });

    it('carries the record to commit alongside it', () => {
      const written = JSON.stringify({ lifecycle: 'failure' });
      expect(minimal({ abandonmentState: written }).abandonmentState).toBe(
        written,
      );
    });
  });

  it('cannot be changed once raised', () => {
    const fault = minimal();
    expect(() => {
      (fault as unknown as Record<string, unknown>).faultKind = 'run_timeout';
    }).toThrow();
  });

  describe('writing one out for whatever stores it', () => {
    it('carries what failed, and where', () => {
      const written = minimal({
        cause: 'ZodError',
        violations: ['orderId: expected string'],
      }).toJSON();
      expect(written.name).toBe('ArvoHandlerFault');
      expect(written.faultKind).toBe('state_schema_rejected');
      expect(written.message).toBe('state does not satisfy the schema');
      expect(written.cause).toBe('ZodError');
      expect(written.violations).toEqual(['orderId: expected string']);
    });

    it('carries the execution it happened on', () => {
      const written = minimal().toJSON();
      expect(written.subject).toBe(initEvent.subject);
      expect(written.executionId).toBe(initEvent.executionid);
      expect(written.eventId).toBe(initEvent.id);
      expect(written.attempt).toBe(0);
      expect(written.timestamp).toBe(1_700_000_000_000);
    });

    it('carries when another attempt is due', () => {
      const retry = {
        maxRetryAttemptsAllowed: 3,
        retryInMs: 300,
        retryAt: 1_700_000_000_300,
      };
      expect(minimal({ retry }).toJSON().retry).toEqual(retry);
    });

    it('says none is due where none is', () => {
      expect(minimal().toJSON().retry).toBeNull();
    });

    it('carries its stack, a stored fault without one being worth little', () => {
      expect(typeof minimal().toJSON().stack).toBe('string');
    });

    it('writes no stack as null rather than dropping the field', () => {
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

    it('survives being turned into a string', () => {
      const written = JSON.parse(JSON.stringify(minimal()));
      expect(written.faultKind).toBe('state_schema_rejected');
    });
  });

  describe('the abandonment pair it carries', () => {
    const storedEvent = JSON.stringify(initEvent);
    const storedRecord = JSON.stringify({ lifecycle: 'failure' });

    it('holds both already written out, so nothing is serialized later', () => {
      const fault = minimal({
        abandonmentEvent: storedEvent,
        abandonmentState: storedRecord,
      });
      expect(fault.abandonmentEvent).toBe(storedEvent);
      expect(fault.abandonmentState).toBe(storedRecord);
    });

    it('passes both through untouched when written out', () => {
      const written = minimal({
        abandonmentEvent: storedEvent,
        abandonmentState: storedRecord,
      }).toJSON();
      expect(written.abandonmentEvent).toBe(storedEvent);
      expect(written.abandonmentState).toBe(storedRecord);
    });

    it('says there is nothing to publish where there is not', () => {
      expect(minimal().toJSON().abandonmentEvent).toBeNull();
    });

    it('says there is nothing to commit where there is not', () => {
      expect(minimal().toJSON().abandonmentState).toBeNull();
    });
  });
});
