import { trace } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import { ArvoExecutionContextTelemetry } from '../../../../src/ArvoEventHandler/context/telemetry/index.js';
import type { ArvoHandlerFault } from '../../../../src/ArvoEventHandler/fault/index.js';
import { deriveArvoExecutionId } from '../../../../src/ArvoEventHandler/helpers/execution-id.js';
import type { ArvoEventHandlerExecuteResponse } from '../../../../src/ArvoEventHandler/types/execute.js';
import { createArvoEventFactory } from '../../../../src/factories/ArvoEventFactory/index.js';
import { cloneArvoEvent } from '../../../../src/factories/cloneArvoEvent.js';
import { heldDependencies } from '../../dependency.js';
import { declareVersions, type OrderContext, orderV1 } from './fixture.js';

/**
 * Business code doing everything it should not.
 *
 * The protocol cannot make an executor correct. What it can do is hold:
 * refuse what must not leave, write nothing it cannot stand behind, and
 * say which code is at fault. Every executor here is one somebody will
 * eventually write.
 */

const executionTelemetry = () =>
  new ArvoExecutionContextTelemetry({
    span: trace.getTracer('adversarial').startSpan('execution'),
    meter: null,
    logger: null,
  });

const anOrder = (subject = 'order-1') =>
  createArvoEventFactory(orderV1).createInput({
    source: 'com.web.checkout',
    subject,
    to: orderV1.type,
    data: { items: ['book'] },
  });

/** One execution of an order, behaving however the test says. */
const runOrder = async (
  behave: (ctx: OrderContext) => unknown,
): Promise<ArvoEventHandlerExecuteResponse | ArvoHandlerFault> => {
  const versions = declareVersions();
  const event = anOrder();
  try {
    return (await versions[orderV1.type]?.['1.0.0']?.execute({
      entry: 'init',
      event,
      state: null,
      executionId: await deriveArvoExecutionId(event),
      attempt: 0,
      dependencies: heldDependencies({ behave }).dependency,
      hooks: {},
      telemetry: executionTelemetry(),
    } as never)) as ArvoEventHandlerExecuteResponse;
  } catch (thrown) {
    return thrown as ArvoHandlerFault;
  }
};

const faultFrom = async (behave: (ctx: OrderContext) => unknown) => {
  const responseOrFault = await runOrder(behave);
  if (!('faultKind' in responseOrFault)) {
    throw new Error(`expected a fault, got ${responseOrFault.kind}`);
  }
  return responseOrFault;
};

/** The same, for an executor expected to have produced something. */
const responseFrom = async (behave: (ctx: OrderContext) => unknown) => {
  const response = await runOrder(behave);
  if ('faultKind' in response || response.kind !== 'produced') {
    throw new Error('expected this execution to produce');
  }
  return response;
};

