import { describe, expect, it } from 'vitest';
import { createArvoEventFactory } from '../../../src/factories/ArvoEventFactory/index.js';
import { ArvoLattice } from '../version/scenarios/lattice.js';
import {
  declareHandler,
  declareInventoryWorker,
  declarePaymentWorker,
  fulfilContract,
  fulfilV1,
  inventoryV1,
  paymentV1,
} from './fixture.js';
import { checkHandlerInvariants } from './invariants.js';

/**
 * The same lattice, with the handler as the thing being driven.
 *
 * Everything the lattice used to settle before reaching a version — what
 * the event is, which execution it concerns, what is stored under it,
 * which version owns that — it now settles nothing of. It publishes an
 * event and hands it over whole.
 *
 * That substitution is the test. Every invariant the version's suite
 * asserts must still hold, because moving who decides changes nothing
 * about what is true.
 */

/** A lattice that drives handlers, and settles nothing itself. */
const latticeWithHandlers = (options: { seed?: number } = {}) =>
  new ArvoLattice({
    versions: {},
    handlers: {
      [fulfilContract.type]: declareHandler() as never,
      // the services answer through handlers of their own, so every
      // event in the lattice passes through a gate rather than around one
      [inventoryV1.type]: declareInventoryWorker() as never,
      [paymentV1.type]: declarePaymentWorker() as never,
    },
    ...(options.seed === undefined ? {} : { seed: options.seed }),
  });

const anOrder = (subject: string) =>
  createArvoEventFactory(fulfilV1).createInput({
    source: 'com.web.checkout',
    subject,
    to: fulfilContract.type,
    data: { items: ['book'] },
  });

describe('a lattice driving the handler rather than a version', () => {
  it('carries a workflow through, with nothing settled before the gate', async () => {
    const lattice = latticeWithHandlers();
    lattice.publish(anOrder('order-1'));
    await lattice.settle();

    expect(lattice.transcript.faults).toEqual([]);

    // the order, and one execution of each service it asked
    expect(lattice.store.size).toBe(3);
    expect(
      [...lattice.store.values()].map((row) => row.lifecycle).sort(),
    ).toEqual(['success', 'success', 'success']);

    // and the caller heard back
    const answered = lattice.transcript.published.filter(
      (event) => event.type === 'evt_order_fulfilled',
    );
    expect(answered).toHaveLength(1);
    expect(answered[0]?.to).toBe('com.web.checkout');
  });

  it('holds every invariant, including those only this layer can break', async () => {
    const lattice = latticeWithHandlers();
    for (let at = 0; at < 10; at += 1) lattice.publish(anOrder(`order-${at}`));
    await lattice.settle();

    await checkHandlerInvariants(lattice);
    expect(lattice.transcript.committed.length).toBeGreaterThan(0);
  });
});
