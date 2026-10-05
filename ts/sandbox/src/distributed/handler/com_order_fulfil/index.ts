import type { ArvoEvent } from 'arvo-core';
import { ArvoDomain, setupArvoEventHandler } from 'arvo-core';
import { z } from 'zod';
import { auditWriteV1 } from '../com_audit_write/contract.js';
import { categoryWalkV1 } from '../com_category_walk/contract.js';
import { fraudCheckV1 } from '../com_fraud_check/contract.js';
import { inventoryCheckV1 } from '../com_inventory_check/contract.js';
import { manualReviewV1 } from '../com_manual_review/contract.js';
import { paymentChargeV1 } from '../com_payment_charge/contract.js';
import type { DistributedDependencies } from '../dependencies.js';
import { HANDLER_TELEMETRY } from '../telemetry.js';
import { orderFulfilContract } from './contract.js';

/**
 * The orchestrator, at two versions.
 *
 * It asks for everything at once and answers once everything has
 * answered, which is the shape the whole run is built to stress: one
 * execution holding five hundred outstanding requests, a recursive
 * branch, a branch that left the lattice entirely, work that fails and
 * recovers, and work that is given up on.
 *
 * Two things here are worth reading rather than skimming.
 *
 * It asks the review through a contract carrying a `domain`, so that
 * request leaves the ordinary path and nothing in the run can answer
 * it. The execution then rests at `waiting` until something outside
 * does, which is the only honest way to model a person.
 *
 * And the audit write goes out **in the same batch as the completion**.
 * A sink answers nobody, so asking for one and then waiting would wait
 * forever; the protocol's mixed batch is what makes fire-and-forget
 * expressible at all. Asking for it on the way in would deadlock the
 * order, and that is a mistake worth having written down.
 */

/** What each version remembers while it waits. */
const firstMemory = z.object({
  orderRef: z.string(),
  /** How many of the fan-out came back sufficient. */
  sufficient: z.number(),
  /** How many were asked, so an answer can say whether all came back. */
  asked: z.number(),
});

const secondMemory = firstMemory.extend({
  /** What only the second version carries, so neither stands in for the other. */
  expedited: z.boolean(),
});

/**
 * What an execution asks for, as requests rather than as events.
 *
 * Both versions ask for the same things, but each builds them through
 * its own context — so what is shared here is the decision and not the
 * building. Trying to share the building instead means passing a
 * loosely typed `build` around, and the compiler refuses: it is the
 * closed emittable set doing its job, and working around it would
 * discard the one check that happens before anything runs.
 */
type ServiceRequest =
  | { type: 'com_inventory_check'; data: { sku: string; wanted: number } }
  | { type: 'com_category_walk'; data: { category: string; remaining: number } }
  | {
      type: 'com_payment_charge';
      data: { amount: number; currency: string; failuresBeforeSuccess: number };
    }
  | { type: 'com_fraud_check'; data: { orderRef: string } }
  | {
      type: 'com_manual_review';
      data: { orderRef: string; because: string };
      /**
       * Said out loud, which is the rule rather than a formality.
       *
       * A domained event is lifted out of the lattice holding it and
       * fulfilled somewhere else entirely, so ADR-001 makes `null` the
       * default and the ordinary case. Leaving a contract's own domain
       * to be inherited would mean work silently escaping the lattice
       * because of something written in a contract somebody else
       * declared — so the asker names the domain, or names where to
       * read one from, every time it asks.
       */
      domain: typeof ArvoDomain.FROM_EVENT_CONTRACT;
    };

const requestsFor = async (
  catalogue: DistributedDependencies['catalogue'],
  order: {
    orderRef: string;
    category: string;
    width: number;
    depth: number;
  },
): Promise<ServiceRequest[]> => {
  const items = await catalogue.itemsIn(order.category);

  return [
    // the fan-out: one execution per item, all outstanding at once
    ...items.slice(0, order.width).map(
      (sku): ServiceRequest => ({
        type: 'com_inventory_check',
        data: { sku, wanted: 1 },
      }),
    ),

    // the recursive branch
    {
      type: 'com_category_walk',
      data: { category: order.category, remaining: order.depth },
    },

    // work that fails and then does not
    {
      type: 'com_payment_charge',
      data: { amount: 42, currency: 'GBP', failuresBeforeSuccess: 2 },
    },

    // work that never succeeds, and must be given up on
    { type: 'com_fraud_check', data: { orderRef: order.orderRef } },

    // Work nothing here can do, which leaves the lattice — and says so,
    // by naming the contract its domain is read from.
    {
      type: 'com_manual_review',
      data: { orderRef: order.orderRef, because: 'every order in this run' },
      domain: ArvoDomain.FROM_EVENT_CONTRACT,
    },
  ];
};

