import { describe, expect, it } from 'vitest';
import type { ArvoEvent } from '../../../src/ArvoEvent/index.js';
import { collectResponse } from '../../../src/ArvoEventHandler/state/collect.js';
import { cloneArvoEvent } from '../../../src/factories/cloneArvoEvent.js';
import { chargedEvent, initEvent } from '../fixtures.js';
import { buildState } from './fixtures.js';

/** The request this execution emitted and is waiting on. */
const REQUEST_ID = 'charge-request';

/** The service's answer to that request. */
const answer = cloneArvoEvent(chargedEvent, { initid: REQUEST_ID });

/** A record waiting on that one request, and nothing else. */
const waiting = (overrides: Record<string, unknown> = {}) =>
  buildState({
    eventIds: [{ id: initEvent.id, direction: 'received' }],
    inFlightEventMap: new Map<string, ArvoEvent | null>([[REQUEST_ID, null]]),
    ...overrides,
  });

describe('taking in a response an execution was waiting for', () => {
  it('holds it against the request it answers', () => {
    expect(
      collectResponse(waiting(), answer).inFlightEventMap.get(REQUEST_ID),
    ).toBe(answer);
  });

  it('leaves outstanding whatever still is', () => {
    const collected = collectResponse(
      waiting({
        inFlightEventMap: new Map<string, ArvoEvent | null>([
          [REQUEST_ID, null],
          ['other-request', null],
        ]),
      }),
      answer,
    );
    expect(collected.inFlightEventMap.get('other-request')).toBeNull();
    expect(collected.inFlightEventMap.size).toBe(2);
  });

  it('adds it to the events the execution has handled', () => {
    expect(collectResponse(waiting(), answer).eventIds.at(-1)).toEqual({
      id: answer.id,
      direction: 'received',
    });
  });

  it('mints a new record rather than changing the one it had', () => {
    const before = waiting();
    const collected = collectResponse(before, answer);
    expect(collected).not.toBe(before);
    expect(before.inFlightEventMap.get(REQUEST_ID)).toBeNull();
  });

  it('leaves everything else as the execution stood', () => {
    const before = waiting();
    const collected = collectResponse(before, answer);
    expect(collected.data).toEqual(before.data);
    expect(collected.lifecycle).toBe(before.lifecycle);
    expect(collected.executionId).toBe(before.executionId);
    expect(collected.casVersion).toBe(before.casVersion);
  });
});
