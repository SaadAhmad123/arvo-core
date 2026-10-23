import { createArvoDispatcher } from 'arvo-core';
import type { Pool } from 'pg';
import {
  auditWriteHandler,
  categoryWalkHandler,
  fraudCheckHandler,
  inventoryCheckHandler,
  orderFulfilHandler,
  paymentChargeHandler,
} from '../handler/index.js';
import { PostgresCatalogue } from './catalogue.js';
import { deliveryLayers, type Mechanism } from './delivery-middleware.js';

/**
 * The set of handlers every mechanism runs, as one dispatcher (ADR-017).
 *
 * Each mechanism has its own, differing only in the layer that names it:
 * a dispatcher's layers are fixed when it is declared, so the mechanism's
 * name is part of its declaration rather than of each call. Nothing else
 * differs, and a dispatcher holds nothing between calls, so one per
 * mechanism serves every delivery that mechanism makes.
 *
 * `com_manual_review` is deliberately absent, as it is from `HANDLERS`:
 * its events leave by domain, and a dispatcher finding nothing for one is
 * the domain working.
 */

const declareFor = (mechanism: Mechanism) =>
  createArvoDispatcher({
    handlers: [
      orderFulfilHandler,
      inventoryCheckHandler,
      categoryWalkHandler,
      paymentChargeHandler,
      fraudCheckHandler,
      auditWriteHandler,
    ],
    middlewares: deliveryLayers(mechanism),
  });

/** The dispatcher type every mechanism holds. */
export type LatticeDispatcher = ReturnType<typeof declareFor>;

const DISPATCHERS = {
  temporal: declareFor('temporal'),
  dbos: declareFor('dbos'),
  replay: declareFor('replay'),
} as const satisfies Record<Mechanism, LatticeDispatcher>;

/**
 * The dispatcher one mechanism enters handlers through.
 *
 * @param mechanism - Which mechanism is asking.
 */
export const dispatcherFor = (mechanism: Mechanism): LatticeDispatcher =>
  DISPATCHERS[mechanism];

/**
 * Every handler's dependency for one delivery: the catalogue, on one
 * connection the picked handler opens and closes. Keyed by handler type,
 * as a dispatcher takes dependencies; the dispatcher gives the picked
 * handler its own entry and nothing of the others'.
 *
 * @param pool - Where the handlers' own data is.
 */
export const catalogueFor = (pool: Pool) => {
  const catalogue = new PostgresCatalogue(pool);
  return {
    [orderFulfilHandler.contracts.self.type]: catalogue,
    [inventoryCheckHandler.contracts.self.type]: catalogue,
    [categoryWalkHandler.contracts.self.type]: catalogue,
    [paymentChargeHandler.contracts.self.type]: catalogue,
    [fraudCheckHandler.contracts.self.type]: catalogue,
    [auditWriteHandler.contracts.self.type]: catalogue,
  };
};
