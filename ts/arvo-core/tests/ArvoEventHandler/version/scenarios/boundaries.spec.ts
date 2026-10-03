import { trace } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import { ArvoExecutionContextTelemetry } from '../../../../src/ArvoEventHandler/context/telemetry/index.js';
import type { ArvoHandlerFault } from '../../../../src/ArvoEventHandler/fault/index.js';
import { deriveArvoExecutionId } from '../../../../src/ArvoEventHandler/helpers/execution-id.js';
import type { ArvoEventHandlerExecuteResponse } from '../../../../src/ArvoEventHandler/types/execute.js';
import { createArvoEventFactory } from '../../../../src/factories/ArvoEventFactory/index.js';
import { cloneArvoEvent } from '../../../../src/factories/cloneArvoEvent.js';
import {
  type AuditContext,
  auditV1,
  declareVersions,
  type OrderContext,
  orderV1,
} from './fixture.js';

/**
 * Exactly at each bound, and one short of it.
 *
 * Every bound in the protocol is exclusive, and every one of them is a
 * place where a comparison written the other way round would pass a
 * thousand executions before it let one through that should not have
 * been. One short and exactly at, for each.
 *
 * Then payloads nobody writes on purpose, which arrive anyway.
 */

const telemetryFor = () =>
  new ArvoExecutionContextTelemetry({
    span: trace.getTracer('boundaries').startSpan('execution'),
    meter: null,
    logger: null,
  });

const anOrder = (overrides: Record<string, unknown> = {}) =>
  cloneArvoEvent(
    createArvoEventFactory(orderV1).createInput({
      source: 'com.web.checkout',
      subject: 'order-1',
      to: orderV1.type,
      data: { items: ['book'] },
    }),
    overrides,
  );

/** One execution, however the version is declared and whatever it does. */
const run = async (param: {
  options?: Record<string, unknown>;
  event?: ReturnType<typeof anOrder>;
  behave?: (ctx: OrderContext) => unknown;
  attempt?: number;
}): Promise<ArvoEventHandlerExecuteResponse | ArvoHandlerFault> => {
  const versions = declareVersions({ [orderV1.type]: param.options ?? {} });
  const event = param.event ?? anOrder();
  try {
    return (await versions[orderV1.type]?.['1.0.0']?.execute({
      entry: 'init',
      event,
      state: null,
      executionId: await deriveArvoExecutionId(event),
      attempt: param.attempt ?? 0,
      dependencies: { behave: param.behave },
      hooks: {},
      telemetry: telemetryFor(),
    } as never)) as ArvoEventHandlerExecuteResponse;
  } catch (raised) {
    return raised as ArvoHandlerFault;
  }
};

const kindOf = (outcome: ArvoEventHandlerExecuteResponse | ArvoHandlerFault) =>
  'faultKind' in outcome ? outcome.faultKind : null;

/** What an execution produced, for a test that expects it to have. */
const produced = (
  outcome: ArvoEventHandlerExecuteResponse | ArvoHandlerFault,
) => {
  if ('faultKind' in outcome || outcome.kind !== 'produced') {
    throw new Error('expected this execution to produce');
  }
  return outcome;
};

/** An executor that remembers something and asks one service. */
const asking = async (ctx: OrderContext) => {
  await ctx.setState({ data: { stage: 'asking', answers: 0 } });
  return ctx.build({ type: 'com_payment_charge', data: { amount: 1 } });
};

/** An executor that remembers something and answers its caller. */
const answering = async (ctx: OrderContext) => {
  await ctx.setState({ data: { stage: 'done', answers: 0 } });
  return ctx.build({
    type: 'evt_order_fulfilled',
    data: { order_id: 'o-1' },
  });
};

