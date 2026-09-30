import { describe, expect, it } from 'vitest';
import type { ArvoRetryVerdictParam } from '../../../src/ArvoEventHandler/fault/retry.js';
import {
  ARVO_RETRY_SAFE_FAULT_KINDS,
  isRetrySafeFaultKind,
  resolveRetry,
  resolveRetryDelayMs,
} from '../../../src/ArvoEventHandler/fault/retry.js';
import type { ArvoFaultKind } from '../../../src/ArvoEventHandler/fault/types.js';
import type { ArvoRetryDelayFn } from '../../../src/ArvoEventHandler/types/options.js';
import { chargedEvent } from '../fixtures.js';

const verdict = (overrides: Partial<ArvoRetryVerdictParam> = {}) =>
  resolveRetry({
    retrySafe: true,
    attempt: 0,
    maxRetryAttempts: 3,
    retryDelay: 300,
    event: chargedEvent,
    state: null,
    timestamp: 1_700_000_000_000,
    ...overrides,
  });

describe('which faults a redelivery could fix', () => {
  it.each([
    'state_resolution_failed',
    'dependency_resolution_failed',
    'run_timeout',
  ] as ArvoFaultKind[])('treats %s as worth another attempt', (faultKind) => {
    expect(isRetrySafeFaultKind(faultKind, false)).toBe(true);
  });

  it.each([
    'event_unclassifiable',
    'category_mismatch',
    'record_unexpected',
    'record_expected',
    'record_invalid',
    'record_event_unrestorable',
    'version_not_declared',
    'max_depth_event_received',
    'lifecycle_terminal',
    'execution_timeout',
    'event_unaddressed',
    'addressing_mismatch',
    'type_not_receivable',
    'event_schema_rejected',
    'response_unawaited',
    'service_version_conflict',
    'execution_cancelled',
    'emission_not_permitted',
    'emission_schema_rejected',
    'max_depth_event_requested',
    'state_schema_rejected',
    'state_not_serializable',
  ] as ArvoFaultKind[])('treats %s as not worth another', (faultKind) => {
    expect(isRetrySafeFaultKind(faultKind, true)).toBe(false);
  });

  describe('the one kind the vocabulary does not decide', () => {
    it('leaves an executor fault to the executor', () => {
      expect(isRetrySafeFaultKind('executor_raised', true)).toBe(true);
      expect(isRetrySafeFaultKind('executor_raised', false)).toBe(false);
    });

    it('is not among the kinds the vocabulary fixes', () => {
      expect(ARVO_RETRY_SAFE_FAULT_KINDS.has('executor_raised')).toBe(false);
    });
  });
});

describe('how long to wait', () => {
  it('is the figure itself where one was declared', () => {
    expect(resolveRetryDelayMs(500, chargedEvent, null, 0, 3)).toBe(500);
  });

  it('is what the function works out', () => {
    const backoff: ArvoRetryDelayFn = (_event, _state, attempt) =>
      200 * (attempt + 1);
    expect(resolveRetryDelayMs(backoff, chargedEvent, null, 2, 3)).toBe(600);
  });

  it('tells the function everything a backoff can turn on', () => {
    const seen: unknown[] = [];
    const record: ArvoRetryDelayFn = (...args) => {
      seen.push(...args);
      return 1;
    };
    resolveRetryDelayMs(record, chargedEvent, null, 2, 5);
    expect(seen).toEqual([chargedEvent, null, 2, 5]);
  });

  describe('a function that cannot be trusted', () => {
    it('falls back where it throws', () => {
      const broken: ArvoRetryDelayFn = () => {
        throw new Error('no');
      };
      expect(resolveRetryDelayMs(broken, chargedEvent, null, 0, 3)).toBe(300);
    });

    it.each([
      ['nothing at all', undefined],
      ['not a number', 'soon'],
      ['a fraction of a millisecond', 1.5],
      ['a negative wait', -1],
      ['something unmeasurable', Number.NaN],
    ])('falls back where it returns %s', (_label, returned) => {
      // Deliberately not a count of milliseconds: the point of the test.
      const odd = () => returned as unknown as number;
      expect(resolveRetryDelayMs(odd, chargedEvent, null, 0, 3)).toBe(300);
    });
  });
});

describe('what a fault says about another attempt', () => {
  it('says how many this version allows', () => {
    expect(verdict()?.maxRetryAttemptsAllowed).toBe(3);
  });

  it('says how long to wait, and when that lands', () => {
    const retry = verdict({ retryDelay: 5_000 });
    expect(retry?.retryInMs).toBe(5_000);
    expect(retry?.retryAt).toBe(1_700_000_005_000);
  });

  it('says nothing where nothing would fix the failure', () => {
    expect(verdict({ retrySafe: false })).toBeNull();
  });

  describe('once the attempts are spent', () => {
    it('says nothing on the attempt that reaches the limit', () => {
      expect(verdict({ attempt: 3 })).toBeNull();
    });

    it('says nothing past it', () => {
      expect(verdict({ attempt: 9 })).toBeNull();
    });

    it('still says something on the one before', () => {
      expect(verdict({ attempt: 2 })).not.toBeNull();
    });

    it('says nothing at all where none were allowed', () => {
      expect(verdict({ maxRetryAttempts: 0 })).toBeNull();
    });
  });
});
