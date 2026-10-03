import { trace } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import { ArvoExecutionContextTelemetry } from '../../../../src/ArvoEventHandler/context/telemetry/index.js';
import type { ArvoHandlerFault } from '../../../../src/ArvoEventHandler/fault/index.js';
import { deriveArvoExecutionId } from '../../../../src/ArvoEventHandler/helpers/execution-id.js';
import type { ArvoEventHandlerExecuteResponse } from '../../../../src/ArvoEventHandler/types/execute.js';
import { createArvoEventFactory } from '../../../../src/factories/ArvoEventFactory/index.js';
import { cloneArvoEvent } from '../../../../src/factories/cloneArvoEvent.js';
import { declareVersions, type OrderContext, orderV1 } from './fixture.js';

/**
 * Business code doing everything it should not.
 *
 * The protocol cannot make an executor correct. What it can do is hold:
 * refuse what must not leave, write nothing it cannot stand behind, and
 * say which code is at fault. Every executor here is one somebody will
 * eventually write.
 */

const telemetryFor = () =>
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
const running = async (
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
      dependencies: { behave },
      hooks: {},
      telemetry: telemetryFor(),
    } as never)) as ArvoEventHandlerExecuteResponse;
  } catch (raised) {
    return raised as ArvoHandlerFault;
  }
};

const faultFrom = async (behave: (ctx: OrderContext) => unknown) => {
  const outcome = await running(behave);
  if (!('faultKind' in outcome)) {
    throw new Error(`expected a fault, got ${outcome.kind}`);
  }
  return outcome;
};

/** The same, for an executor expected to have produced something. */
const producedBy = async (behave: (ctx: OrderContext) => unknown) => {
  const outcome = await running(behave);
  if ('faultKind' in outcome || outcome.kind !== 'produced') {
    throw new Error('expected this execution to produce');
  }
  return outcome;
};

describe('an executor that returns what it must not', () => {
  it('a value that is not an event at all', async () => {
    const refused = await faultFrom(async (ctx) => {
      await ctx.setState({ data: { stage: 'done', answers: 0 } });
      return { type: 'evt_order_fulfilled' };
    });
    expect(refused.faultKind).toBe('emission_not_permitted');
  });

  it('a list with one thing in it that is not an event', async () => {
    const refused = await faultFrom(async (ctx) => {
      await ctx.setState({ data: { stage: 'done', answers: 0 } });
      return [
        await ctx.build({
          type: 'evt_order_fulfilled',
          data: { order_id: 'o-1' },
        }),
        'nearly',
      ];
    });
    expect(refused.faultKind).toBe('emission_not_permitted');
  });

  it('two answers to the caller, who awaits exactly one', async () => {
    const refused = await faultFrom(async (ctx) => {
      await ctx.setState({ data: { stage: 'done', answers: 0 } });
      const answer = await ctx.build({
        type: 'evt_order_fulfilled',
        data: { order_id: 'o-1' },
      });
      return [answer, cloneArvoEvent(answer, { id: 'a-second-answer' })];
    });
    expect(refused.faultKind).toBe('emission_not_permitted');
    expect(refused.violations.some((broken) => broken.includes('one'))).toBe(
      true,
    );
  });

  it('the same event twice, which is one request counted as two', async () => {
    const refused = await faultFrom(async (ctx) => {
      await ctx.setState({ data: { stage: 'done', answers: 0 } });
      const answer = await ctx.build({
        type: 'evt_order_fulfilled',
        data: { order_id: 'o-1' },
      });
      return [answer, answer];
    });
    expect(refused.faultKind).toBe('emission_not_permitted');
  });

  it('this contract own error event, which is never an executor to send', async () => {
    const refused = await faultFrom(async (ctx) => {
      await ctx.setState({ data: { stage: 'done', answers: 0 } });
      return createArvoEventFactory(orderV1).createError({
        source: orderV1.type,
        subject: 'order-1',
        error: new Error('I have decided I failed'),
      });
    });
    expect(refused.faultKind).toBe('emission_not_permitted');
  });

  it('an event addressed somewhere this version may not send', async () => {
    const refused = await faultFrom(async (ctx) => {
      await ctx.setState({ data: { stage: 'done', answers: 0 } });
      const asking = await ctx.build({
        type: 'com_payment_charge',
        data: { amount: 1 },
      });
      return cloneArvoEvent(asking, { type: 'com_nothing_declared' as never });
    });
    expect(refused.faultKind).toBe('emission_not_permitted');
  });
});

