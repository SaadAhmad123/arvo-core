import { z } from 'zod';
import { ArvoContract } from '../../src/ArvoContract/index.js';
import { createArvoEventFactory } from '../../src/factories/ArvoEventFactory/index.js';

/** What the handler under test implements. */
export const orderContract = new ArvoContract({
  type: 'com_order_create',
  versions: {
    '1.0.0': {
      input: z.object({ items: z.array(z.string()) }),
      outputs: { com_order_created: z.object({ order_id: z.string() }) },
    },
  },
});

/** One service it may send to. */
export const paymentContract = new ArvoContract({
  type: 'com_payment_charge',
  versions: {
    '1.0.0': {
      input: z.object({ amount: z.number() }),
      outputs: { evt_payment_charged: z.object({ receipt: z.string() }) },
    },
  },
});

export const orderVersion = orderContract.versions['1.0.0'];
export const paymentVersion = paymentContract.versions['1.0.0'];
export const services = { payments: paymentVersion };

/** The event that opens an execution. */
export const initEvent = createArvoEventFactory(orderVersion).createInput({
  source: 'com.web.checkout',
  subject: 'order-42',
  data: { items: ['book'] },
});

/** What the payment service answers with. */
export const chargedEvent = createArvoEventFactory(paymentVersion).createOutput(
  {
    type: 'evt_payment_charged',
    source: 'com.payment.service',
    subject: initEvent.subject,
    data: { receipt: 'r-1' },
  },
);

/** What the payment service answers with when it could not. */
export const paymentFailedEvent = createArvoEventFactory(
  paymentVersion,
).createError({
  source: 'com.payment.service',
  subject: initEvent.subject,
  error: new Error('card declined'),
});
