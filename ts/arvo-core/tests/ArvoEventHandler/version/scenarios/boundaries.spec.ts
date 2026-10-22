import { trace } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import { ArvoExecutionContextTelemetry } from '../../../../src/ArvoEventHandler/context/telemetry/index.js';
import type { ArvoHandlerFault } from '../../../../src/ArvoEventHandler/fault/index.js';
import { deriveArvoExecutionId } from '../../../../src/ArvoEventHandler/helpers/execution-id.js';
import type { ArvoEventHandlerExecuteResponse } from '../../../../src/ArvoEventHandler/types/execute.js';
import { createArvoEventFactory } from '../../../../src/factories/ArvoEventFactory/index.js';
import { mutateArvoEvent } from '../../../../src/factories/mutateArvoEvent.js';
import { heldDependencies } from '../../dependency.js';
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

const executionTelemetry = () =>
  new ArvoExecutionContextTelemetry({
    span: trace.getTracer('boundaries').startSpan('execution'),
    meter: null,
    logger: null,
  });

const anOrder = (overrides: Record<string, unknown> = {}) =>
  mutateArvoEvent(
    createArvoEventFactory(orderV1).createInput({
      source: 'com.web.checkout',
      subject: 'order-1',
      to: orderV1.type,
      data: { items: ['book'] },
    }),
    overrides,
  );

/** One execution, however the version is declared and whatever it does. */
const runOrder = async (param: {
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
      dependencies: heldDependencies({ behave: param.behave }).dependency,
      hooks: {},
      telemetry: executionTelemetry(),
    } as never)) as ArvoEventHandlerExecuteResponse;
  } catch (thrown) {
    return thrown as ArvoHandlerFault;
  }
};

const faultKindOf = (
  responseOrFault: ArvoEventHandlerExecuteResponse | ArvoHandlerFault,
) => ('faultKind' in responseOrFault ? responseOrFault.faultKind : null);

/** What an execution produced, for a test that expects it to have. */
const producedResponse = (
  responseOrFault: ArvoEventHandlerExecuteResponse | ArvoHandlerFault,
) => {
  if ('faultKind' in responseOrFault || responseOrFault.kind !== 'produced') {
    throw new Error('expected this execution to produce');
  }
  return responseOrFault;
};

/** An executor that remembers something and asks one service. */
const askPayment = async (ctx: OrderContext) => {
  await ctx.setState({ data: { stage: 'asking', answers: 0 } });
  return ctx.build({ type: 'com_payment_charge', data: { amount: 1 } });
};

/** An executor that remembers something and answers its caller. */
const answerCaller = async (ctx: OrderContext) => {
  await ctx.setState({ data: { stage: 'done', answers: 0 } });
  return ctx.build({
    type: 'evt_order_fulfilled',
    data: { order_id: 'o-1' },
  });
};

