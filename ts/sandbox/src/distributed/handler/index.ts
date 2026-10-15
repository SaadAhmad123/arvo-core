import { auditWriteHandler } from './com_audit_write/index.js';
import { categoryWalkHandler } from './com_category_walk/index.js';
import { fraudCheckHandler } from './com_fraud_check/index.js';
import { inventoryCheckHandler } from './com_inventory_check/index.js';
import { orderFulfilHandler } from './com_order_fulfil/index.js';
import { paymentChargeHandler } from './com_payment_charge/index.js';

/**
 * Every handler one run needs, addressed the way an event addresses one.
 *
 * This map is the whole of what a mechanism needs to know. Given an
 * event's `to`, it finds the handler that implements that contract and
 * hands the event over; everything after that — what the event is,
 * which execution it concerns, which version owns it — is the handler's.
 *
 * `com_manual_review` is deliberately absent. Its contract carries a
 * domain, so events built from it leave the ordinary path and nothing
 * here is given them. A mechanism finding nothing under that key is
 * the domain working rather than a gap.
 */
export const HANDLERS = {
  [orderFulfilHandler.contracts.self.type]: orderFulfilHandler,
  [inventoryCheckHandler.contracts.self.type]: inventoryCheckHandler,
  [categoryWalkHandler.contracts.self.type]: categoryWalkHandler,
  [paymentChargeHandler.contracts.self.type]: paymentChargeHandler,
  [fraudCheckHandler.contracts.self.type]: fraudCheckHandler,
  [auditWriteHandler.contracts.self.type]: auditWriteHandler,
} as const;

/** What a handler looks like to a mechanism that only routes to it. */
export type RoutableHandler = (typeof HANDLERS)[keyof typeof HANDLERS];

export {
  auditWriteHandler,
  categoryWalkHandler,
  fraudCheckHandler,
  inventoryCheckHandler,
  orderFulfilHandler,
  paymentChargeHandler,
};
