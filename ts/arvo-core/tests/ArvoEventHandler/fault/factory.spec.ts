import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoContract } from '../../../src/ArvoContract/index.js';
import { ArvoDomain } from '../../../src/ArvoDomain/index.js';
import { createArvoHandlerFault } from '../../../src/ArvoEventHandler/fault/factory.js';
import { ArvoHandlerFault } from '../../../src/ArvoEventHandler/fault/index.js';
import { ARVO_DEFAULT_HANDLER_OPTIONS } from '../../../src/ArvoEventHandler/helpers/defaults.js';
import { mutateArvoEvent } from '../../../src/factories/mutateArvoEvent.js';
import {
  chargedEvent,
  initEvent,
  orderVersion,
  telemetry,
} from '../fixtures.js';
import { buildLooseState, buildState } from '../state/fixtures.js';

const buildFault = async (
  param: Record<string, unknown> = {},
  state = buildState(),
) =>
  createArvoHandlerFault({
    contracts: { self: orderVersion },
    state,
    entry: 'followup',
    options: ARVO_DEFAULT_HANDLER_OPTIONS,
    attempt: 0,
    telemetry: telemetry().telemetry,
    faultKind: 'executor_raised',
    message: 'the payment gateway refused the charge',
    ...param,
  });

describe('what a fault says about the execution it describes', () => {
  it('is a fault, built rather than thrown', async () => {
    expect(await buildFault()).toBeInstanceOf(ArvoHandlerFault);
  });

  it('says which fault it is, and what went wrong', async () => {
    const fault = await buildFault();
    expect(fault.faultKind).toBe('executor_raised');
    expect(fault.message).toBe('the payment gateway refused the charge');
  });

  it('fills in the execution from the record', async () => {
    const fault = await buildFault();
    expect(fault.subject).toBe(initEvent.subject);
    expect(fault.executionId).toBe(initEvent.executionid);
    expect(fault.eventId).toBe(chargedEvent.id);
    expect(fault.attempt).toBe(0);
  });

  it('carries what underlies it where that was said, and nothing where it was not', async () => {
    expect((await buildFault({ cause: 'HTTP 402' })).cause).toBe('HTTP 402');
    expect((await buildFault()).cause).toBeNull();
  });

  it('carries the checks that failed where those were collected', async () => {
    expect(
      (await buildFault({ violations: ['amount: too large'] })).violations,
    ).toEqual(['amount: too large']);
    expect((await buildFault()).violations).toEqual([]);
  });
});

describe('whether another attempt is in prospect', () => {
  it('is, for an executor fault that said nothing, those being retry safe by default', async () => {
    const fault = await buildFault();
    expect(fault.retry?.maxRetryAttemptsAllowed).toBe(3);
    expect(fault.retry?.retryInMs).toBe(300);
    expect(fault.retry?.retryAt).toBe(fault.timestamp + 300);
  });

  it('is not, where the executor said not', async () => {
    expect((await buildFault({ retryable: false })).retry).toBeNull();
  });

  it('is, for a kind the vocabulary fixes as retry safe', async () => {
    expect(
      (await buildFault({ faultKind: 'state_resolution_failed' })).retry,
    ).not.toBeNull();
  });

  it('is not, for a kind no further attempt would fix', async () => {
    expect(
      (await buildFault({ faultKind: 'addressing_mismatch' })).retry,
    ).toBeNull();
  });

  it('is not, once the attempts are spent', async () => {
    expect((await buildFault({ attempt: 3 })).retry).toBeNull();
  });
});

describe('the two kinds a layer can cause', () => {
  it.each(['middleware_conflict', 'middleware_instantiation_failed'])(
    'is %s, with no further attempt in prospect at any attempt',
    async (faultKind) => {
      for (const attempt of [0, 1, 2]) {
        const fault = await buildFault({ faultKind, attempt });
        expect(fault.faultKind).toBe(faultKind);
        expect(fault.retry).toBeNull();
      }
    },
  );

  it.each(['middleware_conflict', 'middleware_instantiation_failed'])(
    'carries the pair a mechanism would abandon with, %s being raised after the gate',
    async (faultKind) => {
      const fault = await buildFault({ faultKind });
      expect(fault.abandonmentEvent).not.toBeNull();
      expect(fault.abandonmentState).not.toBeNull();
    },
  );
});