describe('exactly as deep as a version allows', () => {
  const arriving = (depth: number) =>
    depth === 0 ? anOrder() : anOrder({ depth, parentid: 'something-above' });

  it('admits one a level short of the bound', async () => {
    const outcome = await run({
      options: { maxDepth: 3 },
      event: arriving(2),
      behave: answering,
    });
    expect(kindOf(outcome)).toBeNull();
  });

  it('refuses one exactly at it, the bound being exclusive', async () => {
    const outcome = await run({
      options: { maxDepth: 3 },
      event: arriving(3),
      behave: answering,
    });
    expect(kindOf(outcome)).toBe('max_depth_event_received');
  });

  it('refuses everything where nothing may sit at any level', async () => {
    const outcome = await run({ options: { maxDepth: 0 }, behave: answering });
    expect(kindOf(outcome)).toBe('max_depth_event_received');
  });

  it('admits a request from two levels short, which lands one short', async () => {
    const outcome = await run({
      options: { maxDepth: 3 },
      event: arriving(1),
      behave: asking,
    });
    expect(kindOf(outcome)).toBeNull();
  });

  it('refuses a request from one level short, which would land at it', async () => {
    // arriving a level short is admitted; asking from there is not,
    // because what it asks sits one deeper than the asker
    const outcome = await run({
      options: { maxDepth: 3 },
      event: arriving(2),
      behave: asking,
    });
    expect(kindOf(outcome)).toBe('max_depth_event_requested');
  });

  it('tells an executor it has reached the edge before it asks', async () => {
    let sawTheEdge: boolean | undefined;
    await run({
      options: { maxDepth: 2 },
      event: arriving(1),
      behave: async (ctx) => {
        sawTheEdge = ctx.atMaxDepth;
        await ctx.setState({ data: { stage: 'done', answers: 0 } });
      },
    });
    expect(sawTheEdge).toBe(true);
  });
});

describe('exactly as long as a version allows', () => {
  it('admits an execution a moment short of its bound', async () => {
    const outcome = await run({
      options: { runTimeout: 60, executionTimeout: 60 },
      event: anOrder({ time: new Date(Date.now() - 40).toISOString() }),
      behave: asking,
    });
    expect(kindOf(outcome)).toBeNull();
  });

  it('refuses one exactly at it, the bound being exclusive', async () => {
    const outcome = await run({
      options: { runTimeout: 50, executionTimeout: 50 },
      event: anOrder({ time: new Date(Date.now() - 50).toISOString() }),
      behave: asking,
    });
    expect(kindOf(outcome)).toBe('execution_timeout');
  });

  it('admits an executor that returned a moment short of its own bound', async () => {
    const outcome = await run({
      options: { runTimeout: 80 },
      behave: async (ctx) => {
        await new Promise((settle) => setTimeout(settle, 20));
        return asking(ctx);
      },
    });
    expect(kindOf(outcome)).toBeNull();
  });

  it('waits forever where a version set no bound at all', async () => {
    const outcome = await run({
      options: { runTimeout: null, executionTimeout: null },
      event: anOrder({ time: new Date(2020, 0, 1).toISOString() }),
      behave: asking,
    });
    expect(kindOf(outcome)).toBeNull();
  });
});

describe('exactly as many attempts as a version allows', () => {
  const failing = (attempt: number, maxRetryAttempts: number) =>
    run({
      options: { maxRetryAttempts },
      attempt,
      behave: async (ctx: OrderContext) => {
        throw await ctx.fault({
          faultKind: 'executor_raised',
          message: 'the gateway refused',
        });
      },
    });

  it('offers another attempt one short of the limit', async () => {
    const outcome = (await failing(2, 3)) as ArvoHandlerFault;
    expect(outcome.retry).not.toBeNull();
  });

  it('offers none exactly at it', async () => {
    const outcome = (await failing(3, 3)) as ArvoHandlerFault;
    expect(outcome.retry).toBeNull();
  });

  it('offers none at all where a version allows none', async () => {
    const outcome = (await failing(0, 0)) as ArvoHandlerFault;
    expect(outcome.retry).toBeNull();
  });

  it('keeps the kind whatever the verdict', async () => {
    expect(((await failing(0, 3)) as ArvoHandlerFault).faultKind).toBe(
      'executor_raised',
    );
    expect(((await failing(3, 3)) as ArvoHandlerFault).faultKind).toBe(
      'executor_raised',
    );
  });
});

