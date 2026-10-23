import {
  type ArvoEvent,
  ArvoEventHandler,
  createArvoEventFactory,
  type JSONValue,
  mutateArvoEvent,
} from 'arvo-core';
import { Pool } from 'pg';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { auditWriteV1 } from '../../../src/distributed/handler/com_audit_write/contract.js';
import { inventoryCheckV1 } from '../../../src/distributed/handler/com_inventory_check/contract.js';
import { manualReviewV1 } from '../../../src/distributed/handler/com_manual_review/contract.js';
import { HANDLERS } from '../../../src/distributed/handler/index.js';
import { deliveryTelemetry } from '../../../src/distributed/handler/telemetry.js';
import { readConfig } from '../../../src/distributed/shared/config.js';
import {
  deliveryLayers,
  withDeliveryInScope,
} from '../../../src/distributed/shared/delivery-middleware.js';
import {
  catalogueFor,
  dispatcherFor,
} from '../../../src/distributed/shared/dispatcher.js';
import { handlerFor } from '../../../src/distributed/shared/routing.js';
import { anInventoryCheck } from './injection.js';
import {
  anOrder,
  type Enter,
  FrozenStockCatalogue,
  type Walk,
  walkLattice,
} from './lattice-walk.js';

/**
 * Entering a handler through a dispatcher is entering that handler.
 *
 * ADR-017 lets a dispatcher pick a handler and nothing else: the same
 * event, record, attempt, dependency and layers reach the handler as
 * reach it directly, and its response comes back as it was. The claim is
 * tested here differentially — the same run carried out twice, once
 * through each mechanism's dispatcher and once straight into each
 * handler, and the two compared delivery by delivery.
 *
 * Needs the stack up and migrated, the handlers reading their own data.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

/** What an event says, less its instant and its trace context, which are each walk's own. */
const shapeOf = (event: ArvoEvent) => ({
  id: event.id,
  type: event.type,
  to: event.to,
  source: event.source,
  subject: event.subject,
  domain: event.domain,
  executionid: event.executionid,
  parentid: event.parentid,
  dataschema: event.dataschema,
  data: event.data,
});

/** Keys holding an instant, which a clock chose rather than a handler. */
const INSTANT = /(^time$|At$|Time$)/;

/** A record, less every instant in it. */
const withoutInstants = (value: JSONValue): JSONValue => {
  if (Array.isArray(value)) return value.map(withoutInstants);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !INSTANT.test(key))
      .map(([key, inner]) => [key, withoutInstants(inner)]),
  );
};

/** An event identifier, or an execution identifier derived from one. */
const MINTED =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{64}/g;

/**
 * Every minted identifier renamed for the order it first appears in.
 *
 * Event identifiers are random, and execution identifiers are derived
 * from them, so two walks never share one. What they must share is the
 * pattern: which event answers which, which record belongs to which
 * execution. Renaming by first appearance keeps every such link and
 * drops only the random value under it.
 */
const canonical = (value: unknown): unknown => {
  const labels = new Map<string, string>();
  return JSON.parse(
    JSON.stringify(value).replace(MINTED, (minted) => {
      const known = labels.get(minted);
      if (known !== undefined) return known;
      const label = `minted-${labels.size}`;
      labels.set(minted, label);
      return label;
    }),
  );
};

/** One walk, reduced to what two equivalent ways of entering must agree on. */
const comparable = (walk: Walk) =>
  canonical({
    steps: walk.steps.map(({ event, entered }) => ({
      delivered: shapeOf(event),
      outcome: entered.ok ? entered.value.kind : entered.error.faultKind,
      emitted:
        entered.ok && entered.value.kind === 'produced'
          ? entered.value.events.map(shapeOf)
          : [],
      record:
        entered.ok && entered.value.kind === 'produced'
          ? withoutInstants(entered.value.state)
          : null,
    })),
    left: walk.left.map(shapeOf),
    outside: walk.outside.map(shapeOf),
  });

