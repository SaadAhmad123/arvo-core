/**
 * The CloudEvent boundary. `ArvoEventSerializer` uses `CloudEventConverter`
 * underneath, but you can reach for it directly when you want the CloudEvent
 * object rather than a string -- publishing through an SDK that already
 * speaks CloudEvents, say.
 */

import { CloudEvent, CloudEventConverter, createArvoEvent } from 'arvo-core';
import { type Chapter, heading, indent } from '../display.js';

/**
 * Fields CloudEvent already has (id, source, type, subject, time) map
 * straight across. Everything Arvo-specific becomes an `arvo*` extension,
 * and extensions are strings on the wire -- note `depth`.
 */
const bothDirections = async (): Promise<void> => {
  heading('out to a CloudEvent, and back');

  const converter = new CloudEventConverter();
  const event = createArvoEvent({
    subject: 'order-42',
    source: 'order-service',
    type: 'order.created',
    data: { amount: 100 },
    dataschema: '#/contracts/order',
  });

  const cloudEvent = await converter.convert(event);
  console.log('type:           ', cloudEvent.type);
  console.log(
    'subject:        ',
    cloudEvent.subject,
    '(native, not an extension)',
  );
  console.log('datacontenttype:', cloudEvent.datacontenttype);
  console.log(
    'arvo extensions:',
    Object.fromEntries(
      Object.entries(cloudEvent).filter(([key]) => key.startsWith('arvo')),
    ),
  );

  const back = await converter.revert(cloudEvent);
  console.log('reverted subject:', back.subject);
};

/**
 * Strict reversion rejects anything not Arvo-shaped. Supply a fallback and the
 * foreign event is adapted instead: you provide what Arvo requires and the
 * source event cannot supply.
 */
const aForeignOne = async (): Promise<void> => {
  heading('adapting one that is not ours');

  const converter = new CloudEventConverter();

  const foreign = new CloudEvent({
    id: 'stripe-evt-1',
    // Arvo wants a URI-reference that survives normalization unchanged, so
    // "https://stripe.com" is rejected -- it normalizes to a trailing slash
    // and no longer matches what you wrote. Give it a path.
    source: 'https://stripe.com/webhooks',
    type: 'payment.succeeded',
    specversion: '1.0',
    data: { amount: 2000 },
  });

  const strict = await converter.tryRevert(foreign);
  if (!strict.ok) {
    console.log('without a fallback, rejected:');
    console.log(indent(strict.error.message));
  }

  const adapted = await converter.revert(foreign, {
    dataschema: '#/contracts/payment',
    subject: 'payment-1',
    to: 'billing-service',
  });
  console.log('\nwith a fallback:');
  console.log('  subject:', adapted.subject);
  console.log('  to:     ', adapted.to);
  console.log('  data:   ', JSON.stringify(adapted.data));
};

export const chapter: Chapter = {
  title: '04. The CloudEvent boundary',
  run: async () => {
    await bothDirections();
    await aForeignOne();
  },
};
