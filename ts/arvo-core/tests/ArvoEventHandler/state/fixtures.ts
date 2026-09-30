import { z } from 'zod';
import { ArvoExecutionState } from '../../../src/ArvoEventHandler/state/index.js';
import type { ArvoExecutionStateParam } from '../../../src/ArvoEventHandler/state/types.js';
import { chargedEvent, initEvent, orderContract } from '../fixtures.js';

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
    contracts: {
      self: { uri: orderContract.uri, type: orderContract.type },
      services: [{ uri: 'https://example.com/payment', type: 'com_pay' }],
    },
    ...overrides,
  });
