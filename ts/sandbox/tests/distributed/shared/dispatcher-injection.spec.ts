import { ArvoDispatcher, mutateArvoEvent } from 'arvo-core';
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
import {
  type DeliveryScope,
  deliverOnce,
  UnroutableDelivery,
} from '../../../src/distributed/replay/delivery.js';
import { readConfig } from '../../../src/distributed/shared/config.js';
import {
  type InjectedFailure,
  injectFailuresBySubject,
  withDeliveryInScope,
} from '../../../src/distributed/shared/delivery-middleware.js';
import {
  catalogueFor,
  dispatcherFor,
} from '../../../src/distributed/shared/dispatcher.js';
import { storeFor } from '../../../src/distributed/shared/record-store.js';
import {
  anInventoryCheck,
  type Expected,
  meetsExpectation,
} from './injection.js';

/**
 * The failure-injection layers, now fixed on each mechanism's dispatcher.
 *
 * A dispatcher's layers are declared once, so the layers cannot be told
 * which delivery they are part of; they read it from the delivery in
 * scope instead. That makes one thing worth proving that was not before:
 * deliveries running at once each see their own event, and only their
 * own failure.
 *
 * Needs the stack up and migrated.
 */

/** What each failure must come to, under any mechanism. */
const CASES: readonly {
  readonly failure: InjectedFailure | null;
  readonly expected: Expected;
}[] = [
  {
    failure: { kind: 'factory_throws' },
    expected: { lifecycle: 'failure', answeredWithError: true },
  },
  {
    failure: { kind: 'factory_returns_nothing' },
    expected: { lifecycle: 'failure', answeredWithError: true },
  },
  {
    failure: { kind: 'duplicate_id' },
    expected: { lifecycle: 'failure', answeredWithError: true },
  },
  {
    failure: { kind: 'throw_before' },
    expected: { lifecycle: 'error', answeredWithError: true },
  },
  {
    failure: null,
    expected: { lifecycle: 'success', answeredWithError: false },
  },
];

/** How many deliveries run at once: every case, several times over, interleaved. */
const ROUNDS = 4;

describe('failure injection through a dispatcher’s fixed layers', () => {
  let pool: Pool;
  let scope: DeliveryScope;

  beforeAll(() => {
    const config = readConfig('arvo-dispatcher-injection-spec');
    pool = new Pool({
      connectionString: config.recordsUrl,
      max: config.recordsPoolSize,
    });
    scope = { store: storeFor(pool), pool };
  });

  afterEach(() => {
    injectFailuresBySubject(null);
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('gives each of many deliveries running at once its own failure, and no other', async () => {
    const planned = Array.from({ length: ROUNDS }, (_, round) =>
      CASES.map((one) => ({
        ...one,
        event: anInventoryCheck(
          `scoped-${round}-${one.failure?.kind ?? 'clean'}`,
        ),
      })),
    ).flat();
    injectFailuresBySubject(
      new Map(
        planned.flatMap(({ event, failure }) =>
          failure === null ? [] : [[event.subject, failure] as const],
        ),
      ),
    );

    const reports = await Promise.all(
      planned.map(({ event }) => deliverOnce(scope, event, 0)),
    );

    const came = await Promise.all(
      reports.map((report, index) =>
        meetsExpectation(report, planned[index]?.expected ?? CASES[0].expected),
      ),
    );
    expect(came).toEqual(planned.map(({ expected }) => expected));
  });

  it('applies no workflow’s failure to a call made outside any delivery', async () => {
    const event = anInventoryCheck('unscoped');
    injectFailuresBySubject(
      new Map([[event.subject, { kind: 'factory_throws' }]]),
    );

    const executed = await dispatcherFor('replay').tryExecute({
      event,
      state: () => null,
      attempt: 0,
      dependencies: catalogueFor(pool),
    });
    expect(executed.ok && executed.value.kind).toBe('produced');
  });

  it('reads the innermost delivery where one runs inside another', async () => {
    const outer = anInventoryCheck('outer');
    const inner = anInventoryCheck('inner');
    injectFailuresBySubject(
      new Map([[outer.subject, { kind: 'factory_throws' }]]),
    );

    const executed = await withDeliveryInScope(outer, () =>
      withDeliveryInScope(inner, () =>
        dispatcherFor('replay').tryExecute({
          event: inner,
          state: () => null,
          attempt: 0,
          dependencies: catalogueFor(pool),
        }),
      ),
    );
    expect(executed.ok && executed.value.kind).toBe('produced');
  });

  it('is aimed by the event in scope, not the event executed', async () => {
    // The layers trust the scope: a mechanism that put one event in scope
    // and executed another would aim the first one's failure at it.
    const inScope = anInventoryCheck('in-scope');
    const executedEvent = anInventoryCheck('executed');
    injectFailuresBySubject(
      new Map([[inScope.subject, { kind: 'factory_throws' }]]),
    );

    const executed = await withDeliveryInScope(inScope, () =>
      dispatcherFor('replay').tryExecute({
        event: executedEvent,
        state: () => null,
        attempt: 0,
        dependencies: catalogueFor(pool),
      }),
    );
    expect(executed.ok).toBe(false);
  });
});

describe('the plain loop, given a dispatcher that finds no handler', () => {
  let pool: Pool;
  let scope: DeliveryScope;

  beforeAll(() => {
    const config = readConfig('arvo-dispatcher-unroutable-spec');
    pool = new Pool({ connectionString: config.recordsUrl, max: 2 });
    scope = { store: storeFor(pool), pool };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('raises the delivery as unroutable rather than giving up on it', async () => {
    // Routing and the dispatcher are asked separately, so they could
    // disagree; readdressing on the way in is how this one is made to.
    const original = ArvoDispatcher.prototype.tryExecute;
    vi.spyOn(ArvoDispatcher.prototype, 'tryExecute').mockImplementation(
      function (this: ArvoDispatcher<never>, param) {
        return original.call(this, {
          ...param,
          event: mutateArvoEvent(param.event, { to: 'com.some.client' }),
        });
      },
    );
    const event = anInventoryCheck('disagreeing');

    await expect(deliverOnce(scope, event, 0)).rejects.toBeInstanceOf(
      UnroutableDelivery,
    );
  });
});
