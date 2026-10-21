import type { Span, Tracer } from '@opentelemetry/api';
import { z } from 'zod';
import type { ArvoExecutionContext } from '../../../src/ArvoEventHandler/context/index.js';
import type { ArvoHandlerFault } from '../../../src/ArvoEventHandler/fault/index.js';
import type { IArvoEventHandlerDependency } from '../../../src/ArvoEventHandler/types/dependency.js';
import type {
  ArvoEventHandlerExecuteResponse,
  ArvoExecutorEmission,
} from '../../../src/ArvoEventHandler/types/execute.js';
import type {
  ArvoEventHandlerMiddlewareEntry,
  IArvoEventHandlerMiddleware,
} from '../../../src/ArvoEventHandler/types/middleware.js';
import { createArvoEventFactory } from '../../../src/factories/ArvoEventFactory/index.js';
import { setupArvoEventHandler } from '../../../src/factories/setupArvoEventHandler.js';
import type { JSONObject } from '../../../src/types.js';
import { orderContract, orderVersion, paymentVersion } from '../fixtures.js';

/**
 * A handler with layers around it, and everything needed to watch one run.
 *
 * The span here records: the package's own spans are no-ops without an
 * SDK, which would make every mark invisible to a test.
 */

/** What the order version remembers. */
export const orderState = z.object({ stage: z.string() });

/** A store the handler reaches through, as a mechanism would supply one. */
export const createInMemoryStore = () => {
  const rows = new Map<string, JSONObject>();
  return {
    rows,
    read:
      () =>
      ({ executionId }: { executionId: string }) =>
        rows.get(executionId) ?? null,
    commit: (state: JSONObject) => {
      rows.set(state.executionId as string, state);
    },
  };
};

/** An event opening an execution of the order handler. */
export const orderRequest = (subject = 'order-1') =>
  createArvoEventFactory(orderVersion).createInput({
    source: 'com.web.checkout',
    subject,
    to: orderVersion.type,
    data: { items: ['book'] },
  });

/** A span that keeps everything said to it. */
export const recordingSpan = () => {
  const events: { name: string; attributes: Record<string, unknown> }[] = [];
  const span = {
    addEvent: (name: string, attributes?: Record<string, unknown>) => {
      events.push({ name, attributes: attributes ?? {} });
      return span;
    },
    setAttribute: () => span,
    setAttributes: () => span,
    setStatus: () => span,
    recordException: () => undefined,
    updateName: () => span,
    end: () => undefined,
    isRecording: () => true,
    addLink: () => span,
    addLinks: () => span,
    spanContext: () => ({
      traceId: '0af7651916cd43dd8448eb211c80319c',
      spanId: 'b7ad6b7169203331',
      traceFlags: 1,
    }),
  } as unknown as Span;
  let spansStarted = 0;
  const tracer = {
    startSpan: () => {
      spansStarted += 1;
      return span;
    },
  } as unknown as Tracer;
  return {
    tracer,
    events,
    /** How many spans the handler opened. */
    spansStarted: () => spansStarted,
    /** The marks, by name, with the layer each named. */
    marks: () =>
      events
        .filter((spanEvent) => spanEvent.name.includes('middleware'))
        .map((spanEvent) => [
          spanEvent.name.replace(/^.*stage\./, ''),
          spanEvent.attributes['middleware.id'],
        ]),
  };
};

/** What the executor does, by default answering its caller at once. */
export type OrderExecutor = (
  ctx: ArvoExecutionContext<
    typeof orderVersion,
    { payments: typeof paymentVersion },
    typeof orderState
  >,
) => ArvoExecutorEmission | Promise<ArvoExecutorEmission>;

export const answeringExecutor: OrderExecutor = async (ctx) => {
  await ctx.setState({ data: { stage: 'answered' } });
  return ctx.build({
    type: 'com_order_created',
    data: { order_id: ctx.state.subject },
  });
};

