import { describe, expect, it } from 'vitest';
import type { ArvoEvent } from '../../../src/ArvoEvent/index.js';
import {
  alreadySeen,
  refuseMisaddressed,
  refuseOutlived,
  refuseTerminal,
  refuseUnawaited,
} from '../../../src/ArvoEventHandler/version/gate.js';
import { cloneArvoEvent } from '../../../src/factories/cloneArvoEvent.js';
import { createArvoEvent } from '../../../src/factories/createArvoEvent.js';
import { chargedEvent, initEvent, orderVersion } from '../fixtures.js';
import { buildState } from '../state/fixtures.js';

describe('whether this event has already been processed', () => {
  it('says so where its id is logged as received', () => {
    expect(alreadySeen(buildState(), initEvent)).toBe(true);
  });

  it('says not where it has never been seen', () => {
    expect(alreadySeen(buildState(), chargedEvent)).toBe(false);
  });

  it('says not where the same id was logged as emitted, which is not an execution', () => {
    const state = buildState({
      eventIds: [{ id: chargedEvent.id, direction: 'emitted' }],
    });
    expect(alreadySeen(state, chargedEvent)).toBe(false);
  });
});

describe('whether a finished execution accepts anything further', () => {
  it.each(['success', 'error', 'cancelled', 'failure'] as const)(
    'refuses an execution to one at %s',
    (lifecycle) => {
      const refusal = refuseTerminal(buildState({ lifecycle }));
      expect(refusal?.faultKind).toBe('lifecycle_terminal');
      expect(refusal?.message).toContain(lifecycle);
    },
  );

  it('names the version it finished as, and what commonly causes it', () => {
    const refusal = refuseTerminal(buildState({ lifecycle: 'success' }));
    expect(refusal?.message).toContain('com_order_create@1.0.0');
    expect(refusal?.message).toContain('arrived too late');
  });

  it.each(['idle', 'waiting'] as const)(
    'admits an execution to one at %s',
    (lifecycle) => {
      expect(refuseTerminal(buildState({ lifecycle }))).toBeNull();
    },
  );
});

describe('whether an execution has outlived its time', () => {
  const opened = Date.parse(initEvent.time);

  /** What a refusal names this version by. */
  const VERSION = 'com_order_create@1.0.0';

  it('admits one where the version sets no bound', () => {
    expect(
      refuseOutlived(VERSION, initEvent, null, opened + 1_000_000),
    ).toBeNull();
  });

  it('admits one still inside the bound', () => {
    expect(
      refuseOutlived(VERSION, initEvent, 10_000, opened + 9_999),
    ).toBeNull();
  });

  it('refuses one at the bound, which is exclusive', () => {
    expect(
      refuseOutlived(VERSION, initEvent, 10_000, opened + 10_000)?.faultKind,
    ).toBe('execution_timeout');
  });

  it('refuses one past it', () => {
    expect(
      refuseOutlived(VERSION, initEvent, 1_000, opened + 60_000)?.faultKind,
    ).toBe('execution_timeout');
  });

  it('says the limit, the option it comes from, when it began, and how old it is', () => {
    const refusal = refuseOutlived(VERSION, initEvent, 1_000, opened + 60_000);
    expect(refusal?.message).toContain('1000ms');
    expect(refusal?.message).toContain('executionTimeout');
    expect(refusal?.message).toContain(VERSION);
    expect(refusal?.message).toContain(initEvent.time);
    expect(refusal?.message).toContain('60000ms');
  });
});

