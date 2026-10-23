import { describe, expect, it } from 'vitest';
import { createArvoHandlerFault } from '../../../src/ArvoEventHandler/fault/factory.js';
import { initEvent, telemetry } from '../fixtures.js';

/**
 * The type level, run so it compiles where the suite does.
 *
 * Each `@ts-expect-error` is an assertion: if the line stopped being an
 * error, `pnpm typecheck` would fail on the directive itself.
 */

describe('what the compiler holds a fault factory call to', () => {
  it('refuses a handler-less fault of any kind but handler_not_found', async () => {
    // @ts-expect-error only handler_not_found can be raised with no handler
    const fault = await createArvoHandlerFault({
      contracts: null,
      event: initEvent,
      attempt: 0,
      telemetry: telemetry().telemetry,
      faultKind: 'record_invalid',
      message: 'no handler was entered',
    });
    expect(fault.faultKind).toBe('record_invalid');
  });
});
