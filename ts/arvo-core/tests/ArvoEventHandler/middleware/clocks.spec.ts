import { describe, expect, it, vi } from 'vitest';
import type { ArvoExecutionContext } from '../../../src/ArvoEventHandler/context/index.js';
import {
  createArvoMiddlewareProgress,
  runMiddleware,
} from '../../../src/ArvoEventHandler/version/middleware.js';
import { initEvent, telemetry } from '../fixtures.js';
import {
  answeringExecutor,
  executeOrder,
  orderHandler,
  orderRequest,
  sleep,
} from './fixture.js';

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
    const secondBeforePart = vi.fn();
    const executorSpy = vi.fn(answeringExecutor);
    const executionResult = await executeOrder(
      orderHandler({
        runTimeout: 20,
        execute: executorSpy,
        middleware: [
          { id: 'first', before: () => sleep(60) },
          { id: 'second', before: secondBeforePart },
        ],
      }),
    );
    expect(!executionResult.ok && executionResult.error.faultKind).toBe(
      'run_timeout',
    );
    await sleep(60);
    expect(secondBeforePart).not.toHaveBeenCalled();
    expect(executorSpy).not.toHaveBeenCalled();
  });

  it('during a later before part: a run timeout, the executor never entered', async () => {
    const executorSpy = vi.fn(answeringExecutor);
    const executionResult = await executeOrder(
      orderHandler({
        runTimeout: 20,
        execute: executorSpy,
        middleware: [
          { id: 'first', before: () => undefined },
          { id: 'second', before: () => undefined },
          { id: 'last', before: () => sleep(60) },
        ],
      }),
    );
    expect(!executionResult.ok && executionResult.error.faultKind).toBe(
      'run_timeout',
    );
    await sleep(60);
    expect(executorSpy).not.toHaveBeenCalled();
  });

  it('during the executor: a run timeout, no after part run', async () => {
    const afterSpy = vi.fn();
    const executionResult = await executeOrder(
      orderHandler({
        runTimeout: 20,
        middleware: [{ id: 'watcher', after: afterSpy }],
        execute: async (executionContext) => {
          await sleep(60);
          return answeringExecutor(executionContext);
        },
      }),
    );
    expect(!executionResult.ok && executionResult.error.faultKind).toBe(
      'run_timeout',
    );
    await sleep(60);
    expect(afterSpy).not.toHaveBeenCalled();
  });

  it('between the executor returning and the first after part: the return stands, no after runs', async () => {
    const middlewareProgress = createArvoMiddlewareProgress();
    const afterSpy = vi.fn();
    const executionResult = await runMiddleware({
      layers: [{ id: 'watcher', after: afterSpy }],
      ctx,
      executor: () => {
        middlewareProgress.outran = true;
        return [initEvent];
      },
      telemetry: telemetry().telemetry,
      middlewareProgress,
    });
    expect(executionResult).toEqual({
      kind: 'returned',
      emission: [initEvent],
    });
    expect(afterSpy).not.toHaveBeenCalled();
  });

  it('during the first after part to run: the return stands, the rest skipped', async () => {
    const outerAfterPart = vi.fn();
    const executionResult = await executeOrder(
      orderHandler({
        runTimeout: 25,
        middleware: [
          { id: 'outer', after: outerAfterPart },
          { id: 'inner', after: () => sleep(80) },
        ],
      }),
    );
    expect(
      executionResult.ok &&
        executionResult.value.kind === 'produced' &&
        executionResult.value.state.lifecycle,
    ).toBe('success');
    await sleep(80);
    expect(outerAfterPart).not.toHaveBeenCalled();
  });

  it('during the last after part to run: the return stands', async () => {
    const executionResult = await executeOrder(
      orderHandler({
        runTimeout: 25,
        middleware: [
          { id: 'outer', after: () => sleep(80) },
          { id: 'inner', after: () => undefined },
        ],
      }),
    );
    expect(
      executionResult.ok &&
        executionResult.value.kind === 'produced' &&
        executionResult.value.state.lifecycle,
    ).toBe('success');
  });

  it('after everything finished: no effect at all', async () => {
    const afterSpy = vi.fn();
    const executionResult = await executeOrder(
      orderHandler({
        runTimeout: 200,
        middleware: [{ id: 'quick', after: afterSpy }],
      }),
    );
    expect(executionResult.ok).toBe(true);
    expect(afterSpy).toHaveBeenCalledTimes(1);
  });
});

describe('an unbounded run clock', () => {
  it('cuts no slow after part', async () => {
    const outerAfterPart = vi.fn();
    await executeOrder(
      orderHandler({
        runTimeout: null,
        executionTimeout: null,
        middleware: [
          { id: 'outer', after: outerAfterPart },
          { id: 'slow', after: () => sleep(50) },
        ],
      }),
    );
    expect(outerAfterPart).toHaveBeenCalledTimes(1);
  });
});

describe('the execution clock', () => {
  it('crossed by a slow before part: refused for time, the broader verdict', async () => {
    const executorSpy = vi.fn(answeringExecutor);
    const executionResult = await executeOrder(
      orderHandler({
        runTimeout: 30,
        executionTimeout: 30,
        execute: executorSpy,
        middleware: [{ id: 'slow', before: () => sleep(80) }],
      }),
      { event: orderRequest() },
    );
    expect(!executionResult.ok && executionResult.error.faultKind).toBe(
      'execution_timeout',
    );
    expect(!executionResult.ok && executionResult.error.retry).toBeNull();
    expect(executorSpy).not.toHaveBeenCalled();
  });

  it('crossed only by a slow after part: not refused', async () => {
    const executionResult = await executeOrder(
      orderHandler({
        runTimeout: 40,
        executionTimeout: 40,
        middleware: [{ id: 'slow', after: () => sleep(100) }],
      }),
      { event: orderRequest() },
    );
    expect(executionResult.ok).toBe(true);
  });
});
