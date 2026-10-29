import { describe, expect, it } from 'vitest';
import type { IArvoOutbox } from '../../src/ArvoOutbox/interface.js';
import { ArvoOutboxDriver } from '../../src/ArvoOutboxDriver/index.js';
import { ArvoMemoryOutbox } from '../../src/outbox/inmemory/index.js';

/**
 * The driver at the type level. Each `@ts-expect-error` is an assertion: if
 * the line stopped being an error, `pnpm typecheck` would fail on the
 * directive itself.
 */
describe('the outbox driver', () => {
  it('is not an outbox, so it cannot stand where one is expected', () => {
    const driver = new ArvoOutboxDriver({ outbox: new ArvoMemoryOutbox() });
    // @ts-expect-error the driver takes live events and reports in Arvo's shape, not an outbox's
    const outbox: IArvoOutbox = driver;
    expect(outbox).toBe(driver);
  });
});
