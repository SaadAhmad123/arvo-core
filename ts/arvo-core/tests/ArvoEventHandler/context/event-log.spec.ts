import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ArvoEvent } from '../../../src/ArvoEvent/index.js';
import { ArvoExecutionContext } from '../../../src/ArvoEventHandler/context/index.js';
import type {
  ArvoContextState,
  ArvoExecutionContextParam,
  ArvoTriggeringEvent,
} from '../../../src/ArvoEventHandler/context/types.js';
import { ARVO_DEFAULT_HANDLER_OPTIONS } from '../../../src/ArvoEventHandler/helpers/defaults.js';
import { ArvoExecutionState } from '../../../src/ArvoEventHandler/state/index.js';
import type { ArvoExecutionStateParam } from '../../../src/ArvoEventHandler/state/types.js';
import type { ArvoInitEvent } from '../../../src/ArvoEventHandler/types/services.js';
import type {
  ArvoDependencies,
  ArvoMechanismHooks,
} from '../../../src/ArvoEventHandler/types/supplied.js';
import {
  chargedEvent,
  initEvent,
  orderVersion,
  services,
  telemetry,
} from '../fixtures.js';

const orderData = z.object({ orderId: z.string(), attempts: z.number() });
const { telemetry: tracing } = telemetry();

type Self = typeof orderVersion;
type Services = typeof services;

const record = (
  overrides: Partial<
    ArvoExecutionStateParam<
      typeof orderData,
      ArvoInitEvent<Self>,
      ArvoTriggeringEvent<Self, Services>
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
    inFlightEventMap: new Map<string, ArvoEvent | null>(),
    recordFormatVersion: '1.0.0',
    casVersion: 1,
    ...overrides,
  });

const context = (
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
    entry: 'init',
    state: record(),
    attempt: 0,
    telemetry: tracing,
    options: ARVO_DEFAULT_HANDLER_OPTIONS,
    dependencies: {},
    hooks: {},
    ...overrides,
  });

describe('noting an event the execution handled', () => {
  it('adds one it received, marked as such', () => {
    const ctx = context();
    ctx.markEventReceived(chargedEvent);
    expect(ctx.state.eventIds.at(-1)).toEqual({
      id: chargedEvent.id,
      direction: 'received',
    });
  });

  it('adds one it emitted, marked as such', () => {
    const ctx = context();
    ctx.markEventEmitted(chargedEvent);
    expect(ctx.state.eventIds.at(-1)).toEqual({
      id: chargedEvent.id,
      direction: 'emitted',
    });
  });

  it('keeps what was already there, in order', () => {
    const ctx = context();
    ctx.markEventEmitted(chargedEvent);
    expect(ctx.state.eventIds).toHaveLength(2);
    expect(ctx.state.eventIds[0]?.id).toBe(initEvent.id);
  });

  it('adds one already logged a second time to nothing', () => {
    const ctx = context();
    ctx.markEventEmitted(chargedEvent);
    const once = ctx.state;
    ctx.markEventEmitted(chargedEvent);
    expect(ctx.state).toBe(once);
    expect(ctx.state.eventIds).toHaveLength(2);
  });

  it('leaves the direction it was first logged with alone', () => {
    const ctx = context();
    ctx.markEventEmitted(chargedEvent);
    ctx.markEventReceived(chargedEvent);
    expect(ctx.state.eventIds.at(-1)?.direction).toBe('emitted');
  });

  it('does not log the opening event twice, it being logged already', () => {
    const ctx = context();
    ctx.markEventReceived(initEvent);
    expect(ctx.state.eventIds).toHaveLength(1);
  });

  it('leaves everything else as the execution stood', () => {
    const ctx = context();
    const before = ctx.state;
    ctx.markEventEmitted(chargedEvent);

    expect(ctx.state.data).toEqual(before.data);
    expect(ctx.state.lifecycle).toBe(before.lifecycle);
    expect(ctx.state.casVersion).toBe(before.casVersion);
  });
});
