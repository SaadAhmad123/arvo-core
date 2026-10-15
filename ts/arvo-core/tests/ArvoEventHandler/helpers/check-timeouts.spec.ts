import { describe, expect, it } from 'vitest';
import { checkTimeouts } from '../../../src/ArvoEventHandler/helpers/check-timeouts.js';
import { ARVO_DEFAULT_HANDLER_OPTIONS } from '../../../src/ArvoEventHandler/helpers/defaults.js';
import type { ArvoEventHandlerOptions } from '../../../src/ArvoEventHandler/types/options.js';

/** The two clocks in force, with every other option left as it comes. */
const inForce = (
  runTimeout: number | null,
  executionTimeout: number | null,
): ArvoEventHandlerOptions => ({
  ...ARVO_DEFAULT_HANDLER_OPTIONS,
  runTimeout,
  executionTimeout,
});

describe('the pair a version can be run under', () => {
  it('allows an execution clock above the run clock', () => {
    expect(checkTimeouts(inForce(1_000, 60_000), 'versions.1.0.0')).toEqual([]);
  });

  it('allows the two equal, the execution being exactly one attempt long', () => {
    expect(checkTimeouts(inForce(1_000, 1_000), 'versions.1.0.0')).toEqual([]);
  });

  it('allows an unbounded execution under a bounded attempt', () => {
    expect(checkTimeouts(inForce(1_000, null), 'versions.1.0.0')).toEqual([]);
  });

  it('allows both unbounded', () => {
    expect(checkTimeouts(inForce(null, null), 'versions.1.0.0')).toEqual([]);
  });
});

describe('the pair no execution could satisfy', () => {
  it('refuses an execution clock below the run clock', () => {
    const [issue] = checkTimeouts(inForce(30_000, 1_000), 'versions.1.0.0');
    expect(issue?.path).toBe('versions.1.0.0.options.executionTimeout');
    expect(issue?.received).toBe(1_000);
  });

  it('refuses a bounded execution under an unbounded attempt', () => {
    const [issue] = checkTimeouts(inForce(null, 60_000), 'versions.1.0.0');
    expect(issue?.path).toBe('versions.1.0.0.options.executionTimeout');
  });

  it('says what is in force rather than that a check failed', () => {
    const [issue] = checkTimeouts(inForce(30_000, 1_000), 'versions.1.0.0');
    expect(issue?.message).toContain('30000');
    expect(issue?.message).toContain('runTimeout');
  });

  it('reports one issue, the relation being a single rule', () => {
    expect(
      checkTimeouts(inForce(30_000, 1_000), 'versions.1.0.0'),
    ).toHaveLength(1);
  });
});

describe('what the relation is judged on', () => {
  it('judges the resolved pair, so two levels are compared as one', () => {
    // a run clock from the handler, an execution clock from the version
    const handler = { ...ARVO_DEFAULT_HANDLER_OPTIONS, runTimeout: 30_000 };
    const version = { ...handler, executionTimeout: 1_000 };
    expect(checkTimeouts(version, 'versions.1.0.0')).toHaveLength(1);
  });
});
