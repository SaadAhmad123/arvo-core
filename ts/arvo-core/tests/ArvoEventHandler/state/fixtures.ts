import { z } from 'zod';
import { ArvoExecutionState } from '../../../src/ArvoEventHandler/state/index.js';
import type { ArvoExecutionStateParam } from '../../../src/ArvoEventHandler/state/types.js';
import { chargedEvent, initEvent } from '../fixtures.js';

/** What one version declares it remembers. */
export const orderData = z.object({
  orderId: z.string(),
  attempts: z.number(),
});

/** A record with every field set to something worth reading back. */
export const buildState = (
  overrides: Partial<ArvoExecutionStateParam<typeof orderData>> = {},
): ArvoExecutionState<typeof orderData> =>
  new ArvoExecutionState<typeof orderData>({
    data: { orderId: 'o-1', attempts: 2 },
    subject: initEvent.subject,
    executionId: initEvent.executionid,
    parentExecutionId: initEvent.executionid,
    depth: 3,
    source: 'com_order_create',
    version: '1.0.0',
    lifecycle: 'waiting',
    lifecycleDescription: 'awaiting payment',
    initEvent,
    triggeringEvent: chargedEvent,
    eventIds: [
      { id: initEvent.id, direction: 'received' },
      { id: chargedEvent.id, direction: 'emitted' },
    ],
    inFlightEventMap: new Map([
      ['emitted-1', chargedEvent],
      ['emitted-2', null],
    ]),
    recordFormatVersion: '1.0.0',
    casVersion: 7,
    ...overrides,
  });

/** The same record, for a version whose schema is anything at all. */
export const buildLooseState = (data: Record<string, unknown> | null) =>
  new ArvoExecutionState<z.core.$ZodObject>({
    ...buildState(),
    data,
    eventIds: [...buildState().eventIds],
    inFlightEventMap: new Map(buildState().inFlightEventMap),
  });
