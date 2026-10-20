import { describe, expect, it, vi } from 'vitest';
import type { ArvoExecutionContext } from '../../../src/ArvoEventHandler/context/index.js';
import {
  createArvoMiddlewareProgress,
  runMiddleware,
} from '../../../src/ArvoEventHandler/version/middleware.js';
import { initEvent, telemetry } from '../fixtures.js';
import { anOrder, answering, openOne, orderHandler, sleep } from './fixture.js';

/**
 * The run clock at every boundary of the chain.
 *
 * The real clock is used where the boundary is wide enough to hit
 * reliably; where it is not — the instant between the executor returning
 * and the first after part — the clock firing is stood in for by what it
 * sets, which is deterministic.
 */

const ctx = {} as ArvoExecutionContext;

describe('the clock firing, by where it fires', () => {
  it('during the first before part: a run timeout, nothing else entered', async () => {
    const second = vi.fn();
    const execute = vi.fn(answering);
    const ran = await openOne(
      orderHandler({
        runTimeout: 20,
        execute,
        middleware: [
          { id: 'first', before: () => sleep(60) },
          { id: 'second', before: second },
        ],
      }),
    );
    expect(!ran.ok && ran.error.faultKind).toBe('run_timeout');
    await sleep(60);
    expect(second).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('during a later before part: a run timeout, the executor never entered', async () => {
    const execute = vi.fn(answering);
    const ran = await openOne(
      orderHandler({
        runTimeout: 20,
        execute,
        middleware: [
          { id: 'first', before: () => undefined },
          { id: 'second', before: () => undefined },
          { id: 'last', before: () => sleep(60) },
        ],
      }),
    );
    expect(!ran.ok && ran.error.faultKind).toBe('run_timeout');
    await sleep(60);
    expect(execute).not.toHaveBeenCalled();
  });

  it('during the executor: a run timeout, no after part run', async () => {
    const after = vi.fn();
    const ran = await openOne(
      orderHandler({
        runTimeout: 20,
        middleware: [{ id: 'watcher', after }],
        execute: async (c) => {
          await sleep(60);
          return answering(c);
        },
      }),
    );
    expect(!ran.ok && ran.error.faultKind).toBe('run_timeout');
    await sleep(60);
    expect(after).not.toHaveBeenCalled();
  });

  it('between the executor returning and the first after part: the return stands, no after runs', async () => {
    const progress = createArvoMiddlewareProgress();
    const after = vi.fn();
    const ran = await runMiddleware({
      layers: [{ id: 'watcher', after }],
      ctx,
      executor: () => {
        progress.abandoned = true;
        return [initEvent];
      },
      telemetry: telemetry().telemetry,
      progress,
    });
    expect(ran).toEqual({ kind: 'returned', returned: [initEvent] });
    expect(after).not.toHaveBeenCalled();
  });

  it('during the first after part to run: the return stands, the rest skipped', async () => {
    const outer = vi.fn();
    const ran = await openOne(
      orderHandler({
        runTimeout: 25,
        middleware: [
          { id: 'outer', after: outer },
          { id: 'inner', after: () => sleep(80) },
        ],
      }),
    );
    expect(
      ran.ok && ran.value.kind === 'produced' && ran.value.state.lifecycle,
    ).toBe('success');
    await sleep(80);
    expect(outer).not.toHaveBeenCalled();
  });

  it('during the last after part to run: the return stands', async () => {
    const ran = await openOne(
      orderHandler({
        runTimeout: 25,
        middleware: [
          { id: 'outer', after: () => sleep(80) },
          { id: 'inner', after: () => undefined },
        ],
      }),
    );
    expect(
      ran.ok && ran.value.kind === 'produced' && ran.value.state.lifecycle,
    ).toBe('success');
  });

  it('after everything finished: no effect at all', async () => {
    const after = vi.fn();
    const ran = await openOne(
      orderHandler({ runTimeout: 200, middleware: [{ id: 'quick', after }] }),
    );
    expect(ran.ok).toBe(true);
    expect(after).toHaveBeenCalledTimes(1);
  });
});

describe('an unbounded run clock', () => {
  it('cuts no slow after part', async () => {
    const outer = vi.fn();
    await openOne(
      orderHandler({
        runTimeout: null,
        executionTimeout: null,
        middleware: [
          { id: 'outer', after: outer },
          { id: 'slow', after: () => sleep(50) },
        ],
      }),
    );
    expect(outer).toHaveBeenCalledTimes(1);
  });
});

describe('the execution clock', () => {
  it('crossed by a slow before part: refused for time, the broader verdict', async () => {
    const execute = vi.fn(answering);
    const ran = await openOne(
      orderHandler({
        runTimeout: 30,
        executionTimeout: 30,
        execute,
        middleware: [{ id: 'slow', before: () => sleep(80) }],
      }),
      { event: anOrder() },
    );
    expect(!ran.ok && ran.error.faultKind).toBe('execution_timeout');
    expect(!ran.ok && ran.error.retry).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  it('crossed only by a slow after part: not refused', async () => {
    const ran = await openOne(
      orderHandler({
        runTimeout: 40,
        executionTimeout: 40,
        middleware: [{ id: 'slow', after: () => sleep(100) }],
      }),
      { event: anOrder() },
    );
    expect(ran.ok).toBe(true);
  });
});