describe('an executor that fails in an unusual way', () => {
  it('throws a string, which is still the work failing', async () => {
    const outcome = await producedBy(async (ctx) => {
      await ctx.setState({ data: { stage: 'done', answers: 0 } });
      throw 'the warehouse is on fire';
    });
    expect(outcome.events[0]?.type).toBe(orderV1.error.type);
  });

  it('throws nothing at all, which is still the work failing', async () => {
    const outcome = await producedBy(async (ctx) => {
      await ctx.setState({ data: { stage: 'done', answers: 0 } });
      throw null;
    });
    expect(outcome.events[0]?.type).toBe(orderV1.error.type);
  });

  it('throws something frozen, which nothing may be added to', async () => {
    const outcome = await producedBy(async (ctx) => {
      await ctx.setState({ data: { stage: 'done', answers: 0 } });
      throw Object.freeze(new Error('sealed'));
    });
    expect(outcome.events[0]?.type).toBe(orderV1.error.type);
    expect(outcome.state.lifecycle).toBe('error');
  });

  it('fails before it remembered anything, and a record is written anyway', async () => {
    const outcome = await producedBy(() => {
      throw new Error('it failed before it could write');
    });
    expect(outcome.state.lifecycle).toBe('error');
    expect(outcome.state.data).toBeNull();
  });
});

describe('an executor that writes what it must not', () => {
  it('writes ten thousand times, the last one standing', async () => {
    const outcome = await producedBy(async (ctx) => {
      for (let at = 0; at < 10_000; at += 1) {
        await ctx.setState({ data: { stage: 'counting', answers: at } });
      }
      return ctx.build({
        type: 'evt_order_fulfilled',
        data: { order_id: 'o-1' },
      });
    });
    expect((outcome.state.data as { answers: number }).answers).toBe(9_999);
  });

  it('keeps the context and writes after the execution ended', async () => {
    let kept: OrderContext | undefined;
    const outcome = await producedBy(async (ctx) => {
      kept = ctx;
      await ctx.setState({ data: { stage: 'done', answers: 0 } });
      return ctx.build({
        type: 'evt_order_fulfilled',
        data: { order_id: 'o-1' },
      });
    });

    const committed = JSON.stringify(outcome.state);
    await kept?.setState({ data: { stage: 'after the fact', answers: 99 } });

    // what was committed is what was committed; a context kept past its
    // execution describes one already over
    expect(JSON.stringify(outcome.state)).toBe(committed);
  });

  it('cannot replace what the protocol owns on its context', async () => {
    await running(async (ctx) => {
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
    await running(async (ctx) => {
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
        dependencies: {
          behave: async (ctx: OrderContext) => {
            throw await ctx.fault({
              faultKind: 'executor_raised',
              message: 'the gateway refused this other order',
            });
          },
        },
        hooks: {},
        telemetry: telemetryFor(),
      } as never);
    } catch (raised) {
      return raised as ArvoHandlerFault;
    }
    throw new Error('expected that order to fault');
  };

  it('is refused, throwing one being the corruption itself', async () => {
    const borrowed = await faultOfAnotherOrder();
    const raised = await faultFrom(() => {
      throw borrowed;
    });

    expect(raised).not.toBe(borrowed);
    expect(raised.faultKind).toBe('executor_raised');
    expect(raised.message).toContain('another execution');
  });

  it('names this execution throughout, never the one it came from', async () => {
    const borrowed = await faultOfAnotherOrder();
    expect(borrowed.subject).toBe('somebody-elses-order');

    const raised = await faultFrom(() => {
      throw borrowed;
    });

    // What a mechanism acts on is what the fault names. One naming
    // another execution would have it commit that execution's record and
    // answer that execution's caller, for an event belonging to this one.
    expect(raised.subject).toBe('order-1');
    expect(raised.executionId).not.toBe(borrowed.executionId);
    expect(JSON.parse(raised.abandonmentEvent as string).subject).toBe(
      'order-1',
    );
    expect(JSON.parse(raised.abandonmentState as string).subject).toBe(
      'order-1',
    );
  });

  it('is not worth another attempt, a redelivery doing the same thing', async () => {
    const borrowed = await faultOfAnotherOrder();
    const raised = await faultFrom(() => {
      throw borrowed;
    });
    expect(raised.retry).toBeNull();
  });

  it('keeps what the other fault said, as the cause of this one', async () => {
    const borrowed = await faultOfAnotherOrder();
    const raised = await faultFrom(() => {
      throw borrowed;
    });
    expect(raised.cause).toContain('the gateway refused this other order');
  });

  it('tells nobody the work failed, this being no answer at all', async () => {
    const borrowed = await faultOfAnotherOrder();
    const outcome = await running(() => {
      throw borrowed;
    });
    // a fault concludes nothing: no handler error event reaches a caller
    expect('faultKind' in outcome).toBe(true);
  });

  it('still lets an executor raise a fault of its own', async () => {
    const raised = await faultFrom(async (ctx) => {
      throw await ctx.fault({
        faultKind: 'executor_raised',
        message: 'the gateway refused',
      });
    });
    expect(raised.faultKind).toBe('executor_raised');
    expect(raised.message).toBe('the gateway refused');
    expect(raised.retry).not.toBeNull();
  });
});