/** How many of the fan-out came back able to supply what was wanted. */
const sufficientAmong = (
  responses: Iterable<ArvoEvent | null>,
): { sufficient: number; checked: number } => {
  let sufficient = 0;
  let checked = 0;

  for (const response of responses) {
    if (response === null) continue;
    if (response.type !== 'evt_inventory_checked') continue;

    checked += 1;
    if ((response.data as { sufficient: boolean }).sufficient) sufficient += 1;
  }

  return { sufficient, checked };
};

export const orderFulfilHandler = setupArvoEventHandler({
  contracts: {
    self: orderFulfilContract,
    services: {
      inventory: inventoryCheckV1,
      walk: categoryWalkV1,
      payment: paymentChargeV1,
      fraud: fraudCheckV1,
      review: manualReviewV1,
      audit: auditWriteV1,
    },
  },
  types: {} as { dependencies: DistributedDependencies },
  telemetry: HANDLER_TELEMETRY,
  options: {
    // A wide execution rebuilds its whole collection on every answer,
    // so one entry is not where the time goes — but five hundred of
    // them is, and this is what bounds the slowest of them.
    runTimeout: 30_000,
    maxRetryAttempts: 3,
    // No bound on the whole execution: it waits on a person, and a
    // person may take as long as they like. ADR-009 makes this the
    // default for exactly that reason.
    executionTimeout: null,
  },
})
  .handler('1.0.0', {
    state: firstMemory,
    execute: async (ctx) => {
      const requested = ctx.state.initEvent.data;

      if (ctx.entry === 'init') {
        const requests = await Promise.all(
          (await requestsFor(ctx.dependencies.catalogue, requested)).map(
            (request) => ctx.build(request),
          ),
        );
        await ctx.setState({
          data: {
            orderRef: requested.orderRef,
            sufficient: 0,
            asked: requests.length,
          },
        });
        ctx.telemetry.logger.info('asked everything', {
          orderRef: requested.orderRef,
          requests: requests.length,
        });
        return requests;
      }

      const { sufficient, checked } = sufficientAmong(
        ctx.state.inFlightEventMap.values(),
      );

      // Anything that answered with its own handler error event was
      // given up on. The order still concludes: being told is an
      // answer, and an order that waits for work nobody will do is
      // worse than an order that reports it.
      const givenUpOn = [...ctx.state.inFlightEventMap.values()].filter(
        (response) => response?.type?.startsWith('handler_') === true,
      ).length;

      await ctx.setState({
        data: {
          orderRef: requested.orderRef,
          sufficient,
          asked: ctx.state.inFlightEventMap.size,
        },
      });

      ctx.telemetry.logger.info('fulfilled', {
        orderRef: requested.orderRef,
        checked,
        sufficient,
        givenUpOn,
      });

      // The completion and the audit write leave together. The audit
      // answers nobody, so this is the only shape in which it can be
      // asked for at all.
      return Promise.all([
        ctx.build({
          type: 'evt_order_fulfilled',
          data: {
            orderRef: requested.orderRef,
            checked,
            approved: givenUpOn === 0 && sufficient === checked,
          },
        }),
        ctx.build({
          type: 'com_audit_write',
          data: { orderRef: requested.orderRef, outcome: 'fulfilled' },
        }),
      ]);
    },
  })
  .handler('2.0.0', {
    state: secondMemory,
    execute: async (ctx) => {
      const requested = ctx.state.initEvent.data;

      if (ctx.entry === 'init') {
        const requests = await Promise.all(
          (await requestsFor(ctx.dependencies.catalogue, requested)).map(
            (request) => ctx.build(request),
          ),
        );
        await ctx.setState({
          data: {
            orderRef: requested.orderRef,
            sufficient: 0,
            asked: requests.length,
            expedited: requested.expedited,
          },
        });
        return requests;
      }

      const { sufficient, checked } = sufficientAmong(
        ctx.state.inFlightEventMap.values(),
      );

      await ctx.setState({
        data: {
          orderRef: requested.orderRef,
          sufficient,
          asked: ctx.state.inFlightEventMap.size,
          expedited: requested.expedited,
        },
      });

      return Promise.all([
        ctx.build({
          type: 'evt_order_dispatched',
          data: {
            orderRef: requested.orderRef,
            checked,
            tracking: `${requested.expedited ? 'EXP' : 'STD'}-${requested.orderRef}`,
          },
        }),
        ctx.build({
          type: 'com_audit_write',
          data: { orderRef: requested.orderRef, outcome: 'dispatched' },
        }),
      ]);
    },
  })
  .build();