describe('a collection of exactly one, and of none', () => {
  it('waits on one, and finishes on its answer', async () => {
    const outcome = await run({ behave: asking });
    const made = produced(outcome);
    expect(made.state.lifecycle).toBe('waiting');
    expect((made.state.inFlightEventMap as unknown[]).length).toBe(1);
  });

  it('rests idle on none, having asked for nothing and answered nobody', async () => {
    const outcome = await run({
      behave: async (ctx) => {
        await ctx.setState({ data: { stage: 'quiet', answers: 0 } });
      },
    });
    expect(produced(outcome).state.lifecycle).toBe('idle');
  });
});

describe('payloads nobody writes on purpose', () => {
  /** One execution of the version that remembers anything at all. */
  const remembering = async (data: Record<string, unknown>) => {
    const versions = declareVersions();
    const event = createArvoEventFactory(auditV1).createInput({
      source: 'com.web.checkout',
      subject: 'audit-1',
      to: auditV1.type,
      data: { line: 'something happened' },
    });
    try {
      return (await versions[auditV1.type]?.['1.0.0']?.execute({
        entry: 'init',
        event,
        state: null,
        executionId: await deriveArvoExecutionId(event),
        attempt: 0,
        dependencies: {
          behave: async (ctx: AuditContext) => {
            await ctx.setState({ data });
          },
        },
        hooks: {},
        telemetry: telemetryFor(),
      } as never)) as ArvoEventHandlerExecuteResponse;
    } catch (raised) {
      return raised as ArvoHandlerFault;
    }
  };

  it('keeps a key that names something every object already has', async () => {
    const outcome = await remembering({ constructor: 'not a function' });
    expect(
      (produced(outcome).state.data as Record<string, unknown>).constructor,
    ).toBe('not a function');
  });

  it('does not let a stored key reach anything a prototype answers for', async () => {
    const outcome = await remembering(
      JSON.parse('{"__proto__": {"polluted": true}}'),
    );
    produced(outcome);
    expect(
      ({} as Record<string, unknown>).polluted,
      'a stored record reached every object in the process',
    ).toBeUndefined();
  });

  it('remembers a megabyte, where that is what a version remembers', async () => {
    const outcome = await remembering({ blob: 'x'.repeat(1_000_000) });
    expect((produced(outcome).state.data as { blob: string }).blob.length).toBe(
      1_000_000,
    );
  });

  it('remembers two hundred levels of nesting', async () => {
    let deep: Record<string, unknown> = { bottom: true };
    for (let at = 0; at < 200; at += 1) deep = { deeper: deep };
    const outcome = await remembering(deep);
    expect('faultKind' in outcome).toBe(false);
  });

  it('remembers text nobody can type, and writes it out unchanged', async () => {
    const written = '🙈 مرحبا \\u{1F600} \\uD83D\\uDE00 line\\nbreak';
    const outcome = await remembering({ written });
    expect((produced(outcome).state.data as { written: string }).written).toBe(
      written,
    );
  });

  it('remembers numbers at the edge of what JSON carries', async () => {
    const outcome = await remembering({
      big: Number.MAX_SAFE_INTEGER,
      small: Number.MIN_VALUE,
      negativeZero: -0,
      exponent: 1e308,
    });
    const held = produced(outcome).state.data as Record<string, number>;
    expect(held.big).toBe(Number.MAX_SAFE_INTEGER);
    expect(held.exponent).toBe(1e308);
  });

  it('stores a number JSON cannot carry as the nothing JSON makes of it', async () => {
    const outcome = await remembering({ notANumber: Number.NaN });
    const made = produced(outcome);

    // JSON has no such number, so what reaches a store is null. The
    // execution is not refused for it: a version that declared it
    // remembers anything said it would take whatever came.
    expect((made.state.data as Record<string, unknown>).notANumber).toBeNull();
  });

  it('drops what JSON drops, rather than pretending it was stored', async () => {
    const outcome = await remembering({ here: 1, gone: undefined });
    const made = produced(outcome);
    expect('gone' in (made.state as Record<string, unknown>)).toBe(false);
    expect(JSON.stringify(made.state)).not.toContain('gone');
  });
});
