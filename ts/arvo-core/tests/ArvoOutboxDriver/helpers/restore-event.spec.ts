import { describe, expect, it } from 'vitest';
import { restoreEvent } from '../../../src/ArvoOutboxDriver/helpers/restore-event.js';
import { createArvoEvent } from '../../../src/factories/createArvoEvent.js';
import { ArvoEventSerializer } from '../../../src/serializers/ArvoEventSerializer/index.js';

const serializer = new ArvoEventSerializer({ type: 'cloudevent' });

/** An event Arvo produced, as the driver stores it. */
const storedPayload = () =>
  serializer.serialize(
    createArvoEvent({
      type: 'com_payment_charge',
      source: 'com_order_create',
      dataschema: '#/com/payment/charge/1.0.0',
      data: { amount: 10 },
    }),
  );

describe('restoring a stored payload to a live event', () => {
  it('restores an event Arvo produced to the same event', async () => {
    const payload = await storedPayload();
    const restoredResult = await restoreEvent(serializer, payload);
    expect(restoredResult.ok).toBe(true);
    if (restoredResult.ok) {
      expect(await serializer.serialize(restoredResult.value)).toBe(payload);
    }
  });

  it.each([
    ['is not JSON', 'not json {'],
    ['is JSON but no CloudEvent', JSON.stringify({ hello: 'world' })],
  ])('refuses a payload that %s', async (_refusalReason, payload) => {
    expect((await restoreEvent(serializer, payload)).ok).toBe(false);
  });

  it('refuses a CloudEvent that is not Arvo-shaped, even one carrying every field an event needs', async () => {
    const foreignCloudEvent = {
      specversion: '1.0',
      id: crypto.randomUUID(),
      source: 'com_order_create',
      type: 'com_payment_charge',
      subject: 'subject-1',
      time: new Date().toISOString(),
      datacontenttype: 'application/json',
      dataschema: '#/com/payment/charge/1.0.0',
      executionid: crypto.randomUUID(),
      data: { amount: 10 },
    };
    expect(
      (await restoreEvent(serializer, JSON.stringify(foreignCloudEvent))).ok,
    ).toBe(false);
  });

  it('refuses an Arvo-shaped CloudEvent that is broken', async () => {
    const storedCloudEvent = JSON.parse(await storedPayload());
    delete storedCloudEvent.source;
    expect(
      (await restoreEvent(serializer, JSON.stringify(storedCloudEvent))).ok,
    ).toBe(false);
  });
});
