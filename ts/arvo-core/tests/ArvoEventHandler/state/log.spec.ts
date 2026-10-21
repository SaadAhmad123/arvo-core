import { describe, expect, it } from 'vitest';
import { logEvent } from '../../../src/ArvoEventHandler/state/log.js';
import { chargedEvent, initEvent } from '../fixtures.js';
import { buildState } from './fixtures.js';

/** A record whose trail holds the opening event alone. */
const openedState = () =>
  buildState({ eventIds: [{ id: initEvent.id, direction: 'received' }] });

describe('noting an event the execution handled', () => {
  it('adds one it received, marked as such', () => {
    expect(
      logEvent(openedState(), chargedEvent, 'received').eventIds.at(-1),
    ).toEqual({ id: chargedEvent.id, direction: 'received' });
  });

  it('adds one it sent, marked as such', () => {
    expect(
      logEvent(openedState(), chargedEvent, 'emitted').eventIds.at(-1),
    ).toEqual({ id: chargedEvent.id, direction: 'emitted' });
  });

  it('keeps what was already there, in order', () => {
    const loggedState = logEvent(openedState(), chargedEvent, 'emitted');
    expect(loggedState.eventIds).toHaveLength(2);
    expect(loggedState.eventIds[0]?.id).toBe(initEvent.id);
  });

  it('adds one already in the trail to nothing', () => {
    const onceLoggedState = logEvent(openedState(), chargedEvent, 'emitted');
    expect(logEvent(onceLoggedState, chargedEvent, 'emitted')).toBe(
      onceLoggedState,
    );
  });

  it('leaves the direction it was first noted with alone', () => {
    const onceLoggedState = logEvent(openedState(), chargedEvent, 'emitted');
    expect(
      logEvent(onceLoggedState, chargedEvent, 'received').eventIds.at(-1)
        ?.direction,
    ).toBe('emitted');
  });

  it('mints a new record rather than changing the one it had', () => {
    const stateBefore = openedState();
    const loggedState = logEvent(stateBefore, chargedEvent, 'emitted');
    expect(loggedState).not.toBe(stateBefore);
    expect(stateBefore.eventIds).toHaveLength(1);
  });

  it('leaves everything else as the execution stood', () => {
    const stateBefore = openedState();
    const loggedState = logEvent(stateBefore, chargedEvent, 'emitted');
    expect(loggedState.data).toEqual(stateBefore.data);
    expect(loggedState.lifecycle).toBe(stateBefore.lifecycle);
    expect(loggedState.casVersion).toBe(stateBefore.casVersion);
  });
});
