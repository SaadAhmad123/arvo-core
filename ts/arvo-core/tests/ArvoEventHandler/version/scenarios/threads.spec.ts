import { afterEach, describe, expect, it } from 'vitest';
import {
  ArvoThreadedBroker,
  type ArvoThreadedBrokerOptions,
} from './worker/broker.js';
import { orderV1 } from './worker/contracts.js';

/**
 * The same questions again, with the threads real.
 *
 * Everything before this scheduled its own interleavings, which proves
 * the rules and not the race. Here four handlers run in four threads
 * against one store, and which of them reads before which writes is the
 * operating system's to decide.
 *
 * What a thread cannot share is memory, so nothing here can be arranged:
 * a record crosses as bytes, an event crosses as bytes, and the only
 * thing holding a workflow together is what was committed.
 */

let runningBroker: ArvoThreadedBroker | null = null;

afterEach(async () => {
  await runningBroker?.stop();
  runningBroker = null;
});

const startBroker = async (
  threadCount: number,
  options: ArvoThreadedBrokerOptions = {},
) => {
  runningBroker = await new ArvoThreadedBroker(threadCount, options).start();
  return runningBroker;
};

const anOrder = async (subject: string) => {
  const { createArvoEventFactory } = await import(
    '../../../../dist/factories/ArvoEventFactory/index.js'
  );
  return createArvoEventFactory(orderV1).createInput({
    source: 'com.web.checkout',
    subject,
    to: orderV1.type,
    data: { items: ['book'] },
  });
};

/** Every revision each execution was committed at, in order. */
const revisionsByExecution = (broker: ArvoThreadedBroker) => {
  const revisionsById = new Map<string, number[]>();
  for (const { executionId, casVersion } of broker.transcript.committed) {
    revisionsById.set(executionId, [
      ...(revisionsById.get(executionId) ?? []),
      casVersion,
    ]);
  }
  return revisionsById;
};

const completions = (broker: ArvoThreadedBroker) =>
  broker.transcript.published.filter(
    (event) => event.to === 'com.web.checkout',
  );

describe('four handlers, four threads, one store', () => {
  it('carries sixty workflows through, each answered once', async () => {
    const broker = await startBroker(4);
    for (let orderIndex = 0; orderIndex < 60; orderIndex += 1) {
      await broker.publish(await anOrder(`order-${orderIndex}`));
    }
    await broker.settle();

    expect(completions(broker)).toHaveLength(60);
    expect(
      new Set(completions(broker).map((completion) => completion.subject)).size,
    ).toBe(60);
    expect(broker.store.size).toBe(120);
  }, 60_000);

  it('advances every record one revision at a time, from zero', async () => {
    const broker = await startBroker(4);
    for (let orderIndex = 0; orderIndex < 40; orderIndex += 1) {
      await broker.publish(await anOrder(`order-${orderIndex}`));
    }
    await broker.settle();

    for (const [executionId, revisions] of revisionsByExecution(broker)) {
      expect(revisions[0], `${executionId} did not open at 0`).toBe(0);
      for (let index = 1; index < revisions.length; index += 1) {
        expect(revisions[index], `${executionId} jumped`).toBe(
          (revisions[index - 1] as number) + 1,
        );
      }
    }
  }, 60_000);

  it('leaves every execution finished, and nothing half written', async () => {
    const broker = await startBroker(4);
    for (let orderIndex = 0; orderIndex < 40; orderIndex += 1) {
      await broker.publish(await anOrder(`order-${orderIndex}`));
    }
    await broker.settle();

    const lifecycles = [...broker.store.values()].map((row) => row.lifecycle);
    expect(new Set(lifecycles)).toEqual(new Set(['success']));
    expect(broker.transcript.faults).toEqual([]);
  }, 60_000);
});