/** A handler for the order contract with layers declared around it. */
export const orderHandler = (
  param: {
    middleware?: readonly ArvoEventHandlerMiddlewareEntry[];
    execute?: OrderExecutor;
    runTimeout?: number | null;
    executionTimeout?: number | null;
    tracer?: Tracer;
  } = {},
) =>
  setupArvoEventHandler({
    contracts: { self: orderContract, services: { payments: paymentVersion } },
    options: {
      ...(param.runTimeout === undefined
        ? {}
        : { runTimeout: param.runTimeout }),
      ...(param.executionTimeout === undefined
        ? {}
        : { executionTimeout: param.executionTimeout }),
    },
    ...(param.tracer === undefined
      ? {}
      : { telemetry: { tracer: param.tracer } }),
    ...(param.middleware === undefined ? {} : { middleware: param.middleware }),
  })
    .handler('1.0.0', {
      state: orderState,
      execute: (param.execute ?? answeringExecutor) as never,
    })
    .build();

/** Runs one opening execution and says what came back, fault included. */
export const executeOrder = async (
  handler: ReturnType<typeof orderHandler>,
  param: {
    middleware?: readonly ArvoEventHandlerMiddlewareEntry[];
    event?: Parameters<
      ReturnType<typeof orderHandler>['tryExecute']
    >[0]['event'];
    store?: ReturnType<typeof createInMemoryStore>;
    dependencies?: IArvoEventHandlerDependency;
    attempt?: number;
  } = {},
): Promise<
  | { ok: true; value: ArvoEventHandlerExecuteResponse }
  | { ok: false; error: ArvoHandlerFault }
> => {
  const executionResult = await handler.tryExecute({
    event: param.event ?? orderRequest(),
    state: (param.store ?? createInMemoryStore()).read(),
    attempt: param.attempt ?? 0,
    ...(param.middleware === undefined ? {} : { middleware: param.middleware }),
    ...(param.dependencies === undefined
      ? {}
      : { dependencies: param.dependencies as never }),
  });
  return executionResult;
};

/** A log every part of every layer writes to, in the order things happened. */
export const createPartLog = () => {
  const partLog: string[] = [];
  const loggingLayer = (
    id: string,
    parts: { before?: boolean; after?: boolean } = {
      before: true,
      after: true,
    },
  ): IArvoEventHandlerMiddleware => ({
    id,
    ...(parts.before
      ? { before: () => void partLog.push(`${id}.before`) }
      : {}),
    ...(parts.after ? { after: () => void partLog.push(`${id}.after`) } : {}),
  });
  const loggingExecutor: OrderExecutor = async (ctx) => {
    partLog.push('executor');
    return answeringExecutor(ctx);
  };
  return { partLog, loggingLayer, loggingExecutor };
};

/** Waits, so a clock can run out. */
export const sleep = (ms: number) =>
  new Promise<void>((settle) => setTimeout(settle, ms));

/** The executor that asks the payment service twice, then answers once both reply. */
export const askingPaymentTwiceExecutor: OrderExecutor = async (ctx) => {
  if (ctx.state.triggeringEvent.type === 'com_order_create') {
    await ctx.setState({ data: { stage: 'asking' } });
    return [
      await ctx.build({ type: 'com_payment_charge', data: { amount: 1 } }),
      await ctx.build({ type: 'com_payment_charge', data: { amount: 2 } }),
    ];
  }
  return answeringExecutor(ctx);
};

/** What the payment service answers one request with. */
export const paymentAnswerFor = (
  request: { id: string; subject: string },
  executionId: string,
) =>
  createArvoEventFactory(paymentVersion).createOutput({
    type: 'evt_payment_charged',
    source: paymentVersion.type,
    subject: request.subject,
    to: orderVersion.type,
    executionid: executionId,
    initid: request.id,
    parentid: request.id,
    data: { receipt: `r-${request.id}` },
  });
