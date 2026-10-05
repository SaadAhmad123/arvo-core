import {
  type ArvoEvent,
  cloneArvoEvent,
  createArvoEventFactory,
} from 'arvo-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { inventoryCheckV1 } from '../../../src/distributed/handler/com_inventory_check/contract.js';
import { inventoryCheckHandler } from '../../../src/distributed/handler/com_inventory_check/index.js';
import {
  orderFulfilContract,
  orderFulfilV1,
} from '../../../src/distributed/handler/com_order_fulfil/contract.js';
import { orderFulfilHandler } from '../../../src/distributed/handler/com_order_fulfil/index.js';
import {
  destinationFor,
  handlerFor,
} from '../../../src/distributed/shared/routing.js';

/**
 * Where an event goes, decided from the event alone.
 *
 * Every event here is one a handler actually built, because the claim
 * being tested is that a mechanism needs nothing but the event — and an
 * event assembled by the test could be given whatever fields would make
 * that look true.
 *
 * Needs the stack up and migrated.
 */

/** Narrow, so a run of this is quick and still fans out. */
const NARROW = 2;

describe('where an event goes', () => {
  let asked: readonly ArvoEvent[];

  beforeAll(async () => {
    const opening = createArvoEventFactory(orderFulfilV1).createInput({
      source: 'com.test.routing',
      subject: 'routing-1',
      to: orderFulfilContract.type,
      data: {
        orderRef: 'order-routing-1',
        category: 'orders',
        width: NARROW,
        depth: 2,
      },
    });

    const ran = await orderFulfilHandler.execute({
      event: opening,
      state: () => null,
      attempt: 0,
      dependencies: { executionId: 'unused', attempt: 0, resumed: null },
    });

    if (ran.kind !== 'produced') throw new Error('the order asked for nothing');
    asked = ran.events;
  });

  /** One of the events the order asked for. */
  const askedFor = (type: string): ArvoEvent => {
    const event = asked.find((one) => one.type === type);
    if (event === undefined) throw new Error(`${type} was never asked for`);
    return event;
  };

  it('goes to the handler its `to` names', () => {
    const where = destinationFor(askedFor('com_inventory_check'));
    expect(where.kind).toBe('handled');
    if (where.kind !== 'handled') return;
    expect(where.handler.contracts.self.type).toBe('com_inventory_check');
  });

  it('goes to an execution of the same handler where a handler asked itself', () => {
    const where = destinationFor(askedFor('com_category_walk'));
    expect(where.kind).toBe('handled');
    if (where.kind !== 'handled') return;
    expect(where.handler.contracts.self.type).toBe('com_category_walk');
  });

  it('leaves the lattice where it carries a domain, whatever it is addressed to', () => {
    expect(destinationFor(askedFor('com_manual_review'))).toEqual({
      kind: 'left',
      domain: expect.any(String),
    });
  });

  it('goes nowhere here where nothing implements what it is addressed to', () => {
    const answer = createArvoEventFactory(inventoryCheckV1).createInput({
      source: 'com.test.routing',
      subject: 'routing-outside',
      to: 'com.some.client',
      data: { sku: 'sku-wide-0001', wanted: 1 },
    });

    expect(destinationFor(answer)).toEqual({
      kind: 'outside',
      addressedTo: 'com.some.client',
    });
  });

  it('is decided by `to` and by nothing else about the event', async () => {
    const request = askedFor('com_inventory_check');
    const checked = await inventoryCheckHandler.execute({
      event: request,
      state: () => null,
      attempt: 0,
      dependencies: { executionId: 'unused', attempt: 0, resumed: null },
    });
    if (checked.kind !== 'produced') throw new Error('nothing was answered');

    const reply = checked.events[0];
    if (reply === undefined) throw new Error('nothing was answered');

    // A reply goes to the handler that asked, which is what its `to`
    // names and is a different handler from the one that sent it.
    const answering = destinationFor(reply);
    expect(answering.kind).toBe('handled');
    if (answering.kind !== 'handled') return;
    expect(answering.handler.contracts.self.type).toBe('com_order_fulfil');

    // The same request readdressed goes elsewhere, though its type,
    // source, dataschema and category all still say inventory.
    const readdressed = destinationFor(
      cloneArvoEvent(request, { to: 'com_fraud_check' }),
    );
    expect(readdressed.kind).toBe('handled');
    if (readdressed.kind !== 'handled') return;
    expect(readdressed.handler.contracts.self.type).toBe('com_fraud_check');
  });

  it('finds no handler on anything an object has anyway', () => {
    for (const reached of ['__proto__', 'constructor', 'toString', null]) {
      expect(handlerFor(reached)).toBeNull();
    }
  });
});