describe('exactly as deep as a version allows', () => {
  const orderAtDepth = (depth: number) =>
    depth === 0 ? anOrder() : anOrder({ depth, parentid: 'something-above' });

  it('admits one a level short of the bound', async () => {
    const responseOrFault = await runOrder({
      options: { maxDepth: 3 },
      event: orderAtDepth(2),
      behave: answerCaller,
    });
    expect(faultKindOf(responseOrFault)).toBeNull();
  });

  it('refuses one exactly at it, the bound being exclusive', async () => {
    const responseOrFault = await runOrder({
      options: { maxDepth: 3 },
      event: orderAtDepth(3),
      behave: answerCaller,
    });
    expect(faultKindOf(responseOrFault)).toBe('max_depth_event_received');
  });

  it('refuses everything where nothing may sit at any level', async () => {
    const responseOrFault = await runOrder({
      options: { maxDepth: 0 },
      behave: answerCaller,
    });
    expect(faultKindOf(responseOrFault)).toBe('max_depth_event_received');
  });

  it('admits a request from two levels short, which lands one short', async () => {
    const responseOrFault = await runOrder({
      options: { maxDepth: 3 },
      event: orderAtDepth(1),
      behave: askPayment,
    });
    expect(faultKindOf(responseOrFault)).toBeNull();
  });

  it('refuses a request from one level short, which would land at it', async () => {
    // arriving a level short is admitted; asking from there is not,
    // because what it asks sits one deeper than the asker
    const responseOrFault = await runOrder({
      options: { maxDepth: 3 },
      event: orderAtDepth(2),
      behave: askPayment,
    });
    expect(faultKindOf(responseOrFault)).toBe('max_depth_event_requested');
  });

  it('tells an executor it has reached the edge before it asks', async () => {
    let sawTheEdge: boolean | undefined;
    await runOrder({
      options: { maxDepth: 2 },
      event: orderAtDepth(1),
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
    const responseOrFault = await runOrder({
      options: { runTimeout: 60, executionTimeout: 60 },
      event: anOrder({ time: new Date(Date.now() - 40).toISOString() }),
      behave: askPayment,
    });
    expect(faultKindOf(responseOrFault)).toBeNull();
  });

  it('refuses one exactly at it, the bound being exclusive', async () => {
    const responseOrFault = await runOrder({
      options: { runTimeout: 50, executionTimeout: 50 },
      event: anOrder({ time: new Date(Date.now() - 50).toISOString() }),
      behave: askPayment,
    });
    expect(faultKindOf(responseOrFault)).toBe('execution_timeout');
  });

  it('admits an executor that returned a moment short of its own bound', async () => {
    const responseOrFault = await runOrder({
      options: { runTimeout: 80 },
      behave: async (ctx) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return askPayment(ctx);
      },
    });
    expect(faultKindOf(responseOrFault)).toBeNull();
  });

  it('waits forever where a version set no bound at all', async () => {
    const responseOrFault = await runOrder({
      options: { runTimeout: null, executionTimeout: null },
      event: anOrder({ time: new Date(2020, 0, 1).toISOString() }),
      behave: askPayment,
    });
    expect(faultKindOf(responseOrFault)).toBeNull();
  });
});

describe('exactly as many attempts as a version allows', () => {
  const runFailingAttempt = (attempt: number, maxRetryAttempts: number) =>
    runOrder({
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
    const responseOrFault = (await runFailingAttempt(2, 3)) as ArvoHandlerFault;
    expect(responseOrFault.retry).not.toBeNull();
  });

  it('offers none exactly at it', async () => {
    const responseOrFault = (await runFailingAttempt(3, 3)) as ArvoHandlerFault;
    expect(responseOrFault.retry).toBeNull();
  });

  it('offers none at all where a version allows none', async () => {
    const responseOrFault = (await runFailingAttempt(0, 0)) as ArvoHandlerFault;
    expect(responseOrFault.retry).toBeNull();
  });

  it('keeps the kind whatever the verdict', async () => {
    expect(
      ((await runFailingAttempt(0, 3)) as ArvoHandlerFault).faultKind,
    ).toBe('executor_raised');
    expect(
      ((await runFailingAttempt(3, 3)) as ArvoHandlerFault).faultKind,
    ).toBe('executor_raised');
  });
});

describe('a collection of exactly one, and of none', () => {
  it('waits on one, and finishes on its answer', async () => {
    const responseOrFault = await runOrder({ behave: askPayment });
    const response = producedResponse(responseOrFault);
    expect(response.state.lifecycle).toBe('waiting');
    expect(response.state.inFlightEventMap as unknown[]).toHaveLength(1);
  });

  it('rests idle on none, having asked for nothing and answered nobody', async () => {
    const responseOrFault = await runOrder({
      behave: async (ctx) => {
        await ctx.setState({ data: { stage: 'quiet', answers: 0 } });
      },
    });
    expect(producedResponse(responseOrFault).state.lifecycle).toBe('idle');
  });
});

describe('payloads nobody writes on purpose', () => {
  /** One execution of the version that remembers anything at all. */
  const runAudit = async (data: Record<string, unknown>) => {
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
        dependencies: heldDependencies({
          behave: async (ctx: AuditContext) => {
            await ctx.setState({ data });
          },
        }).dependency,
        hooks: {},
        telemetry: executionTelemetry(),
      } as never)) as ArvoEventHandlerExecuteResponse;
    } catch (thrown) {
      return thrown as ArvoHandlerFault;
    }
  };

  it('keeps a key that names something every object already has', async () => {
    const responseOrFault = await runAudit({ constructor: 'not a function' });
    expect(
      (producedResponse(responseOrFault).state.data as Record<string, unknown>)
        .constructor,
    ).toBe('not a function');
  });

  it('does not let a stored key reach anything a prototype answers for', async () => {
    const responseOrFault = await runAudit(
      JSON.parse('{"__proto__": {"polluted": true}}'),
    );
    producedResponse(responseOrFault);
    expect(
      ({} as Record<string, unknown>).polluted,
      'a stored record reached every object in the process',
    ).toBeUndefined();
  });

  it('remembers a megabyte, where that is what a version remembers', async () => {
    const responseOrFault = await runAudit({ blob: 'x'.repeat(1_000_000) });
    expect(
      (producedResponse(responseOrFault).state.data as { blob: string }).blob,
    ).toHaveLength(1_000_000);
  });

  it('remembers two hundred levels of nesting', async () => {
    let nested: Record<string, unknown> = { bottom: true };
    for (let level = 0; level < 200; level += 1) nested = { deeper: nested };
    const responseOrFault = await runAudit(nested);
    expect('faultKind' in responseOrFault).toBe(false);
  });

  it('remembers text nobody can type, and writes it out unchanged', async () => {
    const unusualText = '🙈 مرحبا \\u{1F600} \\uD83D\\uDE00 line\\nbreak';
    const responseOrFault = await runAudit({ written: unusualText });
    expect(
      (producedResponse(responseOrFault).state.data as { written: string })
        .written,
    ).toBe(unusualText);
  });

  it('remembers numbers at the edge of what JSON carries', async () => {
    const responseOrFault = await runAudit({
      big: Number.MAX_SAFE_INTEGER,
      small: Number.MIN_VALUE,
      negativeZero: -0,
      exponent: 1e308,
    });
    const storedNumbers = producedResponse(responseOrFault).state
      .data as Record<string, number>;
    expect(storedNumbers.big).toBe(Number.MAX_SAFE_INTEGER);
    expect(storedNumbers.exponent).toBe(1e308);
  });

  it('stores a number JSON cannot carry as the nothing JSON makes of it', async () => {
    const responseOrFault = await runAudit({ notANumber: Number.NaN });
    const response = producedResponse(responseOrFault);

    // JSON has no such number, so what reaches a store is null. The
    // execution is not refused for it: a version that declared it
    // remembers anything said it would take whatever came.
    expect(
      (response.state.data as Record<string, unknown>).notANumber,
    ).toBeNull();
  });

  it('drops what JSON drops, rather than pretending it was stored', async () => {
    const responseOrFault = await runAudit({ here: 1, gone: undefined });
    const response = producedResponse(responseOrFault);
    expect('gone' in (response.state as Record<string, unknown>)).toBe(false);
    expect(JSON.stringify(response.state)).not.toContain('gone');
  });
});
