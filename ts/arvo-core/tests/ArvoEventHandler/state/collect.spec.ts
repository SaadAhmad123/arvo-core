import { describe, expect, it } from 'vitest';
import type { ArvoEvent } from '../../../src/ArvoEvent/index.js';
import { collectResponse } from '../../../src/ArvoEventHandler/state/collect.js';
import { cloneArvoEvent } from '../../../src/factories/cloneArvoEvent.js';
import { chargedEvent, initEvent } from '../fixtures.js';
import { buildState } from './fixtures.js';

/** The request this execution emitted and is waiting on. */
const REQUEST_ID = 'charge-request';

/** The service's answer to that request. */
const response = cloneArvoEvent(chargedEvent, { initid: REQUEST_ID });

/** A record waiting on that one request, and nothing else. */
const waitingState = (overrides: Record<string, unknown> = {}) =>
  buildState({
    eventIds: [{ id: initEvent.id, direction: 'received' }],
    inFlightEventMap: new Map<string, ArvoEvent | null>([[REQUEST_ID, null]]),
    ...overrides,
  });

describe('taking in a response an execution was waiting for', () => {
  it('holds it against the request it answers', () => {
    expect(
      collectResponse(waitingState(), response).inFlightEventMap.get(
        REQUEST_ID,
      ),
    ).toBe(response);
  });

  it('leaves outstanding whatever still is', () => {
    const collectedState = collectResponse(
      waitingState({
        inFlightEventMap: new Map<string, ArvoEvent | null>([
          [REQUEST_ID, null],
          ['other-request', null],
        ]),
      }),
      response,
    );
    expect(collectedState.inFlightEventMap.get('other-request')).toBeNull();
    expect(collectedState.inFlightEventMap.size).toBe(2);
  });

  it('adds it to the events the execution has handled', () => {
    expect(collectResponse(waitingState(), response).eventIds.at(-1)).toEqual({
      id: response.id,
      direction: 'received',
    });
  });

  it('mints a new record rather than changing the one it had', () => {
    const stateBefore = waitingState();
    const collectedState = collectResponse(stateBefore, response);
    expect(collectedState).not.toBe(stateBefore);
    expect(stateBefore.inFlightEventMap.get(REQUEST_ID)).toBeNull();
  });

  it('leaves everything else as the execution stood', () => {
    const stateBefore = waitingState();
    const collectedState = collectResponse(stateBefore, response);
    expect(collectedState.data).toEqual(stateBefore.data);
    expect(collectedState.lifecycle).toBe(stateBefore.lifecycle);
    expect(collectedState.executionId).toBe(stateBefore.executionId);
    expect(collectedState.casVersion).toBe(stateBefore.casVersion);
  });
});
