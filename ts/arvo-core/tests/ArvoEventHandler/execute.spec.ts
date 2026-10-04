import { trace } from '@opentelemetry/api';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoContract } from '../../src/ArvoContract/index.js';
import { ArvoHandlerFault } from '../../src/ArvoEventHandler/fault/index.js';
import { deriveArvoExecutionId } from '../../src/ArvoEventHandler/helpers/execution-id.js';
import type { ArvoEventHandlerExecuteResponse } from '../../src/ArvoEventHandler/types/execute.js';
import { createArvoEventFactory } from '../../src/factories/ArvoEventFactory/index.js';
import { cloneArvoEvent } from '../../src/factories/cloneArvoEvent.js';
import { setupArvoEventHandler } from '../../src/factories/setupArvoEventHandler.js';
import type { JSONObject } from '../../src/types.js';
import { orderContract, orderVersion, paymentVersion } from './fixtures.js';

/** A store the handler reaches through, as a mechanism would supply one. */
const storing = () => {
  const rows = new Map<string, JSONObject>();
  return {
    rows,
    read:
      (failing = false) =>
      ({ executionId }: { executionId: string }) => {
        if (failing) throw new Error('the store is unreachable');
        return rows.get(executionId) ?? null;
      },
  };
};

const handlerOf = (charge = true) =>
  setupArvoEventHandler({
    contracts: { self: orderContract, services: { payments: paymentVersion } },
  })
    .handler('1.0.0', {
      state: z.object({ stage: z.string() }),
      execute: async (ctx) => {
        if (ctx.entry === 'followup') {
          await ctx.setState({ data: { stage: 'answering' } });
          return ctx.build({
            type: 'com_order_created',
            data: { order_id: ctx.state.subject },
          });
        }
        await ctx.setState({ data: { stage: 'asking' } });
        if (!charge) return;
        return ctx.build({ type: 'com_payment_charge', data: { amount: 10 } });
      },
    })
    .build();

const anOrder = (subject = 'order-1') =>
  createArvoEventFactory(orderVersion).createInput({
    source: 'com.web.checkout',
    subject,
    to: orderVersion.type,
    data: { items: ['book'] },
  });

/**
 * An event opening an execution that states it completes one.
 *
 * It carries an `initid` because an event stating it completes something
 * must say what, which is what makes this a disagreement between two
 * participants rather than a malformed event.
 */
const miscategorised = () =>
  cloneArvoEvent(anOrder(), {
    category: 'io.arvo.complete',
    initid: 'a-request-somewhere-else',
  });

/** What a fault says, for a test that only cares which one it is. */
const faultFrom = async (
  run: Promise<ArvoEventHandlerExecuteResponse>,
): Promise<ArvoHandlerFault> => {
  try {
    await run;
  } catch (raised) {
    return raised as ArvoHandlerFault;
  }
  throw new Error('nothing was refused');
};

describe('an event that opens an execution', () => {
  const store = storing();
  beforeEach(() => store.rows.clear());

  it('produces the events to publish and the record to commit', async () => {
    const ran = await handlerOf().execute({
      event: anOrder(),
      state: store.read(),
      attempt: 0,
    });
    expect(ran.kind).toBe('produced');
    expect(ran.kind === 'produced' && ran.events).toHaveLength(1);
    expect(ran.kind === 'produced' && ran.events[0]?.type).toBe(
      'com_payment_charge',
    );
  });

  it('opens it under the identifier the event derives', async () => {
    const event = anOrder();
    const ran = await handlerOf().execute({
      event,
      state: store.read(),
      attempt: 0,
    });
    const record = ran.kind === 'produced' ? ran.state : null;
    expect(record?.executionId).toBe(await deriveArvoExecutionId(event));
  });

  it('opens it at the first revision, so a second create is refused', async () => {
    const ran = await handlerOf().execute({
      event: anOrder(),
      state: store.read(),
      attempt: 0,
    });
    expect(ran.kind === 'produced' && ran.state.casVersion).toBe(0);
  });

  it('rests where nothing was asked for and nothing answered', async () => {
    const ran = await handlerOf(false).execute({
      event: anOrder(),
      state: store.read(),
      attempt: 0,
    });
    expect(ran.kind === 'produced' && ran.state.lifecycle).toBe('idle');
  });
});