describe('whether the event, the handler and the record agree', () => {
  const addressed = cloneArvoEvent(initEvent, { to: orderVersion.type });

  it('admits an event addressed here, with no record to check', () => {
    expect(refuseMisaddressed(orderVersion, addressed, null)).toBeNull();
  });

  it('says what to set where an event names no destination', () => {
    const unaddressed = createArvoEvent({
      source: initEvent.source,
      subject: initEvent.subject,
      type: initEvent.type,
      dataschema: initEvent.dataschema,
      data: initEvent.data,
    });
    const refusal = refuseMisaddressed(orderVersion, unaddressed, null);
    expect(refusal?.message).toContain('to = its own type');
    expect(refusal?.message).toContain(orderVersion.type);
  });

  it('says how many fields disagree, where the record and the event do', () => {
    const state = buildState({ source: 'com_something_else' });
    const stray = cloneArvoEvent(chargedEvent, {
      to: 'com.somewhere.else',
      parentid: initEvent.id,
      executionid: 'somewhere-else',
      subject: 'another-workflow',
    });
    const refusal = refuseMisaddressed(orderVersion, stray, state);
    expect(refusal?.message).toContain('4 of its identifying fields');
  });

  it('refuses one naming no destination at all', () => {
    const unaddressed = createArvoEvent({
      source: initEvent.source,
      subject: initEvent.subject,
      type: initEvent.type,
      dataschema: initEvent.dataschema,
      data: initEvent.data,
    });
    const refusal = refuseMisaddressed(orderVersion, unaddressed, null);
    expect(refusal?.faultKind).toBe('event_unaddressed');
  });

  it('refuses one addressed elsewhere', () => {
    const elsewhere = cloneArvoEvent(initEvent, { to: 'com.somewhere.else' });
    const refusal = refuseMisaddressed(orderVersion, elsewhere, null);
    expect(refusal?.faultKind).toBe('addressing_mismatch');
    expect(refusal?.violations[0]).toContain('to:');
  });

  it('admits one agreeing with the record on every count', () => {
    const state = buildState();
    const answering = cloneArvoEvent(chargedEvent, {
      to: orderVersion.type,
      executionid: state.executionId,
      subject: state.subject,
    });
    expect(refuseMisaddressed(orderVersion, answering, state)).toBeNull();
  });

  it('refuses one answering a different execution', () => {
    const state = buildState();
    const stray = cloneArvoEvent(chargedEvent, {
      to: orderVersion.type,
      parentid: initEvent.id,
      executionid: 'somewhere-else',
      subject: state.subject,
    });
    const refusal = refuseMisaddressed(orderVersion, stray, state);
    expect(refusal?.violations.some((v) => v.includes('executionId'))).toBe(
      true,
    );
  });

  it('refuses one from a different workflow', () => {
    const state = buildState();
    const stray = cloneArvoEvent(chargedEvent, {
      to: orderVersion.type,
      parentid: initEvent.id,
      executionid: state.executionId,
      subject: 'another-workflow',
    });
    const refusal = refuseMisaddressed(orderVersion, stray, state);
    expect(refusal?.violations.some((v) => v.includes('subject'))).toBe(true);
  });

  it('refuses a record naming a contract this handler does not implement', () => {
    const state = buildState({ source: 'com_something_else' });
    const answering = cloneArvoEvent(chargedEvent, {
      to: orderVersion.type,
      executionid: state.executionId,
      subject: state.subject,
    });
    const refusal = refuseMisaddressed(orderVersion, answering, state);
    expect(refusal?.violations.some((v) => v.includes('source'))).toBe(true);
  });

  it('reports every disagreement together, not merely the first', () => {
    const state = buildState({ source: 'com_something_else' });
    const stray = cloneArvoEvent(chargedEvent, {
      to: 'com.somewhere.else',
      parentid: initEvent.id,
      executionid: 'somewhere-else',
      subject: 'another-workflow',
    });
    expect(
      refuseMisaddressed(orderVersion, stray, state)?.violations,
    ).toHaveLength(4);
  });
});

describe('whether a response was awaited', () => {
  const awaiting = (answer: ArvoEvent | null) =>
    buildState({
      inFlightEventMap: new Map<string, ArvoEvent | null>([
        ['charge-request', answer],
      ]),
    });

  it('admits one answering an outstanding request', () => {
    const answer = cloneArvoEvent(chargedEvent, { initid: 'charge-request' });
    expect(refuseUnawaited(awaiting(null), answer)).toBeNull();
  });

  it('refuses one naming no request', () => {
    const unaddressed = cloneArvoEvent(chargedEvent, {
      initid: null as never,
    });
    expect(refuseUnawaited(awaiting(null), unaddressed)?.faultKind).toBe(
      'response_unawaited',
    );
  });

  it('says a reply must name what it answers, where it names nothing', () => {
    const unaddressed = cloneArvoEvent(chargedEvent, {
      initid: null as never,
    });
    const refusal = refuseUnawaited(awaiting(null), unaddressed);
    expect(refusal?.message).toContain('initid');
    expect(refusal?.message).toContain('the id of the event it is answering');
  });

  it('refuses one naming a request never made', () => {
    const stranger = cloneArvoEvent(chargedEvent, { initid: 'never-asked' });
    const refusal = refuseUnawaited(awaiting(null), stranger);
    expect(refusal?.message).toContain('never-asked');
    expect(refusal?.message).toContain('never sent');
  });

  it('refuses a second answer to one already answered', () => {
    const answer = cloneArvoEvent(chargedEvent, { initid: 'charge-request' });
    const refusal = refuseUnawaited(awaiting(answer), answer);
    expect(refusal?.message).toContain('already has an answer');
  });
});