describe('what the execution would be abandoned with', () => {
  it('is a pair, both written out', async () => {
    const fault = await buildFault();
    expect(typeof fault.abandonmentEvent).toBe('string');
    expect(typeof fault.abandonmentState).toBe('string');
  });

  it('addresses the event at whoever opened the execution', async () => {
    const abandonmentEvent = JSON.parse(
      (await buildFault()).abandonmentEvent as string,
    );
    expect(abandonmentEvent.to).toBe(initEvent.source);
    expect(abandonmentEvent.type).toBe(orderVersion.error.type);
    expect(abandonmentEvent.initid).toBe(initEvent.id);
  });

  it('rests the record at failure, saying why', async () => {
    const fault = await buildFault();
    const abandonmentRecord = JSON.parse(fault.abandonmentState as string);
    expect(abandonmentRecord.lifecycle).toBe('failure');
    expect(abandonmentRecord.lifecycleDescription).toBe(fault.message);
  });

  it('advances the revision, so a store can tell it from the one read', async () => {
    const abandonmentRecord = JSON.parse(
      (await buildFault()).abandonmentState as string,
    );
    expect(abandonmentRecord.casVersion).toBe(buildState().casVersion + 1);
  });

  it('keeps the revision an opening execution was built at, no record having been read', async () => {
    const openingFault = await buildFault({ entry: 'init' });
    const abandonmentRecord = JSON.parse(
      openingFault.abandonmentState as string,
    );
    expect(abandonmentRecord.casVersion).toBe(buildState().casVersion);
  });

  it('carries neither half where the execution already rests terminal', async () => {
    const fault = await buildFault({ faultKind: 'lifecycle_terminal' });
    expect(fault.abandonmentEvent).toBeNull();
    expect(fault.abandonmentState).toBeNull();
  });

  it('logs the event it would publish against the execution', async () => {
    const fault = await buildFault();
    const abandonmentEvent = JSON.parse(fault.abandonmentEvent as string);
    const abandonmentRecord = JSON.parse(fault.abandonmentState as string);
    expect(abandonmentRecord.eventIds).toContainEqual({
      id: abandonmentEvent.id,
      direction: 'emitted',
    });
  });

  it('holds no event where the execution could address none, and a record all the same', async () => {
    const fault = await buildFault(
      {},
      buildState({ source: 'not a contract type' }),
    );
    expect(fault.abandonmentEvent).toBeNull();
    expect(typeof fault.abandonmentState).toBe('string');
  });

  it('commits no record where the one it holds cannot be written out', async () => {
    const circularRecord: Record<string, unknown> = {};
    circularRecord.self = circularRecord;
    const fault = await buildFault(
      {},
      buildLooseState({ circular: circularRecord }),
    );
    expect(fault.abandonmentState).toBeNull();
    expect(typeof fault.abandonmentEvent).toBe('string');
  });

  it('sends the event down the path the version declared for it', async () => {
    const fault = await buildFault({
      options: {
        ...ARVO_DEFAULT_HANDLER_OPTIONS,
        handlerErrorDomain: 'analytics',
      },
    });
    const abandonmentEvent = JSON.parse(fault.abandonmentEvent as string);
    expect(abandonmentEvent.domain).toBe('analytics');
  });

  it('sends the event down a path read from this handler own contract', async () => {
    const domainedVersion = new ArvoContract({
      type: 'com_order_create',
      domain: 'order_failures',
      versions: {
        '1.0.0': {
          input: z.object({ items: z.array(z.string()) }),
          outputs: { com_order_created: z.object({ order_id: z.string() }) },
        },
      },
    }).versions['1.0.0'];

    const fault = await buildFault({
      contracts: { self: domainedVersion },
      options: {
        ...ARVO_DEFAULT_HANDLER_OPTIONS,
        handlerErrorDomain: ArvoDomain.FROM_SELF_CONTRACT,
      },
    });
    expect(JSON.parse(fault.abandonmentEvent as string).domain).toBe(
      'order_failures',
    );
  });

  it('sends it down the path the event that caused the execution came on', async () => {
    const domainedChargedEvent = mutateArvoEvent(chargedEvent, {
      domain: 'human',
    });
    const fault = await buildFault(
      {
        options: {
          ...ARVO_DEFAULT_HANDLER_OPTIONS,
          handlerErrorDomain: ArvoDomain.FROM_TRIGGERING_EVENT,
        },
      },
      buildState({ triggeringEvent: domainedChargedEvent }),
    );
    expect(JSON.parse(fault.abandonmentEvent as string).domain).toBe('human');
  });

  it('keeps it on the lattice where the version asked for that outright', async () => {
    const fault = await buildFault({
      options: {
        ...ARVO_DEFAULT_HANDLER_OPTIONS,
        handlerErrorDomain: ArvoDomain.LOCAL,
      },
    });
    expect(JSON.parse(fault.abandonmentEvent as string).domain).toBeNull();
  });

  it('leaves the record it was given exactly as it was', async () => {
    const state = buildState();
    await buildFault({}, state);
    expect(state.lifecycle).toBe('waiting');
    expect(state.casVersion).toBe(7);
  });
});

describe('what building one records', () => {
  it('writes the fault to the span, a meter and a log, a fault writing no record', async () => {
    const freshTelemetry = telemetry();
    await buildFault({ telemetry: freshTelemetry.telemetry });
    expect(freshTelemetry.emitted).toHaveLength(1);
    expect(freshTelemetry.emitted[0].body).toContain(
      'the payment gateway refused',
    );
  });
});

describe('a fault raised before any record could be read', () => {
  const buildRecordlessFault = async (param: Record<string, unknown> = {}) =>
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
    const fault = await buildRecordlessFault();
    expect(fault.subject).toBe(initEvent.subject);
    expect(fault.eventId).toBe(initEvent.id);
  });

  it('names the execution it was looking for', async () => {
    expect((await buildRecordlessFault()).executionId).toBe('a'.repeat(64));
  });

  it('names no execution where none was resolved', async () => {
    expect(
      (await buildRecordlessFault({ executionId: null })).executionId,
    ).toBeNull();
  });

  it('commits no record, there being none to carry forward', async () => {
    expect((await buildRecordlessFault()).abandonmentState).toBeNull();
  });

  it('still addresses the caller, the event that opened it being known', async () => {
    const abandonmentEvent = JSON.parse(
      (await buildRecordlessFault()).abandonmentEvent as string,
    );
    expect(abandonmentEvent.to).toBe(initEvent.source);
    expect(abandonmentEvent.initid).toBe(initEvent.id);
  });

  it('addresses nobody where even that event is unknown', async () => {
    expect(
      (await buildRecordlessFault({ initEvent: null })).abandonmentEvent,
    ).toBeNull();
  });

  it('still says whether another attempt is due', async () => {
    const fault = await buildRecordlessFault({
      faultKind: 'state_resolution_failed',
    });
    expect(fault.retry).not.toBeNull();
  });
});