describe('a whole workflow through the handler', () => {
  it('asks, is answered, and answers its own caller', async () => {
    const store = storing();
    const handler = handlerOf();
    const order = anOrder();

    const asked = await handler.execute({
      event: order,
      state: store.read(),
      attempt: 0,
    });
    if (asked.kind !== 'produced') throw new Error('nothing was asked');
    store.rows.set(asked.state.executionId as string, asked.state);

    const charged = createArvoEventFactory(paymentVersion).createOutput({
      type: 'evt_payment_charged',
      source: paymentVersion.type,
      subject: order.subject,
      to: orderVersion.type,
      executionid: asked.state.executionId as string,
      initid: asked.events[0]?.id,
      parentid: asked.events[0]?.id,
      data: { receipt: 'r-1' },
    });

    const answered = await handler.execute({
      event: charged,
      state: store.read(),
      attempt: 0,
    });
    expect(answered.kind).toBe('produced');
    expect(answered.kind === 'produced' && answered.events[0]?.type).toBe(
      'com_order_created',
    );
    expect(answered.kind === 'produced' && answered.state.lifecycle).toBe(
      'success',
    );
    expect(answered.kind === 'produced' && answered.state.casVersion).toBe(1);
  });
});

describe('an event nothing can place', () => {
  it('is refused, its contract being one nothing declared', async () => {
    const stranger = new ArvoContract({
      type: 'com_nothing_declared',
      versions: {
        '1.0.0': { input: z.object({ of: z.string() }), outputs: {} },
      },
    });
    const event = createArvoEventFactory(
      stranger.versions['1.0.0'],
    ).createInput({
      source: 'com.web.checkout',
      subject: 'order-1',
      to: 'com_nothing_declared',
      data: { of: 'nothing' },
    });
    const fault = await faultFrom(
      handlerOf().execute({ event, state: storing().read(), attempt: 0 }),
    );
    expect(fault.faultKind).toBe('event_unclassifiable');
  });

  it('names no execution, nothing having placed it', async () => {
    const event = cloneArvoEvent(anOrder(), { dataschema: '#/nowhere/1.0.0' });
    const fault = await faultFrom(
      handlerOf().execute({ event, state: storing().read(), attempt: 0 }),
    );
    expect(fault.executionId).toBeNull();
  });

  it('carries nothing to abandon with, there being nobody to tell', async () => {
    const event = cloneArvoEvent(anOrder(), { dataschema: '#/nowhere/1.0.0' });
    const fault = await faultFrom(
      handlerOf().execute({ event, state: storing().read(), attempt: 0 }),
    );
    expect(fault.abandonmentEvent).toBeNull();
    expect(fault.abandonmentState).toBeNull();
  });

  it('is not worth another attempt, the event being the same every time', async () => {
    const event = cloneArvoEvent(anOrder(), { dataschema: '#/nowhere/1.0.0' });
    const fault = await faultFrom(
      handlerOf().execute({ event, state: storing().read(), attempt: 0 }),
    );
    expect(fault.retry).toBeNull();
  });

  it('is refused where the contract declares no such version', async () => {
    const event = cloneArvoEvent(anOrder(), {
      dataschema: `${orderContract.uri}/9.9.9`,
    });
    const fault = await faultFrom(
      handlerOf().execute({ event, state: storing().read(), attempt: 0 }),
    );
    expect(fault.faultKind).toBe('event_unclassifiable');
  });
});

describe('an event whose stated role contradicts what it was placed as', () => {
  it('is refused, two deployments having diverged', async () => {
    const event = miscategorised();
    const fault = await faultFrom(
      handlerOf().execute({ event, state: storing().read(), attempt: 0 }),
    );
    expect(fault.faultKind).toBe('category_mismatch');
  });

  it('still carries the caller an answer, the event naming where it came from', async () => {
    const event = miscategorised();
    const fault = await faultFrom(
      handlerOf().execute({ event, state: storing().read(), attempt: 0 }),
    );
    expect(fault.abandonmentEvent).not.toBeNull();
  });

  it('carries no record, no execution having begun', async () => {
    const event = miscategorised();
    const fault = await faultFrom(
      handlerOf().execute({ event, state: storing().read(), attempt: 0 }),
    );
    expect(fault.abandonmentState).toBeNull();
  });

  it('is accepted where the event states nothing at all', async () => {
    const ran = await handlerOf().execute({
      event: anOrder(),
      state: storing().read(),
      attempt: 0,
    });
    expect(ran.kind).toBe('produced');
  });

  it('is accepted where the event states something unreserved', async () => {
    const event = cloneArvoEvent(anOrder(), { category: 'something.else' });
    const ran = await handlerOf().execute({
      event,
      state: storing().read(),
      attempt: 0,
    });
    expect(ran.kind).toBe('produced');
  });
});

