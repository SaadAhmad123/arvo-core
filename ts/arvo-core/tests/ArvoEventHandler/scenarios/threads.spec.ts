import { afterEach, describe, expect, it } from 'vitest';
import { ThreadedBroker, type ThreadedBrokerOptions } from './worker/broker.js';

/**
 * The handler itself, in four threads, against one store.
 *
 * Everything before this ran the handler and the store in one process,
 * so the order of things was decided here. Here it is the operating
 * system's: four threads place events, derive identities and choose
 * versions at the same moment, and nothing but what was committed holds
 * a workflow together.
 *
 * The broker is markedly simpler than the one that drove versions, and
 * every line it lost is a line the handler now owns. That is the point
 * of the exercise rather than a side effect of it.
 */

let runningBroker: ThreadedBroker | null = null;

afterEach(async () => {
  await runningBroker?.stop();
  runningBroker = null;
});

const startBroker = async (
  threadCount: number,
  options: ThreadedBrokerOptions = {},
) => {
  runningBroker = await new ThreadedBroker(threadCount, options).start();
  return runningBroker;
};

/** An order, written out the way one arrives. */
const anOrder = async (subject: string, version: '1.0.0' | '2.0.0') => {
  const { createArvoEventFactory } = await import(
    '../../../dist/factories/ArvoEventFactory/index.js'
  );
  const { orderContract } = await import('./worker/contracts.js');
  return createArvoEventFactory(orderContract.versions[version]).createInput({
    source: 'com.web.checkout',
    subject,
    to: orderContract.type,
    data: { items: ['book'] },
  });
};

/** What reached the caller, as a workflow concluding looks from outside. */
const answersToCaller = (broker: ThreadedBroker) =>
  broker.transcript.published.filter(
    (event) => event.to === 'com.web.checkout',
  );

describe('four threads with layers around the order handler', () => {
  it('keeps what each execution learns with that execution, under real concurrency', async () => {
    const broker = await startBroker(4, { layered: true });
    for (let orderIndex = 0; orderIndex < 40; orderIndex += 1) {
      await broker.publish(await anOrder(`order-${orderIndex}`, '1.0.0'));
    }
    await broker.settle();

    const answers = answersToCaller(broker);
    expect(answers).toHaveLength(40);
    for (const answer of answers) {
      const orderId = (answer as unknown as { data: { order_id: string } }).data
        .order_id;
      expect(orderId).toBe(`${answer.subject}|${answer.subject}`);
    }
    expect(broker.transcript.faults).toEqual([]);
  }, 60_000);
});

describe('four threads, one store, and the handler deciding everything', () => {
  it('carries forty workflows through, each answered once', async () => {
    const broker = await startBroker(4);
    for (let orderIndex = 0; orderIndex < 40; orderIndex += 1) {
      await broker.publish(await anOrder(`order-${orderIndex}`, '1.0.0'));
    }
    await broker.settle();

    expect(answersToCaller(broker)).toHaveLength(40);
    expect(
      new Set(answersToCaller(broker).map((event) => event.subject)).size,
    ).toBe(40);
    expect(broker.transcript.faults).toEqual([]);
  }, 60_000);

  it('routes each to the version its own event named, whichever thread took it', async () => {
    const broker = await startBroker(4);
    for (let orderIndex = 0; orderIndex < 20; orderIndex += 1) {
      await broker.publish(
        await anOrder(
          `order-${orderIndex}`,
          orderIndex % 2 === 0 ? '1.0.0' : '2.0.0',
        ),
      );
    }
    await broker.settle();

    const doneAnswers = answersToCaller(broker).filter(
      (event) => event.type === 'evt_threaded_order_done',
    );
    const shippedAnswers = answersToCaller(broker).filter(
      (event) => event.type === 'evt_threaded_order_shipped',
    );
    expect(doneAnswers).toHaveLength(10);
    expect(shippedAnswers).toHaveLength(10);
  }, 60_000);

  it('advances every record one revision at a time, from zero', async () => {
    const broker = await startBroker(4);
    for (let orderIndex = 0; orderIndex < 20; orderIndex += 1) {
      await broker.publish(await anOrder(`order-${orderIndex}`, '1.0.0'));
    }
    await broker.settle();

    const revisionsByExecution = new Map<string, number[]>();
    for (const { executionId, casVersion } of broker.transcript.committed) {
      revisionsByExecution.set(executionId, [
        ...(revisionsByExecution.get(executionId) ?? []),
        casVersion,
      ]);
    }
    for (const [executionId, revisions] of revisionsByExecution) {
      expect(revisions[0], `${executionId} did not open at 0`).toBe(0);
      expect(
        new Set(revisions).size,
        `${executionId} wrote a revision twice`,
      ).toBe(revisions.length);
    }
  }, 60_000);

  it('keeps every execution on one version for its whole life', async () => {
    const broker = await startBroker(4);
    for (let orderIndex = 0; orderIndex < 20; orderIndex += 1) {
      await broker.publish(await anOrder(`order-${orderIndex}`, '1.0.0'));
    }
    await broker.settle();

    const versionsByExecution = new Map<string, Set<string>>();
    for (const { executionId, version } of broker.transcript.committed) {
      const executionVersions =
        versionsByExecution.get(executionId) ?? new Set<string>();
      executionVersions.add(version);
      versionsByExecution.set(executionId, executionVersions);
    }
    for (const [executionId, versions] of versionsByExecution) {
      expect([...versions], `${executionId} changed version`).toHaveLength(1);
    }
  }, 60_000);
});

