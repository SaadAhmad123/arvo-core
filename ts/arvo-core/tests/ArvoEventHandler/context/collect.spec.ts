import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ArvoEvent } from '../../../src/ArvoEvent/index.js';
import { ArvoExecutionContext } from '../../../src/ArvoEventHandler/context/index.js';
import type {
  ArvoContextState,
  ArvoDeliveredEvent,
  ArvoExecutionContextParam,
} from '../../../src/ArvoEventHandler/context/types.js';
import { ArvoHandlerFault } from '../../../src/ArvoEventHandler/fault/index.js';
import { ARVO_DEFAULT_HANDLER_OPTIONS } from '../../../src/ArvoEventHandler/helpers/defaults.js';
import { ArvoExecutionState } from '../../../src/ArvoEventHandler/state/index.js';
import type { ArvoExecutionStateParam } from '../../../src/ArvoEventHandler/state/types.js';
import type { ArvoInitEvent } from '../../../src/ArvoEventHandler/types/services.js';
import type {
  ArvoDependencies,
  ArvoMechanismHooks,
} from '../../../src/ArvoEventHandler/types/supplied.js';
import { cloneArvoEvent } from '../../../src/factories/cloneArvoEvent.js';
import {
  chargedEvent,
  initEvent,
  orderContract,
  orderVersion,
  services,
  telemetry,
} from '../fixtures.js';

/** What a delivery records against; these tests only carry it. */
const { span, meter, logger } = telemetry();

const orderData = z.object({ orderId: z.string(), attempts: z.number() });

type Self = typeof orderVersion;
type Services = typeof services;

/** The request this execution emitted and is waiting on. */
const REQUEST_ID = 'charge-request';

/** The service's answer to that request. */
const answer = cloneArvoEvent(chargedEvent, { initid: REQUEST_ID });

/** An answer to something this execution never asked for. */
const stranger = cloneArvoEvent(chargedEvent, { initid: 'never-asked' });

/** An answer that names no request at all. */
const unaddressed = cloneArvoEvent(chargedEvent, { initid: null as never });

const record = (
  overrides: Partial<
    ArvoExecutionStateParam<
      typeof orderData,
      ArvoInitEvent<Self>,
      ArvoDeliveredEvent<Self, Services>
    >
  > = {},
): ArvoContextState<Self, Services, typeof orderData> =>
  new ArvoExecutionState({
    data: { orderId: 'o-1', attempts: 1 },
    subject: initEvent.subject,
    executionId: initEvent.executionid,
    parentExecutionId: initEvent.executionid,
    depth: 0,
    source: 'com_order_create',
    version: '1.0.0',
    lifecycle: 'waiting',
    lifecycleDescription: null,
    initEvent,
    triggeringEvent: initEvent,
    eventIds: [{ id: initEvent.id, direction: 'received' }],
    inFlightEventMap: new Map<string, ArvoEvent | null>([[REQUEST_ID, null]]),
    recordFormatVersion: '1.0.0',
    casVersion: 1,
    contracts: {
      self: { uri: orderContract.uri, type: orderContract.type },
      services: [],
    },
    ...overrides,
  });

const waiting = (
  overrides: Partial<
    ArvoExecutionContextParam<
      Self,
      Services,
      typeof orderData,
      ArvoDependencies,
      ArvoMechanismHooks
    >
  > = {},
) =>
  new ArvoExecutionContext({
    contracts: { self: orderVersion, services },
    dataSchema: orderData,
    entry: 'followup',
    state: record(),
    attempt: 0,
    span,
    meter,
    logger,
    options: ARVO_DEFAULT_HANDLER_OPTIONS,
    dependencies: {},
    hooks: {},
    ...overrides,
  });

/** The fault raised by taking in a response nothing was waiting for. */
const refused = async (event: ArvoEvent, ctx = waiting()) => {
  try {
    await ctx.collect(event);
  } catch (raised) {
    return raised as ArvoHandlerFault;
  }
  throw new Error('expected the response to be refused');
};

describe('taking in a response an execution was waiting for', () => {
  it('records it against the request it answers', async () => {
    const ctx = waiting();
    await ctx.collect(answer);
    expect(ctx.state.inFlightEventMap.get(REQUEST_ID)).toBe(answer);
  });

  it('leaves nothing else outstanding than what still is', async () => {
    const ctx = waiting({
      state: record({
        inFlightEventMap: new Map<string, ArvoEvent | null>([
          [REQUEST_ID, null],
          ['other-request', null],
        ]),
      }),
    });
    await ctx.collect(answer);
    expect(ctx.state.inFlightEventMap.get('other-request')).toBeNull();
    expect(ctx.state.inFlightEventMap.size).toBe(2);
  });

  it('adds it to the events the execution has handled', async () => {
    const ctx = waiting();
    await ctx.collect(answer);
    expect(ctx.state.eventIds.at(-1)).toEqual({
      id: answer.id,
      direction: 'received',
    });
  });

  it('mints a new record rather than changing the one it had', async () => {
    const ctx = waiting();
    const before = ctx.state;
    await ctx.collect(answer);
    expect(ctx.state).not.toBe(before);
    expect(before.inFlightEventMap.get(REQUEST_ID)).toBeNull();
  });

  it('leaves everything else as the execution stood', async () => {
    const ctx = waiting();
    const before = ctx.state;
    await ctx.collect(answer);

    expect(ctx.state.data).toEqual(before.data);
    expect(ctx.state.lifecycle).toBe(before.lifecycle);
    expect(ctx.state.executionId).toBe(before.executionId);
    expect(ctx.state.casVersion).toBe(before.casVersion);
  });
});

describe('a response nothing was waiting for', () => {
  describe('one naming no request at all', () => {
    it('raises a fault', async () => {
      expect(await refused(unaddressed)).toBeInstanceOf(ArvoHandlerFault);
    });

    it('names it as a response nobody awaited', async () => {
      expect((await refused(unaddressed)).faultKind).toBe('response_unawaited');
    });
  });

  describe('one naming a request this execution never made', () => {
    it('names it as a response nobody awaited', async () => {
      expect((await refused(stranger)).faultKind).toBe('response_unawaited');
    });

    it('says which request it claimed to answer', async () => {
      expect((await refused(stranger)).message).toContain('never-asked');
    });

    it('leaves what is remembered unchanged', async () => {
      const ctx = waiting();
      const before = ctx.state;
      await refused(stranger, ctx);
      expect(ctx.state).toBe(before);
    });
  });

  describe('one naming a request already answered', () => {
    const answered = () =>
      waiting({
        state: record({
          inFlightEventMap: new Map<string, ArvoEvent | null>([
            [REQUEST_ID, answer],
          ]),
        }),
      });

    it('names it as a response nobody awaited', async () => {
      expect((await refused(answer, answered())).faultKind).toBe(
        'response_unawaited',
      );
    });

    it('leaves the answer already held alone', async () => {
      const ctx = answered();
      const second = cloneArvoEvent(answer, { id: 'a-second-answer' });
      await refused(second, ctx);
      expect(ctx.state.inFlightEventMap.get(REQUEST_ID)).toBe(answer);
    });
  });

  it('carries what the execution would be abandoned with', async () => {
    const fault = await refused(stranger);
    expect(typeof fault.abandonmentEvent).toBe('string');
    expect(typeof fault.abandonmentState).toBe('string');
  });

  it('is not worth another attempt, a redelivery changing nothing', async () => {
    expect((await refused(stranger)).retry).toBeNull();
  });
});