describe('an executor that returns what it must not', () => {
  it('a value that is not an event at all', async () => {
    const fault = await faultFrom(async (ctx) => {
      await ctx.setState({ data: { stage: 'done', answers: 0 } });
      return { type: 'evt_order_fulfilled' };
    });
    expect(fault.faultKind).toBe('emission_not_permitted');
  });

  it('a list with one thing in it that is not an event', async () => {
    const fault = await faultFrom(async (ctx) => {
      await ctx.setState({ data: { stage: 'done', answers: 0 } });
      return [
        await ctx.build({
          type: 'evt_order_fulfilled',
          data: { order_id: 'o-1' },
        }),
        'nearly',
      ];
    });
    expect(fault.faultKind).toBe('emission_not_permitted');
  });

  it('two answers to the caller, who awaits exactly one', async () => {
    const fault = await faultFrom(async (ctx) => {
      await ctx.setState({ data: { stage: 'done', answers: 0 } });
      const answer = await ctx.build({
        type: 'evt_order_fulfilled',
        data: { order_id: 'o-1' },
      });
      return [answer, cloneArvoEvent(answer, { id: 'a-second-answer' })];
    });
    expect(fault.faultKind).toBe('emission_not_permitted');
    expect(
      fault.violations.some((violation) => violation.includes('one')),
    ).toBe(true);
  });

  it('the same event twice, which is one request counted as two', async () => {
    const fault = await faultFrom(async (ctx) => {
      await ctx.setState({ data: { stage: 'done', answers: 0 } });
      const answer = await ctx.build({
        type: 'evt_order_fulfilled',
        data: { order_id: 'o-1' },
      });
      return [answer, answer];
    });
    expect(fault.faultKind).toBe('emission_not_permitted');
  });

  it('this contract own error event, which is never an executor to send', async () => {
    const fault = await faultFrom(async (ctx) => {
      await ctx.setState({ data: { stage: 'done', answers: 0 } });
      return createArvoEventFactory(orderV1).createError({
        source: orderV1.type,
        subject: 'order-1',
        error: new Error('I have decided I failed'),
      });
    });
    expect(fault.faultKind).toBe('emission_not_permitted');
  });

  it('an event addressed somewhere this version may not send', async () => {
    const fault = await faultFrom(async (ctx) => {
      await ctx.setState({ data: { stage: 'done', answers: 0 } });
      const chargeRequest = await ctx.build({
        type: 'com_payment_charge',
        data: { amount: 1 },
      });
      return cloneArvoEvent(chargeRequest, {
        type: 'com_nothing_declared' as never,
      });
    });
    expect(fault.faultKind).toBe('emission_not_permitted');
  });
});

describe('an executor that fails in an unusual way', () => {
  it('throws a string, which is still the work failing', async () => {
    const response = await responseFrom(async (ctx) => {
      await ctx.setState({ data: { stage: 'done', answers: 0 } });
      throw 'the warehouse is on fire';
    });
    expect(response.events[0]?.type).toBe(orderV1.error.type);
  });

  it('throws nothing at all, which is still the work failing', async () => {
    const response = await responseFrom(async (ctx) => {
      await ctx.setState({ data: { stage: 'done', answers: 0 } });
      throw null;
    });
    expect(response.events[0]?.type).toBe(orderV1.error.type);
  });

  it('throws something frozen, which nothing may be added to', async () => {
    const response = await responseFrom(async (ctx) => {
      await ctx.setState({ data: { stage: 'done', answers: 0 } });
      throw Object.freeze(new Error('sealed'));
    });
    expect(response.events[0]?.type).toBe(orderV1.error.type);
    expect(response.state.lifecycle).toBe('error');
  });

  it('fails before it remembered anything, and a record is written anyway', async () => {
    const response = await responseFrom(() => {
      throw new Error('it failed before it could write');
    });
    expect(response.state.lifecycle).toBe('error');
    expect(response.state.data).toBeNull();
  });
});

describe('an executor that writes what it must not', () => {
  it('writes ten thousand times, the last one standing', async () => {
    const response = await responseFrom(async (ctx) => {
      for (let writeIndex = 0; writeIndex < 10_000; writeIndex += 1) {
        await ctx.setState({
          data: { stage: 'counting', answers: writeIndex },
        });
      }
      return ctx.build({
        type: 'evt_order_fulfilled',
        data: { order_id: 'o-1' },
      });
    });
    expect((response.state.data as { answers: number }).answers).toBe(9_999);
  });

  it('keeps the context and writes after the execution ended', async () => {
    let escapedContext: OrderContext | undefined;
    const response = await responseFrom(async (ctx) => {
      escapedContext = ctx;
      await ctx.setState({ data: { stage: 'done', answers: 0 } });
      return ctx.build({
        type: 'evt_order_fulfilled',
        data: { order_id: 'o-1' },
      });
    });

    const committedState = JSON.stringify(response.state);
    await escapedContext?.setState({
      data: { stage: 'after the fact', answers: 99 },
    });

    // what was committed is what was committed; a context kept past its
    // execution describes one already over
    expect(JSON.stringify(response.state)).toBe(committedState);
  });

  it('cannot replace what the protocol owns on its context', async () => {
    await runOrder(async (ctx) => {
      expect(() => {
        (ctx as unknown as { entry: string }).entry = 'followup';
      }).toThrow();
      expect(() => {
        (ctx.contracts as unknown as { self: unknown }).self = null;
      }).toThrow();
      await ctx.setState({ data: { stage: 'done', answers: 0 } });
    });
  });

  it('cannot change the record it was handed', async () => {
    await runOrder(async (ctx) => {
      expect(() => {
        (ctx.state as unknown as { lifecycle: string }).lifecycle = 'success';
      }).toThrow();
      await ctx.setState({ data: { stage: 'done', answers: 0 } });
    });
  });
});

