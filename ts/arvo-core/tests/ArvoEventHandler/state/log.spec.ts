import { describe, expect, it } from 'vitest';
import { logEvent } from '../../../src/ArvoEventHandler/state/log.js';
import { chargedEvent, initEvent } from '../fixtures.js';
import { buildState } from './fixtures.js';

/** A record whose trail holds the opening event alone. */
const opened = () =>
  buildState({ eventIds: [{ id: initEvent.id, direction: 'received' }] });

describe('noting an event the execution handled', () => {
  it('adds one it received, marked as such', () => {
    expect(
      logEvent(opened(), chargedEvent, 'received').eventIds.at(-1),
    ).toEqual({ id: chargedEvent.id, direction: 'received' });
  });

  it('adds one it sent, marked as such', () => {
    expect(logEvent(opened(), chargedEvent, 'emitted').eventIds.at(-1)).toEqual(
      { id: chargedEvent.id, direction: 'emitted' },
    );
  });

  it('keeps what was already there, in order', () => {
    const logged = logEvent(opened(), chargedEvent, 'emitted');
    expect(logged.eventIds).toHaveLength(2);
    expect(logged.eventIds[0]?.id).toBe(initEvent.id);
  });

  it('adds one already in the trail to nothing', () => {
    const once = logEvent(opened(), chargedEvent, 'emitted');
    expect(logEvent(once, chargedEvent, 'emitted')).toBe(once);
  });

  it('leaves the direction it was first noted with alone', () => {
    const once = logEvent(opened(), chargedEvent, 'emitted');
    expect(
      logEvent(once, chargedEvent, 'received').eventIds.at(-1)?.direction,
    ).toBe('emitted');
  });

  it('mints a new record rather than changing the one it had', () => {
    const before = opened();
    const logged = logEvent(before, chargedEvent, 'emitted');
    expect(logged).not.toBe(before);
    expect(before.eventIds).toHaveLength(1);
  });

  it('leaves everything else as the execution stood', () => {
    const before = opened();
    const logged = logEvent(before, chargedEvent, 'emitted');
    expect(logged.data).toEqual(before.data);
    expect(logged.lifecycle).toBe(before.lifecycle);
    expect(logged.casVersion).toBe(before.casVersion);
  });
});