describe('entering through a dispatcher', () => {
  let pool: Pool;

  beforeAll(() => {
    const config = readConfig('arvo-dispatcher-differential-spec');
    pool = new Pool({
      connectionString: config.recordsUrl,
      max: config.recordsPoolSize,
    });
  });

  afterAll(async () => {
    await pool?.end();
  });

  /** Straight into the handler routing finds, with the mechanism's layers supplied. */
  const directly =
    (
      mechanism: 'temporal' | 'dbos' | 'replay',
      catalogue: FrozenStockCatalogue,
    ): Enter =>
    (event, state) => {
      const handler = handlerFor(event.to);
      if (handler === null) throw new Error(`nothing takes ${event.to}`);
      return withDeliveryInScope(event, () =>
        handler.tryExecute({
          event,
          state,
          attempt: 0,
          dependencies: catalogue,
          middleware: deliveryLayers(mechanism),
          telemetry: deliveryTelemetry(),
        }),
      );
    };

  /** Through the mechanism's dispatcher, every handler given the one catalogue. */
  const throughDispatcher =
    (
      mechanism: 'temporal' | 'dbos' | 'replay',
      catalogue: FrozenStockCatalogue,
    ): Enter =>
    (event, state) =>
      withDeliveryInScope(event, () =>
        dispatcherFor(mechanism).tryExecute({
          event,
          state,
          attempt: 0,
          dependencies: Object.fromEntries(
            dispatcherFor(mechanism).handlers.map((handler) => [
              handler.contracts.self.type,
              catalogue,
            ]),
          ),
          telemetry: deliveryTelemetry(),
        }),
      );

  it.each(['temporal', 'dbos', 'replay'] as const)(
    'carries a whole run under %s exactly as entering each handler directly does',
    async (mechanism) => {
      const opening = anOrder(`differential-${mechanism}`);
      const viaDispatcher = await walkLattice(
        opening,
        throughDispatcher(mechanism, new FrozenStockCatalogue(pool)),
      );
      const direct = await walkLattice(
        opening,
        directly(mechanism, new FrozenStockCatalogue(pool)),
      );

      // a run that does nothing would agree with anything
      expect(viaDispatcher.steps.length).toBeGreaterThan(5);
      // every handler but the audit write, which the order asks for only
      // once the review that left by domain has answered
      expect(new Set(viaDispatcher.steps.map(({ event }) => event.to))).toEqual(
        new Set(
          Object.keys(HANDLERS).filter((type) => type !== auditWriteV1.type),
        ),
      );
      expect(viaDispatcher.left.length).toBeGreaterThan(0);

      expect(comparable(viaDispatcher)).toEqual(comparable(direct));
    },
  );

  it('tells apart a walk in which one delivery was altered on its way in', async () => {
    // The control: were the comparison blind to what reached a handler,
    // every differential above would pass whatever the dispatcher did.
    const opening = anOrder('control');
    const faithful = throughDispatcher(
      'replay',
      new FrozenStockCatalogue(pool),
    );
    const altering = throughDispatcher(
      'replay',
      new FrozenStockCatalogue(pool),
    );
    let altered = false;
    const viaAltering = await walkLattice(opening, (event, state) => {
      if (altered || event.to !== inventoryCheckV1.type) {
        return altering(event, state);
      }
      altered = true;
      const data = inventoryCheckV1.input.parse(event.data);
      return altering(
        mutateArvoEvent(event, { data: { ...data, wanted: 1_000_000 } }),
        state,
      );
    });
    expect(altered).toBe(true);
    expect(comparable(viaAltering)).not.toEqual(
      comparable(await walkLattice(opening, faithful)),
    );
  });

  it.each(['temporal', 'dbos', 'replay'] as const)(
    'carries an audit write under %s exactly as entering the handler directly does',
    async (mechanism) => {
      const opening = createArvoEventFactory(auditWriteV1).createInput({
        source: 'com.test.dispatcher',
        subject: `dispatch-audit-${mechanism}-${Date.now()}`,
        to: auditWriteV1.type,
        data: { orderRef: 'order-audit', outcome: 'fulfilled' },
      });
      const viaDispatcher = await walkLattice(
        opening,
        throughDispatcher(mechanism, new FrozenStockCatalogue(pool)),
      );
      const direct = await walkLattice(
        opening,
        directly(mechanism, new FrozenStockCatalogue(pool)),
      );
      expect(viaDispatcher.steps).toHaveLength(1);
      expect(comparable(viaDispatcher)).toEqual(comparable(direct));
    },
  );

  it('enters each handler exactly once per delivery, with the event it was given', async () => {
    const entered = vi.spyOn(ArvoEventHandler.prototype, 'tryExecute');
    const walk = await walkLattice(
      anOrder('once-each'),
      throughDispatcher('replay', new FrozenStockCatalogue(pool)),
    );
    expect(entered).toHaveBeenCalledTimes(walk.steps.length);
    walk.steps.forEach(({ event }, index) => {
      const given = entered.mock.calls[index]?.[0];
      // no SDK is registered here, so the dispatcher's span does not
      // record and the event passes on untouched rather than as a copy
      expect(given?.event).toBe(event);
      expect(given?.attempt).toBe(0);
      expect(given?.middleware).toBe(dispatcherFor('replay').middlewares);
    });
    // each delivery reached the handler its `to` names, and only that one
    walk.steps.forEach(({ event }, index) => {
      expect(entered.mock.contexts[index]).toBe(handlerFor(event.to));
    });
  });

  it('hands each handler its own dependency and nothing of the others’', async () => {
    const entered = vi.spyOn(ArvoEventHandler.prototype, 'tryExecute');
    const byType = Object.fromEntries(
      dispatcherFor('replay').handlers.map((handler) => [
        handler.contracts.self.type,
        new FrozenStockCatalogue(pool),
      ]),
    );
    const walk = await walkLattice(anOrder('own-dependency'), (event, state) =>
      withDeliveryInScope(event, () =>
        dispatcherFor('replay').tryExecute({
          event,
          state,
          attempt: 0,
          dependencies: byType,
        }),
      ),
    );
    walk.steps.forEach(({ event }, index) => {
      expect(entered.mock.calls[index]?.[0].dependencies).toBe(
        byType[event.to ?? ''],
      );
    });
  });

  it('gives a handler no dependency where none is supplied, and it refuses as it would directly', async () => {
    const event = anInventoryCheck('no-dependency');
    const viaDispatcher = await withDeliveryInScope(event, () =>
      dispatcherFor('replay').tryExecute({
        event,
        state: () => null,
        attempt: 0,
      }),
    );
    const handler = handlerFor(event.to);
    if (handler === null) throw new Error('nothing takes an inventory check');
    const direct = await withDeliveryInScope(event, () =>
      handler.tryExecute({
        event,
        state: () => null,
        attempt: 0,
        middleware: deliveryLayers('replay'),
      }),
    );
    expect(viaDispatcher.ok).toBe(false);
    expect(direct.ok).toBe(false);
    if (viaDispatcher.ok || direct.ok) return;
    expect(viaDispatcher.error.faultKind).toBe(direct.error.faultKind);
    expect(viaDispatcher.error.message).toBe(direct.error.message);
    expect(viaDispatcher.error.retry).toEqual(direct.error.retry);
  });

  it('returns the handler’s fault as the handler raised it, not one of its own', async () => {
    const event = anInventoryCheck('handler-fault');
    const executed = await withDeliveryInScope(event, () =>
      dispatcherFor('replay').tryExecute({
        event,
        state: () => null,
        attempt: 0,
      }),
    );
    expect(executed.ok).toBe(false);
    if (executed.ok) return;
    expect(executed.error.faultKind).not.toBe('handler_not_found');
    expect(executed.error.message).toContain(inventoryCheckV1.type);
  });

  it('does not route: an event carrying a domain still reaches the handler its `to` names', async () => {
    // Leaving the lattice by domain is the mechanism's decision, made
    // before any dispatcher is asked; a dispatcher picks by `to` alone.
    const event = mutateArvoEvent(anInventoryCheck('domained'), {
      domain: 'human.review',
    });
    const executed = await withDeliveryInScope(event, () =>
      dispatcherFor('replay').tryExecute({
        event,
        state: () => null,
        attempt: 0,
        dependencies: catalogueFor(pool),
      }),
    );
    expect(executed.ok && executed.value.kind).toBe('produced');
  });
});