describe('an executor that raises a fault belonging to somebody else', () => {
  /** One order's fault, built properly, by its own execution. */
  const faultOfAnotherOrder = async () => {
    const versions = declareVersions();
    const event = anOrder('somebody-elses-order');
    try {
      await versions[orderV1.type]?.['1.0.0']?.execute({
        entry: 'init',
        event,
        state: null,
        executionId: await deriveArvoExecutionId(event),
        attempt: 0,
        dependencies: heldDependencies({
          behave: async (ctx: OrderContext) => {
            throw await ctx.fault({
              faultKind: 'executor_raised',
              message: 'the gateway refused this other order',
            });
          },
        }).dependency,
        hooks: {},
        telemetry: executionTelemetry(),
      } as never);
    } catch (thrown) {
      return thrown as ArvoHandlerFault;
    }
    throw new Error('expected that order to fault');
  };

  it('is refused, throwing one being the corruption itself', async () => {
    const foreignFault = await faultOfAnotherOrder();
    const reportedFault = await faultFrom(() => {
      throw foreignFault;
    });

    expect(reportedFault).not.toBe(foreignFault);
    expect(reportedFault.faultKind).toBe('executor_raised');
    expect(reportedFault.message).toContain('another execution');
  });

  it('names this execution throughout, never the one it came from', async () => {
    const foreignFault = await faultOfAnotherOrder();
    expect(foreignFault.subject).toBe('somebody-elses-order');

    const reportedFault = await faultFrom(() => {
      throw foreignFault;
    });

    // What a mechanism acts on is what the fault names. One naming
    // another execution would have it commit that execution's record and
    // answer that execution's caller, for an event belonging to this one.
    expect(reportedFault.subject).toBe('order-1');
    expect(reportedFault.executionId).not.toBe(foreignFault.executionId);
    expect(JSON.parse(reportedFault.abandonmentEvent as string).subject).toBe(
      'order-1',
    );
    expect(JSON.parse(reportedFault.abandonmentState as string).subject).toBe(
      'order-1',
    );
  });

  it('is not worth another attempt, a redelivery doing the same thing', async () => {
    const foreignFault = await faultOfAnotherOrder();
    const reportedFault = await faultFrom(() => {
      throw foreignFault;
    });
    expect(reportedFault.retry).toBeNull();
  });

  it('keeps what the other fault said, as the cause of this one', async () => {
    const foreignFault = await faultOfAnotherOrder();
    const reportedFault = await faultFrom(() => {
      throw foreignFault;
    });
    expect(reportedFault.cause).toContain(
      'the gateway refused this other order',
    );
  });

  it('tells nobody the work failed, this being no answer at all', async () => {
    const foreignFault = await faultOfAnotherOrder();
    const responseOrFault = await runOrder(() => {
      throw foreignFault;
    });
    // a fault concludes nothing: no handler error event reaches a caller
    expect('faultKind' in responseOrFault).toBe(true);
  });

  it('still lets an executor raise a fault of its own', async () => {
    const reportedFault = await faultFrom(async (ctx) => {
      throw await ctx.fault({
        faultKind: 'executor_raised',
        message: 'the gateway refused',
      });
    });
    expect(reportedFault.faultKind).toBe('executor_raised');
    expect(reportedFault.message).toBe('the gateway refused');
    expect(reportedFault.retry).not.toBeNull();
  });
});
