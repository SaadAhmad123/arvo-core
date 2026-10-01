import { describe, expect, it } from 'vitest';
import { createArvoHandlerFault } from '../../../src/ArvoEventHandler/fault/factory.js';
import { ArvoHandlerFault } from '../../../src/ArvoEventHandler/fault/index.js';
import { ARVO_DEFAULT_HANDLER_OPTIONS } from '../../../src/ArvoEventHandler/helpers/defaults.js';
import {
  chargedEvent,
  initEvent,
  orderVersion,
  telemetry,
} from '../fixtures.js';
import { buildState } from '../state/fixtures.js';

const raise = async (
  param: Record<string, unknown> = {},
  state = buildState(),
) =>
  createArvoHandlerFault({
    contracts: { self: orderVersion },
    state,
    options: ARVO_DEFAULT_HANDLER_OPTIONS,
    attempt: 0,
    telemetry: telemetry().telemetry,
    faultKind: 'executor_raised',
    message: 'the payment gateway refused the charge',
    ...param,
  });

describe('what a fault says about the execution it describes', () => {
  it('is a fault, built rather than thrown', async () => {
    expect(await raise()).toBeInstanceOf(ArvoHandlerFault);
  });

  it('says which fault it is, and what went wrong', async () => {
    const fault = await raise();
    expect(fault.faultKind).toBe('executor_raised');
    expect(fault.message).toBe('the payment gateway refused the charge');
  });

  it('fills in the execution from the record', async () => {
    const fault = await raise();
    expect(fault.subject).toBe(initEvent.subject);
    expect(fault.executionId).toBe(initEvent.executionid);
    expect(fault.eventId).toBe(chargedEvent.id);
    expect(fault.attempt).toBe(0);
  });

  it('carries what underlies it where that was said, and nothing where it was not', async () => {
    expect((await raise({ cause: 'HTTP 402' })).cause).toBe('HTTP 402');
    expect((await raise()).cause).toBeNull();
  });

  it('carries the checks that failed where those were collected', async () => {
    expect(
      (await raise({ violations: ['amount: too large'] })).violations,
    ).toEqual(['amount: too large']);
    expect((await raise()).violations).toEqual([]);
  });
});

describe('whether another attempt is in prospect', () => {
  it('is, for an executor fault that said nothing, those being retry safe by default', async () => {
    const fault = await raise();
    expect(fault.retry?.maxRetryAttemptsAllowed).toBe(3);
    expect(fault.retry?.retryInMs).toBe(300);
    expect(fault.retry?.retryAt).toBe(fault.timestamp + 300);
  });

  it('is not, where the executor said not', async () => {
    expect((await raise({ retryable: false })).retry).toBeNull();
  });

  it('is, for a kind the vocabulary fixes as retry safe', async () => {
    expect(
      (await raise({ faultKind: 'state_resolution_failed' })).retry,
    ).not.toBeNull();
  });

  it('is not, for a kind no further attempt would fix', async () => {
    expect(
      (await raise({ faultKind: 'addressing_mismatch' })).retry,
    ).toBeNull();
  });

  it('is not, once the attempts are spent', async () => {
    expect((await raise({ attempt: 3 })).retry).toBeNull();
  });
});

describe('what the execution would be abandoned with', () => {
  it('is a pair, both written out', async () => {
    const fault = await raise();
    expect(typeof fault.abandonmentEvent).toBe('string');
    expect(typeof fault.abandonmentState).toBe('string');
  });

  it('addresses the event at whoever opened the execution', async () => {
    const written = JSON.parse((await raise()).abandonmentEvent as string);
    expect(written.to).toBe(initEvent.source);
    expect(written.type).toBe(orderVersion.error.type);
    expect(written.initid).toBe(initEvent.id);
  });

  it('rests the record at failure, saying why', async () => {
    const fault = await raise();
    const record = JSON.parse(fault.abandonmentState as string);
    expect(record.lifecycle).toBe('failure');
    expect(record.lifecycleDescription).toBe(fault.message);
  });

  it('advances the revision, so a store can tell it from the one read', async () => {
    const record = JSON.parse((await raise()).abandonmentState as string);
    expect(record.casVersion).toBe(buildState().casVersion + 1);
  });

  it('logs the event it would publish against the execution', async () => {
    const fault = await raise();
    const published = JSON.parse(fault.abandonmentEvent as string);
    const record = JSON.parse(fault.abandonmentState as string);
    expect(record.eventIds).toContainEqual({
      id: published.id,
      direction: 'emitted',
    });
  });

  it('holds no event where the execution could address none, and a record all the same', async () => {
    const fault = await raise(
      {},
      buildState({ source: 'not a contract type' }),
    );
    expect(fault.abandonmentEvent).toBeNull();
    expect(typeof fault.abandonmentState).toBe('string');
  });

  it('leaves the record it was given exactly as it was', async () => {
    const state = buildState();
    await raise({}, state);
    expect(state.lifecycle).toBe('waiting');
    expect(state.casVersion).toBe(7);
  });
});

describe('what building one records', () => {
  it('writes the fault to the span, a meter and a log, a fault writing no record', async () => {
    const recorded = telemetry();
    await raise({ telemetry: recorded.telemetry });
    expect(recorded.emitted).toHaveLength(1);
    expect(recorded.emitted[0].body).toContain('the payment gateway refused');
  });
});

describe('a fault raised before any record could be read', () => {
  const unread = async (param: Record<string, unknown> = {}) =>
    createArvoHandlerFault({
      contracts: { self: orderVersion },
      state: null,
      event: initEvent,
      initEvent,
      executionId: 'a'.repeat(64),
      options: ARVO_DEFAULT_HANDLER_OPTIONS,
      attempt: 0,
      telemetry: telemetry().telemetry,
      faultKind: 'record_invalid',
      message: 'the stored record does not read as one',
      ...param,
    });

  it('names the workflow and the event off the event itself', async () => {
    const fault = await unread();
    expect(fault.subject).toBe(initEvent.subject);
    expect(fault.eventId).toBe(initEvent.id);
  });

  it('names the execution it was looking for', async () => {
    expect((await unread()).executionId).toBe('a'.repeat(64));
  });

  it('names no execution where none was resolved', async () => {
    expect((await unread({ executionId: null })).executionId).toBeNull();
  });

  it('commits no record, there being none to carry forward', async () => {
    expect((await unread()).abandonmentState).toBeNull();
  });

  it('still addresses the caller, the event that opened it being known', async () => {
    const written = JSON.parse((await unread()).abandonmentEvent as string);
    expect(written.to).toBe(initEvent.source);
    expect(written.initid).toBe(initEvent.id);
  });

  it('addresses nobody where even that event is unknown', async () => {
    expect((await unread({ initEvent: null })).abandonmentEvent).toBeNull();
  });

  it('still says whether another attempt is due', async () => {
    const fault = await unread({ faultKind: 'state_resolution_failed' });
    expect(fault.retry).not.toBeNull();
  });
});
