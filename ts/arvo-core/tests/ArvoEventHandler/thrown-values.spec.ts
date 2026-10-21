import { describe, expect, it } from 'vitest';
import { failingToClose } from './dependency.js';
import {
  answeringExecutor,
  executeOrder,
  orderHandler,
  orderRequest,
} from './middleware/fixture.js';

/**
 * Values thrown by code a handler runs, that cannot be turned into text
 * the ordinary way. Wherever such a value is thrown, the handler still
 * reports it as the protocol says, and never fails on describing it.
 */

/** A thrown value with no text of its own: `String()` throws on it. */
const unprintableValue = () => Object.create(null);

describe('a value with no text of its own, thrown', () => {
  it('by the executor, is the handler error, as any failure of the work is', async () => {
    const executionResult = await executeOrder(
      orderHandler({
        execute: () => {
          throw unprintableValue();
        },
      }),
    );
    expect(
      executionResult.ok &&
        executionResult.value.kind === 'produced' &&
        executionResult.value.state.lifecycle,
    ).toBe('error');
  });

  it('by a before part, is the handler error too', async () => {
    const executionResult = await executeOrder(
      orderHandler({
        middleware: [
          {
            id: 'hostile',
            before: () => {
              throw unprintableValue();
            },
          },
        ],
      }),
    );
    expect(
      executionResult.ok &&
        executionResult.value.kind === 'produced' &&
        executionResult.value.state.lifecycle,
    ).toBe('error');
  });

  it('by an after part, changes nothing', async () => {
    const executionResult = await executeOrder(
      orderHandler({
        middleware: [
          {
            id: 'hostile',
            after: () => {
              throw unprintableValue();
            },
          },
        ],
      }),
    );
    expect(
      executionResult.ok &&
        executionResult.value.kind === 'produced' &&
        executionResult.value.state.lifecycle,
    ).toBe('success');
  });

  it('by a middleware factory, is the failed-instantiation fault', async () => {
    const executionResult = await executeOrder(orderHandler(), {
      middleware: [
        () => {
          throw unprintableValue();
        },
      ],
    });
    expect(!executionResult.ok && executionResult.error.faultKind).toBe(
      'middleware_instantiation_failed',
    );
  });

  it('while opening the dependencies, is the dependency fault', async () => {
    const executionResult = await executeOrder(orderHandler(), {
      dependencies: {
        open: () => {
          throw unprintableValue();
        },
        close: () => undefined,
        attributes: {},
      },
    });
    expect(!executionResult.ok && executionResult.error.faultKind).toBe(
      'dependency_resolution_failed',
    );
  });

  it('while closing the dependencies, changes nothing', async () => {
    const executionResult = await executeOrder(
      orderHandler({ execute: answeringExecutor }),
      { dependencies: failingToClose({}, unprintableValue()).dependency },
    );
    expect(executionResult.ok && executionResult.value.kind).toBe('produced');
  });

  it('by the state function, is the state fault', async () => {
    const executionResult = await orderHandler().tryExecute({
      event: orderRequest(),
      state: () => {
        throw unprintableValue();
      },
      attempt: 0,
    });
    expect(!executionResult.ok && executionResult.error.faultKind).toBe(
      'state_resolution_failed',
    );
  });
});
