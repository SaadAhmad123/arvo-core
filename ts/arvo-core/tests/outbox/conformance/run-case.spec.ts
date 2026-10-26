import { describe, expect, it } from 'vitest';
import type { IArvoOutbox } from '../../../src/ArvoOutbox/interface.js';
import { runConformanceCase } from '../../../src/outbox/conformance/run-case.js';

/** An outbox writing down each step of its life, failing where told to. */
const createLoggingOutbox = (failingStep?: 'open' | 'close') => {
  const steps: string[] = [];
  const outbox: IArvoOutbox = {
    open: async () => {
      steps.push('open');
      if (failingStep === 'open') throw new Error('the outbox would not open');
    },
    close: async () => {
      steps.push('close');
      if (failingStep === 'close')
        throw new Error('the outbox would not close');
    },
    readLatestState: () => null,
    commitStateAndEvents: () => ({ committed: true }),
    commitEvents: () => undefined,
    readCommittedEvents: () => [],
    listUnseenEvents: () => [],
    markEventsSeen: () => undefined,
  };
  return { outbox, steps };
};

describe('running one conformance case', () => {
  it('opens a new outbox before the check and closes it after', async () => {
    const { outbox, steps } = createLoggingOutbox();
    await runConformanceCase(async () => outbox, {
      name: 'a passing rule',
      check: async (checkedOutbox) => {
        expect(checkedOutbox).toBe(outbox);
        steps.push('check');
      },
    });
    expect(steps).toEqual(['open', 'check', 'close']);
  });

  it('closes the outbox after a check that fails, and throws what the check threw', async () => {
    const { outbox, steps } = createLoggingOutbox();
    await expect(
      runConformanceCase(() => outbox, {
        name: 'a failing rule',
        check: async () => {
          steps.push('check');
          throw new Error('the rule was broken');
        },
      }),
    ).rejects.toThrow('the rule was broken');
    expect(steps).toEqual(['open', 'check', 'close']);
  });

  it('closes the outbox after an opening that fails, and throws what opening threw', async () => {
    const { outbox, steps } = createLoggingOutbox('open');
    await expect(
      runConformanceCase(() => outbox, {
        name: 'a rule',
        check: async () => undefined,
      }),
    ).rejects.toThrow('the outbox would not open');
    expect(steps).toEqual(['open', 'close']);
  });

  it('throws what closing threw after a check that passed', async () => {
    const { outbox } = createLoggingOutbox('close');
    await expect(
      runConformanceCase(() => outbox, {
        name: 'a rule',
        check: async () => undefined,
      }),
    ).rejects.toThrow('the outbox would not close');
  });

  it('throws what the check threw where closing throws as well', async () => {
    const { outbox } = createLoggingOutbox('close');
    await expect(
      runConformanceCase(() => outbox, {
        name: 'a rule',
        check: async () => {
          throw new Error('the rule was broken');
        },
      }),
    ).rejects.toThrow('the rule was broken');
  });
});