describe('an event no handler in the set takes', () => {
  /** Readdressed from a real request, so only `to` is wrong. */
  const addressedTo = (to: string) =>
    mutateArvoEvent(anInventoryCheck('unhandled'), { to });

  it.each([
    'com.some.client',
    manualReviewV1.type,
    '__proto__',
    'constructor',
    'toString',
  ])(
    'is refused as handler_not_found where it is addressed to %j',
    async (to) => {
      const entered = vi.spyOn(ArvoEventHandler.prototype, 'tryExecute');
      const event = addressedTo(to);
      const executed = await dispatcherFor('replay').tryExecute({
        event,
        state: () => {
          throw new Error(
            'nothing may read a record for an event no handler takes',
          );
        },
        attempt: 3,
      });

      expect(entered).not.toHaveBeenCalled();
      expect(executed.ok).toBe(false);
      if (executed.ok) return;
      const fault = executed.error;
      expect(fault.faultKind).toBe('handler_not_found');
      expect(fault.message).toContain(to);
      // non-retryable, and nothing to abandon: no handler ever ran
      expect(fault.retry).toBeNull();
      expect(fault.abandonmentEvent).toBeNull();
      expect(fault.abandonmentState).toBeNull();
      expect(fault.executionId).toBeNull();
      expect(fault.eventId).toBe(event.id);
      expect(fault.subject).toBe(event.subject);
      expect(fault.attempt).toBe(3);
    },
  );

  it('is refused the same way by every mechanism’s dispatcher', async () => {
    const event = addressedTo('com.some.client');
    const kinds = await Promise.all(
      (['temporal', 'dbos', 'replay'] as const).map(async (mechanism) => {
        const executed = await dispatcherFor(mechanism).tryExecute({
          event,
          state: () => null,
          attempt: 0,
        });
        return executed.ok ? 'entered' : executed.error.faultKind;
      }),
    );
    expect(kinds).toEqual([
      'handler_not_found',
      'handler_not_found',
      'handler_not_found',
    ]);
  });

  it('is thrown as the fault itself by execute', async () => {
    await expect(
      dispatcherFor('replay').execute({
        event: addressedTo('com.some.client'),
        state: () => null,
        attempt: 0,
      }),
    ).rejects.toMatchObject({ faultKind: 'handler_not_found' });
  });
});