describe('the same opening event in four threads at one moment', () => {
  it('opens the execution once, every other thread deriving the same identity', async () => {
    // each thread is held inside its execution, so all four are in there
    // together rather than merely close to one another
    const broker = await startBroker(4, { slowly: 25 });
    const order = await anOrder('order-raced', '1.0.0');
    for (let orderIndex = 0; orderIndex < 4; orderIndex += 1)
      await broker.publish(order);
    await broker.settle();

    // one order and one charge, however many threads tried to open it
    expect(broker.store.size).toBe(2);
    expect(answersToCaller(broker)).toHaveLength(1);
  }, 60_000);

  it('never writes two records at one revision, however they interleaved', async () => {
    const broker = await startBroker(4, { slowly: 15, duplicate: true });
    for (let orderIndex = 0; orderIndex < 10; orderIndex += 1) {
      await broker.publish(await anOrder(`order-${orderIndex}`, '1.0.0'));
    }
    await broker.settle();

    const revisionsByExecution = new Map<string, number[]>();
    for (const { executionId, casVersion } of broker.transcript.committed) {
      revisionsByExecution.set(executionId, [
        ...(revisionsByExecution.get(executionId) ?? []),
        casVersion,
      ]);
    }
    for (const [executionId, revisions] of revisionsByExecution) {
      expect(
        new Set(revisions).size,
        `${executionId} wrote a revision twice`,
      ).toBe(revisions.length);
    }
  }, 60_000);

  it('comes to the same end however the threads happened to interleave', async () => {
    const endStates = [];
    for (let round = 0; round < 3; round += 1) {
      const broker = await startBroker(4, { slowly: 10, duplicate: true });
      for (let orderIndex = 0; orderIndex < 8; orderIndex += 1) {
        await broker.publish(await anOrder(`order-${orderIndex}`, '1.0.0'));
      }
      await broker.settle();
      endStates.push(
        [...broker.store.values()]
          .map((row) => `${row.source}:${row.lifecycle}:${row.casVersion}`)
          .sort()
          .join('|'),
      );
      await broker.stop();
      runningBroker = null;
    }
    expect(new Set(endStates).size).toBe(1);
  }, 90_000);
});

describe('a thread killed while it is deciding', () => {
  it('loses nothing: whatever it held is placed again elsewhere', async () => {
    const broker = await startBroker(4, { slowly: 40 });
    for (let orderIndex = 0; orderIndex < 12; orderIndex += 1) {
      await broker.publish(await anOrder(`order-${orderIndex}`, '1.0.0'));
    }

    for (let round = 0; round < 2; round += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      await broker.kill(0);
    }
    await broker.settle(40_000);

    expect(broker.transcript.died).toBeGreaterThan(0);
    expect(answersToCaller(broker)).toHaveLength(12);
    expect(
      new Set([...broker.store.values()].map((row) => row.lifecycle)),
    ).toEqual(new Set(['success']));
  }, 60_000);
});

describe('a service that fails in every thread', () => {
  it('tells each order once, and ends every one of them', async () => {
    const broker = await startBroker(4, { charges: 'errors' });
    for (let orderIndex = 0; orderIndex < 12; orderIndex += 1) {
      await broker.publish(await anOrder(`order-${orderIndex}`, '1.0.0'));
    }
    await broker.settle();

    const restingStates = [...broker.store.values()].map(
      (row) => `${row.source}:${row.lifecycle}`,
    );
    expect(
      restingStates.filter((restingState) => restingState.endsWith(':error')),
    ).toHaveLength(12);
    expect(answersToCaller(broker)).toHaveLength(12);
    expect(broker.transcript.faults).toEqual([]);
  }, 60_000);
});
