import { describe, expect, it } from 'vitest';
import { ARVO_CATEGORY_COMPLETE } from '../src/ArvoEventHandler/helpers/defaults.js';
import { deriveArvoExecutionId } from '../src/ArvoEventHandler/helpers/execution-id.js';
import * as surface from '../src/index.js';
import { initEvent } from './ArvoEventHandler/fixtures.js';

/**
 * What a mechanism needs to deliver an event, reachable without reaching
 * inside.
 *
 * ADR-006 gives routing to the mechanism: it must decide whether an event
 * opens an execution or answers one, work out which execution an opening
 * event opens, and tell a finished execution from one that can still be
 * resumed. None of that is a handler's to do, so all of it has to be on
 * the package's surface — and a mechanism that had to re-derive any of it
 * would be keeping a second copy of a rule that must not differ.
 *
 * Asserted against the entry point rather than against the modules
 * behind it, because an export is the thing under test.
 */

describe('what a mechanism routes an event by', () => {
  it('names the two categories, so neither is written as a literal', () => {
    expect(surface.ARVO_CATEGORY_INIT).toBe('io.arvo.init');
    expect(surface.ARVO_CATEGORY_COMPLETE).toBe(ARVO_CATEGORY_COMPLETE);
    expect(surface.ARVO_CATEGORY_INIT).not.toBe(surface.ARVO_CATEGORY_COMPLETE);
  });

  it('derives the execution an opening event opens, the one way it is derived', async () => {
    // the same answer as the module the handler itself uses: one rule,
    // and two implementations of it would fork an execution on every
    // redelivery
    expect(await surface.deriveArvoExecutionId(initEvent)).toBe(
      await deriveArvoExecutionId(initEvent),
    );
  });

  it('says whether a string is shaped like one', async () => {
    expect(
      surface.isArvoExecutionId(await surface.deriveArvoExecutionId(initEvent)),
    ).toBe(true);
    expect(surface.isArvoExecutionId('not an execution')).toBe(false);
  });

  it('lists every lifecycle, and which of them accept nothing further', () => {
    expect([...surface.ARVO_EXECUTION_LIFECYCLES]).toEqual(
      expect.arrayContaining([...surface.ARVO_TERMINAL_LIFECYCLES]),
    );
    // a mechanism closes an execution on a terminal lifecycle and keeps
    // one open otherwise, so the two lists cannot be the same list
    expect(surface.ARVO_TERMINAL_LIFECYCLES.length).toBeLessThan(
      surface.ARVO_EXECUTION_LIFECYCLES.length,
    );
  });

  it('hands them over frozen, so one mechanism cannot change another', () => {
    for (const listed of [
      surface.ARVO_EXECUTION_LIFECYCLES,
      surface.ARVO_TERMINAL_LIFECYCLES,
    ]) {
      expect(Array.isArray(listed)).toBe(true);
      expect(Object.isFrozen(listed)).toBe(true);
    }
  });
});