describe('the same event in several threads at the same moment', () => {
  it('commits one of them, and the rest find it already done', async () => {
    // each thread is held inside its executor, so all four are in there
    // together rather than merely close to one another
    const broker = await startBroker(4, { slowly: 25 });
    const order = await anOrder('order-raced');

    for (let orderIndex = 0; orderIndex < 4; orderIndex += 1)
      await broker.publish(order);
    await broker.settle();

    // one execution opened, one charge asked for, one answer back
    expect(broker.store.size).toBe(2);
    expect(completions(broker)).toHaveLength(1);

    // and every thread that lost either conflicted or found a repeat
    expect(
      broker.transcript.conflicts + broker.transcript.discarded,
    ).toBeGreaterThan(0);
  }, 60_000);

  it('never writes two records at one revision', async () => {
    const broker = await startBroker(4, { slowly: 15 });
    for (let orderIndex = 0; orderIndex < 10; orderIndex += 1) {
      const order = await anOrder(`order-${orderIndex}`);
      await broker.publish(order);
      await broker.publish(order);
    }
    await broker.settle();

    for (const [executionId, revisions] of revisionsByExecution(broker)) {
      expect(
        new Set(revisions).size,
        `${executionId} wrote a revision twice`,
      ).toBe(revisions.length);
    }
  }, 60_000);

  it('comes to the same end however the threads happened to interleave', async () => {
    const endStates = [];
    for (let round = 0; round < 3; round += 1) {
      const broker = await startBroker(4, { slowly: 10 });
      for (let orderIndex = 0; orderIndex < 12; orderIndex += 1) {
        const order = await anOrder(`order-${orderIndex}`);
        await broker.publish(order);
        await broker.publish(order);
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

describe('a thread that is killed while it is working', () => {
  it('loses nothing: whatever it held is run again elsewhere', async () => {
    const broker = await startBroker(4, { slowly: 40 });
    for (let orderIndex = 0; orderIndex < 12; orderIndex += 1) {
      await broker.publish(await anOrder(`order-${orderIndex}`));
    }

    // a machine goes away mid-flight, twice
    await new Promise((resolve) => setTimeout(resolve, 20));
    await broker.kill(0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await broker.kill(0);

    await broker.settle();

    expect(broker.transcript.died).toBeGreaterThan(0);
    expect(completions(broker)).toHaveLength(12);
    expect(
      new Set([...broker.store.values()].map((row) => row.lifecycle)),
    ).toEqual(new Set(['success']));
  }, 60_000);

  it('leaves no half-written record behind it', async () => {
    const broker = await startBroker(3, { slowly: 30 });
    for (let orderIndex = 0; orderIndex < 9; orderIndex += 1) {
      await broker.publish(await anOrder(`order-${orderIndex}`));
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
    await broker.kill(0);
    await broker.settle();

    for (const [executionId, revisions] of revisionsByExecution(broker)) {
      expect(revisions[0], `${executionId} did not open at 0`).toBe(0);
      expect(
        new Set(revisions).size,
        `${executionId} wrote a revision twice`,
      ).toBe(revisions.length);
    }
  }, 60_000);
});

describe('a service that fails in every thread', () => {
  it('tells each order once, and ends every one of them', async () => {
    const broker = await startBroker(4, { charges: 'errors' });
    for (let orderIndex = 0; orderIndex < 20; orderIndex += 1) {
      await broker.publish(await anOrder(`order-${orderIndex}`));
    }
    await broker.settle();

    // each charge concluded that it could not do the work, which is an
    // answer rather than a failure of the delivery
    const sourceLifecycles = [...broker.store.values()].map(
      (row) => `${row.source}:${row.lifecycle}`,
    );
    expect(
      sourceLifecycles.filter((sourceLifecycle) =>
        sourceLifecycle.endsWith(':error'),
      ),
    ).toHaveLength(20);
    expect(completions(broker)).toHaveLength(20);
    expect(broker.transcript.faults).toEqual([]);
  }, 60_000);
});

describe('attempts that run out, in whichever thread spends the last one', () => {
  it('abandons every execution rather than retrying forever', async () => {
    const broker = await startBroker(4, { charges: 'faults' });
    for (let orderIndex = 0; orderIndex < 12; orderIndex += 1) {
      await broker.publish(await anOrder(`order-${orderIndex}`));
    }
    await broker.settle();

    // one charge per order, each abandoned once and only once
    expect(broker.transcript.abandoned).toHaveLength(12);
    expect(new Set(broker.transcript.abandoned).size).toBe(12);

    // a retryable fault is spent before it is given up on, so every
    // abandonment is preceded by the attempts the options allow
    expect(broker.transcript.faults).toHaveLength(12 * 4);
    expect(new Set(broker.transcript.faults)).toEqual(
      new Set(['executor_raised']),
    );

    // and the order hears about it, rather than waiting for an answer
    // that is never coming
    expect(completions(broker)).toHaveLength(12);
  }, 90_000);

  it('leaves the abandoned record saying so, and nothing running', async () => {
    const broker = await startBroker(2, { charges: 'faults' });
    await broker.publish(await anOrder('order-abandoned'));
    await broker.settle();

    // the charge rests at failure, which is where an execution nobody
    // will attempt again belongs; the order it was for rests at success,
    // because being told is an answer
    const lifecycles = [...broker.store.values()].map((row) => row.lifecycle);
    expect(lifecycles.sort()).toEqual(['failure', 'success']);
  }, 60_000);
});

describe('a service that fails and then does not', () => {
  it('spends attempts across threads and finishes every workflow', async () => {
    const broker = await startBroker(4, { charges: 'flaky' });
    for (let orderIndex = 0; orderIndex < 12; orderIndex += 1) {
      await broker.publish(await anOrder(`order-${orderIndex}`));
    }
    await broker.settle();

    // two attempts lost per charge, and the third answers
    expect(broker.transcript.faults).toHaveLength(24);
    expect(broker.transcript.abandoned).toEqual([]);
    expect(completions(broker)).toHaveLength(12);
    expect(
      new Set([...broker.store.values()].map((row) => row.lifecycle)),
    ).toEqual(new Set(['success']));
  }, 90_000);
});

describe('everything at once, with the threads real', () => {
  it('answers each order exactly once through duplicates, disorder and death', async () => {
    const broker = await startBroker(4, {
      slowly: 5,
      duplicate: true,
      shuffle: true,
    });
    for (let orderIndex = 0; orderIndex < 30; orderIndex += 1) {
      await broker.publish(await anOrder(`order-${orderIndex}`));
    }

    // machines go away while all of this is in flight
    for (let round = 0; round < 2; round += 1) {
      await new Promise((resolve) => setTimeout(resolve, 15));
      await broker.kill(0);
    }

    await broker.settle(40_000);

    // the cruelty has to have landed, or this proves nothing
    expect(broker.transcript.died).toBeGreaterThan(0);

    const answeredSubjects = completions(broker).map(
      (completion) => completion.subject,
    );
    expect(new Set(answeredSubjects).size).toBe(30);
    expect(broker.store.size).toBe(60);
    expect(
      new Set([...broker.store.values()].map((row) => row.lifecycle)),
    ).toEqual(new Set(['success']));

    // nothing was written twice at one revision, however badly it went
    for (const [executionId, revisions] of revisionsByExecution(broker)) {
      expect(revisions[0], `${executionId} did not open at 0`).toBe(0);
      expect(
        new Set(revisions).size,
        `${executionId} wrote a revision twice`,
      ).toBe(revisions.length);
    }
  }, 90_000);

  it('comes to the same end under chaos, run after run', async () => {
    const endStates = [];
    for (let round = 0; round < 3; round += 1) {
      const broker = await startBroker(4, { duplicate: true, shuffle: true });
      for (let orderIndex = 0; orderIndex < 10; orderIndex += 1) {
        await broker.publish(await anOrder(`order-${orderIndex}`));
      }
      await broker.settle(40_000);
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
  }, 120_000);
});