describe('a store that cannot be read', () => {
  it('is refused, and is worth another attempt', async () => {
    const fault = await faultFrom(
      handlerOf().execute({
        event: anOrder(),
        state: storing().read(true),
        attempt: 0,
      }),
    );
    expect(fault.faultKind).toBe('state_resolution_failed');
    expect(fault.retry).not.toBeNull();
  });

  it('says what the store said, so the cause is not lost', async () => {
    const fault = await faultFrom(
      handlerOf().execute({
        event: anOrder(),
        state: storing().read(true),
        attempt: 0,
      }),
    );
    expect(fault.cause).toContain('unreachable');
  });
});

describe('what the store held against what the event claims', () => {
  it('refuses an opening event where an execution already exists', async () => {
    const store = storing();
    const order = anOrder();
    const first = await handlerOf().execute({
      event: order,
      state: store.read(),
      attempt: 0,
    });
    if (first.kind !== 'produced') throw new Error('nothing was opened');
    store.rows.set(first.state.executionId as string, first.state);

    const fault = await faultFrom(
      handlerOf().execute({ event: order, state: store.read(), attempt: 0 }),
    );
    expect(fault.faultKind).toBe('record_unexpected');
  });

  it('refuses an answering event where no execution exists', async () => {
    const charged = createArvoEventFactory(paymentVersion).createOutput({
      type: 'evt_payment_charged',
      source: paymentVersion.type,
      subject: 'order-1',
      to: orderVersion.type,
      executionid: 'an-execution-nothing-opened',
      initid: 'a-request-nothing-sent',
      parentid: 'a-request-nothing-sent',
      data: { receipt: 'r-1' },
    });
    const fault = await faultFrom(
      handlerOf().execute({
        event: charged,
        state: storing().read(),
        attempt: 0,
      }),
    );
    expect(fault.faultKind).toBe('record_expected');
  });

  it('tells nobody about an answering event it has no record of', async () => {
    const charged = createArvoEventFactory(paymentVersion).createOutput({
      type: 'evt_payment_charged',
      source: paymentVersion.type,
      subject: 'order-1',
      to: orderVersion.type,
      executionid: 'an-execution-nothing-opened',
      initid: 'a-request-nothing-sent',
      parentid: 'a-request-nothing-sent',
      data: { receipt: 'r-1' },
    });
    const fault = await faultFrom(
      handlerOf().execute({
        event: charged,
        state: storing().read(),
        attempt: 0,
      }),
    );
    // its source names the service, not this execution's caller
    expect(fault.abandonmentEvent).toBeNull();
  });
});

describe('a stored row that is not a record', () => {
  it('is refused as corrupt rather than compared against anything', async () => {
    const charged = createArvoEventFactory(paymentVersion).createOutput({
      type: 'evt_payment_charged',
      source: paymentVersion.type,
      subject: 'order-1',
      to: orderVersion.type,
      executionid: 'anything',
      initid: 'anything',
      parentid: 'anything',
      data: { receipt: 'r-1' },
    });
    const fault = await faultFrom(
      handlerOf().execute({
        event: charged,
        state: () => ({ nothing: 'that is a record' }) as JSONObject,
        attempt: 0,
      }),
    );
    expect(fault.faultKind).toBe('record_invalid');
  });
});

describe('an execution whose version the handler no longer runs', () => {
  it('is refused, nothing being left that could resume it', async () => {
    const store = storing();
    const handler = handlerOf();
    const order = anOrder();
    const asked = await handler.execute({
      event: order,
      state: store.read(),
      attempt: 0,
    });
    if (asked.kind !== 'produced') throw new Error('nothing was asked');

    const stranded = { ...asked.state, version: '9.9.9' } as JSONObject;
    const charged = createArvoEventFactory(paymentVersion).createOutput({
      type: 'evt_payment_charged',
      source: paymentVersion.type,
      subject: order.subject,
      to: orderVersion.type,
      executionid: asked.state.executionId as string,
      initid: asked.events[0]?.id,
      parentid: asked.events[0]?.id,
      data: { receipt: 'r-1' },
    });

    const fault = await faultFrom(
      handler.execute({
        event: charged,
        state: () => stranded,
        attempt: 0,
      }),
    );
    expect(fault.faultKind).toBe('version_not_declared');
  });
});

