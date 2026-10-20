import { type ArvoEvent, createArvoEventFactory } from 'arvo-core';
import { inventoryCheckV1 } from '../../../src/distributed/handler/com_inventory_check/contract.js';
import type { InjectedFailure } from '../../../src/distributed/shared/delivery-middleware.js';

/**
 * Failures injected through a layer, and what the protocol must make of
 * each — the same expectations under every mechanism.
 *
 * Aimed at the inventory check: one query and an answer, so whatever a
 * case does to it is the case's doing and nothing else's.
 */

/** A fresh request to the inventory check. */
export const anInventoryCheck = (label: string): ArvoEvent =>
  createArvoEventFactory(inventoryCheckV1).createInput({
    source: 'com.test.injection',
    subject: `inject-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    to: inventoryCheckV1.type,
    data: { sku: 'sku-1', wanted: 1 },
  });

/** Where the execution must rest once the delivery is done with. */
export type Expected = {
  /** The record's lifecycle after this delivery. */
  readonly lifecycle: 'success' | 'error' | 'failure';
  /** Whether the event published to the caller is the handler error event. */
  readonly answeredWithError: boolean;
};

/** Each failure, aimed at the inventory check, and what it must come to. */
export const INJECTION_CASES: readonly {
  readonly name: string;
  readonly failure: InjectedFailure;
  readonly expected: Expected;
}[] = [
  {
    name: 'a before part that throws: the work failed, the caller is told',
    failure: { kind: 'throw_before', into: inventoryCheckV1.type },
    expected: { lifecycle: 'error', answeredWithError: true },
  },
  {
    name: 'a before part that faults with no retry: abandoned',
    failure: {
      kind: 'fault_before',
      retryable: false,
      into: inventoryCheckV1.type,
    },
    expected: { lifecycle: 'failure', answeredWithError: true },
  },
  {
    name: 'an after part that throws: the answer stands',
    failure: { kind: 'throw_after', into: inventoryCheckV1.type },
    expected: { lifecycle: 'success', answeredWithError: false },
  },
  {
    name: 'an after part that hangs past the run clock: the answer stands',
    failure: { kind: 'hang_after', ms: 5_500, into: inventoryCheckV1.type },
    expected: { lifecycle: 'success', answeredWithError: false },
  },
  {
    name: 'a middleware-data key written twice: abandoned, no retry',
    failure: { kind: 'duplicate_key', into: inventoryCheckV1.type },
    expected: { lifecycle: 'failure', answeredWithError: true },
  },
  {
    name: 'a layer supplied twice under one identifier: abandoned, no retry',
    failure: { kind: 'duplicate_id' },
    expected: { lifecycle: 'failure', answeredWithError: true },
  },
];

/** The retryable case, which each mechanism retries in its own way. */
export const RETRYABLE_ONCE: InjectedFailure = {
  kind: 'fault_before',
  retryable: true,
  failingAttempts: 1,
  into: inventoryCheckV1.type,
};

/** What a delivery report must say for a case, under any mechanism. */
export const meetsExpectation = async (
  report: {
    lifecycle: string | null;
    // the plain loop and DBOS report payloads; Temporal reports each
    // with where it is going, the payload among it
    emitted: readonly (string | { readonly payload: string })[];
  },
  _expected: Expected,
): Promise<{ lifecycle: string | null; answeredWithError: boolean }> => {
  const { ArvoEventSerializer } = await import('arvo-core');
  const wire = new ArvoEventSerializer({ type: 'arvoevent' });
  const answers = await Promise.all(
    report.emitted.map((one) =>
      wire.deserialize(typeof one === 'string' ? one : one.payload),
    ),
  );
  return {
    lifecycle: report.lifecycle,
    answeredWithError: answers.some(
      (one) => one.type === inventoryCheckV1.error.type,
    ),
  };
};
