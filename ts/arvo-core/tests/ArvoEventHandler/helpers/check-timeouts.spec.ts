import { describe, expect, it } from 'vitest';
import { checkTimeouts } from '../../../src/ArvoEventHandler/helpers/check-timeouts.js';
import { DEFAULT_OPTIONS } from '../../../src/ArvoEventHandler/helpers/defaults.js';
import { resolveOptions } from '../../../src/ArvoEventHandler/helpers/resolve-options.js';

const inForce = (runTimeout: number | null, executionTimeout: number | null) =>
  resolveOptions({ runTimeout, executionTimeout }, DEFAULT_OPTIONS);

const check = (run: number | null, execution: number | null) =>
  checkTimeouts(inForce(run, execution), 'versions["1.0.0"].options');

describe('checkTimeouts', () => {
  describe('what is allowed', () => {
    it('allows an unbounded execution against a bounded run', () => {
      expect(check(10_000, null)).toEqual([]);
    });

    it('allows both unbounded', () => {
      expect(check(null, null)).toEqual([]);
    });

    it('allows an execution above the run', () => {
      expect(check(10_000, 86_400_000)).toEqual([]);
    });

    it('allows the two being equal, one attempt filling the whole execution', () => {
      expect(check(10_000, 10_000)).toEqual([]);
    });
  });

  describe('what is refused', () => {
    it('refuses an execution below the run, naming the run in force', () => {
      const issues = check(30_000, 5_000);
      expect(issues).toHaveLength(1);
      expect(issues[0]?.message).toContain('30000ms');
      expect(issues[0]?.received).toBe(5_000);
    });

    it('refuses a bounded execution against an unbounded run', () => {
      const issues = check(null, 5_000);
      expect(issues).toHaveLength(1);
      expect(issues[0]?.message).toContain('must be null');
    });

    it('reports against the execution timeout, which is the one to change', () => {
      expect(check(30_000, 5_000)[0]?.path).toBe(
        'versions["1.0.0"].options.executionTimeout',
      );
    });

    it('reports nothing as blocking, so other rules still run', () => {
      expect(check(30_000, 5_000)[0]?.isBlocking).toBe(false);
    });
  });

  it('judges the resolved pair, so the two halves may be declared apart', () => {
    const handler = resolveOptions({ runTimeout: 30_000 }, DEFAULT_OPTIONS);
    const version = resolveOptions({ executionTimeout: 5_000 }, handler);
    expect(checkTimeouts(version, 'v')).toHaveLength(1);
  });
});
