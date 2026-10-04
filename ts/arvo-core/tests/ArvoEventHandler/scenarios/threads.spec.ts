import { execSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
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

const AT = (where: string) => new URL(where, import.meta.url).pathname;
const BUILT = AT('../../../dist/ArvoEventHandler/index.js');
const SOURCE = AT('../../../src');

let running: ThreadedBroker | null = null;

/** When anything under a directory was last written. */
const newestUnder = (where: string): number => {
  let newest = 0;
  for (const entry of readdirSync(where, { withFileTypes: true })) {
    const at = join(where, entry.name);
    const when = entry.isDirectory() ? newestUnder(at) : statSync(at).mtimeMs;
    if (when > newest) newest = when;
  }
  return newest;
};

beforeAll(() => {
  // a thread loads what a deployment would load, and it has to be this
  // source built or these threads prove something about code nobody has
  const stale =
    !existsSync(BUILT) || statSync(BUILT).mtimeMs < newestUnder(SOURCE);
  if (stale) execSync('pnpm build', { stdio: 'ignore' });
}, 180_000);

afterEach(async () => {
  await running?.stop();
  running = null;
});

const broking = async (
  howMany: number,
  options: ThreadedBrokerOptions = {},
) => {
  running = await new ThreadedBroker(howMany, options).start();
  return running;
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
const answers = (broker: ThreadedBroker) =>
  broker.transcript.published.filter((one) => one.to === 'com.web.checkout');

describe('four threads, one store, and the handler deciding everything', () => {
  it('carries forty workflows through, each answered once', async () => {
    const broker = await broking(4);
    for (let at = 0; at < 40; at += 1) {
      await broker.publish(await anOrder(`order-${at}`, '1.0.0'));
    }
    await broker.settle();

    expect(answers(broker)).toHaveLength(40);
    expect(new Set(answers(broker).map((one) => one.subject)).size).toBe(40);
    expect(broker.transcript.faults).toEqual([]);
  }, 60_000);

  it('routes each to the version its own event named, whichever thread took it', async () => {
    const broker = await broking(4);
    for (let at = 0; at < 20; at += 1) {
      await broker.publish(
        await anOrder(`order-${at}`, at % 2 === 0 ? '1.0.0' : '2.0.0'),
      );
    }
    await broker.settle();

    const first = answers(broker).filter(
      (one) => one.type === 'evt_threaded_order_done',
    );
    const second = answers(broker).filter(
      (one) => one.type === 'evt_threaded_order_shipped',
    );
    expect(first).toHaveLength(10);
    expect(second).toHaveLength(10);
  }, 60_000);

  it('advances every record one revision at a time, from zero', async () => {
    const broker = await broking(4);
    for (let at = 0; at < 20; at += 1) {
      await broker.publish(await anOrder(`order-${at}`, '1.0.0'));
    }
    await broker.settle();

    const byExecution = new Map<string, number[]>();
    for (const { executionId, casVersion } of broker.transcript.committed) {
      byExecution.set(executionId, [
        ...(byExecution.get(executionId) ?? []),
        casVersion,
      ]);
    }
    for (const [executionId, revisions] of byExecution) {
      expect(revisions[0], `${executionId} did not open at 0`).toBe(0);
      expect(
        new Set(revisions).size,
        `${executionId} wrote a revision twice`,
      ).toBe(revisions.length);
    }
  }, 60_000);

  it('keeps every execution on one version for its whole life', async () => {
    const broker = await broking(4);
    for (let at = 0; at < 20; at += 1) {
      await broker.publish(await anOrder(`order-${at}`, '1.0.0'));
    }
    await broker.settle();

    const byExecution = new Map<string, Set<string>>();
    for (const { executionId, version } of broker.transcript.committed) {
      const held = byExecution.get(executionId) ?? new Set<string>();
      held.add(version);
      byExecution.set(executionId, held);
    }
    for (const [executionId, versions] of byExecution) {
      expect([...versions], `${executionId} changed version`).toHaveLength(1);
    }
  }, 60_000);
});

describe('the same opening event in four threads at one moment', () => {
  it('opens the execution once, every other thread deriving the same identity', async () => {
    // each thread is held inside its execution, so all four are in there
    // together rather than merely close to one another
    const broker = await broking(4, { slowly: 25 });
    const order = await anOrder('order-raced', '1.0.0');
    for (let at = 0; at < 4; at += 1) await broker.publish(order);
    await broker.settle();

    // one order and one charge, however many threads tried to open it
    expect(broker.store.size).toBe(2);
    expect(answers(broker)).toHaveLength(1);
  }, 60_000);

  it('never writes two records at one revision, however they interleaved', async () => {
    const broker = await broking(4, { slowly: 15, duplicate: true });
    for (let at = 0; at < 10; at += 1) {
      await broker.publish(await anOrder(`order-${at}`, '1.0.0'));
    }
    await broker.settle();

    const byExecution = new Map<string, number[]>();
    for (const { executionId, casVersion } of broker.transcript.committed) {
      byExecution.set(executionId, [
        ...(byExecution.get(executionId) ?? []),
        casVersion,
      ]);
    }
    for (const [executionId, revisions] of byExecution) {
      expect(
        new Set(revisions).size,
        `${executionId} wrote a revision twice`,
      ).toBe(revisions.length);
    }
  }, 60_000);

  it('comes to the same end however the threads happened to interleave', async () => {
    const ends = [];
    for (let again = 0; again < 3; again += 1) {
      const broker = await broking(4, { slowly: 10, duplicate: true });
      for (let at = 0; at < 8; at += 1) {
        await broker.publish(await anOrder(`order-${at}`, '1.0.0'));
      }
      await broker.settle();
      ends.push(
        [...broker.store.values()]
          .map((row) => `${row.source}:${row.lifecycle}:${row.casVersion}`)
          .sort()
          .join('|'),
      );
      await broker.stop();
      running = null;
    }
    expect(new Set(ends).size).toBe(1);
  }, 90_000);
});

describe('a thread killed while it is deciding', () => {
  it('loses nothing: whatever it held is placed again elsewhere', async () => {
    const broker = await broking(4, { slowly: 40 });
    for (let at = 0; at < 12; at += 1) {
      await broker.publish(await anOrder(`order-${at}`, '1.0.0'));
    }

    for (let again = 0; again < 2; again += 1) {
      await new Promise((settle) => setTimeout(settle, 20));
      await broker.kill(0);
    }
    await broker.settle(40_000);

    expect(broker.transcript.died).toBeGreaterThan(0);
    expect(answers(broker)).toHaveLength(12);
    expect(
      new Set([...broker.store.values()].map((row) => row.lifecycle)),
    ).toEqual(new Set(['success']));
  }, 60_000);
});

describe('a service that fails in every thread', () => {
  it('tells each order once, and ends every one of them', async () => {
    const broker = await broking(4, { charges: 'errors' });
    for (let at = 0; at < 12; at += 1) {
      await broker.publish(await anOrder(`order-${at}`, '1.0.0'));
    }
    await broker.settle();

    const resting = [...broker.store.values()].map(
      (row) => `${row.source}:${row.lifecycle}`,
    );
    expect(resting.filter((one) => one.endsWith(':error'))).toHaveLength(12);
    expect(answers(broker)).toHaveLength(12);
    expect(broker.transcript.faults).toEqual([]);
  }, 60_000);
});