describe('an event the contract it named cannot send here', () => {
  it('refuses a payload the schema rejects', async () => {
    const event = cloneArvoEvent(anOrder(), {
      data: { items: ['book', 7] as unknown as string[] },
    });
    const fault = await faultFrom(
      handlerOf().execute({ event, state: storing().read(), attempt: 0 }),
    );
    expect(fault.faultKind).toBe('event_schema_rejected');
  });

  it('refuses a type the contract never takes in', async () => {
    const event = cloneArvoEvent(anOrder(), { type: 'com_order_created' });
    const fault = await faultFrom(
      handlerOf().execute({ event, state: storing().read(), attempt: 0 }),
    );
    expect(fault.faultKind).toBe('type_not_receivable');
  });
});

describe('the two ways a refusal reaches a caller', () => {
  it('is thrown by execute and reported by tryExecute', async () => {
    const event = miscategorised();
    const reported = await handlerOf().tryExecute({
      event,
      state: storing().read(),
      attempt: 0,
    });
    expect(reported.ok).toBe(false);
    expect(!reported.ok && reported.error).toBeInstanceOf(ArvoHandlerFault);
  });

  it('reports the same thing either way', async () => {
    const event = miscategorised();
    const thrown = await faultFrom(
      handlerOf().execute({ event, state: storing().read(), attempt: 0 }),
    );
    const reported = await handlerOf().tryExecute({
      event,
      state: storing().read(),
      attempt: 0,
    });
    expect(!reported.ok && reported.error.faultKind).toBe(thrown.faultKind);
  });

  it('reports what was produced where nothing was refused', async () => {
    const reported = await handlerOf().tryExecute({
      event: anOrder(),
      state: storing().read(),
      attempt: 0,
    });
    expect(reported.ok && reported.value.kind).toBe('produced');
  });
});

describe('what the handler records against', () => {
  it('continues the trace the event arrived on', async () => {
    const spans: string[] = [];
    const tracer = {
      startSpan: (name: string) => {
        spans.push(name);
        return trace.getTracer('probe').startSpan(name);
      },
    } as unknown as Parameters<typeof setupArvoEventHandler>[0] extends never
      ? never
      : Parameters<typeof trace.getTracer>[0] extends never
        ? never
        : ReturnType<typeof trace.getTracer>;

    const handler = setupArvoEventHandler({
      contracts: { self: orderContract },
      telemetry: { tracer },
    })
      .handler('1.0.0', async () => {})
      .build();

    await handler.execute({
      event: anOrder(),
      state: storing().read(),
      attempt: 0,
    });
    expect(spans).toEqual(['com_order_create.execute']);
  });

  it('records with no tracer declared, every signal being a no-op', async () => {
    const ran = await handlerOf().execute({
      event: anOrder(),
      state: storing().read(),
      attempt: 0,
    });
    expect(ran.kind).toBe('produced');
  });
});

describe('an answering event that states it opens one', () => {
  it('is refused the same way, the disagreement running both directions', async () => {
    const store = storing();
    const handler = handlerOf();
    const order = anOrder();
    const asked = await handler.execute({
      event: order,
      state: store.read(),
      attempt: 0,
    });
    if (asked.kind !== 'produced') throw new Error('nothing was asked');
    store.rows.set(asked.state.executionId as string, asked.state);

    const charged = createArvoEventFactory(paymentVersion).createOutput({
      type: 'evt_payment_charged',
      source: paymentVersion.type,
      subject: order.subject,
      to: orderVersion.type,
      executionid: asked.state.executionId as string,
      initid: asked.events[0]?.id,
      parentid: asked.events[0]?.id,
      data: { receipt: 'r-1' },
    });

    const fault = await faultFrom(
      handler.execute({
        event: cloneArvoEvent(charged, { category: 'io.arvo.init' }),
        state: store.read(),
        attempt: 0,
      }),
    );
    expect(fault.faultKind).toBe('category_mismatch');
  });
});

describe('a store that rejects rather than throwing', () => {
  it('is refused the same way, however the failure was signalled', async () => {
    const fault = await faultFrom(
      handlerOf().execute({
        event: anOrder(),
        state: () => Promise.reject(new RangeError('the store went mad')),
        attempt: 0,
      }),
    );
    expect(fault.faultKind).toBe('state_resolution_failed');
    expect(fault.cause).toContain('went mad');
  });
});

