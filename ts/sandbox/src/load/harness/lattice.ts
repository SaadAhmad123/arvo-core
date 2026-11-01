import {
  type ArvoEvent,
  createArvoDispatcher,
  createArvoEventFactory,
} from 'arvo-core';
import {
  orderFulfilContract,
  orderFulfilV1,
} from '../../distributed/handler/com_order_fulfil/contract.js';
import {
  auditWriteHandler,
  categoryWalkHandler,
  fraudCheckHandler,
  inventoryCheckHandler,
  orderFulfilHandler,
  paymentChargeHandler,
} from '../../distributed/handler/index.js';
import { decisionFor } from '../../distributed/shared/from-outside.js';
import { type CatalogueData, InMemoryCatalogue } from './catalogue.js';

/**
 * The distributed handlers as one dispatcher, and how a load run opens and
 * answers the orders they work on.
 */

/** Who places every order a load run places, and where each is answered. */
export const LOAD_CALLER = 'com.load.caller';

/** Every handler the distributed sandbox runs, as one dispatcher. */
export const createLatticeDispatcher = () =>
  createArvoDispatcher({
    handlers: [
      orderFulfilHandler,
      inventoryCheckHandler,
      categoryWalkHandler,
      paymentChargeHandler,
      fraudCheckHandler,
      auditWriteHandler,
    ],
  });

/** The dispatcher a load run delivers through. */
export type LatticeDispatcher = ReturnType<typeof createLatticeDispatcher>;

/** Each handler's catalogue for one delivery, opened for that execution alone. */
export const dependenciesFor = (data: CatalogueData) => {
  const catalogue = new InMemoryCatalogue(data);
  return {
    [orderFulfilHandler.contracts.self.type]: catalogue,
    [inventoryCheckHandler.contracts.self.type]: catalogue,
    [categoryWalkHandler.contracts.self.type]: catalogue,
    [paymentChargeHandler.contracts.self.type]: catalogue,
    [fraudCheckHandler.contracts.self.type]: catalogue,
    [auditWriteHandler.contracts.self.type]: catalogue,
  };
};

/** The event that places one order. */
export const openingOrder = (param: {
  readonly orderRef: string;
  readonly width: number;
  readonly depth: number;
}): ArvoEvent =>
  createArvoEventFactory(orderFulfilV1).createInput({
    source: LOAD_CALLER,
    subject: param.orderRef,
    to: orderFulfilContract.type,
    data: {
      orderRef: param.orderRef,
      category: 'orders',
      width: param.width,
      depth: param.depth,
    },
  });

/** The answer from outside to work that left the lattice by its domain: the review, approved. */
export const answerFromOutside = (leftEvent: ArvoEvent): ArvoEvent =>
  decisionFor(leftEvent, { approved: true, by: 'the load suite' });
