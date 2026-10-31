import { describe, expect, it } from 'vitest';
import type { IArvoOutbox } from '../../src/ArvoOutbox/interface.js';
import { ArvoOutboxDriver } from '../../src/ArvoOutboxDriver/index.js';

/**
 * The driver at the type level. Each `@ts-expect-error` is an assertion: if
 * the line stopped being an error, `pnpm typecheck` would fail on the
 * directive itself.
 */
describe('the outbox driver', () => {
  it('is not an outbox, so it cannot stand where one is expected', () => {
    const unlimitedOutbox: IArvoOutbox = {
      open: () => undefined,
      close: () => undefined,
      readLatestState: () => null,
      commitStateAndEvents: () => ({ committed: true }),
      commitEvents: () => ({ committed: true }),
      readCommittedEvents: () => [],
      listUnseenEvents: () => [],
      markEventsSeen: () => undefined,
      capacity: () => ({ status: 'available', buffers: {} }),
    };
    const driver = new ArvoOutboxDriver({ outbox: unlimitedOutbox });
    // @ts-expect-error the driver takes live events and reports in Arvo's shape, not an outbox's
    const outbox: IArvoOutbox = driver;
    expect(outbox).toBe(driver);
  });
});