describe('what the executor is given', () => {
  const handlerReading = () =>
    setupArvoEventHandler({
      contracts: { self: orderContract },
      types: {} as {
        dependencies: { note: string };
        mechanismHooks: { ticket: string };
      },
    })
      .handler('1.0.0', {
        state: z.object({ seen: z.string() }),
        execute: async (ctx) => {
          await ctx.setState({
            data: { seen: `${ctx.dependencies.note}/${ctx.hooks.ticket}` },
          });
        },
      })
      .build();

  it('reaches a dependency supplied as a value', async () => {
    const ran = await handlerReading().execute({
      event: anOrder(),
      state: storing().read(),
      attempt: 0,
      dependencies: { note: 'given' },
      hooks: { ticket: 'T-1' },
    });
    expect(ran.kind === 'produced' && ran.state.data).toEqual({
      seen: 'given/T-1',
    });
  });

  it('reaches one built by a factory for this execution alone', async () => {
    const ran = await handlerReading().execute({
      event: anOrder(),
      state: storing().read(),
      attempt: 0,
      dependencies: ({ attempt }) => ({ note: `attempt-${attempt}` }),
      hooks: { ticket: 'T-2' },
    });
    expect(ran.kind === 'produced' && ran.state.data).toEqual({
      seen: 'attempt-0/T-2',
    });
  });
});

describe('the trace an execution records on', () => {
  it('continues the one the event arrived on', async () => {
    const event = cloneArvoEvent(anOrder(), {
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    });
    const ran = await handlerOf().execute({
      event,
      state: storing().read(),
      attempt: 0,
    });
    expect(ran.kind).toBe('produced');
  });

  it('begins one where the event carried none', async () => {
    const event = anOrder();
    expect(event.traceparent).toBeNull();
    const ran = await handlerOf().execute({
      event,
      state: storing().read(),
      attempt: 0,
    });
    expect(ran.kind).toBe('produced');
  });
});

describe('a store that fails with something that is not an error', () => {
  it('is still refused, with whatever it said kept as the cause', async () => {
    const fault = await faultFrom(
      handlerOf().execute({
        event: anOrder(),
        state: () => {
          throw 'the store said only this';
        },
        attempt: 0,
      }),
    );
    expect(fault.faultKind).toBe('state_resolution_failed');
    expect(fault.cause).toBe('the store said only this');
  });
});

describe('a record holding an event that will not restore', () => {
  it('is refused as one that cannot be restored, not as one of the wrong shape', async () => {
    const store = storing();
    const handler = handlerOf();
    const order = anOrder();
    const asked = await handler.execute({
      event: order,
      state: store.read(),
      attempt: 0,
    });
    if (asked.kind !== 'produced') throw new Error('nothing was asked');

    const charged = createArvoEventFactory(paymentVersion).createOutput({
      type: 'evt_payment_charged',
      source: paymentVersion.type,
      subject: order.subject,
      to: orderVersion.type,
      executionid: asked.state.executionId as string,
      initid: asked.events[0]?.id,
      parentid: asked.events[0]?.id,
      data: { receipt: 'r-1' },
    });

    const fault = await faultFrom(
      handler.execute({
        event: charged,
        state: () =>
          ({
            ...asked.state,
            initEvent: { not: 'an event' },
          }) as JSONObject,
        attempt: 0,
      }),
    );
    expect(fault.faultKind).toBe('record_event_unrestorable');
  });
});

describe('a record carrying state its version never declared', () => {
  it('is refused rather than read under a schema that was never its own', async () => {
    const stateless = setupArvoEventHandler({
      contracts: {
        self: orderContract,
        services: { payments: paymentVersion },
      },
    })
      .handler('1.0.0', async (ctx) =>
        ctx.build({ type: 'com_payment_charge', data: { amount: 10 } }),
      )
      .build();

    const store = storing();
    const order = anOrder();
    const asked = await stateless.execute({
      event: order,
      state: store.read(),
      attempt: 0,
    });
    if (asked.kind !== 'produced') throw new Error('nothing was asked');
    expect(asked.state.data).toBeNull();

    const charged = createArvoEventFactory(paymentVersion).createOutput({
      type: 'evt_payment_charged',
      source: paymentVersion.type,
      subject: order.subject,
      to: orderVersion.type,
      executionid: asked.state.executionId as string,
      initid: asked.events[0]?.id,
      parentid: asked.events[0]?.id,
      data: { receipt: 'r-1' },
    });

    const fault = await faultFrom(
      stateless.execute({
        event: charged,
        state: () =>
          ({
            ...asked.state,
            data: { written: 'by something else' },
          }) as JSONObject,
        attempt: 0,
      }),
    );
    expect(fault.faultKind).toBe('record_invalid');
  });
});
