/**
 * Handing a handler an event. It works out what the event is, which execution
 * it concerns and which version owns it, and hands back what to publish and
 * what to commit — together, or neither.
 */

import {
  type ArvoEvent,
  type ArvoHandlerFault,
  createArvoContract,
  createArvoEventFactory,
  type JSONObject,
  setupArvoEventHandler,
} from 'arvo-core';
import { z } from 'zod';
import { type Chapter, heading } from '../display.js';

const payments = createArvoContract({
  type: 'com_payment_charge',
  versions: {
    '1.0.0': {
      input: z.object({ amount: z.number() }),
      outputs: { evt_payment_charged: z.object({ receipt: z.string() }) },
    },
  },
});

const orders = createArvoContract({
  type: 'com_order_fulfil',
  versions: {
    '1.0.0': {
      input: z.object({ items: z.array(z.string()) }),
      outputs: { evt_order_fulfilled: z.object({ order_id: z.string() }) },
    },
  },
});

const handler = setupArvoEventHandler({
  contracts: {
    self: orders,
    services: { payments: payments.versions['1.0.0'] },
  },
})
  .handler('1.0.0', {
    state: z.object({ stage: z.string() }),
    execute: async (ctx) => {
      if (ctx.entry === 'followup') {
        await ctx.setState({ data: { stage: 'answering' } });
        return ctx.build({
          type: 'evt_order_fulfilled',
          data: { order_id: ctx.state.subject },
        });
      }
      await ctx.setState({ data: { stage: 'asking' } });
      return ctx.build({ type: 'com_payment_charge', data: { amount: 10 } });
    },
  })
  .build();

/**
 * A store, which is all a handler asks of whatever runs it: something that
 * takes one identifier and answers with what is under it.
 */
const aStore = () => {
  const rows = new Map<string, JSONObject>();
  return {
    rows,
    read: ({ executionId }: { executionId: string }) =>
      rows.get(executionId) ?? null,
    commit: (row: JSONObject) => rows.set(String(row.executionId), row),
  };
};

const anOrder = () =>
  createArvoEventFactory(orders.versions['1.0.0']).createInput({
    source: 'com.web.checkout',
    subject: 'order-1',
    to: orders.type,
    data: { items: ['a book'] },
  });

/** Opening one, then answering it, which is the whole of a workflow. */
const aWholeWorkflow = async (): Promise<void> => {
  heading('one workflow, start to finish');

  const store = aStore();
  const order = anOrder();

  const asked = await handler.execute({
    event: order,
    state: store.read,
    attempt: 0,
  });
  if (asked.kind !== 'produced') return;

  console.log('  asked for:', asked.events.map((one) => one.type));
  console.log('  resting at:', asked.state.lifecycle);
  console.log('  revision:', asked.state.casVersion);
  store.commit(asked.state);

  // what the payment service sends back
  const charged = createArvoEventFactory(
    payments.versions['1.0.0'],
  ).createOutput({
    type: 'evt_payment_charged',
    source: payments.type,
    subject: order.subject,
    to: orders.type,
    executionid: String(asked.state.executionId),
    initid: (asked.events[0] as ArvoEvent).id,
    parentid: (asked.events[0] as ArvoEvent).id,
    data: { receipt: 'r-1' },
  });

  const answered = await handler.execute({
    event: charged,
    state: store.read,
    attempt: 0,
  });
  if (answered.kind !== 'produced') return;

  console.log('  answered with:', answered.events.map((one) => one.type));
  console.log('  addressed to:', answered.events[0]?.to);
  console.log('  resting at:', answered.state.lifecycle);
  console.log('  revision:', answered.state.casVersion);
};

/** The same event twice is a repeat, not a failure. */
const aRepeat = async (): Promise<void> => {
  heading('the same event twice');

  const store = aStore();
  const order = anOrder();

  const first = await handler.execute({
    event: order,
    state: store.read,
    attempt: 0,
  });
  if (first.kind !== 'produced') return;
  store.commit(first.state);

  const again = await handler.tryExecute({
    event: order,
    state: store.read,
    attempt: 0,
  });

  if (!again.ok) {
    console.log('  refused as:', again.error.faultKind);
    console.log('  retry:', again.error.retry === null ? 'no' : 'yes');
    console.log(
      '  the same execution:',
      again.error.executionId === first.state.executionId,
    );
  }
};

/** What a refusal carries, so a mechanism never has to compose anything. */
const aRefusal = async (): Promise<void> => {
  heading('an event nothing can place');

  const stranger = createArvoContract({
    type: 'com_something_else',
    versions: {
      '1.0.0': { input: z.object({ whatever: z.string() }), outputs: {} },
    },
  });

  const reported = await handler.tryExecute({
    event: createArvoEventFactory(stranger.versions['1.0.0']).createInput({
      source: 'com.web.checkout',
      subject: 'order-1',
      to: stranger.type,
      data: { whatever: 'this' },
    }),
    state: aStore().read,
    attempt: 0,
  });

  if (reported.ok) return;
  const fault: ArvoHandlerFault = reported.error;
  console.log('  refused as:', fault.faultKind);
  console.log('  names an execution:', fault.executionId !== null);
  console.log('  anything to give up with:', fault.abandonmentEvent !== null);
  for (const violation of fault.violations) console.log(`  ${violation}`);
};

export const chapter: Chapter = {
  title: '14. running an event through a handler',
  run: async () => {
    await aWholeWorkflow();
    await aRepeat();
    await aRefusal();
  },
};
