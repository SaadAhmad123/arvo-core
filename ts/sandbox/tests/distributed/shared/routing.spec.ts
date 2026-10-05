import {
  ARVO_CATEGORY_INIT,
  type ArvoEvent,
  createArvoEventFactory,
  deriveArvoExecutionId,
} from 'arvo-core';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inventoryCheckV1 } from '../../../src/distributed/handler/com_inventory_check/contract.js';
import { inventoryCheckHandler } from '../../../src/distributed/handler/com_inventory_check/index.js';
import { orderFulfilContract } from '../../../src/distributed/handler/com_order_fulfil/contract.js';
import { orderFulfilHandler } from '../../../src/distributed/handler/com_order_fulfil/index.js';
import { catalogueFor } from '../../../src/distributed/shared/catalogue.js';
import { readConfig } from '../../../src/distributed/shared/config.js';
import {
  type Destination,
  destinationFor,
  handlerFor,
} from '../../../src/distributed/shared/routing.js';

/**
 * Where an event goes, decided from the event alone.
 *
 * Every event here is one a handler actually built, because the whole
 * claim being tested is that a mechanism needs nothing but the event —
 * and an event assembled by the test could be given whatever fields
 * would make that look true.
 *
 * It needs the stack up and migrated: the orchestrator asks the
 * catalogue what to fan out over.
 */

/** Deliberately narrow, so a run of this is quick and still fans out. */
const NARROW = 2;

describe('where an event goes', () => {
  let pool: Pool;
  let asked: readonly ArvoEvent[];

  beforeAll(async () => {
    const config = readConfig('arvo-routing-spec');
    pool = new Pool({
      connectionString: config.recordsUrl,
      max: config.recordsPoolSize,
    });

    const { catalogue, release } = await catalogueFor(pool);
    const opening = createArvoEventFactory(
      orderFulfilContract.versions['1.0.0'],
    ).createInput({
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
      dependencies: {
        catalogue,
        executionId: 'unused',
        attempt: 0,
        resumed: null,
      },
    });
    release();

    if (ran.kind !== 'produced') throw new Error('the order asked for nothing');
    asked = ran.events;
  });

  afterAll(async () => {
    await pool.end();
  });

  /** Where one of the events the order asked for goes. */
  const destinationOf = async (type: string): Promise<Destination> => {
    const event = asked.find((one) => one.type === type);
    expect(event).toBeDefined();
    if (event === undefined) throw new Error(`${type} was never asked for`);
    return destinationFor(event);
  };

  it('opens an execution for work addressed to a handler', async () => {
    const where = await destinationOf('com_inventory_check');
    expect(where.kind).toBe('opens');
    if (where.kind !== 'opens') return;

    const event = asked.find((one) => one.type === 'com_inventory_check');
    expect(event?.category).toBe(ARVO_CATEGORY_INIT);
    // derived from the event, so the same request arriving twice finds
    // the execution the first one opened
    expect(where.executionId).toBe(
      await deriveArvoExecutionId(event as ArvoEvent),
    );
    expect(where.handler.contracts.self.type).toBe('com_inventory_check');
    // and the asking execution is carried along, which is what a
    // mechanism needs to know who is waiting
    expect(where.awaitingExecutionId).toBe(event?.executionid);
  });

  it('sends a request to itself to an execution of itself', async () => {
    const where = await destinationOf('com_category_walk');
    expect(where.kind).toBe('opens');
    if (where.kind !== 'opens') return;
    expect(where.handler.contracts.self.type).toBe('com_category_walk');
  });

  it('lets a domained event leave, whatever it was addressed to', async () => {
    const where = await destinationOf('com_manual_review');
    expect(where).toEqual({ kind: 'left', domain: expect.any(String) });
  });

  it('answers the execution that asked, which the reply names', async () => {
    const request = asked.find((one) => one.type === 'com_inventory_check');
    expect(request).toBeDefined();
    if (request === undefined) return;

    const { catalogue, release } = await catalogueFor(pool);
    const checked = await inventoryCheckHandler.execute({
      event: request,
      state: () => null,
      attempt: 0,
      dependencies: {
        catalogue,
        executionId: await deriveArvoExecutionId(request),
        attempt: 0,
        resumed: null,
      },
    });
    release();

    if (checked.kind !== 'produced') throw new Error('nothing was answered');
    const reply = checked.events[0];
    expect(reply).toBeDefined();
    if (reply === undefined) return;

    const where = await destinationFor(reply);
    expect(where.kind).toBe('answers');
    if (where.kind !== 'answers') return;

    // the execution that asked, not the one that answered: a reply
    // carries the asking execution so an answer can be routed without
    // reading a record
    expect(where.executionId).toBe(request.executionid);
    expect(where.handler.contracts.self.type).toBe('com_order_fulfil');
  });

  it('hands a run its answer, which nothing here implements', async () => {
    // What the client asked for, answered. Its `to` is whoever asked for
    // the run, and that is not a handler — so a mechanism puts it where
    // its caller can find it rather than treating it as work.
    const factory = createArvoEventFactory(inventoryCheckV1);
    const toNobody = factory.createInput({
      source: 'com.test.routing',
      subject: 'routing-outside',
      to: 'com.some.client',
      data: { sku: 'sku-wide-0001', wanted: 1 },
    });

    expect(await destinationFor(toNobody)).toEqual({
      kind: 'outside',
      addressedTo: 'com.some.client',
    });
  });

  it('finds no handler on anything an object has anyway', () => {
    // `to` is whatever the event says. A lookup that walked the
    // prototype would find something for every one of these, and what
    // it found would not be a handler.
    for (const reached of ['__proto__', 'constructor', 'toString', null]) {
      expect(handlerFor(reached)).toBeNull();
    }
  });
});
